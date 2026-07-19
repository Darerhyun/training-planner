import test from 'node:test';
import assert from 'node:assert/strict';
import type { MiddlewareHandler } from 'hono';
import { createPlanningRoutes } from './planning.js';
import { requireRole, type AppEnv, type SqlQuery, type UserRole } from '@training-planner/shared';

type QueryCall = { sql: string; params: unknown[] };

const baseSummary = {
  total: 2,
  draft: 1,
  confirmed: 1,
  cancelled: 0,
  completed: 0,
  unassigned_trainer: 1,
  unresolved_venue: 1,
  owned_venue_missing_room: 0,
  capacity_overrun: 1,
};

const baseRows = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    external_ref: 'tms:1',
    course_code: 'ASKMEI',
    tms_code: 'ASKMEI-2026-1',
    course_name: 'Microsoft Excel Intermediate',
    programme_code: 'ASK',
    trainer_id: null,
    trainer_name: null,
    raw_trainer_name: null,
    venue_code: null,
    venue_name: null,
    venue_type: null,
    raw_venue_text: 'Hotel',
    room_id: null,
    room_name: null,
    room_capacity: null,
    status: 'draft',
    start_date: '2026-08-01',
    end_date: '2026-08-02',
    time_text: '9.00 AM - 6.00 PM',
    span_days: 2,
    expected_pax: 12,
    confirmed_pax: null,
    unassigned_trainer: true,
    unresolved_venue: true,
    owned_venue_missing_room: false,
    capacity_overrun: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    external_ref: 'tms:2',
    course_code: 'STANDALONE',
    tms_code: 'STANDALONE-2026-1',
    course_name: 'Standalone Course',
    programme_code: null,
    trainer_id: 'trainer-1',
    trainer_name: 'Trainer One',
    raw_trainer_name: null,
    venue_code: 'IP',
    venue_name: 'International Plaza',
    venue_type: 'owned',
    raw_venue_text: '10 Anson Road',
    room_id: 'ip-knowledge',
    room_name: 'Knowledge',
    room_capacity: 16,
    status: 'confirmed',
    start_date: '2026-08-03',
    end_date: '2026-08-03',
    time_text: '9.00 AM - 6.00 PM',
    span_days: 1,
    expected_pax: 18,
    confirmed_pax: null,
    unassigned_trainer: false,
    unresolved_venue: false,
    owned_venue_missing_room: false,
    capacity_overrun: true,
  },
] as const;

function authFor(role: UserRole): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('auth', {
      firebaseUid: `${role}-uid`,
      email: `${role}@example.com`,
      user: {
        id: `${role}-id`,
        firebase_uid: `${role}-uid`,
        email: `${role}@example.com`,
        display_name: null,
        role,
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-19T00:00:00.000Z',
      },
    });
    await next();
  };
}

function createFakeDb(overrides: { rows?: readonly unknown[]; summary?: unknown } = {}) {
  const calls: QueryCall[] = [];
  const db: SqlQuery = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    calls.push({ sql, params });
    if (sql.includes('COUNT(*)::int AS total')) return [overrides.summary ?? baseSummary] as T[];
    if (sql.includes('SELECT\n        s.id,')) return [...(overrides.rows ?? baseRows)] as T[];
    if (sql.includes('FROM programmes')) return [{ code: 'ASK', name: 'ASK Training', status: 'active' }] as T[];
    if (sql.includes('FROM courses WHERE programme_code IS NULL')) return [{ count: 1 }] as T[];
    if (sql.includes('FROM trainers')) return [{ id: 'trainer-1', name: 'Trainer One', is_active: true }] as T[];
    if (sql.includes('FROM venues')) return [{ code: 'IP', name: 'International Plaza', type: 'owned' }] as T[];
    if (sql.includes('FROM rooms')) return [{ id: 'ip-knowledge', venue_code: 'IP', name: 'Knowledge', capacity: 16 }] as T[];
    return [];
  };
  return { db, calls };
}

async function request(role: UserRole, path: string, fake = createFakeDb()) {
  const app = createPlanningRoutes({ db: fake.db, auth: authFor(role), roles: requireRole('admin', 'ops', 'finance', 'viewer') });
  const response = await app.request(path);
  const body = await response.json();
  return { response, body, calls: fake.calls };
}

test('requires from and to ISO dates and validates ordering', async () => {
  assert.equal((await request('ops', '/planning/sessions?to=2026-08-31')).response.status, 400);
  assert.equal((await request('ops', '/planning/sessions?from=2026-08-01&to=2026-02-30')).response.status, 400);
  assert.equal((await request('ops', '/planning/sessions?from=2026-08-31&to=2026-08-01')).response.status, 400);
});

test('rejects date ranges longer than one year', async () => {
  const { response, body } = await request('ops', '/planning/sessions?from=2026-01-01&to=2027-01-02');
  assert.equal(response.status, 400);
  assert.match(body.error, /one year/);
});

test('applies filters and special values without training-day conflict SQL', async () => {
  const result = await request('ops', '/planning/sessions?from=2026-08-01&to=2026-08-31&status=draft,confirmed&programme=__standalone&trainerId=trainer-1&venueCode=__unresolved&roomId=__unassigned&issue=unassigned_trainer,unresolved_venue,capacity_overrun');
  assert.equal(result.response.status, 200);
  const combinedSql = result.calls.map((call) => call.sql).join('\n');
  assert.match(combinedSql, /c\.programme_code IS NULL/);
  assert.match(combinedSql, /s\.venue_code IS NULL/);
  assert.match(combinedSql, /s\.room_id IS NULL/);
  assert.match(combinedSql, /s\.trainer_id IS NULL/);
  assert.match(combinedSql, /r\.capacity IS NOT NULL/);
  assert.doesNotMatch(combinedSql, /generate_series|trainerOverlap|roomOverlap|overlappingTrainerDates|overlappingRoomDates/);
  assert.equal(result.body.meta.filterMode, 'session_span_overlap');
  assert.equal(result.body.sessions[0].dates.spanDays, 2);
  assert.equal('days' in result.body.sessions[0].dates, false);
});

test('excludes cancelled sessions by default and includes them when requested', async () => {
  const excluded = await request('ops', '/planning/sessions?from=2026-08-01&to=2026-08-31');
  assert.match(excluded.calls[0].sql, /s\.status <> 'cancelled'/);

  const included = await request('ops', '/planning/sessions?from=2026-08-01&to=2026-08-31&includeCancelled=true');
  assert.doesNotMatch(included.calls[0].sql, /s\.status <> 'cancelled'/);
});

test('uses stable cursor pagination ordered by start_date and id', async () => {
  const first = await request('ops', '/planning/sessions?from=2026-08-01&to=2026-08-31&limit=1');
  assert.equal(first.response.status, 200);
  assert.equal(first.body.sessions.length, 1);
  assert.equal(typeof first.body.page.nextCursor, 'string');

  const second = await request('ops', `/planning/sessions?from=2026-08-01&to=2026-08-31&limit=1&cursor=${first.body.page.nextCursor}`);
  assert.match(second.calls[1].sql, /\(s\.start_date, s\.id\) > /);
  assert.match(second.calls[1].sql, /ORDER BY s\.start_date ASC, s\.id ASC/);
});

test('summary is calculated before pagination and issue counts are returned for filtered rows', async () => {
  const fake = createFakeDb({ rows: baseRows, summary: { ...baseSummary, total: 7, unassigned_trainer: 7 } });
  const result = await request('ops', '/planning/sessions?from=2026-08-01&to=2026-08-31&limit=1&issue=unassigned_trainer', fake);
  assert.equal(result.body.sessions.length, 1);
  assert.equal(result.body.summary.total, 7);
  assert.equal(result.body.summary.issues.unassignedTrainers, 7);
});

test('allows active roles and denies pending or rejected users', async () => {
  for (const role of ['admin', 'ops', 'finance', 'viewer'] as const) {
    assert.equal((await request(role, '/planning/sessions?from=2026-08-01&to=2026-08-31')).response.status, 200);
  }
  assert.equal((await request('pending', '/planning/sessions?from=2026-08-01&to=2026-08-31')).response.status, 403);
  assert.equal((await request('rejected', '/planning/sessions?from=2026-08-01&to=2026-08-31')).response.status, 403);
});

test('does not return trainer fee or economics fields', async () => {
  const result = await request('finance', '/planning/sessions?from=2026-08-01&to=2026-08-31');
  const json = JSON.stringify(result.body).toLowerCase();
  assert.doesNotMatch(json, /fee|rate|economics|revenue|cost|viability/);
});