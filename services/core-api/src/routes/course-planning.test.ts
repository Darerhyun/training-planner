import test from 'node:test';
import assert from 'node:assert/strict';
import type { MiddlewareHandler } from 'hono';
import { createCoursePlanningRoutes } from './course-planning.js';
import { requireRole, type AppEnv, type SqlQuery, type TransactionHandler, type UserRole } from '@training-planner/shared';

type RunState = {
  id: string;
  planning_month: string;
  course_code: string;
  venue_code: string;
  status: 'proposed' | 'approved' | 'scheduled';
  note: string | null;
  version: number;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  scheduled_by: string | null;
  scheduled_at: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
};

type SessionState = {
  id: string;
  course_code: string;
  venue_code: string;
  status: 'draft';
  start_date: string;
  end_date: string;
  management_source: 'application';
  version: number;
};

const now = '2026-08-26T00:00:00.000Z';

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
        created_at: now,
        updated_at: now,
      },
    });
    await next();
  };
}

function cloneRuns(runs: RunState[]): RunState[] {
  return runs.map((run) => ({ ...run }));
}

function createFakeStore(options: { failScheduledUpdate?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const runs: RunState[] = [];
  const sessions: SessionState[] = [];
  let nextRun = 1;
  let nextSession = 1;

  const query: SqlQuery = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    calls.push({ sql, params });
    if (sql.includes('FROM venues') && sql.includes('ORDER BY lower(name)')) {
      return [
        { code: 'FURAMA', name: 'Furama Hotel', type: 'external' },
        { code: 'IP', name: 'International Plaza', type: 'owned' },
      ] as T[];
    }
    if (sql.includes('FROM courses c') && sql.includes("p.status = 'active'") && !sql.includes('c.code = $1')) {
      return [
        { code: 'ASKCAP', name: 'Capstone', programme_code: 'ASK', programme_name: 'ASK Training' },
        { code: 'FTDM-DME', name: 'Digital Marketing Essentials', programme_code: 'FTDM', programme_name: 'Full-Time DM' },
        { code: 'STANDALONE', name: 'Standalone Course', programme_code: null, programme_name: null },
      ] as T[];
    }
    if (sql.includes('FROM planned_course_runs r')) {
      const month = String(params[0]);
      const venue = String(params[1]);
      return runs
        .filter((run) => run.planning_month === month && run.venue_code === venue)
        .map((run) => ({
          ...run,
          created_by_email: `${run.created_by.replace('-id', '')}@example.com`,
          created_by_name: null,
          approved_by_email: run.approved_by ? `${run.approved_by.replace('-id', '')}@example.com` : null,
          approved_by_name: null,
          scheduled_by_email: run.scheduled_by ? `${run.scheduled_by.replace('-id', '')}@example.com` : null,
          scheduled_by_name: null,
          session_status: run.session_id ? 'draft' : null,
          session_start_date: sessions.find((session) => session.id === run.session_id)?.start_date ?? null,
          session_end_date: sessions.find((session) => session.id === run.session_id)?.end_date ?? null,
        })) as T[];
    }
    return [];
  };

  const txQuery: SqlQuery = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    calls.push({ sql, params });
    if (sql.includes('FROM courses c') && sql.includes('c.code = $1')) {
      const courseCode = String(params[0]);
      if (courseCode === 'OBSOLETE' || courseCode === 'UNKNOWN') return [];
      return [{ code: courseCode, name: 'Course', programme_code: 'ASK', programme_name: 'ASK Training' }] as T[];
    }
    if (sql.includes('FROM venues WHERE code = $1')) {
      const code = String(params[0]);
      return (code === 'UNKNOWN' ? [] : [{ code, name: code, type: 'owned' }]) as T[];
    }
    if (sql.includes('INSERT INTO planned_course_runs')) {
      const count = Number(params[5]);
      const created = Array.from({ length: count }, () => {
        const run: RunState = {
          id: `run-${nextRun++}`,
          planning_month: String(params[0]),
          course_code: String(params[1]),
          venue_code: String(params[2]),
          note: params[3] as string | null,
          status: 'proposed',
          version: 1,
          created_by: String(params[4]),
          approved_by: null,
          approved_at: null,
          scheduled_by: null,
          scheduled_at: null,
          session_id: null,
          created_at: now,
          updated_at: now,
        };
        runs.push(run);
        return { ...run };
      });
      return created as T[];
    }
    if (sql.includes('FROM planned_course_runs') && sql.includes('FOR UPDATE')) {
      const run = runs.find((item) => item.id === params[0]);
      return (run ? [{ ...run }] : []) as T[];
    }
    if (sql.includes("SET status = 'approved'")) {
      const run = runs.find((item) => item.id === params[0] && item.version === params[2]);
      if (!run) return [];
      run.status = 'approved';
      run.approved_by = String(params[1]);
      run.approved_at = now;
      run.version += 1;
      run.updated_at = now;
      return [{ ...run }] as T[];
    }
    if (sql.includes('INSERT INTO sessions')) {
      const session: SessionState = {
        id: `session-${nextSession++}`,
        course_code: String(params[0]),
        venue_code: String(params[1]),
        status: 'draft',
        start_date: String(params[2]),
        end_date: String(params[3]),
        management_source: 'application',
        version: 1,
      };
      sessions.push(session);
      return [{ ...session }] as T[];
    }
    if (sql.includes("SET status = 'scheduled'")) {
      if (options.failScheduledUpdate) throw new Error('simulated update failure');
      const run = runs.find((item) => item.id === params[0] && item.version === params[3]);
      if (!run) return [];
      run.status = 'scheduled';
      run.scheduled_by = String(params[1]);
      run.scheduled_at = now;
      run.session_id = String(params[2]);
      run.version += 1;
      run.updated_at = now;
      return [{ ...run }] as T[];
    }
    return [];
  };

  const transaction = async <T>(handler: TransactionHandler<T>): Promise<T> => {
    const previousRuns = cloneRuns(runs);
    const previousSessions = sessions.map((session) => ({ ...session }));
    try {
      return await handler(txQuery);
    } catch (error) {
      runs.splice(0, runs.length, ...previousRuns);
      sessions.splice(0, sessions.length, ...previousSessions);
      throw error;
    }
  };

  return { query, transaction, calls, runs, sessions };
}

async function request(
  role: UserRole,
  path: string,
  init: RequestInit = { method: 'GET' },
  store = createFakeStore(),
) {
  const app = createCoursePlanningRoutes({
    db: store.query,
    transaction: store.transaction,
    auth: authFor(role),
    activeRoles: requireRole('admin', 'ops', 'finance', 'viewer'),
    writeRoles: requireRole('admin', 'ops'),
    currentMonth: () => '2026-08',
  });
  const response = await app.request(path, init);
  // FIX: Keep simulated 500 rollback responses testable when Hono emits plain text.
  const body = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : { error: await response.text() };
  return { response, body, store };
}

function json(method: string, body: Record<string, unknown>): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function createRuns(role: 'admin' | 'ops', store = createFakeStore(), overrides: Record<string, unknown> = {}) {
  return request(role, '/course-planning/runs', json('POST', {
    planningMonth: '2026-09',
    courseCode: 'ASKCAP',
    venueCode: 'IP',
    count: 1,
    note: 'Planner judgment',
    ...overrides,
  }), store);
}

test('lists active planning courses and read-only evidence for every active role', async () => {
  for (const role of ['admin', 'ops', 'finance', 'viewer'] as const) {
    const result = await request(role, '/course-planning?month=2026-09&venueCode=IP');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.meta.evidenceMode, 'committed_profiles_read_only');
    assert.equal(result.body.meta.evidenceVenueCode, 'IP');
    assert.deepEqual(result.body.courses.map((row: { course: { code: string } }) => row.course.code), [
      'ASKCAP',
      'FTDM-DME',
      'STANDALONE',
    ]);
    assert.equal(result.body.courses[0].planningProfile.source, 'direct');
    assert.equal(result.body.courses[1].planningProfile.source, 'ft_proxy');
    assert.equal(result.body.summary.plannedRuns, 0);
    assert.doesNotMatch(
      result.store.calls.map((call) => call.sql).join('\n').toLowerCase(),
      /trainer[_ ]?rate|economics|revenue|cost|viability|recommendation/,
    );
  }
});

test('maps documented hotel venues to HOTEL evidence without inferring OTHER', async () => {
  const hotel = await request('viewer', '/course-planning?month=2026-09&venueCode=FURAMA');
  assert.equal(hotel.response.status, 200);
  assert.equal(hotel.body.meta.evidenceVenueCode, 'HOTEL');

  const unavailableStore = createFakeStore();
  unavailableStore.query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    if (sql.includes('FROM venues') && sql.includes('ORDER BY lower(name)')) {
      return [{ code: 'OUTBOUND', name: 'Outbound', type: 'external' }] as T[];
    }
    return createFakeStore().query<T>(sql, params);
  };
  const other = await request('viewer', '/course-planning?month=2026-09&venueCode=OUTBOUND', { method: 'GET' }, unavailableStore);
  assert.equal(other.response.status, 200);
  assert.equal(other.body.meta.evidenceVenueCode, 'OUTBOUND');
});

test('validates read parameters and blocks pending and rejected roles', async () => {
  assert.equal((await request('viewer', '/course-planning?venueCode=IP')).response.status, 400);
  assert.equal((await request('viewer', '/course-planning?month=2026-13&venueCode=IP')).response.status, 400);
  assert.equal((await request('viewer', '/course-planning?month=2026-09&venueCode=UNKNOWN')).response.status, 404);
  assert.equal((await request('pending', '/course-planning?month=2026-09&venueCode=IP')).response.status, 403);
  assert.equal((await request('rejected', '/course-planning?month=2026-09&venueCode=IP')).response.status, 403);
});

test('admin and ops create one to twenty proposed rows in the approved horizon', async () => {
  for (const role of ['admin', 'ops'] as const) {
    const store = createFakeStore();
    const result = await createRuns(role, store, { count: 3 });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.runs.length, 3);
    assert.equal(result.body.runs[0].status, 'proposed');
    assert.equal(result.body.runs[0].version, 1);
    assert.equal(result.body.runs[0].note, 'Planner judgment');
    assert.equal(store.runs.length, 3);
  }

  assert.equal((await createRuns('ops', createFakeStore(), { count: 0 })).response.status, 400);
  assert.equal((await createRuns('ops', createFakeStore(), { count: 21 })).response.status, 400);
  assert.equal((await createRuns('ops', createFakeStore(), { planningMonth: '2026-07' })).response.status, 422);
  assert.equal((await createRuns('ops', createFakeStore(), { planningMonth: '2027-09' })).response.status, 422);
  assert.equal((await createRuns('ops', createFakeStore(), { courseCode: 'OBSOLETE' })).response.status, 422);
  assert.equal((await createRuns('ops', createFakeStore(), { venueCode: 'UNKNOWN' })).response.status, 404);
});

test('finance and viewer cannot create, approve, or schedule and execute no SQL', async () => {
  for (const role of ['finance', 'viewer'] as const) {
    for (const [path, init] of [
      ['/course-planning/runs', json('POST', {})],
      ['/course-planning/runs/run-1/approve', json('PATCH', { expectedVersion: 1 })],
      ['/course-planning/runs/run-1/session', json('POST', { expectedVersion: 1, startDate: '2026-09-01', endDate: '2026-09-02' })],
    ] as const) {
      const store = createFakeStore();
      const result = await request(role, path, init, store);
      assert.equal(result.response.status, 403);
      assert.equal(store.calls.length, 0);
    }
  }
});

test('admin and ops can self-approve proposed rows with optimistic concurrency', async () => {
  for (const role of ['admin', 'ops'] as const) {
    const store = createFakeStore();
    const created = await createRuns(role, store);
    const run = created.body.runs[0];
    const approved = await request(role, `/course-planning/runs/${run.id}/approve`, json('PATCH', {
      expectedVersion: run.version,
    }), store);
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.run.status, 'approved');
    assert.equal(approved.body.run.version, 2);
    assert.equal(approved.body.run.approvedBy.id, `${role}-id`);

    const stale = await request(role, `/course-planning/runs/${run.id}/approve`, json('PATCH', {
      expectedVersion: 1,
    }), store);
    assert.equal(stale.response.status, 409);
    assert.equal(stale.body.code, 'stale_planned_course_run_version');
    assert.equal(stale.body.currentVersion, 2);
  }
});

test('approved run creates exactly one explicit-date application-managed draft Session', async () => {
  const store = createFakeStore();
  const created = await createRuns('ops', store);
  const run = created.body.runs[0];
  const approved = await request('ops', `/course-planning/runs/${run.id}/approve`, json('PATCH', {
    expectedVersion: 1,
  }), store);
  const scheduled = await request('ops', `/course-planning/runs/${run.id}/session`, json('POST', {
    expectedVersion: approved.body.run.version,
    startDate: '2026-09-30',
    endDate: '2026-10-02',
  }), store);

  assert.equal(scheduled.response.status, 201);
  assert.deepEqual(scheduled.body.session, {
    id: 'session-1',
    courseCode: 'ASKCAP',
    venueCode: 'IP',
    status: 'draft',
    startDate: '2026-09-30',
    endDate: '2026-10-02',
    managementSource: 'application',
    version: 1,
    trainer: null,
    room: null,
    timeText: null,
    pax: null,
  });
  assert.equal(scheduled.body.run.status, 'scheduled');
  assert.equal(store.sessions.length, 1);
  const insertSql = store.calls.find((call) => call.sql.includes('INSERT INTO sessions'))?.sql ?? '';
  assert.doesNotMatch(insertSql, /trainer_id|room_id|expected_pax|confirmed_pax|time_text/);

  const duplicate = await request('ops', `/course-planning/runs/${run.id}/session`, json('POST', {
    expectedVersion: scheduled.body.run.version,
    startDate: '2026-09-30',
    endDate: '2026-10-02',
  }), store);
  assert.equal(duplicate.response.status, 422);
  assert.equal(duplicate.body.code, 'planned_run_not_schedulable');
  assert.equal(store.sessions.length, 1);
});

test('scheduling rejects invalid or out-of-month dates before inserting a Session', async () => {
  const store = createFakeStore();
  const created = await createRuns('ops', store);
  await request('ops', `/course-planning/runs/${created.body.runs[0].id}/approve`, json('PATCH', {
    expectedVersion: 1,
  }), store);

  const invalid = await request('ops', `/course-planning/runs/${created.body.runs[0].id}/session`, json('POST', {
    expectedVersion: 2,
    startDate: '2026-09-20',
    endDate: '2026-09-19',
  }), store);
  assert.equal(invalid.response.status, 400);

  const outside = await request('ops', `/course-planning/runs/${created.body.runs[0].id}/session`, json('POST', {
    expectedVersion: 2,
    startDate: '2026-10-01',
    endDate: '2026-10-02',
  }), store);
  assert.equal(outside.response.status, 422);
  assert.equal(outside.body.code, 'session_start_outside_planning_month');
  assert.equal(store.sessions.length, 0);
});

test('transaction rollback removes a draft Session when the run link fails', async () => {
  const store = createFakeStore({ failScheduledUpdate: true });
  const created = await createRuns('ops', store);
  await request('ops', `/course-planning/runs/${created.body.runs[0].id}/approve`, json('PATCH', {
    expectedVersion: 1,
  }), store);

  const failed = await request('ops', `/course-planning/runs/${created.body.runs[0].id}/session`, json('POST', {
    expectedVersion: 2,
    startDate: '2026-09-01',
    endDate: '2026-09-02',
  }), store);
  assert.equal(failed.response.status, 500);
  assert.equal(store.sessions.length, 0);
  assert.equal(store.runs[0].status, 'approved');
});
