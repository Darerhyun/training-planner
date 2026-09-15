import { createHash } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { Hono, type MiddlewareHandler } from 'hono';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, SqlQuery, TransactionHandler } from '@training-planner/shared';
import { HttpError } from '../lib/http-error.js';
import {
  applyScheduleParseResult, computeSchedulePreviewDigest, isSchedulePreviewBlocked,
  lockScheduleResolution, resolveSchedulePreview, ScheduleApplyBlockedError,
  ScheduleApplyConflictError, ScheduleApplyStaleError, parseScheduleWorkbook,
  type ScheduleApplyResult, type SchedulePreview, type ScheduleParseResult, type ScheduleRowDecision,
} from '../ingest/parse-schedule.js';
import { ScheduleHeaderError } from '../ingest/master-schedule-mapping.js';

type SyncStorage = {
  bucket(name: string): { file(name: string): { download(): Promise<[Buffer, ...unknown[]]> } };
};
type SyncRouteOptions = {
  db?: SqlQuery;
  storage?: SyncStorage;
  auth?: MiddlewareHandler<AppEnv>;
  writeRoles?: MiddlewareHandler<AppEnv>;
  transaction?: <T>(handler: TransactionHandler<T>) => Promise<T>;
  parseWorkbook?: (buffer: Buffer, db: SqlQuery) => Promise<ScheduleParseResult>;
};
type UploadBatchStatus = 'uploaded' | 'parsed' | 'applied' | 'blocked' | 'rejected';
type UploadBatchRow = {
  id: string; gcs_object_name: string; original_workbook_sha256: string | null;
  status: UploadBatchStatus; parse_result: unknown; acknowledged_digest: string | null;
};
type SyncResponseBody = SchedulePreview & { applied?: ScheduleApplyResult };
type SyncOutcome = { body: SyncResponseBody; status: 200 | 409 };
const STALE_MESSAGE = 'Schedule Preview is stale. Run Re-check, review the new Preview, and acknowledge it before applying.';

export function createSyncRoutes(options: SyncRouteOptions = {}): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const db: SqlQuery = options.db ?? ((query, params) => getDb()(query, params));
  const storage: SyncStorage = options.storage ?? (new Storage() as unknown as SyncStorage);
  const runTransaction = options.transaction ?? withTransaction;
  const parseWorkbook = options.parseWorkbook ?? parseScheduleWorkbook;
  routes.use('/sync/*', options.auth ?? authMiddleware(), options.writeRoles ?? requireRole('admin', 'ops'));

  async function generate(batch: UploadBatchRow, tx: SqlQuery, rechecked: boolean, decisions: ScheduleRowDecision[]): Promise<SchedulePreview> {
    if (rechecked && !batch.original_workbook_sha256) throw new HttpError(409,
      'The original workbook identity is unavailable. Cancel this Preview and upload the workbook again.', { code: 'sync_upload_unavailable' });
    const bucket = process.env.GCS_UPLOAD_BUCKET;
    if (!bucket) throw new HttpError(500, 'GCS_UPLOAD_BUCKET is not configured');
    let buffer: Buffer;
    try {
      [buffer] = await storage.bucket(bucket).file(batch.gcs_object_name).download();
    } catch (error) {
      const code = isRecord(error) ? error.code : null;
      if (code === 404 || code === '404') throw new HttpError(409,
        'The uploaded workbook is no longer available. Cancel this Preview and upload the workbook again.', { code: 'sync_upload_unavailable' });
      throw new HttpError(503, 'The workbook could not be read. The stored Preview is unchanged. Retry Re-check when storage is available.', { code: 'sync_recheck_failed' });
    }
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (batch.original_workbook_sha256 && hash !== batch.original_workbook_sha256) throw new HttpError(409,
      'The original workbook has changed. Cancel this Preview and upload the workbook again.', { code: 'sync_workbook_changed' });
    if (rechecked && (batch.parse_result as SchedulePreview).resolution?.freshness.objectName !== batch.gcs_object_name) {
      throw new ScheduleApplyStaleError('The original workbook object changed.');
    }
    await lockScheduleResolution(tx);
    const parsed = await parseWorkbook(buffer, tx);
    return resolveSchedulePreview(parsed, {
      batchId: batch.id, objectName: batch.gcs_object_name, workbookSha256: hash, rechecked,
    }, decisions, tx);
  }

  routes.post('/sync/parse-schedule', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const id = isRecord(body) && typeof body.uploadBatchId === 'string' ? body.uploadBatchId.trim() : '';
    if (!id) return c.json({ error: 'uploadBatchId is required' }, 400);
    try {
      const batch = await findUploadBatch(db, id);
      if (!batch) throw new HttpError(404, 'Upload batch not found');
      const replay = replayStoredBatch(batch);
      if (replay) return c.json(replay.body, replay.status);
      const outcome = await runTransaction(async (tx) => {
        const locked = await findUploadBatch(tx, id, true);
        if (!locked) throw new HttpError(404, 'Upload batch not found');
        const stored = replayStoredBatch(locked);
        if (stored) return stored;
        if (locked.status !== 'uploaded') throw new HttpError(409, 'Upload batch is not ready for parsing.');
        const preview = await generate(locked, tx, false, []);
        await saveParseResult(tx, id, preview);
        return previewOutcome(preview);
      });
      return c.json(outcome.body, outcome.status);
    } catch (error) {
      const failure = syncError(error); return c.json(failure.body, failure.status);
    }
  });

  routes.post('/sync/:batchId/re-check', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    try {
      const outcome = await runTransaction(async (tx) => {
        const batch = await editableBatch(tx, c.req.param('batchId'));
        const previous = validatePreview(batch, body);
        const decisions = parseDecisions(body, previous, c.get('auth').user.id);
        const preview = await generate(batch, tx, true, decisions);
        // No earlier update: failures retain the exact last successful Preview.
        await saveParseResult(tx, batch.id, preview);
        return previewOutcome(preview);
      });
      return c.json(outcome.body, outcome.status);
    } catch (error) {
      const failure = syncError(error); return c.json(failure.body, failure.status);
    }
  });

  routes.post('/sync/:batchId/confirm', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    try {
      const outcome = await runTransaction(async (tx) => {
        const batch = await findUploadBatch(tx, c.req.param('batchId'), true);
        if (!batch?.parse_result) throw new HttpError(404, 'Parsed batch not found');
        if (batch.status === 'rejected') throw new HttpError(409, 'Upload batch has been rejected.');
        if (!isRecord(body) || body.acknowledged !== true) throw new HttpError(400,
          'Explicit acknowledgement of the current schedule Preview is required.', { code: 'sync_preview_acknowledgement_required' });
        const preview = validatePreview(batch, body);
        if (batch.status === 'applied') {
          if (!batch.acknowledged_digest || batch.acknowledged_digest !== preview.previewDigest) {
            throw new HttpError(409, STALE_MESSAGE, { code: 'stale_sync_preview' });
          }
          return { body: preview, status: 200 } satisfies SyncOutcome;
        }
        if (!preview.resolution?.rechecked) throw new HttpError(409,
          'Run a successful Re-check before acknowledging and applying this Preview.', { code: 'sync_recheck_required' });
        if (isSchedulePreviewBlocked(preview)) throw new ScheduleApplyBlockedError();
        const fresh = await generate(batch, tx, true, preview.resolution.decisions);
        if (fresh.previewDigest !== preview.previewDigest) throw new ScheduleApplyStaleError();
        const applied = await applyScheduleParseResult(batch.id, fresh, tx);
        await saveParseResult(tx, batch.id, fresh, applied, c.get('auth').user.id);
        return { body: { ...fresh, applied }, status: 200 } satisfies SyncOutcome;
      });
      return c.json(outcome.body, outcome.status);
    } catch (error) {
      const failure = syncError(error); return c.json(failure.body, failure.status);
    }
  });

  routes.post('/sync/:batchId/cancel', async (c) => {
    try {
      const outcome = await runTransaction(async (tx) => {
        const batch = await findUploadBatch(tx, c.req.param('batchId'), true);
        if (!batch) throw new HttpError(404, 'Upload batch not found');
        if (batch.status === 'applied') throw new HttpError(409, 'Applied upload batches cannot be cancelled.');
        if (batch.status === 'rejected') return { id: batch.id, status: batch.status };
        const [updated] = await tx<{ id: string; status: UploadBatchStatus }>(
          "UPDATE upload_batches SET status = 'rejected' WHERE id = $1 RETURNING id, status::text AS status", [batch.id],
        );
        if (!updated) throw new HttpError(404, 'Upload batch not found');
        return updated;
      });
      return c.json(outcome);
    } catch (error) {
      const failure = syncError(error); return c.json(failure.body, failure.status);
    }
  });
  return routes;
}

export const syncRoutes = createSyncRoutes();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function syncError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof ScheduleApplyBlockedError) return new HttpError(409,
    'Schedule Preview is blocked and cannot be applied.', { code: 'sync_preview_blocked' });
  if (error instanceof ScheduleApplyConflictError || error instanceof ScheduleApplyStaleError ||
    (isRecord(error) && ['40001', '40P01', '55P03'].includes(String(error.code)))) {
    return new HttpError(409, STALE_MESSAGE, { code: 'stale_sync_preview' });
  }
  if (error instanceof ScheduleHeaderError) return new HttpError(422, error.message, { code: 'sync_parse_failed' });
  return new HttpError(500, 'Sync could not complete. No changes were committed; the last stored Preview is unchanged.', { code: 'sync_recheck_failed' });
}
function validatePreview(batch: UploadBatchRow, body: unknown): SyncResponseBody {
  const preview = batch.parse_result as SyncResponseBody;
  if (!preview?.previewDigest || !preview.resolution || !isRecord(body) || body.previewDigest !== preview.previewDigest ||
    preview.previewDigest !== computeSchedulePreviewDigest(preview)) {
    throw new HttpError(409, STALE_MESSAGE, { code: 'stale_sync_preview' });
  }
  return preview;
}
function parseDecisions(body: unknown, previous: SyncResponseBody, actorId: string): ScheduleRowDecision[] {
  if (!isRecord(body) || !Array.isArray(body.decisions)) {
    throw new HttpError(400, 'Re-check decisions are required.', { code: 'invalid_sync_decision' });
  }
  const seen = new Set<string>();
  const now = new Date().toISOString();
  const prior = new Map(previous.resolution?.decisions.map((decision) => [decision.sourceRowId, decision]) ?? []);
  return body.decisions.map((candidate) => {
    if (!isRecord(candidate) || candidate.action !== 'skip' || typeof candidate.sourceRowId !== 'string'
      || typeof candidate.reason !== 'string') {
      throw new HttpError(400, 'Each Re-check decision must be a single server-issued row skip.', { code: 'invalid_sync_decision' });
    }
    const sourceRowId = candidate.sourceRowId.trim();
    const reason = candidate.reason.trim();
    if (!sourceRowId || seen.has(sourceRowId) || !reason || reason.length > 500) {
      throw new HttpError(400, 'Each skip needs a unique source row and a reason of 1–500 characters.', { code: 'invalid_sync_decision' });
    }
    seen.add(sourceRowId);
    const saved = prior.get(sourceRowId);
    if (saved?.reason === reason) return saved;
    return { sourceRowId, action: 'skip', reason, actorId, decidedAt: now };
  });
}
function previewOutcome(preview: SyncResponseBody): SyncOutcome {
  return { body: preview, status: isSchedulePreviewBlocked(preview) ? 409 : 200 };
}
function replayStoredBatch(batch: UploadBatchRow): SyncOutcome | null {
  if (!batch.parse_result) return null;
  if (!(batch.parse_result as SchedulePreview).resolution) {
    throw new HttpError(409,
      'This Preview predates Re-check evidence. Cancel this Preview and upload the workbook again.',
      { code: 'sync_upload_unavailable' });
  }
  if (batch.status === 'applied') return { body: batch.parse_result as SyncResponseBody, status: 200 };
  if (batch.status === 'parsed' || batch.status === 'blocked') return previewOutcome(batch.parse_result as SyncResponseBody);
  return null;
}
async function editableBatch(db: SqlQuery, id: string): Promise<UploadBatchRow> {
  const batch = await findUploadBatch(db, id, true);
  if (!batch?.parse_result) throw new HttpError(404, 'Parsed batch not found');
  if (batch.status !== 'parsed' && batch.status !== 'blocked') throw new HttpError(409, 'This batch is terminal and cannot be changed.');
  return batch;
}
async function findUploadBatch(db: SqlQuery, id: string, lock = false): Promise<UploadBatchRow | null> {
  const [batch] = await db<UploadBatchRow>(
    `SELECT id, gcs_object_name, original_workbook_sha256, status::text AS status, parse_result,
       acknowledged_digest
     FROM upload_batches WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id],
  );
  return batch ?? null;
}
async function saveParseResult(db: SqlQuery, id: string, preview: SchedulePreview, applied?: ScheduleApplyResult, actorId?: string): Promise<void> {
  await db(
    `UPDATE upload_batches SET status = $2::upload_batch_status, parse_result = $3::jsonb,
       original_workbook_sha256 = COALESCE(original_workbook_sha256, $4),
       applied_at = CASE WHEN $2 = 'applied' THEN now() ELSE applied_at END,
       acknowledged_by = CASE WHEN $2 = 'applied' THEN $5::uuid ELSE NULL END,
       acknowledged_digest = CASE WHEN $2 = 'applied' THEN $6 ELSE NULL END,
       acknowledged_at = CASE WHEN $2 = 'applied' THEN now() ELSE NULL END
     WHERE id = $1`,
    [id, applied ? 'applied' : isSchedulePreviewBlocked(preview) ? 'blocked' : 'parsed',
      JSON.stringify(applied ? { ...preview, applied } : preview), preview.resolution?.freshness.workbookSha256,
      actorId ?? null, applied ? preview.previewDigest : null],
  );
}
