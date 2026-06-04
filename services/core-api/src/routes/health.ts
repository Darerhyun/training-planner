import { Hono } from 'hono';
import { getDb } from '@training-planner/shared';

export const healthRoutes = new Hono();

/**
 * GET /health
 *
 * Public endpoint (no auth). Returns service status + database connectivity.
 * Cloud Run uses this for liveness / readiness probes.
 */
healthRoutes.get('/health', async (c) => {
  const checks: Record<string, string | number> = {
    status: 'ok',
    service: 'core-api',
    timestamp: new Date().toISOString(),
  };

  try {
    const result = await getDb()('SELECT 1 AS ok');
    checks.database = result[0]?.ok === 1 ? 'connected' : 'error';
  } catch {
    checks.database = 'error';
    checks.status = 'degraded';
  }

  const statusCode = checks.status === 'ok' ? 200 : 503;
  return c.json(checks, statusCode);
});
