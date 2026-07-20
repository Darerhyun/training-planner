import { Storage } from '@google-cloud/storage';
import { Hono } from 'hono';
import { authMiddleware, getDb, requireRole } from '@training-planner/shared';
import type { AppEnv } from '@training-planner/shared';
import {
  applyScheduleParseResult,
  parseScheduleWorkbook,
  type ScheduleApplyResult,
  type ScheduleParseResult,
} from '../ingest/parse-schedule.js';
import { ScheduleHeaderError } from '../ingest/master-schedule-mapping.js';

const storage = new Storage();

export const syncRoutes = new Hono<AppEnv>();

syncRoutes.use('/sync/*', authMiddleware(), requireRole('admin', 'ops'));

syncRoutes.post('/sync/parse-schedule', async (c) => {
  const body = await c.req.json().catch(() => null);
  const uploadBatchId =
    typeof body?.uploadBatchId === 'string' ? body.uploadBatchId.trim() : '';

  if (!uploadBatchId) {
    return c.json({ error: 'uploadBatchId is required' }, 400);
  }

  const batch = await findUploadBatch(uploadBatchId);
  if (!batch) {
    return c.json({ error: 'Upload batch not found' }, 404);
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
    parseResult = await parseScheduleWorkbook(buffer);
  } catch (error) {
    console.error('Schedule parse failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    return c.json(
      { error: `Schedule parse failed: ${message}` },
      error instanceof ScheduleHeaderError ? 422 : 500,
    );
  }

  if (!parseResult.summary.requiresConfirmation) {
    const applied = await applyScheduleParseResult(uploadBatchId, parseResult);
    parseResult.summary.autoApplied = true;
    await saveParseResult(uploadBatchId, 'applied', parseResult, applied);
    return c.json({ ...parseResult, applied });
  }

  await saveParseResult(
    uploadBatchId,
    parseResult.summary.blocked ? 'blocked' : 'parsed',
    parseResult,
  );

  return c.json(parseResult, parseResult.summary.blocked ? 409 : 200);
});

syncRoutes.post('/sync/:batchId/confirm', async (c) => {
  const batch = await findUploadBatch(c.req.param('batchId'));
  if (!batch?.parse_result) {
    return c.json({ error: 'Parsed batch not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const manualOverride = body?.manualOverride === true;
  const parseResult = batch.parse_result as ScheduleParseResult;

  if (parseResult.summary.blocked && !manualOverride) {
    return c.json(
      { error: 'Manual override is required for the cancellation guard.' },
      409,
    );
  }

  const applied = await applyScheduleParseResult(batch.id, parseResult);
  await saveParseResult(batch.id, 'applied', parseResult, applied);

  return c.json({ ...parseResult, applied });
});

syncRoutes.post('/sync/:batchId/cancel', async (c) => {
  const updated = await getDb()(
    `UPDATE upload_batches
     SET status = 'rejected'
     WHERE id = $1
     RETURNING id, status`,
    [c.req.param('batchId')],
  );

  if (updated.length === 0) {
    return c.json({ error: 'Upload batch not found' }, 404);
  }

  return c.json(updated[0]);
});

async function findUploadBatch(batchId: string): Promise<{
  id: string;
  gcs_object_name: string;
  parse_result: unknown;
} | null> {
  const rows = await getDb()(
    `SELECT id, gcs_object_name, parse_result
     FROM upload_batches
     WHERE id = $1`,
    [batchId],
  );

  return (rows[0] as { id: string; gcs_object_name: string; parse_result: unknown } | undefined) ?? null;
}

async function saveParseResult(
  batchId: string,
  status: 'parsed' | 'blocked' | 'applied',
  parseResult: ScheduleParseResult,
  applied?: ScheduleApplyResult,
): Promise<void> {
  await getDb()(
    `UPDATE upload_batches
     SET status = $2::upload_batch_status,
       parse_result = $3::jsonb,
       applied_at = CASE WHEN $2::upload_batch_status = 'applied'::upload_batch_status THEN now() ELSE applied_at END
     WHERE id = $1`,
    [batchId, status, JSON.stringify(applied ? { ...parseResult, applied } : parseResult)],
  );
}