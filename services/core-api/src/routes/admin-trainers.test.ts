import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import type { AppEnv, SqlQuery, TransactionHandler, UserRole } from '@training-planner/shared';
import { createAdminTrainersRoutes, normalizeTrainerName } from './admin-trainers.js';

type Row = Record<string, unknown>;
const base = {
  trainer_id: 'tr_demo', name: 'Demo Trainer 1', notes: null, is_active: true, version: 4,
  eligibility_version: 2, scheduling_readiness: 'ready', readiness_origin: 'admin_confirmed',
  readiness_confirmed_at: '2026-09-01T00:00:00Z', readiness_confirmed_by: 'demo-admin', readiness_version: 3,
  exclusions_acknowledged_at: '2026-09-01T00:00:00Z', exclusions_acknowledged_by: 'demo-admin',
  exclusions_acknowledged_version: 2, created_at: '', updated_at: '',
};
function auth(role: UserRole = 'admin', active = true): () => MiddlewareHandler<AppEnv> {
  return () => async (c, next) => {
    c.set('auth', { firebaseUid: 'demo', email: 'demo@example.com', user: {
      id: 'demo-admin', firebase_uid: 'demo', email: 'demo@example.com', display_name: 'Demo Admin',
      role, is_active: active, version: 1, created_at: '', updated_at: '',
    } });
    await next();
  };
}
function store(overrides: Row = {}) {
  let trainer: Row = { ...base, ...overrides };
  let links = [{ course_code: 'FTDM-DME', is_sme: true }];
  let exclusions: string[] = [];
  let aliases = [{ id: 1, alias_name: 'D. Trainer One', source: 'schedule_excel' }, { id: 2, alias_name: 'Trainer One DM', source: 'rate_excel' }];
  let events: unknown[][] = [];
  const calls: { sql: string; params: unknown[] }[] = [];
  let failEvent = false; let duplicate = false; let impactAvailable = true; let unique = false;
  const sessions = [
    { status: 'confirmed', end_date: '2026-09-08', trainer_id: 'tr_demo' },
    { status: 'draft', end_date: '2026-09-09', trainer_id: 'tr_demo' },
    { status: 'cancelled', end_date: '2026-09-10', trainer_id: 'tr_demo' },
    { status: 'completed', end_date: '2026-09-08', trainer_id: 'tr_demo' },
    { status: 'confirmed', end_date: '2026-09-07', trainer_id: 'tr_demo' },
    { status: 'confirmed', end_date: '2026-09-10', trainer_id: 'tr_other' },
  ];
  const query: SqlQuery = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    calls.push({ sql, params });
    const rows = (value: unknown[]): T[] => structuredClone(value) as T[];
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('regexp_replace')) return rows(duplicate ? [{ trainer_id: 'duplicate' }] : []);
    if (sql.includes('WITH directory AS')) return rows([{ trainers: [{ ...trainer }, { ...trainer, trainer_id: 'tr_second', name: 'Demo Trainer 2' }], counts: { ready: 2, needs_setup: 0, inactive: 1 }, filteredCount: 2 }]);
    if (sql.includes('FROM trainers WHERE trainer_id=$1')) return rows(params[0] === trainer.trainer_id ? [trainer] : []);
    if (sql.includes('INSERT INTO trainers')) {
      trainer = { ...base, trainer_id: params[0], name: params[1], notes: params[2], version: 1, eligibility_version: 1,
        scheduling_readiness: 'needs_setup', readiness_origin: null, readiness_confirmed_at: null,
        readiness_confirmed_by: null, readiness_version: null, exclusions_acknowledged_at: null,
        exclusions_acknowledged_by: null, exclusions_acknowledged_version: null };
      return rows([trainer]);
    }
    if (sql.includes('UPDATE trainers SET')) {
      if (trainer.version !== params[1]) return [];
      if (sql.includes('name=$3')) { trainer.name = params[2]; trainer.notes = params[3]; }
      if (sql.includes('eligibility_version=eligibility_version+1')) {
        if (trainer.exclusions_acknowledged_version === trainer.eligibility_version) trainer.exclusions_acknowledged_version = Number(trainer.eligibility_version) + 1;
        trainer.eligibility_version = Number(trainer.eligibility_version) + 1;
        trainer.module_excludes = params[2];
      }
      if (sql.includes("scheduling_readiness='needs_setup'")) {
        trainer.scheduling_readiness = 'needs_setup';
        for (const key of ['readiness_origin', 'readiness_confirmed_at', 'readiness_confirmed_by', 'readiness_version', 'exclusions_acknowledged_at', 'exclusions_acknowledged_by', 'exclusions_acknowledged_version']) trainer[key] = null;
      }
      if (sql.includes("scheduling_readiness='ready'")) {
        trainer.scheduling_readiness = 'ready'; trainer.readiness_origin = 'admin_confirmed';
        trainer.readiness_confirmed_at = 'now'; trainer.readiness_confirmed_by = params[2]; trainer.readiness_version = Number(trainer.version) + 1;
        trainer.exclusions_acknowledged_at = 'now'; trainer.exclusions_acknowledged_by = params[2]; trainer.exclusions_acknowledged_version = trainer.eligibility_version;
      }
      if (sql.includes('is_active=false')) trainer.is_active = false;
      if (sql.includes('is_active=true')) trainer.is_active = true;
      trainer.version = Number(trainer.version) + 1;
      return rows([trainer]);
    }
    if (sql.includes('INSERT INTO trainer_change_events')) {
      if (failEvent) throw new Error('injected event failure');
      events.push(structuredClone(params)); return [];
    }
    if (sql.includes('FROM trainer_change_events e')) return rows(events.map((p, i) => ({ id: String(i), action: p[2], note: p[11], metadata: JSON.parse(String(p[12])), actor: { displayName: 'Demo Admin' } })).reverse());
    if (sql.includes('SELECT course_code,is_sme FROM trainer_courses')) return rows(links);
    if (sql.includes('SELECT course_code FROM trainer_course_exclusions')) return rows(exclusions.map((course_code) => ({ course_code })));
    if (sql.includes('SELECT c.code FROM courses')) return rows((params[0] as string[]).filter((code) => ['FTDM-DME', 'FTDM-SMM', 'ASKAME'].includes(code)).map((code) => ({ code })));
    if (sql.includes('DELETE FROM trainer_courses')) { links = links.filter((l) => l.course_code !== params[1]); return []; }
    if (sql.includes('INSERT INTO trainer_courses')) { links = links.filter((l) => l.course_code !== params[1]); links.push({ course_code: String(params[1]), is_sme: Boolean(params[2]) }); return []; }
    if (sql.includes('DELETE FROM trainer_course_exclusions')) { exclusions = exclusions.filter((code) => code !== params[1]); return []; }
    if (sql.includes('INSERT INTO trainer_course_exclusions')) { exclusions.push(String(params[1])); return []; }
    if (sql.includes('INSERT INTO trainer_aliases')) {
      if (unique) throw Object.assign(new Error('unique'), { code: '23505' });
      const alias = { id: 3, alias_name: String(params[1]), source: 'admin' }; aliases.push(alias); return rows([alias]);
    }
    if (sql.includes('DELETE FROM trainer_aliases')) { aliases = aliases.filter((a) => a.id !== params[1]); return []; }
    if (sql.includes('SELECT id,alias_name,source FROM trainer_aliases')) return rows(params.length > 1 ? aliases.filter((a) => a.id === params[1]) : aliases);
    if (sql.includes('FROM sessions s')) return rows(impactAvailable ? [{ count: sessions.filter((s) => s.trainer_id === params[0] && !['cancelled', 'completed'].includes(s.status) && s.end_date >= '2026-09-08').length }] : []);
    if (sql.includes('FROM trainer_courses l JOIN courses')) return rows(links);
    if (sql.includes('FROM trainer_course_exclusions x JOIN courses')) return rows(exclusions.map((course_code) => ({ course_code })));
    if (sql.includes('FROM courses c LEFT JOIN programmes')) return rows([{ code: 'FTDM-DME', name: 'Digital Marketing Essentials', programme_code: 'FTDM', programme_name: 'Digital Marketing' }]);
    throw new Error(`Unhandled SQL: ${sql}`);
  };
  const transaction = async <T>(handler: TransactionHandler<T>): Promise<T> => {
    const snapshot = structuredClone({ trainer, links, exclusions, aliases, events });
    try { return await handler(query); } catch (error) {
      ({ trainer, links, exclusions, aliases, events } = snapshot); throw error;
    }
  };
  return { query, transaction, calls, sessions, get trainer() { return trainer; }, get links() { return links; },
    get exclusions() { return exclusions; }, get aliases() { return aliases; }, get events() { return events; },
    set failEvent(v: boolean) { failEvent = v; }, set duplicate(v: boolean) { duplicate = v; },
    set impactAvailable(v: boolean) { impactAvailable = v; }, set unique(v: boolean) { unique = v; },
    set exclusions(v: string[]) { exclusions = v; },
  };
}
function request(s: ReturnType<typeof store>, path: string, method = 'GET', body?: Row, role: UserRole = 'admin') {
  // FIX: mount the route factory so its typed error handler remains installed.
  const app = new Hono<AppEnv>();
  app.route('/', createAdminTrainersRoutes({ db: s.query, transaction: s.transaction, auth: auth(role) }));
  app.onError((error, c) => c.json({ error: error.message }, 500));
  // FIX: GET matrix entries must not attach a request body.
  return app.request(`/admin/trainers${path}`, { method, ...(body && method !== 'GET' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
}
const writes: [string, string, Row][] = [
  ['', 'POST', { name: 'Demo Trainer 13' }],
  ['/tr_demo/profile', 'PATCH', { expectedVersion: 4, name: 'Demo Trainer One' }],
  ['/tr_demo/eligibility', 'PUT', { expectedVersion: 4, links: [], exclusions: [] }],
  ['/tr_demo/readiness/confirm', 'POST', { expectedVersion: 4, expectedEligibilityVersion: 2, acknowledgeExclusions: true }],
  ['/tr_demo/aliases', 'POST', { expectedVersion: 4, aliasName: 'Demo Alternate' }],
  ['/tr_demo/aliases/1', 'DELETE', { expectedVersion: 4, note: 'Incorrect mapping' }],
  ['/tr_demo/deactivate', 'POST', { expectedVersion: 4, acknowledgeAssignments: true }],
  ['/tr_demo/reactivate', 'POST', { expectedVersion: 4 }],
];
const reads = ['', '/courses', '/tr_demo', '/tr_demo/history', '/tr_demo/deactivation-impact'];

test('all routes deny unauthenticated and every non-admin role before SQL', async () => {
  for (const [path, method, body] of [...reads.map((p): [string, string, Row] => [p, 'GET', {}]), ...writes]) {
    const s = store();
    const unauth = createAdminTrainersRoutes({ db: s.query, transaction: s.transaction });
    assert.equal((await unauth.request(`/admin/trainers${path}`, { method })).status, 401);
    for (const role of ['ops', 'finance', 'viewer', 'pending', 'rejected'] as const) assert.equal((await request(s, path, method, body, role)).status, 403);
    const inactive = createAdminTrainersRoutes({ db: s.query, transaction: s.transaction, auth: auth('admin', false) });
    assert.equal((await inactive.request(`/admin/trainers${path}`, { method })).status, 403);
    assert.equal(s.calls.length, 0);
  }
});
test('registration uses immutable random ID, normalized name, needs_setup v1 and one atomic event only', async () => {
  const s = store(); const response = await request(s, '', 'POST', { name: '  Demo   Trainer 13  ', notes: 'Administrative note' });
  assert.equal(response.status, 201);
  const { trainer } = await response.json();
  assert.match(trainer.trainer_id, /^tr_[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.equal(trainer.name, 'Demo Trainer 13'); assert.equal(trainer.version, 1); assert.equal(trainer.scheduling_readiness, 'needs_setup');
  assert.equal(s.events.length, 1); assert.equal(s.events[0][2], 'trainer_created');
  assert.equal(s.calls.filter((c) => /INSERT INTO/.test(c.sql)).length, 2);
  assert.equal((await request(store(), '', 'POST', { name: 'Demo Trainer 13', trainerId: 'chosen' })).status, 400);
  const duplicate = store(); duplicate.duplicate = true;
  const blocked = await request(duplicate, '', 'POST', { name: 'demo TRAINER 1' });
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'duplicate_trainer_identity');
  assert.equal(normalizeTrainerName('  Demo\nTrainer   1 '), 'Demo Trainer 1');
});
test('every existing-record mutation rejects missing and stale versions without writes', async () => {
  for (const [path, method, body] of writes.slice(1)) {
    const s = store();
    assert.equal((await request(s, path, method, { ...body, expectedVersion: undefined })).status, 400);
    const response = await request(s, path, method, { ...body, expectedVersion: 3 });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'stale_trainer_version');
    assert.equal(s.events.length, 0); assert.equal(s.trainer.version, 4);
    assert.equal(s.calls.some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)), false);
  }
});
test('profile changes preserve identity/readiness and record exactly one event', async () => {
  const s = store(); assert.equal((await request(s, '/tr_demo/profile', 'PATCH', { expectedVersion: 4, name: 'Demo Trainer One', notes: 'Updated' })).status, 200);
  assert.equal(s.trainer.trainer_id, base.trainer_id); assert.equal(s.trainer.version, 5);
  assert.equal(s.trainer.readiness_version, base.readiness_version); assert.equal(s.trainer.readiness_confirmed_at, base.readiness_confirmed_at);
  assert.equal(s.events.length, 1); assert.equal(s.events[0][2], 'trainer_updated');
});
test('eligibility reset/additive matrix dual-writes exclusions, preserves links and emits one structured event', async () => {
  const cases = [
    { name: 'link removed', links: [], exclusions: [], reset: true },
    { name: 'exclusion added over existing link', links: [{ courseCode: 'FTDM-DME', isSme: true }], exclusions: ['FTDM-DME'], reset: true },
    { name: 'link added', links: [{ courseCode: 'FTDM-DME', isSme: true }, { courseCode: 'FTDM-SMM', isSme: false }], exclusions: [], reset: false },
    { name: 'SME toggled', links: [{ courseCode: 'FTDM-DME', isSme: false }], exclusions: [], reset: false },
    { name: 'exclusion removed', links: [{ courseCode: 'FTDM-DME', isSme: true }], exclusions: [], reset: false, previous: ['ASKAME'] },
  ];
  for (const scenario of cases) {
    const s = store(); s.exclusions = scenario.previous ?? [];
    const response = await request(s, '/tr_demo/eligibility', 'PUT', { expectedVersion: 4, links: scenario.links, exclusions: scenario.exclusions });
    assert.equal(response.status, 200, scenario.name); assert.equal(s.trainer.version, 5); assert.equal(s.trainer.eligibility_version, 3);
    assert.deepEqual(s.trainer.module_excludes, scenario.exclusions); assert.deepEqual(s.exclusions, scenario.exclusions);
    assert.equal(s.links.length, scenario.links.length); assert.equal(s.events.length, 1); assert.equal(s.events[0][2], 'course_access_changed');
    assert.equal(JSON.parse(String(s.events[0][12])).readinessReset, scenario.reset);
    assert.equal(s.trainer.scheduling_readiness, scenario.reset ? 'needs_setup' : 'ready');
    assert.equal(s.trainer.exclusions_acknowledged_version, scenario.reset ? null : 3);
    assert.equal(s.trainer.readiness_confirmed_at, scenario.reset ? null : base.readiness_confirmed_at);
    assert.equal(s.trainer.readiness_confirmed_by, scenario.reset ? null : base.readiness_confirmed_by);
    assert.equal(s.trainer.readiness_version, scenario.reset ? null : base.readiness_version);
    if (!scenario.reset) assert.equal(s.trainer.exclusions_acknowledged_at, base.exclusions_acknowledged_at);
  }
});
test('eligibility rejects duplicate/unknown course entries and rolls back all writes on event failure', async () => {
  for (const body of [
    { links: [{ courseCode: 'FTDM-DME', isSme: true }, { courseCode: 'FTDM-DME', isSme: false }], exclusions: [] },
    { links: [], exclusions: ['ASKAME', 'ASKAME'] },
    { links: [{ courseCode: 'UNKNOWN', isSme: false }], exclusions: [] },
    { links: [{ courseCode: 'FTDM-DME' }], exclusions: [] },
  ]) {
    const s = store(); assert.equal((await request(s, '/tr_demo/eligibility', 'PUT', { expectedVersion: 4, ...body })).status, 400);
    assert.equal(s.events.length, 0); assert.equal(s.trainer.version, 4);
  }
  const s = store(); s.failEvent = true;
  const response = await request(s, '/tr_demo/eligibility', 'PUT', { expectedVersion: 4, links: [], exclusions: ['ASKAME'] });
  assert.equal(response.status, 500); assert.equal(s.trainer.version, 4); assert.equal(s.events.length, 0);
  assert.deepEqual(s.links, [{ course_code: 'FTDM-DME', is_sme: true }]); assert.deepEqual(s.exclusions, []);
});
test('readiness requires active, effective link, explicit acknowledgement and current eligibility version', async () => {
  const payload = { expectedVersion: 4, expectedEligibilityVersion: 2, acknowledgeExclusions: true };
  for (const acknowledgeExclusions of [false, undefined]) assert.equal((await request(store(), '/tr_demo/readiness/confirm', 'POST', { ...payload, acknowledgeExclusions })).status, 400);
  assert.equal((await request(store({ is_active: false }), '/tr_demo/readiness/confirm', 'POST', payload)).status, 409);
  assert.equal((await request(store(), '/tr_demo/readiness/confirm', 'POST', { ...payload, expectedEligibilityVersion: 1 })).status, 409);
  const excluded = store(); excluded.exclusions = ['FTDM-DME'];
  assert.equal((await request(excluded, '/tr_demo/readiness/confirm', 'POST', payload)).status, 422);
  const s = store({ scheduling_readiness: 'needs_setup' });
  assert.equal((await request(s, '/tr_demo/readiness/confirm', 'POST', payload)).status, 200);
  assert.equal(s.trainer.version, 5); assert.equal(s.trainer.eligibility_version, 2); assert.equal(s.trainer.readiness_version, 5);
  assert.equal(s.trainer.readiness_origin, 'admin_confirmed'); assert.equal(s.trainer.exclusions_acknowledged_version, 2);
  assert.equal(s.events.length, 1); assert.equal(s.events[0][2], 'scheduling_readiness_changed');
});
test('alias removal requires note/version, protects primary names, deletes one mapping and preserves earlier events', async () => {
  for (const note of [undefined, '', '   ', 'x'.repeat(501)]) {
    const s = store(); assert.equal((await request(s, '/tr_demo/aliases/1', 'DELETE', { expectedVersion: 4, note })).status, 400); assert.equal(s.aliases.length, 2);
  }
  const s = store();
  await request(s, '/tr_demo/aliases', 'POST', { expectedVersion: 4, aliasName: 'Demo Alternate' });
  const earlier = JSON.stringify(s.events);
  const response = await request(s, '/tr_demo/aliases/1', 'DELETE', { expectedVersion: 5, note: 'Wrong import mapping' });
  assert.equal(response.status, 200); assert.equal(s.aliases.length, 2); assert.equal(s.aliases.some((a) => a.id === 1), false);
  assert.equal(s.trainer.version, 6); assert.equal(s.events.length, 2); assert.equal(JSON.stringify(s.events.slice(0, 1)), earlier);
  assert.deepEqual(JSON.parse(String(s.events[1][12])), { aliasId: 1, aliasName: 'D. Trainer One', source: 'schedule_excel', note: 'Wrong import mapping' });
  for (const aliasId of ['tr_demo', 'Demo%20Trainer%201']) {
    const blocked = await request(store(), `/tr_demo/aliases/${aliasId}`, 'DELETE', { expectedVersion: 4, note: 'Remove' });
    assert.equal(blocked.status, 400); assert.equal((await blocked.json()).code, 'primary_name_removal_forbidden');
  }
  const primary = store(); primary.aliases[0].alias_name = ' demo Trainer 1 ';
  assert.equal((await request(primary, '/tr_demo/aliases/1', 'DELETE', { expectedVersion: 4, note: 'Remove' })).status, 400);
  assert.equal((await request(store(), '/tr_demo/aliases/999', 'DELETE', { expectedVersion: 4, note: 'Remove' })).status, 404);
});
test('alias duplicate preflight and database uniqueness races return typed 409 without event', async () => {
  for (const failure of ['duplicate', 'unique'] as const) {
    const s = store(); s[failure] = true;
    const response = await request(s, '/tr_demo/aliases', 'POST', { expectedVersion: 4, aliasName: 'Demo Alternate' });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'duplicate_trainer_identity');
    assert.equal(s.events.length, 0); assert.equal(s.trainer.version, 4);
  }
});
test('deactivation checks exact SGT impact, requires acknowledgement and preserves all assignments/history', async () => {
  const s = store(); const original = JSON.stringify(s.sessions);
  const response = await request(s, '/tr_demo/deactivation-impact');
  assert.equal((await response.json()).upcomingSessionCount, 2);
  assert.equal((await request(s, '/tr_demo/deactivate', 'POST', { expectedVersion: 4 })).status, 400);
  assert.equal((await request(s, '/tr_demo/deactivate', 'POST', { expectedVersion: 4, acknowledgeAssignments: true, note: 'Pause' })).status, 200);
  assert.equal(s.trainer.is_active, false); assert.equal(s.trainer.scheduling_readiness, 'needs_setup'); assert.equal(s.trainer.exclusions_acknowledged_version, null);
  assert.equal(JSON.stringify(s.sessions), original); assert.equal(s.events.length, 1);
  assert.equal(JSON.parse(String(s.events[0][12])).upcomingSessionCount, 2); assert.equal(s.events[0][11], 'Pause');
  const sql = s.calls.find((c) => c.sql.includes('FROM sessions s'))!.sql;
  assert.match(sql, /status NOT IN \('cancelled','completed'\)/); assert.match(sql, /end_date >= \(CURRENT_TIMESTAMP AT TIME ZONE 'Asia\/Singapore'\)::date/);
  const failed = store(); failed.impactAvailable = false;
  assert.equal((await request(failed, '/tr_demo/deactivate', 'POST', { expectedVersion: 4, acknowledgeAssignments: true })).status, 503);
  assert.equal(failed.trainer.is_active, true); assert.equal(failed.events.length, 0);
  assert.equal((await request(s, '/tr_demo/reactivate', 'POST', { expectedVersion: 5 })).status, 200);
  assert.equal(s.trainer.is_active, true); assert.equal(s.trainer.scheduling_readiness, 'needs_setup'); assert.equal(s.events.length, 2);
});
test('directory cursor/search/count SQL, active canonical courses and not-found reads', async () => {
  const s = store(); const response = await request(s, '?state=ready&q=FTDM&limit=1'); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.trainers.length, 1); assert.equal(body.filteredCount, 2); assert.ok(body.nextCursor);
  assert.deepEqual(body.counts, { ready: 2, needs_setup: 0, inactive: 1 });
  assert.equal((await request(s, `?state=ready&q=FTDM&cursor=${body.nextCursor}`)).status, 200);
  const sql = s.calls[0].sql;
  assert.match(sql, /ORDER BY lower\(name\),trainer_id/); assert.match(sql, /trainer_aliases/); assert.match(sql, /lower\(c.name\)/); assert.match(sql, /AS matched_course/);
  for (const path of ['?state=unknown', '?limit=0', '?cursor=bad']) assert.equal((await request(s, path)).status, 400);
  assert.equal((await request(s, '/courses')).status, 200); assert.match(s.calls.at(-1)!.sql, /c.programme_code IS NULL OR p.status='active'/);
  for (const suffix of ['', '/history', '/deactivation-impact']) assert.equal((await request(s, `/missing${suffix}`)).status, 404);
});
test('every new route is rate-table-free and responses contain only rate-free fields', async () => {
  for (const [path, method, body] of [...reads.map((p): [string, string, Row | undefined] => [p, 'GET', undefined]), ...writes]) {
    const s = store(path.endsWith('/reactivate') ? { is_active: false } : {});
    const response = await request(s, path, method, body);
    assert.ok([200, 201].includes(response.status), `${method} ${path}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /"(?:fee|rate|tier|margin|cost|viability|recommendation|ranking)[^"]*"\s*:/i);
    assert.doesNotMatch(s.calls.map((c) => c.sql).join('\n'), /trainer_rate|trainer_tier|fee_with_gst|economics|viability/i);
  }
});
test('schema migration retains alias preflight, append-only trigger and course/trainer-correlated grandfathering SQL', () => {
  const migration = readFileSync(new URL('../../../../db/migrations/2026-09-08_trainer_directory.sql', import.meta.url), 'utf8');
  assert.match(migration, /GROUP BY lower\(btrim\(alias_name\)\)[\s\S]*HAVING count\(\*\) > 1/);
  assert.match(migration, /RAISE EXCEPTION[\s\S]*duplicate normalized trainer aliases/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON trainer_change_events/);
  assert.match(migration, /e.trainer_id = tc.trainer_id[\s\S]*e.course_code = tc.course_code/);
  assert.match(migration, /grandfathered/);
});

test('all mutation events are atomic: event failure restores profile, lifecycle, mappings and versions', async () => {
  for (const [path, method, body] of writes) {
    const s = store(path.endsWith('/reactivate') ? { is_active: false } : {});
    const before = JSON.stringify({ trainer: s.trainer, links: s.links, aliases: s.aliases, exclusions: s.exclusions });
    s.failEvent = true;
    assert.equal((await request(s, path, method, body)).status, 500, path);
    assert.equal(JSON.stringify({ trainer: s.trainer, links: s.links, aliases: s.aliases, exclusions: s.exclusions }), before, path);
    assert.equal(s.events.length, 0);
  }
});

test('additive saves never create acknowledgement or confirm a needs_setup trainer', async () => {
  const s = store({ scheduling_readiness: 'needs_setup', readiness_origin: null, readiness_confirmed_at: null,
    readiness_confirmed_by: null, readiness_version: null, exclusions_acknowledged_at: null,
    exclusions_acknowledged_by: null, exclusions_acknowledged_version: null });
  const response = await request(s, '/tr_demo/eligibility', 'PUT', { expectedVersion: 4,
    links: [{ courseCode: 'FTDM-DME', isSme: true }, { courseCode: 'ASKAME', isSme: false }], exclusions: [] });
  assert.equal(response.status, 200); assert.equal(s.trainer.scheduling_readiness, 'needs_setup');
  assert.equal(s.trainer.exclusions_acknowledged_version, null); assert.equal(s.trainer.readiness_confirmed_at, null);
  assert.equal(s.events.length, 1);
});
