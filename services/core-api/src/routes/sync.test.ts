import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { requireRole, type AppEnv, type SqlQuery, type TransactionHandler, type UserRole } from '@training-planner/shared';
import { createSyncRoutes } from './sync.js';
import { buildExternalRef, REFERENCE_NAMESPACES, type SchedulePreview, type ScheduleParseResult } from '../ingest/parse-schedule.js';
import { ScheduleHeaderError, type MappedScheduleRow } from '../ingest/master-schedule-mapping.js';

const previousBucket = process.env.GCS_UPLOAD_BUCKET;
before(() => { process.env.GCS_UPLOAD_BUCKET = 'synthetic-sync-bucket'; });
after(() => {
  if (previousBucket === undefined) delete process.env.GCS_UPLOAD_BUCKET;
  else process.env.GCS_UPLOAD_BUCKET = previousBucket;
});

type BatchState = {
  id: string; gcs_object_name: string; status: 'uploaded' | 'parsed' | 'blocked' | 'applied' | 'rejected';
  original_workbook_sha256: string | null; parse_result: SchedulePreview | null;
  acknowledged_by: string | null; acknowledged_digest: string | null; acknowledged_at: string | null;
};
type SessionState = {
  id: string; external_ref: string; management_source: 'import' | 'application';
  course_code: string | null; trainer_id: string | null; venue_code: string | null; room_id: string | null;
  status: string; start_date: string; end_date: string; expected_pax: number | null;
  confirmed_pax: number | null; time_text: string | null; version: number;
};
type Call = { sql: string; params: unknown[]; transaction: boolean };

function authFor(role: UserRole): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('auth', {
      firebaseUid: 'synthetic-uid', email: 'demo@example.test',
      user: { id: '00000000-0000-4000-8000-000000000001', firebase_uid: 'synthetic-uid', email: 'demo@example.test',
        display_name: 'Demo Operator', role, created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' },
    });
    await next();
  };
}
function mapped(overrides: Partial<MappedScheduleRow> = {}): MappedScheduleRow {
  return { rowNumber: 3, tmsCode: 'DEMO', courseCode: 'DEMO', sourceCourseName: 'Demo course',
    aliasBatchId: 'DEMO-2026-1', batchId: null, startDate: '2026-10-01', endDate: '2026-10-02',
    trainerId: 'demo-trainer', rawTrainerName: 'Demo Trainer', venueCode: 'IP', roomId: 'ip-demo',
    rawVenueText: 'IP', rawRoomText: 'Demo room', timeText: '09:00–18:00', expectedPax: 12, confirmedPax: 10,
    status: 'confirmed', alerts: [], ...overrides };
}
function unresolved(overrides: Partial<MappedScheduleRow> = {}): MappedScheduleRow {
  return mapped({ trainerId: null, rawTrainerName: 'Demo unmatched', alerts: [{
    code: 'unknown_trainer', message: 'Trainer did not resolve.', rowNumber: 3, rawValue: 'Demo unmatched',
  }], ...overrides });
}
function existing(row = mapped(), overrides: Partial<SessionState> = {}): SessionState {
  return { id: 'demo-session-1', external_ref: buildExternalRef(row), management_source: 'import',
    course_code: row.courseCode, trainer_id: row.trainerId, venue_code: row.venueCode, room_id: row.roomId,
    status: row.status, start_date: row.startDate!, end_date: row.endDate!, expected_pax: row.expectedPax,
    confirmed_pax: row.confirmedPax, time_text: row.timeText, version: 1, ...overrides };
}
function parsed(rows: MappedScheduleRow[]): ScheduleParseResult {
  return { rows, alerts: rows.flatMap((row) => row.alerts), conflicts: [], summary: {
    totalRows: rows.length, validRows: rows.length, inserts: rows.length, updates: 0, unchanged: 0, skipped: 0,
    cancellations: 0, conflicts: 0, existingSessions: 0, changeCount: rows.length, autoApplied: false,
    requiresConfirmation: true, blocked: false, blockReason: null,
  } };
}

function fixture(rows = [mapped()], sessions: SessionState[] = [], role: UserRole = 'admin') {
  const state = {
    batch: { id: 'demo-batch', gcs_object_name: 'demo/schedule.xlsx', status: 'uploaded', original_workbook_sha256: null,
      parse_result: null, acknowledged_by: null, acknowledged_digest: null, acknowledged_at: null } as BatchState,
    sessions: structuredClone(sessions),
    namespaces: REFERENCE_NAMESPACES.map((namespace) => ({ namespace: String(namespace), revision: '1' })),
    trainers: [{ trainer_id: 'demo-trainer', name: 'Demo Trainer', version: 1, is_active: true, scheduling_readiness: 'ready' }],
    aliases: [{ id: 1, trainer_id: 'demo-trainer', alias_name: 'Demo Trainer alias', source: 'schedule_excel' }],
  };
  const controls = { rows, buffer: Buffer.from('synthetic workbook'), storageError: null as unknown,
    parseError: null as unknown, failBatch: false, failSession: false, lockError: null as unknown };
  const calls: Call[] = [];
  const downloads: string[] = [];
  let transactions = 0;
  function query(active: typeof state, transaction: boolean): SqlQuery {
    return async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      calls.push({ sql, params, transaction });
      if (sql.startsWith('LOCK TABLE') || sql.includes('pg_advisory_xact_lock')) {
        if (controls.lockError) throw controls.lockError;
        return [];
      }
      if (sql.includes('FROM upload_batches')) return (params[0] === active.batch.id ? [active.batch] : []) as T[];
      if (sql.includes('UPDATE upload_batches')) {
        if (controls.failBatch) throw new Error('synthetic batch failure');
        if (sql.includes("status = 'rejected'")) {
          active.batch.status = 'rejected'; return [{ id: active.batch.id, status: 'rejected' }] as T[];
        }
        active.batch.status = params[1] as BatchState['status'];
        active.batch.parse_result = JSON.parse(params[2] as string);
        active.batch.original_workbook_sha256 ??= params[3] as string;
        active.batch.acknowledged_by = params[4] as string | null;
        active.batch.acknowledged_digest = params[5] as string | null;
        active.batch.acknowledged_at = active.batch.status === 'applied' ? '2026-09-15T12:00:00Z' : null;
        return [];
      }
      if (sql.includes('FROM reference_data_namespace_revisions')) return active.namespaces as T[];
      if (sql.includes('FROM trainer_aliases')) return active.aliases as T[];
      if (sql.includes('FROM trainers')) return active.trainers as T[];
      if (sql.includes('FROM sessions')) {
        if (sql.includes('WHERE external_ref = ANY')) return active.sessions.filter((row) => (params[0] as string[]).includes(row.external_ref)) as T[];
        if (sql.includes('WHERE external_ref = $1')) return active.sessions.filter((row) => row.external_ref === params[0]) as T[];
        return [...active.sessions].sort((a, b) => a.external_ref.localeCompare(b.external_ref) || a.id.localeCompare(b.id)) as T[];
      }
      if (sql.includes('INSERT INTO sessions')) {
        if (controls.failSession || active.sessions.some((row) => row.external_ref === params[15])) return [];
        const row: SessionState = { id: `inserted-${active.sessions.length}`, external_ref: params[15] as string,
          management_source: 'import', course_code: params[0] as string, trainer_id: params[3] as string,
          venue_code: params[5] as string, room_id: params[6] as string, time_text: params[8] as string,
          status: params[9] as string, start_date: params[10] as string, end_date: params[11] as string,
          expected_pax: params[12] as number, confirmed_pax: params[13] as number, version: 1 };
        active.sessions.push(row); return [row] as T[];
      }
      if (sql.includes('UPDATE sessions')) {
        if (controls.failSession) return [];
        const row = active.sessions.find((session) => session.id === params[0] && session.version === params[16] && session.management_source === 'import');
        if (!row) return [];
        Object.assign(row, { course_code: params[1], trainer_id: params[4], venue_code: params[6], room_id: params[7], time_text: params[9],
          status: params[10], start_date: params[11], end_date: params[12], expected_pax: params[13], confirmed_pax: params[14], version: row.version + 1 });
        return [row] as T[];
      }
      throw new Error(`Unexpected synthetic SQL: ${sql}`);
    };
  }
  const db = query(state, false);
  let queue = Promise.resolve();
  const transaction = <T>(handler: TransactionHandler<T>): Promise<T> => {
    const run = queue.then(async () => {
      transactions++;
      const copy = structuredClone(state);
      const result = await handler(query(copy, true));
      Object.assign(state, copy);
      return result;
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
  const app = createSyncRoutes({ db, transaction, auth: authFor(role), writeRoles: requireRole('admin', 'ops'),
    storage: { bucket: () => ({ file: (name) => ({ download: async (): Promise<[Buffer]> => {
      downloads.push(name); if (controls.storageError) throw controls.storageError; return [controls.buffer];
    } }) }) },
    parseWorkbook: async (_buffer, tx) => {
      assert.notEqual(tx, db, 'the parser receives the same transaction query dependency');
      if (controls.parseError) throw controls.parseError; return parsed(structuredClone(controls.rows));
    },
  });
  const call = (path: string, body: unknown = {}) => app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { state, controls, calls, downloads, app, call, get transactions() { return transactions; },
    parse: () => call('/sync/parse-schedule', { uploadBatchId: state.batch.id }),
    recheck: (decisions: unknown[] = state.batch.parse_result?.resolution?.decisions ?? []) => call('/sync/demo-batch/re-check', {
      previewDigest: state.batch.parse_result?.previewDigest, decisions,
    }),
    confirm: (extra: Record<string, unknown> = {}) => call('/sync/demo-batch/confirm', {
      previewDigest: state.batch.parse_result?.previewDigest, acknowledged: true, ...extra,
    }),
  };
}
async function preview(response: Response, status = 200): Promise<SchedulePreview> {
  const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body));
  assert.ok(body.resolution); return body as SchedulePreview;
}
function writes(f: ReturnType<typeof fixture>): Call[] {
  return f.calls.filter((call) => /^(INSERT INTO|UPDATE|DELETE FROM)/.test(call.sql));
}
async function ready(f: ReturnType<typeof fixture>): Promise<SchedulePreview> {
  await preview(await f.parse()); return preview(await f.recheck());
}

test('every initial Parse stores a durable non-rechecked Preview; duplicate Parse never applies', async () => {
  for (const count of [0, 1, 9, 10]) {
    const f = fixture(Array.from({ length: count }, (_, index) => mapped({ rowNumber: index + 3, aliasBatchId: `DEMO-2026-${index + 1}` })));
    const initial = await preview(await f.parse());
    assert.equal(initial.resolution!.rechecked, false);
    assert.equal(initial.summary.autoApplied, false);
    assert.equal(initial.summary.requiresConfirmation, true);
    assert.equal(f.state.batch.original_workbook_sha256, createHash('sha256').update(f.controls.buffer).digest('hex'));
    assert.deepEqual(await (await f.parse()).json(), initial);
    assert.equal(f.downloads.length, 1); assert.equal(f.state.sessions.length, 0);
    const denied = await f.confirm(); assert.equal(denied.status, 409);
    assert.equal((await denied.json()).code, 'sync_recheck_required');
    assert.equal(writes(f).filter((call) => call.sql.includes('sessions')).length, 0);
    const checked = await preview(await f.recheck()); assert.equal(checked.resolution!.rechecked, true);
    assert.notEqual(checked.previewDigest, initial.previewDigest);
    assert.equal((await f.confirm({ previewDigest: initial.previewDigest })).status, 409);
    assert.equal((await f.confirm({ acknowledged: false })).status, 400);
  }
});

test('Re-check server-stamps only valid row decisions, trims reasons, and Restore is explicit', async () => {
  const f = fixture([unresolved()]);
  const initial = await preview(await f.parse(), 409);
  const sourceRowId = initial.resolution!.outcomes[0].sourceRowId;
  assert.match(sourceRowId, /^[a-f0-9]{64}$/);
  const checked = await preview(await f.recheck([{ sourceRowId, action: 'skip', reason: '  Demo reason  ', actorId: 'forged', decidedAt: 'forged' }]));
  const decision = checked.resolution!.decisions[0];
  assert.equal(decision.reason, 'Demo reason');
  assert.equal(decision.actorId, '00000000-0000-4000-8000-000000000001');
  assert.ok(Number.isFinite(Date.parse(decision.decidedAt)));
  assert.deepEqual(checked.resolution!.counts, { total: 1, apply: 0, skipped: 1, blocked: 0 });
  assert.equal(checked.resolution!.outcomes[0].sourceRowId, sourceRowId);
  const restored = await preview(await f.recheck([]), 409);
  assert.deepEqual(restored.resolution!.decisions, []);
  assert.equal(restored.resolution!.outcomes[0].outcome, 'blocked');
  assert.equal(restored.resolution!.outcomes[0].sourceRowId, sourceRowId);
  assert.equal((await f.confirm()).status, 409);
  assert.equal(f.state.sessions.length, 0);
});

test('Re-check rejects forged IDs, bulk actions, duplicate decisions, and invalid reason bounds without writes', async () => {
  const f = fixture([unresolved()]); const initial = await preview(await f.parse(), 409);
  const id = initial.resolution!.outcomes[0].sourceRowId;
  const good = { sourceRowId: id, action: 'skip', reason: 'Demo' };
  for (const decisions of [[{ ...good, sourceRowId: 'forged' }], [good, good], [{ ...good, action: 'ignore_forever' }],
    [{ ...good, reason: '' }], [{ ...good, reason: '   ' }], [{ ...good, reason: 'x'.repeat(501) }]]) {
    const beforeWrites = writes(f).length;
    const response = await f.recheck(decisions);
    assert.ok(response.status === 400 || response.status === 409, await response.text());
    assert.deepEqual(f.state.batch.parse_result, initial); assert.equal(f.state.batch.status, 'blocked');
    assert.equal(writes(f).length, beforeWrites);
  }
  await preview(await f.recheck([{ ...good, reason: 'x'.repeat(500) }]));
});

test('malformed, ready, duplicate, and unresolved-fallback rows cannot be skipped', async () => {
  const malformed = unresolved({ startDate: null, alerts: [{ code: 'invalid_start_date', rowNumber: 3, message: 'Invalid date.', rawValue: 'bad' }] });
  for (const rows of [[mapped()], [malformed], [unresolved({ aliasBatchId: null, batchId: null, courseCode: null })],
    [unresolved(), unresolved({ rowNumber: 4 })], [unresolved({ batchId: 'OTHER-2026-2' })]]) {
    const f = fixture(rows); const initial = await preview(await f.parse(), rows[0].alerts.length ? 409 : 200);
    assert.equal(initial.resolution!.outcomes[0].canSkip, false);
    const response = await f.recheck([{ sourceRowId: initial.resolution!.outcomes[0].sourceRowId, action: 'skip', reason: 'Unsafe skip attempt' }]);
    assert.ok(response.status === 400 || response.status === 409, JSON.stringify({ source: rows, status: response.status, body: await response.text() }));
    assert.deepEqual(f.state.batch.parse_result, initial); assert.equal(f.state.sessions.length, 0);
  }
});

test('failed Re-check retains the exact Preview and parsed/blocked status; missing workbook directs Cancel/re-upload', async () => {
  for (const blocked of [false, true]) {
    const f = fixture(blocked ? [unresolved()] : [mapped()]);
    const initial = await preview(await f.parse(), blocked ? 409 : 200);
    for (const error of [new Error('synthetic parse failure'), new ScheduleHeaderError('Synthetic missing headers')]) {
      f.controls.parseError = error;
      const response = await f.recheck(); assert.equal(response.status, error instanceof ScheduleHeaderError ? 422 : 500);
      assert.deepEqual(f.state.batch.parse_result, initial); assert.equal(f.state.batch.status, blocked ? 'blocked' : 'parsed');
    }
    f.controls.parseError = null;
    f.controls.storageError = { code: 404 };
    const response = await f.recheck(); const body = await response.json();
    assert.equal(response.status, 409); assert.equal(body.code, 'sync_upload_unavailable');
    assert.match(body.error, /Cancel.*upload.*again/); assert.deepEqual(f.state.batch.parse_result, initial);
    f.controls.storageError = new Error('synthetic storage outage');
    assert.equal((await f.recheck()).status, 503); assert.deepEqual(f.state.batch.parse_result, initial);
  }
});

test('Re-check re-resolves the same workbook against current references without changing source IDs', async () => {
  const f = fixture([unresolved()]); const initial = await preview(await f.parse(), 409);
  f.controls.rows = [mapped()]; f.state.namespaces[0].revision = '2';
  const checked = await preview(await f.recheck());
  assert.equal(checked.resolution!.outcomes[0].sourceRowId, initial.resolution!.outcomes[0].sourceRowId);
  assert.deepEqual(f.downloads, ['demo/schedule.xlsx', 'demo/schedule.xlsx']);
  assert.equal(f.state.batch.status, 'parsed'); assert.notEqual(initial.previewDigest, checked.previewDigest);
  assert.equal(f.state.sessions.length, 0);
});

test('Apply rejects every namespace, trainer/alias, session presence/ID/version, parser, and workbook freshness change without writes', async () => {
  const mutations: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ...REFERENCE_NAMESPACES.map((namespace): [string, (f: ReturnType<typeof fixture>) => void] => [namespace, (f) => { f.state.namespaces.find((row) => row.namespace === namespace)!.revision = '2'; }]),
    ['trainer version', (f) => { f.state.trainers[0].version++; }],
    ['trainer inactive', (f) => { f.state.trainers[0].is_active = false; }],
    ['trainer readiness', (f) => { f.state.trainers[0].scheduling_readiness = 'needs_setup'; }],
    ['trainer alias', (f) => { f.state.aliases[0].alias_name = 'New demo alias'; }],
    ['new affected session', (f) => { f.state.sessions.push(existing()); }],
    ['denominator presence', (f) => { f.state.sessions.push(existing(mapped({ aliasBatchId: 'ABSENT-2026-9' }))); }],
    ['parser output', (f) => { f.controls.rows[0].expectedPax = 99; }],
    ['workbook SHA', (f) => { f.controls.buffer = Buffer.from('changed synthetic workbook'); }],
    ['object identity', (f) => { f.state.batch.gcs_object_name = 'changed.xlsx'; }],
  ];
  for (const [label, mutate] of mutations) {
    const f = fixture(); const checked = await ready(f); mutate(f);
    const beforeWrites = writes(f).length; const response = await f.confirm(); const body = await response.json();
    assert.equal(response.status, 409, label); assert.ok(['stale_sync_preview', 'sync_workbook_changed'].includes(body.code), label);
    assert.equal(writes(f).length, beforeWrites, label); assert.deepEqual(f.state.batch.parse_result, checked, label);
  }
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.state.sessions[0].version++; },
    (f: ReturnType<typeof fixture>) => { f.state.sessions[0].id = 'replaced-id'; },
    (f: ReturnType<typeof fixture>) => { f.state.sessions = []; }]) {
    const f = fixture([mapped()], [existing()]); await ready(f); mutate(f);
    const beforeWrites = writes(f).length; assert.equal((await f.confirm()).status, 409); assert.equal(writes(f).length, beforeWrites);
  }
});

test('Apply is atomic and exact committed-digest retries return the stored result even after workbook expiry', async () => {
  const f = fixture(); const checked = await ready(f);
  const response = await f.confirm(); const committed = await response.json();
  assert.equal(response.status, 200); assert.equal(committed.applied.applied, 1);
  assert.equal(f.state.batch.status, 'applied'); assert.equal(f.state.sessions.length, 1);
  assert.equal(f.state.batch.acknowledged_by, '00000000-0000-4000-8000-000000000001');
  assert.equal(f.state.batch.acknowledged_digest, checked.previewDigest); assert.ok(f.state.batch.acknowledged_at);
  const beforeWrites = writes(f).length; const downloads = f.downloads.length; f.controls.storageError = { code: 404 };
  assert.deepEqual(await (await f.confirm()).json(), committed);
  assert.equal((await f.confirm({ previewDigest: 'another-digest' })).status, 409);
  assert.equal((await f.confirm({ acknowledged: false })).status, 400);
  assert.equal(writes(f).length, beforeWrites); assert.equal(f.downloads.length, downloads);
  assert.equal((await f.recheck()).status, 409); assert.equal((await f.call('/sync/demo-batch/cancel')).status, 409);
  const sessionWriteIndex = f.calls.findIndex((call) => call.sql.startsWith('INSERT INTO sessions'));
  assert.ok(sessionWriteIndex > f.calls.findIndex((call) => call.sql.includes('LOCK TABLE sessions')));
  assert.ok(f.calls.filter((call) => call.sql.startsWith('UPDATE') || call.sql.startsWith('INSERT')).every((call) => call.transaction));
});

test('concurrent exact confirmations commit once and cancellation of an applied batch is rejected', async () => {
  const f = fixture(); await ready(f);
  const [first, second] = await Promise.all([f.confirm(), f.confirm()]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(f.state.sessions.length, 1);
  assert.equal(writes(f).filter((call) => call.sql.startsWith('INSERT INTO sessions')).length, 1);
});

test('session or batch persistence failure rolls back the complete Apply including acknowledgement', async () => {
  for (const failure of ['batch', 'session']) {
    const f = fixture([mapped({ confirmedPax: 11 }), mapped({ rowNumber: 4, aliasBatchId: 'DEMO-2026-2' })], [existing()]);
    await ready(f); const before = structuredClone(f.state);
    if (failure === 'batch') f.controls.failBatch = true; else f.controls.failSession = true;
    const response = await f.confirm(); assert.equal(response.status, failure === 'batch' ? 500 : 409);
    assert.deepEqual(f.state, before); assert.equal(f.state.batch.acknowledged_digest, null);
  }
});

test('transaction lock/deadlock failures are typed stale 409s without mutation', async () => {
  for (const code of ['40001', '40P01', '55P03']) {
    const f = fixture(); await ready(f); const before = structuredClone(f.state); f.controls.lockError = { code };
    const response = await f.confirm(); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'stale_sync_preview');
    assert.deepEqual(f.state, before);
  }
});

test('explicit cancellation numerator includes cancelled inserts and already-cancelled matches, separately from existing IDs', async () => {
  const cancelled = mapped({ status: 'cancelled' });
  const rows = [cancelled, mapped({ rowNumber: 4, aliasBatchId: 'NEW-2026-2', status: 'cancelled' })];
  const sessions = Array.from({ length: 4 }, (_, index) => existing(index === 0 ? cancelled : mapped({ aliasBatchId: `OTHER-2026-${index}` }), { id: `existing-${index}` }));
  const f = fixture(rows, sessions); const checked = await ready(f); const cancellation = checked.resolution!.cancellation;
  assert.equal(cancellation.numerator, 2); assert.equal(cancellation.denominator, 4); assert.equal(cancellation.hardBlocked, false);
  assert.deepEqual(cancellation.sourceRowIds, checked.resolution!.outcomes.map((row) => row.sourceRowId).sort());
  assert.deepEqual(cancellation.sessionIds, ['existing-0']);
  assert.equal(cancellation.denominatorSessions.length, 4);
  assert.equal((await f.confirm()).status, 200);
  assert.equal(f.state.sessions.filter((row) => row.status === 'cancelled').length, 2);
  assert.equal(f.state.sessions.filter((row) => row.status === 'confirmed').length, 3, 'absent rows are not cancellations');
});

test('greater-than-50% cancellation is non-overridable, and only a proven skipped cancellation leaves its numerator', async () => {
  const cancel = unresolved({ status: 'cancelled' });
  const f = fixture([cancel], [existing()]); const initial = await preview(await f.parse(), 409);
  assert.equal(initial.resolution!.cancellation.hardBlocked, true);
  await preview(await f.recheck(), 409);
  assert.equal((await f.confirm({ manualOverride: true })).status, 409);
  const checked = await preview(await f.recheck([{ sourceRowId: initial.resolution!.outcomes[0].sourceRowId, action: 'skip', reason: 'Keep application session' }]));
  assert.deepEqual(checked.resolution!.cancellation.sourceRowIds, []);
  assert.deepEqual(checked.resolution!.cancellation.sessionIds, []);
  assert.equal(checked.resolution!.cancellation.numerator, 0);
  assert.equal(checked.resolution!.cancellation.denominator, 1);
  assert.equal((await f.confirm()).status, 200); assert.equal(f.state.sessions[0].status, 'confirmed');
  assert.equal(writes(f).filter((call) => call.sql.includes('sessions')).length, 0);
});

test('application-managed conflicts block writes and permit only reasoned correspondence-safe skips', async () => {
  const f = fixture([mapped({ trainerId: 'incoming-demo' })], [existing(mapped(), { management_source: 'application' })]);
  const initial = await preview(await f.parse(), 409);
  assert.equal(initial.conflicts.length, 1); assert.equal(initial.resolution!.outcomes[0].canSkip, true);
  const checked = await preview(await f.recheck([{ sourceRowId: initial.resolution!.outcomes[0].sourceRowId, action: 'skip', reason: 'Keep app assignment' }]));
  assert.equal(checked.resolution!.counts.skipped, 1); assert.equal((await f.confirm()).status, 200);
  assert.equal(f.state.sessions[0].trainer_id, 'demo-trainer'); assert.equal(f.state.sessions[0].version, 1);
});

test('server authorizes every Sync endpoint for Admin/Ops only, before any database or storage work', async () => {
  const paths = ['/sync/parse-schedule', '/sync/demo-batch/re-check', '/sync/demo-batch/confirm', '/sync/demo-batch/cancel'];
  for (const role of ['finance', 'viewer', 'pending', 'rejected'] as UserRole[]) {
    const f = fixture([mapped()], [], role);
    for (const path of paths) assert.equal((await f.call(path, { uploadBatchId: 'demo-batch', acknowledged: true, decisions: [] })).status, 403);
    assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0);
  }
  for (const role of ['admin', 'ops'] as UserRole[]) {
    const f = fixture([mapped()], [], role); await ready(f); assert.equal((await f.confirm()).status, 200);
  }
});

test('cancel is idempotent, terminal batches cannot Re-check, and malformed/missing batch requests do not write', async () => {
  const f = fixture(); assert.equal((await f.call('/sync/parse-schedule')).status, 400);
  assert.equal((await f.call('/sync/parse-schedule', { uploadBatchId: 'missing' })).status, 404);
  await f.parse(); const cancelled = await f.call('/sync/demo-batch/cancel'); assert.equal(cancelled.status, 200);
  assert.deepEqual(await (await f.call('/sync/demo-batch/cancel')).json(), await cancelled.json());
  assert.equal((await f.recheck()).status, 409); assert.equal((await f.confirm()).status, 409);
  assert.equal((await f.parse()).status, 409); assert.equal(f.state.sessions.length, 0);
});

test('a legacy stored Preview without Re-check evidence fails closed with Cancel-and-re-upload recovery', async () => {
  const f = fixture();
  f.state.batch.status = 'parsed';
  f.state.batch.parse_result = { ...parsed([mapped()]), previewDigest: 'a'.repeat(64) } as SchedulePreview;
  const response = await f.parse();
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'sync_upload_unavailable');
  assert.match(body.error, /Cancel.*upload.*again/);
  assert.equal(writes(f).length, 0);
});
