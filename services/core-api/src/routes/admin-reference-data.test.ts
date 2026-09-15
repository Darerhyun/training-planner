import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv, SqlQuery, TransactionHandler, UserRole } from '@training-planner/shared';
import { createAdminReferenceDataRoutes } from './admin-reference-data.js';

const course = { code: 'ASKMEI', name: 'Microsoft Excel Intermediate', duration_days: 2, is_active: true, version: 1, notes: null };
function auth(role: UserRole = 'admin', active = true): () => MiddlewareHandler<AppEnv> {
  return () => async (c, next) => {
    c.set('auth', { firebaseUid: 'demo', email: 'demo@example.com', user: { id: 'demo-admin', firebase_uid: 'demo', email: 'demo@example.com', display_name: 'Demo Admin', role, is_active: active, version: 1, created_at: '', updated_at: '' } });
    await next();
  };
}
function fixture(role: UserRole = 'admin', active = true) {
  let record: Record<string, unknown> = { ...course }; let revision = 1; let events: unknown[][] = [];
  let dependent = false; let failAudit = false; let targetActive = true;
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: SqlQuery = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    calls.push({ sql, params }); const rows = (value: unknown[]) => structuredClone(value) as T[];
    if (sql.includes('pg_advisory')) return [];
    if (sql.startsWith('SELECT 1')) return rows(dependent ? [{ found: 1 }] : []);
    if (sql.includes('FROM venues WHERE code=')) return rows([{ code: 'IP', type: 'owned', is_active: targetActive, version: 1 }]);
    if (sql.includes('FROM rooms WHERE room_id=')) return rows([{ room_id: 'ip-quality', venue_code: 'IP', is_active: targetActive, version: 1 }]);
    if (sql.includes('FROM courses WHERE code=') && record.tms_code) return rows([course]);
    if (sql.startsWith('SELECT') && sql.includes('reference_data_change_events')) return rows(events.map((e) => ({ action: e[4], note: e[9] })));
    if (sql.startsWith('SELECT')) return rows(params[0] === 'missing' ? [] : [record]);
    if (sql.startsWith('UPDATE reference_data_namespace')) { revision++; return rows([{ revision }]); }
    if (sql.startsWith('INSERT INTO reference_data_change_events')) { if (failAudit) throw new Error('audit failed'); events.push(params); return []; }
    if (sql.startsWith('UPDATE courses SET')) {
      if (sql.includes('name=$3')) record.name = params[2];
      if (sql.includes('is_active=$3')) record.is_active = params[2];
      record.version = Number(record.version) + 1; return rows([record]);
    }
    if (sql.startsWith('INSERT INTO course_aliases')) {
      record = { tms_code: params[0], catalog_code: params[1], version: 1, is_active: true }; return rows([record]);
    }
    throw new Error(`Unhandled query: ${sql}`);
  };
  const transaction = async <T>(handler: TransactionHandler<T>): Promise<T> => {
    const snapshot = structuredClone({ record, revision, events });
    try { return await handler(db); } catch (error) { ({ record, revision, events } = snapshot); throw error; }
  };
  // FIX: exercise the route under the same outer error boundary as the server.
  const app = new Hono<AppEnv>();
  app.route('/', createAdminReferenceDataRoutes({ db, transaction, auth: auth(role, active) }));
  app.onError((_error, c) => c.json({ error: 'Internal error' }, 500));
  const post = (path: string, body: unknown) => app.request(`/admin/reference-data/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { app, post, calls, get record() { return record; }, get revision() { return revision; }, get events() { return events; }, set dependent(v: boolean) { dependent = v; }, set failAudit(v: boolean) { failAudit = v; }, set targetActive(v: boolean) { targetActive = v; } };
}

test('reference routes deny every non-admin and inactive admin before SQL', async () => {
  for (const role of ['ops', 'finance', 'viewer', 'pending', 'rejected'] as UserRole[]) {
    const f = fixture(role); assert.equal((await f.app.request('/admin/reference-data/courses')).status, 403); assert.equal(f.calls.length, 0);
  }
  const f = fixture('admin', false); assert.equal((await f.post('courses/ASKMEI/profile', { expectedVersion: 1, name: 'Changed' })).status, 403); assert.equal(f.calls.length, 0);
});
test('reference routes reject missing authentication without SQL', async () => {
  let queried = false;
  const app = createAdminReferenceDataRoutes({ db: async () => { queried = true; return []; }, auth: () => async (_c, next) => next() });
  assert.equal((await app.request('/admin/reference-data/courses')).status, 401); assert.equal(queried, false);
});
test('profile save increments record and namespace exactly once and appends one event', async () => {
  const f = fixture(); assert.equal((await f.post('courses/ASKMEI/profile', { expectedVersion: 1, name: 'Microsoft Excel Intermediate' })).status, 200);
  assert.equal(f.record.version, 2); assert.equal(f.revision, 2); assert.equal(f.events.length, 1); assert.equal(f.events[0]?.[4], 'course_updated');
  assert.ok(f.calls.some((c) => c.sql.includes('FOR UPDATE')));
});
test('stale version writes nothing and reports current version', async () => {
  const f = fixture(); const result = await f.post('courses/ASKMEI/profile', { expectedVersion: 2, name: 'Changed' });
  assert.equal(result.status, 409); assert.equal((await result.json()).currentVersion, 1); assert.equal(f.events.length, 0); assert.equal(f.revision, 1);
});
test('audit failure rolls back record and revision', async () => {
  const f = fixture(); f.failAudit = true; assert.equal((await f.post('courses/ASKMEI/profile', { expectedVersion: 1, name: 'Changed' })).status, 500);
  assert.equal(f.record.version, 1); assert.equal(f.record.name, course.name); assert.equal(f.revision, 1); assert.equal(f.events.length, 0);
});
test('dependent deactivation is blocked; note required; no hard delete route', async () => {
  const f = fixture(); f.dependent = true;
  assert.equal((await f.post('courses/ASKMEI/deactivate', { expectedVersion: 1, note: 'Retire reference' })).status, 409);
  assert.equal((await f.post('courses/ASKMEI/deactivate', { expectedVersion: 1 })).status, 400);
  assert.equal((await f.app.request('/admin/reference-data/courses/ASKMEI', { method: 'DELETE' })).status, 404);
  assert.equal(f.record.is_active, true); assert.equal(f.events.length, 0);
});
test('identity and economics fields are never writable or selected', async () => {
  const f = fixture();
  for (const key of ['code', 'fee_with_gst', 'version', 'is_active']) assert.equal((await f.post('courses/ASKMEI/profile', { expectedVersion: 1, [key]: 'bad' })).status, 400);
  assert.equal((await f.app.request('/admin/reference-data/courses')).status, 200);
  assert.ok(f.calls.every((c) => !c.sql.includes('fee_with_gst') && !c.sql.includes('SELECT *')));
});
test('alias create requires audit note, uses active target, and records alias history', async () => {
  const f = fixture();
  assert.equal((await f.post('courses/ASKMEI/aliases', { tms_code: 'Demo source' })).status, 400);
  assert.equal((await f.post('courses/ASKMEI/aliases', { tms_code: 'Demo source', note: 'Verified source spelling' })).status, 201);
  assert.equal(f.events[0]?.[4], 'course_alias_created');
  assert.equal((await f.app.request('/admin/reference-data/courses/ASKMEI/aliases/Demo%20source/history')).status, 200);
});
test('invalid namespaces, pagination, IDs and missing rows return typed failures', async () => {
  const f = fixture();
  assert.equal((await f.app.request('/admin/reference-data/unknown')).status, 404);
  assert.equal((await f.app.request('/admin/reference-data/courses?limit=0')).status, 400);
  assert.equal((await f.app.request('/admin/reference-data/courses/missing')).status, 404);
  assert.equal((await f.app.request('/admin/reference-data/rooms/ip-quality/aliases/not-a-uuid')).status, 400);
  assert.equal((await f.app.request('/admin/reference-data/course-aliases')).status, 404);
});

test('history rejects a 36-hyphen cursor UUID with typed 400 before any SQL', async () => {
  const cursor = Buffer.from(JSON.stringify({ time: '2026-09-10T12:00:00.000Z', id: '-'.repeat(36) })).toString('base64url');
  for (const path of ['courses/ASKMEI/history', 'courses/ASKMEI/aliases/Demo/history', 'rooms/ip-quality/aliases/00000000-0000-0000-0000-000000000001/history']) {
    const f = fixture();
    const response = await f.app.request(`/admin/reference-data/${path}?cursor=${cursor}`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid cursor', code: 'invalid_reference_data' });
    assert.equal(f.calls.length, 0);
  }
});

test('history accepts a canonical mixed-case UUID cursor', async () => {
  const f = fixture();
  const value = { time: '2026-09-10T12:00:00.000Z', id: 'aBcDeF01-2345-6789-aBcD-Ef0123456789' };
  const cursor = Buffer.from(JSON.stringify(value)).toString('base64url');
  const response = await f.app.request(`/admin/reference-data/courses/ASKMEI/history?cursor=${cursor}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { events: [], nextCursor: null });
  const history = f.calls.find((call) => call.sql.includes('FROM reference_data_change_events'));
  assert.ok(history);
  assert.deepEqual(history.params, ['course', 'ASKMEI', 51, value.time, value.id]);
});

test('room creation requires an active owned parent before any insertion', async () => {
  const f = fixture(); f.targetActive = false;
  assert.equal((await f.post('rooms', { room_id: 'ip-demo', venue_code: 'IP', name: 'Demo room' })).status, 409);
  assert.ok(!f.calls.some((c) => c.sql.startsWith('INSERT')));
});

test('alias identity and room scope cannot be changed by retarget', async () => {
  const f = fixture();
  assert.equal((await f.post('rooms/ip-quality/aliases/00000000-0000-0000-0000-000000000001/retarget', { expectedVersion: 1, venue_code: 'JTC', room_id: 'jtc-adapt', note: 'Change scope' })).status, 400);
  assert.equal((await f.post('venues/IP/aliases/Demo/retarget', { expectedVersion: 1, alias: 'Renamed', venue_code: 'IP', note: 'Rename alias' })).status, 400);
  assert.equal(f.calls.length, 0);
});
