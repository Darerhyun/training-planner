import { Storage } from '@google-cloud/storage';
import { Hono, type MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, SqlQuery, TransactionHandler } from '@training-planner/shared';
import {
  applyScheduleParseResult,
  parseScheduleWorkbook,
  type ScheduleApplyResult,
  type ScheduleParseResult,
} from '../ingest/parse-schedule.js';
import { ScheduleHeaderError } from '../ingest/master-schedule-mapping.js';

type SyncStorage = {
  bucket(name: string): {
    file(name: string): {
      download(): Promise<[Buffer, ...unknown[]]>;
    };
  };
};

type SyncRouteOptions = {
  db?: SqlQuery;
  storage?: SyncStorage;
  auth?: MiddlewareHandler<AppEnv>;
  writeRoles?: MiddlewareHandler<AppEnv>;
  transaction?: <T>(handler: TransactionHandler<T>) => Promise<T>;
  parseWorkbook?: (buffer: Buffer) => Promise<ScheduleParseResult>;
};

type UploadBatchStatus = 'uploaded' | 'parsed' | 'applied' | 'blocked' | 'rejected';

type UploadBatchRow = {
  id: string;
  gcs_object_name: string;
  status: UploadBatchStatus;
  parse_result: unknown;
};

type SyncResponseBody = ScheduleParseResult & { applied?: ScheduleApplyResult };

type SyncOutcome = {
  body: SyncResponseBody;
  status: 200 | 409;
};

class SyncHttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    message: string,
    public readonly body: Record<string, unknown> = { error: message },
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}

export function createSyncRoutes(options: SyncRouteOptions = {}): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const db: SqlQuery = options.db ?? ((query, params) => getDb()(query, params));
  const storage: SyncStorage = options.storage ?? (new Storage() as unknown as SyncStorage);
  const runTransaction = options.transaction ?? withTransaction;
  const parseWorkbook = options.parseWorkbook ?? parseScheduleWorkbook;

  routes.use(
    '/sync/*',
    options.auth ?? authMiddleware(),
    options.writeRoles ?? requireRole('admin', 'ops'),
  );

  routes.post('/sync/parse-schedule', async (c) => {
    const body = await c.req.json().catch(() => null);
    const uploadBatchId =
      typeof body?.uploadBatchId === 'string' ? body.uploadBatchId.trim() : '';

    if (!uploadBatchId) {
      return c.json({ error: 'uploadBatchId is required' }, 400);
    }

    const batch = await findUploadBatch(db, uploadBatchId);
    if (!batch) {
      return c.json({ error: 'Upload batch not found' }, 404);
    }

    // Once a preview or application has been recorded, return that durable
    // result. This makes duplicate parse requests safe while a confirmation
    // request may race with a still-in-flight download/parse.
    const replay = replayStoredBatch(batch);
    if (replay) return c.json(replay.body, replay.status);
    if (batch.status !== 'uploaded') {
      return c.json({ error: 'Upload batch is not ready for parsing.' }, 409);
    }

    const bucketName = process.env.GCS_UPLOAD_BUCKET;
    if (!bucketName) {
      return c.json({ error: 'GCS_UPLOAD_BUCKET is not configured' }, 500);
    }

    let parseResult: ScheduleParseResult;
    try {
      const [buffer] = await storage
        .bucket(bucketName)
        .file(batch.gcs_object_name)
        .download();
      parseResult = await parseWorkbook(buffer);
    } catch (error) {
      console.error('Schedule parse failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      return c.json(
        { error: `Schedule parse failed: ${message}` },
        error instanceof ScheduleHeaderError ? 422 : 500,
      );
    }

    try {
      const outcome = await runTransaction(async (tx) => {
        const lockedBatch = await findUploadBatch(tx, uploadBatchId, true);
        if (!lockedBatch) throw new SyncHttpError(404, 'Upload batch not found');

        const lockedReplay = replayStoredBatch(lockedBatch);
        if (lockedReplay) return lockedReplay;
        if (lockedBatch.status !== 'uploaded') {
          throw new SyncHttpError(409, 'Upload batch is not ready for parsing.');
        }

        if (!parseResult.summary.requiresConfirmation) {
          const applied = await applyScheduleParseResult(uploadBatchId, parseResult, tx);
          parseResult.summary.autoApplied = true;
          await saveParseResult(tx, uploadBatchId, 'applied', parseResult, applied);
          return { body: { ...parseResult, applied }, status: 200 } satisfies SyncOutcome;
        }

        const status = parseResult.summary.blocked ? 'blocked' : 'parsed';
        await saveParseResult(tx, uploadBatchId, status, parseResult);
        return {
          body: parseResult,
          status: parseResult.summary.blocked ? 409 : 200,
        } satisfies SyncOutcome;
      });

      return c.json(outcome.body, outcome.status);
    } catch (error) {
      if (error instanceof SyncHttpError) return c.json(error.body, error.status);
      throw error;
    }
  });

  routes.post('/sync/:batchId/confirm', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const manualOverride = body?.manualOverride === true;

    try {
      const outcome = await runTransaction(async (tx) => {
        const batch = await findUploadBatch(tx, c.req.param('batchId'), true);
        if (!batch?.parse_result) {
          throw new SyncHttpError(404, 'Parsed batch not found');
        }

        // A second confirmation observes the committed result after waiting
        // on the batch lock and returns the exact first response body.
        const replay = replayAppliedBatch(batch);
        if (replay) return replay;

        if (batch.status === 'rejected') {
          throw new SyncHttpError(409, 'Upload batch has been rejected.');
        }

        const parseResult = batch.parse_result as ScheduleParseResult;
        if (parseResult.summary.blocked && !manualOverride) {
          throw new SyncHttpError(
            409,
            'Manual override is required for the cancellation guard.',
          );
        }

        const applied = await applyScheduleParseResult(batch.id, parseResult, tx);
        await saveParseResult(tx, batch.id, 'applied', parseResult, applied);
        return { body: { ...parseResult, applied }, status: 200 } satisfies SyncOutcome;
      });

      return c.json(outcome.body, outcome.status);
    } catch (error) {
      if (error instanceof SyncHttpError) return c.json(error.body, error.status);
      throw error;
    }
  });

  routes.post('/sync/:batchId/cancel', async (c) => {
    try {
      const outcome = await runTransaction(async (tx) => {
        const batch = await findUploadBatch(tx, c.req.param('batchId'), true);
        if (!batch) throw new SyncHttpError(404, 'Upload batch not found');
        if (batch.status === 'applied') {
          throw new SyncHttpError(409, 'Applied upload batches cannot be cancelled.');
        }
        if (batch.status === 'rejected') {
          return { id: batch.id, status: batch.status };
        }

        const updated = await tx<{ id: string; status: UploadBatchStatus }>(
          `UPDATE upload_batches
           SET status = 'rejected'
           WHERE id = $1
           RETURNING id, status::text AS status`,
          [batch.id],
        );
        if (updated.length === 0) {
          throw new SyncHttpError(404, 'Upload batch not found');
        }
        return updated[0];
      });

      return c.json(outcome);
    } catch (error) {
      if (error instanceof SyncHttpError) return c.json(error.body, error.status);
      throw error;
    }
  });

  return routes;
}

export const syncRoutes = createSyncRoutes();

function replayAppliedBatch(batch: UploadBatchRow): SyncOutcome | null {
  if (batch.status !== 'applied' || !batch.parse_result) return null;
  return { body: batch.parse_result as SyncResponseBody, status: 200 };
}

function replayStoredBatch(batch: UploadBatchRow): SyncOutcome | null {
  if (!batch.parse_result) return null;
  if (batch.status === 'applied') return replayAppliedBatch(batch);
  if (batch.status === 'blocked') {
    return { body: batch.parse_result as SyncResponseBody, status: 409 };
  }
  if (batch.status === 'parsed') {
    const result = batch.parse_result as SyncResponseBody;
    return {
      body: result,
      status: result.summary.blocked ? 409 : 200,
    };
  }
  return null;
}

async function findUploadBatch(
  db: SqlQuery,
  batchId: string,
  forUpdate = false,
): Promise<UploadBatchRow | null> {
  const rows = await db<UploadBatchRow>(
    `SELECT id, gcs_object_name, status::text AS status, parse_result
     FROM upload_batches
     WHERE id = $1${forUpdate ? '\n     FOR UPDATE' : ''}`,
    [batchId],
  );

  return rows[0] ?? null;
}

async function saveParseResult(
  db: SqlQuery,
  batchId: string,
  status: 'parsed' | 'blocked' | 'applied',
  parseResult: ScheduleParseResult,
  applied?: ScheduleApplyResult,
): Promise<void> {
  await db(
    `UPDATE upload_batches
     SET status = $2::upload_batch_status,
       parse_result = $3::jsonb,
       applied_at = CASE WHEN $2::upload_batch_status = 'applied'::upload_batch_status THEN now() ELSE applied_at END
     WHERE id = $1`,
    [batchId, status, JSON.stringify(applied ? { ...parseResult, applied } : parseResult)],
  );
}
