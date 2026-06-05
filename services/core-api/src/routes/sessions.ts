import { Hono } from 'hono';
import { authMiddleware, getDb, requireRole } from '@training-planner/shared';
import type { AppEnv } from '@training-planner/shared';

export const sessionsRoutes = new Hono<AppEnv>();

sessionsRoutes.use(
  '/sessions/*',
  authMiddleware(),
  requireRole('admin', 'ops', 'finance', 'viewer'),
);

sessionsRoutes.get('/sessions', async (c) => {
  const status = c.req.query('status');
  const rows = await getDb()(
    `SELECT
      s.id,
      s.course_code,
      s.tms_code,
      COALESCE(c.name, s.source_course_name) AS course_name,
      s.trainer_id,
      COALESCE(t.name, s.raw_trainer_name) AS trainer_name,
      s.venue_code,
      v.name AS venue_name,
      s.room_id,
      r.name AS room_name,
      s.status,
      s.start_date::text AS start_date,
      s.end_date::text AS end_date,
      s.time_text,
      s.expected_pax,
      s.confirmed_pax,
      s.external_ref,
      s.created_at,
      s.updated_at
     FROM sessions s
     LEFT JOIN courses c ON c.code = s.course_code
     LEFT JOIN trainers t ON t.trainer_id = s.trainer_id
     LEFT JOIN venues v ON v.code = s.venue_code
     LEFT JOIN rooms r ON r.room_id = s.room_id
     WHERE ($1::text IS NULL OR s.status::text = $1)
     ORDER BY s.start_date ASC, s.time_text ASC NULLS LAST
     LIMIT 500`,
    [status ?? null],
  );

  return c.json({ sessions: rows });
});