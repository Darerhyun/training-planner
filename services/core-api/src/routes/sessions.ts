import { Hono, type MiddlewareHandler } from 'hono';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, SqlQuery, TransactionHandler } from '@training-planner/shared';
import { HttpError } from '../lib/http-error.js';

type SessionRouteOptions = {
  db?: SqlQuery;
  auth?: MiddlewareHandler<AppEnv>;
  activeRoles?: MiddlewareHandler<AppEnv>;
  writeRoles?: MiddlewareHandler<AppEnv>;
  transaction?: <T>(handler: TransactionHandler<T>) => Promise<T>;
};

type SessionLockRow = {
  id: string;
  course_code: string | null;
  trainer_id: string | null;
  previous_trainer_name: string | null;
  version: number;
};

type TrainerValidationRow = {
  trainer_id: string;
  name: string;
  is_active: boolean;
  module_excludes: string[] | null;
  course_linked: boolean;
};

type TrainerOptionSessionRow = {
  id: string;
  course_code: string | null;
};

type TrainerOptionRow = {
  trainer_id: string;
  name: string;
};

type UpdatedSessionRow = {
  id: string;
  trainer_id: string | null;
  trainer_name: string | null;
  management_source: 'import' | 'application';
  version: number;
  updated_at: string;
};

type HistoryRow = {
  id: string;
  session_id: string;
  action: 'trainer_assigned' | 'trainer_replaced' | 'trainer_unassigned';
  actor_user_id: string | null;
  actor_email: string | null;
  actor_display_name: string | null;
  previous_trainer_id: string | null;
  previous_trainer_name: string | null;
  new_trainer_id: string | null;
  new_trainer_name: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};


export function createSessionsRoutes(options: SessionRouteOptions = {}): Hono<AppEnv> {
  const sessionsRoutes = new Hono<AppEnv>();
  const db: SqlQuery = options.db ?? ((query, params) => getDb()(query, params));
  const runTransaction = options.transaction ?? withTransaction;

  sessionsRoutes.use(
    '/sessions/*',
    options.auth ?? authMiddleware(),
    options.activeRoles ?? requireRole('admin', 'ops', 'finance', 'viewer'),
  );

  sessionsRoutes.get('/sessions', async (c) => {
    const status = c.req.query('status');
    const rows = await db(
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
        s.management_source AS "managementSource",
        s.version,
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

  sessionsRoutes.get('/sessions/:id/history', async (c) => {
    const sessionId = c.req.param('id');
    const exists = await db<{ id: string }>('SELECT id FROM sessions WHERE id = $1', [sessionId]);
    if (exists.length === 0) return c.json({ error: 'Session not found' }, 404);

    const rows = await db<HistoryRow>(
      `SELECT
        h.id,
        h.session_id,
        h.action::text AS action,
        h.actor_user_id,
        u.email AS actor_email,
        u.display_name AS actor_display_name,
        h.previous_trainer_id,
        pt.name AS previous_trainer_name,
        h.new_trainer_id,
        nt.name AS new_trainer_name,
        h.note,
        h.metadata,
        h.created_at
       FROM session_change_history h
       LEFT JOIN users u ON u.id = h.actor_user_id
       LEFT JOIN trainers pt ON pt.trainer_id = h.previous_trainer_id
       LEFT JOIN trainers nt ON nt.trainer_id = h.new_trainer_id
       WHERE h.session_id = $1
       ORDER BY h.created_at DESC, h.id DESC`,
      [sessionId],
    );

    return c.json({ history: rows.map(mapHistory) });
  });

  sessionsRoutes.get(
    '/sessions/:id/trainer-options',
    options.writeRoles ?? requireRole('admin', 'ops'),
    async (c) => {
      const sessionRows = await db<TrainerOptionSessionRow>(
        'SELECT id, course_code FROM sessions WHERE id = $1',
        [c.req.param('id')],
      );
      const session = sessionRows[0];
      if (!session) return c.json({ error: 'Session not found' }, 404);
      if (!session.course_code) {
        return c.json({
          error: 'Unresolved courses cannot provide trainer options.',
          code: 'unresolved_session_course',
        }, 422);
      }

      const rows = await db<TrainerOptionRow>(
        `SELECT
          t.trainer_id,
          t.name
         FROM trainers t
         INNER JOIN trainer_courses tc
           ON tc.trainer_id = t.trainer_id
          AND tc.course_code = $1
         WHERE t.is_active = true
           AND NOT ($1 = ANY(COALESCE(t.module_excludes, ARRAY[]::text[])))
         GROUP BY t.trainer_id, t.name
         ORDER BY lower(t.name) ASC, t.trainer_id ASC`,
        [session.course_code],
      );

      return c.json({
        trainers: rows.map((row) => ({ id: row.trainer_id, name: row.name })),
      });
    },
  );

  sessionsRoutes.patch(
    '/sessions/:id/trainer',
    options.writeRoles ?? requireRole('admin', 'ops'),
    async (c) => {
      const { user } = c.get('auth');
      const body = await c.req.json().catch(() => null);
      const parsed = parseTrainerUpdateBody(body);
      if ('error' in parsed) return c.json({ error: parsed.error }, 400);

      try {
        const result = await runTransaction(async (tx) => {
          const lockedRows = await tx<SessionLockRow>(
            `SELECT
              s.id,
              s.course_code,
              s.trainer_id,
              pt.name AS previous_trainer_name,
              s.version
             FROM sessions s
             LEFT JOIN trainers pt ON pt.trainer_id = s.trainer_id
             WHERE s.id = $1
             FOR UPDATE`,
            [c.req.param('id')],
          );
          const session = lockedRows[0];
          if (!session) throw new HttpError(404, 'Session not found');
          if (session.version !== parsed.expectedVersion) {
            throw new HttpError(409, 'Session was changed by another user. Reload and try again.', {
              code: 'stale_session_version',
              currentVersion: session.version,
            });
          }
          if (!session.course_code) {
            throw new HttpError(422, 'Unresolved courses cannot receive a trainer assignment.', {
              code: 'unresolved_session_course',
            });
          }

          const newTrainer = parsed.trainerId
            ? await validateTrainer(tx, parsed.trainerId, session.course_code)
            : null;
          const action = getTrainerAction(session.trainer_id, parsed.trainerId);

          const updatedRows = await tx<UpdatedSessionRow>(
            `UPDATE sessions s
             SET trainer_id = $2,
               raw_trainer_name = NULL,
               management_source = 'application',
               app_managed_at = now(),
               app_managed_by = $3,
               version = version + 1,
               updated_at = now()
             WHERE s.id = $1
               AND s.version = $4
             RETURNING
               s.id,
               s.trainer_id,
               (SELECT name FROM trainers WHERE trainer_id = s.trainer_id) AS trainer_name,
               s.management_source::text AS management_source,
               s.version,
               s.updated_at`,
            [session.id, parsed.trainerId, user.id, parsed.expectedVersion],
          );
          if (updatedRows.length === 0) {
            throw new HttpError(409, 'Session was changed by another user. Reload and try again.', {
              code: 'stale_session_version',
              currentVersion: session.version,
            });
          }

          const historyRows = await tx<HistoryRow>(
            `INSERT INTO session_change_history (
              session_id, actor_user_id, action, previous_trainer_id, new_trainer_id, note, metadata
             ) VALUES ($1, $2, $3::session_change_action, $4, $5, $6, '{}'::jsonb)
             RETURNING
               id,
               session_id,
               action::text AS action,
               actor_user_id,
               NULL::text AS actor_email,
               NULL::text AS actor_display_name,
               previous_trainer_id,
               NULL::text AS previous_trainer_name,
               new_trainer_id,
               NULL::text AS new_trainer_name,
               note,
               metadata,
               created_at`,
            [session.id, user.id, action, session.trainer_id, parsed.trainerId, parsed.note],
          );

          return {
            session: mapUpdatedSession(updatedRows[0], session, newTrainer),
            history: {
              id: historyRows[0].id,
              action: historyRows[0].action,
              createdAt: historyRows[0].created_at,
            },
          };
        });

        return c.json(result);
      } catch (error) {
        if (error instanceof HttpError) return c.json(error.body, error.status);
        throw error;
      }
    },
  );

  return sessionsRoutes;
}

function parseTrainerUpdateBody(body: unknown):
  | { trainerId: string | null; expectedVersion: number; note: string | null }
  | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'JSON body is required' };
  const value = body as Record<string, unknown>;
  if (!('trainerId' in value) || !(typeof value.trainerId === 'string' || value.trainerId === null)) {
    return { error: 'trainerId must be a string or null' };
  }
  const expectedVersion = Number(value.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return { error: 'expectedVersion must be a positive integer' };
  }
  const note = typeof value.note === 'string' ? value.note.trim() : null;
  if (note !== null && note.length > 500) return { error: 'note must be 500 characters or fewer' };
  return {
    trainerId: typeof value.trainerId === 'string' ? value.trainerId.trim() : null,
    expectedVersion,
    note: note || null,
  };
}

async function validateTrainer(
  db: SqlQuery,
  trainerId: string,
  courseCode: string,
): Promise<{ id: string; name: string }> {
  const rows = await db<TrainerValidationRow>(
    `SELECT
      t.trainer_id,
      t.name,
      t.is_active,
      t.module_excludes,
      (tc.trainer_id IS NOT NULL) AS course_linked
     FROM trainers t
     LEFT JOIN trainer_courses tc
       ON tc.trainer_id = t.trainer_id
      AND tc.course_code = $2
     WHERE t.trainer_id = $1`,
    [trainerId, courseCode],
  );
  const trainer = rows[0];
  if (!trainer) throw new HttpError(404, 'Trainer not found');
  if (!trainer.is_active) {
    throw new HttpError(422, 'Trainer is inactive.', { code: 'inactive_trainer' });
  }
  if ((trainer.module_excludes ?? []).includes(courseCode)) {
    throw new HttpError(422, 'Trainer is excluded from this course.', { code: 'trainer_excluded' });
  }
  if (!trainer.course_linked) {
    throw new HttpError(422, 'Trainer is not linked to this course.', { code: 'trainer_not_linked_to_course' });
  }
  return { id: trainer.trainer_id, name: trainer.name };
}

function getTrainerAction(
  previousTrainerId: string | null,
  newTrainerId: string | null,
): 'trainer_assigned' | 'trainer_replaced' | 'trainer_unassigned' {
  if (!previousTrainerId && newTrainerId) return 'trainer_assigned';
  if (previousTrainerId && !newTrainerId) return 'trainer_unassigned';
  return 'trainer_replaced';
}

function mapUpdatedSession(
  row: UpdatedSessionRow,
  previous: SessionLockRow,
  newTrainer: { id: string; name: string } | null,
) {
  return {
    id: row.id,
    trainer: row.trainer_id ? { id: row.trainer_id, name: row.trainer_name ?? newTrainer?.name ?? null } : null,
    previousTrainer: previous.trainer_id ? { id: previous.trainer_id, name: previous.previous_trainer_name } : null,
    managementSource: row.management_source,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function mapHistory(row: HistoryRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    action: row.action,
    actor: row.actor_user_id ? {
      id: row.actor_user_id,
      email: row.actor_email,
      displayName: row.actor_display_name,
    } : null,
    previousTrainer: row.previous_trainer_id ? {
      id: row.previous_trainer_id,
      name: row.previous_trainer_name,
    } : null,
    newTrainer: row.new_trainer_id ? {
      id: row.new_trainer_id,
      name: row.new_trainer_name,
    } : null,
    note: row.note,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export const sessionsRoutes = createSessionsRoutes();
