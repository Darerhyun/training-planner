import test from 'node:test';
import assert from 'node:assert/strict';
import type { MiddlewareHandler } from 'hono';
import { createSessionsRoutes } from './sessions.js';
import { requireRole, type AppEnv, type SqlQuery, type TransactionHandler, type UserRole } from '@training-planner/shared';

type SessionState = {
  id: string;
  course_code: string | null;
  trainer_id: string | null;
  previous_trainer_name: string | null;
  version: number;
};

type TrainerState = {
  trainer_id: string;
  name: string;
  is_active: boolean;
  module_excludes: string[] | null;
  linkedCourses: string[];
};

type HistoryState = {
  id: string;
  session_id: string;
  action: string;
  actor_user_id: string | null;
  previous_trainer_id: string | null;
  new_trainer_id: string | null;
  note: string | null;
  created_at: string;
};

const sessionId = '00000000-0000-0000-0000-000000000101';

function authFor(role: UserRole): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('auth', {
      firebaseUid: `${role}-uid`,
      email: `${role}@example.com`,
      user: {
        id: `${role}-id`,
        firebase_uid: `${role}-uid`,
        email: `${role}@example.com`,
        display_name: `${role} user`,
        role,
        created_at: '2026-07-20T00:00:00.000Z',
        updated_at: '2026-07-20T00:00:00.000Z',
      },
    });
    await next();
  };
}

function createFakeStore(overrides: Partial<SessionState> = {}) {
  const session: SessionState = {
    id: sessionId,
    course_code: 'ASKMEI',
    trainer_id: null,
    previous_trainer_name: null,
    version: 1,
    ...overrides,
  };
  const trainers = new Map<string, TrainerState>([
    ['trainer-1', { trainer_id: 'trainer-1', name: 'Trainer One', is_active: true, module_excludes: null, linkedCourses: ['ASKMEI'] }],
    ['trainer-2', { trainer_id: 'trainer-2', name: 'Trainer Two', is_active: true, module_excludes: [], linkedCourses: ['ASKMEI'] }],
    ['inactive', { trainer_id: 'inactive', name: 'Inactive Trainer', is_active: false, module_excludes: null, linkedCourses: ['ASKMEI'] }],
    ['unlinked', { trainer_id: 'unlinked', name: 'Unlinked Trainer', is_active: true, module_excludes: null, linkedCourses: ['OTHER'] }],
    ['excluded', { trainer_id: 'excluded', name: 'Excluded Trainer', is_active: true, module_excludes: ['ASKMEI'], linkedCourses: ['ASKMEI'] }],
  ]);
  const history: HistoryState[] = [];
  const calls: string[] = [];

  const query: SqlQuery = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    calls.push(sql);
    if (sql.includes('FROM sessions s') && sql.includes('ORDER BY s.start_date')) {
      return [{
        id: session.id,
        course_code: session.course_code,
        tms_code: 'ASKMEI-2026-1',
        course_name: 'Excel Intermediate',
        trainer_id: session.trainer_id,
        trainer_name: session.trainer_id ? 'Trainer One' : null,
        venue_code: 'IP',
        venue_name: 'International Plaza',
        room_id: 'ip-class1',
        room_name: 'Class 1',
        status: 'confirmed',
        start_date: '2026-08-01',
        end_date: '2026-08-02',
        time_text: '9.00 AM - 6.00 PM',
        expected_pax: 12,
        confirmed_pax: 10,
        external_ref: 'tms:ASKMEI-2026-1',
        managementSource: 'application',
        version: session.version,
        created_at: '2026-07-20T00:00:00.000Z',
        updated_at: '2026-07-20T01:00:00.000Z',
      }] as T[];
    }
    if (sql.includes('SELECT id FROM sessions WHERE id = $1')) {
      return (params[0] === session.id ? [{ id: session.id }] : []) as T[];
    }
    if (sql.includes('FROM session_change_history')) {
      return history.map((entry) => ({
        ...entry,
        action: entry.action,
        actor_email: entry.actor_user_id ? 'ops@example.com' : null,
        actor_display_name: entry.actor_user_id ? 'ops user' : null,
        previous_trainer_name: entry.previous_trainer_id ? trainers.get(entry.previous_trainer_id)?.name ?? null : null,
        new_trainer_name: entry.new_trainer_id ? trainers.get(entry.new_trainer_id)?.name ?? null : null,
        metadata: {},
      })) as T[];
    }
    return [];
  };

  const transaction = async <T>(handler: TransactionHandler<T>): Promise<T> => handler(async <R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> => {
    calls.push(sql);
    if (sql.includes('FOR UPDATE')) {
      return (params[0] === session.id ? [{ ...session }] : []) as R[];
    }
    if (sql.includes('FROM trainers t')) {
      const trainer = trainers.get(String(params[0]));
      if (!trainer) return [];
      return [{
        trainer_id: trainer.trainer_id,
        name: trainer.name,
        is_active: trainer.is_active,
        module_excludes: trainer.module_excludes,
        course_linked: trainer.linkedCourses.includes(String(params[1])),
      }] as R[];
    }
    if (sql.includes('UPDATE sessions s')) {
      if (session.version !== params[3]) return [];
      const trainerId = params[1] as string | null;
      session.previous_trainer_name = trainerId ? trainers.get(trainerId)?.name ?? null : null;
      session.trainer_id = trainerId;
      session.version += 1;
      return [{
        id: session.id,
        trainer_id: session.trainer_id,
        trainer_name: trainerId ? trainers.get(trainerId)?.name ?? null : null,
        management_source: 'application',
        version: session.version,
        updated_at: '2026-07-20T01:00:00.000Z',
      }] as R[];
    }
    if (sql.includes('INSERT INTO session_change_history')) {
      const entry: HistoryState = {
        id: `history-${history.length + 1}`,
        session_id: params[0] as string,
        action: params[2] as string,
        actor_user_id: params[1] as string,
        previous_trainer_id: params[3] as string | null,
        new_trainer_id: params[4] as string | null,
        note: params[5] as string | null,
        created_at: '2026-07-20T01:00:00.000Z',
      };
      history.unshift(entry);
      return [{ ...entry, metadata: {}, actor_email: null, actor_display_name: null, previous_trainer_name: null, new_trainer_name: null }] as R[];
    }
    return [];
  });

  return { query, transaction, session, history, calls };
}

async function request(role: UserRole, path: string, init: RequestInit, store = createFakeStore()) {
  const app = createSessionsRoutes({
    db: store.query,
    transaction: store.transaction,
    auth: authFor(role),
    activeRoles: requireRole('admin', 'ops', 'finance', 'viewer'),
    writeRoles: requireRole('admin', 'ops'),
  });
  const response = await app.request(path, init);
  const body = await response.json();
  return { response, body, store };
}

function patchBody(trainerId: string | null, expectedVersion: number, note?: string): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trainerId, expectedVersion, note }),
  };
}

test('sessions list includes ownership and version read fields', async () => {
  const result = await request('viewer', '/sessions', { method: 'GET' });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.sessions[0].managementSource, 'application');
  assert.equal(result.body.sessions[0].version, 1);
});

test('admin and ops can assign, replace, and unassign trainers with versioned history', async () => {
  const store = createFakeStore();

  const assigned = await request('admin', `/sessions/${sessionId}/trainer`, patchBody('trainer-1', 1, 'assign'), store);
  assert.equal(assigned.response.status, 200);
  assert.equal(assigned.body.session.trainer.id, 'trainer-1');
  assert.equal(assigned.body.session.managementSource, 'application');
  assert.equal(assigned.body.session.version, 2);
  assert.equal(assigned.body.history.action, 'trainer_assigned');

  const replaced = await request('ops', `/sessions/${sessionId}/trainer`, patchBody('trainer-2', 2), store);
  assert.equal(replaced.response.status, 200);
  assert.equal(replaced.body.history.action, 'trainer_replaced');
  assert.equal(replaced.body.session.version, 3);

  const unassigned = await request('ops', `/sessions/${sessionId}/trainer`, patchBody(null, 3), store);
  assert.equal(unassigned.response.status, 200);
  assert.equal(unassigned.body.history.action, 'trainer_unassigned');
  assert.equal(unassigned.body.session.trainer, null);
  assert.equal(unassigned.body.session.version, 4);
  assert.equal(store.history.length, 3);
});

test('finance, viewer, pending, rejected, and unauthenticated users cannot write trainers', async () => {
  for (const role of ['finance', 'viewer', 'pending', 'rejected'] as const) {
    const result = await request(role, `/sessions/${sessionId}/trainer`, patchBody('trainer-1', 1));
    assert.equal(result.response.status, 403);
  }

  const unauthenticated = createSessionsRoutes({ db: createFakeStore().query });
  const response = await unauthenticated.request(`/sessions/${sessionId}/trainer`, patchBody('trainer-1', 1));
  assert.equal(response.status, 401);
});

test('rejects unknown, inactive, unlinked, and excluded trainers', async () => {
  const cases = [
    ['missing', 404, 'Trainer not found'],
    ['inactive', 422, 'inactive_trainer'],
    ['unlinked', 422, 'trainer_not_linked_to_course'],
    ['excluded', 422, 'trainer_excluded'],
  ] as const;

  for (const [trainerId, status, marker] of cases) {
    const result = await request('ops', `/sessions/${sessionId}/trainer`, patchBody(trainerId, 1));
    assert.equal(result.response.status, status);
    assert.match(JSON.stringify(result.body), new RegExp(marker));
  }
});

test('rejects unresolved session courses and stale versions', async () => {
  const unresolved = await request('ops', `/sessions/${sessionId}/trainer`, patchBody('trainer-1', 1), createFakeStore({ course_code: null }));
  assert.equal(unresolved.response.status, 422);
  assert.equal(unresolved.body.code, 'unresolved_session_course');

  const stale = await request('ops', `/sessions/${sessionId}/trainer`, patchBody('trainer-1', 1), createFakeStore({ version: 3 }));
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, 'stale_session_version');
  assert.equal(stale.body.currentVersion, 3);
});

test('history is read-only, newest first, and contains no fees or recommendations', async () => {
  const store = createFakeStore();
  await request('ops', `/sessions/${sessionId}/trainer`, patchBody('trainer-1', 1, 'first'), store);
  await request('ops', `/sessions/${sessionId}/trainer`, patchBody('trainer-2', 2, 'second'), store);

  const app = createSessionsRoutes({
    db: store.query,
    transaction: store.transaction,
    auth: authFor('viewer'),
    activeRoles: requireRole('admin', 'ops', 'finance', 'viewer'),
    writeRoles: requireRole('admin', 'ops'),
  });
  const response = await app.request(`/sessions/${sessionId}/history`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.history.length, 2);
  assert.equal(body.history[0].note, 'second');
  assert.equal(body.history[1].note, 'first');
  assert.doesNotMatch(
    JSON.stringify(body).toLowerCase(),
    /trainerfee|trainerrate|economics|revenue|cost|viability|recommendation|aiassistant/,
  );
});
