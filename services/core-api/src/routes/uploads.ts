import crypto from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { Hono } from 'hono';
import { authMiddleware, getDb, requireRole } from '@training-planner/shared';
import type { AppEnv } from '@training-planner/shared';

const storage = new Storage();

export const uploadsRoutes = new Hono<AppEnv>();

uploadsRoutes.use('/uploads/*', authMiddleware(), requireRole('admin', 'ops'));

uploadsRoutes.post('/uploads/signed-url', async (c) => {
  const { user } = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
  const requestedContentType =
    typeof body?.contentType === 'string' ? body.contentType.trim() : '';
  const contentType =
    requestedContentType ||
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (!filename) {
    return c.json({ error: 'filename is required' }, 400);
  }

  const bucketName = process.env.GCS_UPLOAD_BUCKET;
  if (!bucketName) {
    return c.json({ error: 'GCS_UPLOAD_BUCKET is not configured' }, 500);
  }

  const objectName = `master-schedules/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;
  const [signedUrl] = await storage
    .bucket(bucketName)
    .file(objectName)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType,
    });

  const inserted = await getDb()(
    `INSERT INTO upload_batches (original_filename, gcs_object_name, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, original_filename, gcs_object_name, status, created_at`,
    [filename, objectName, user.id],
  );

  return c.json({
    upload: inserted[0],
    signedUrl,
    method: 'PUT',
    contentType,
  });
});

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}