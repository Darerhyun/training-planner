import test from 'node:test';
import assert from 'node:assert/strict';
import type { MiddlewareHandler } from 'hono';
import { createSyncRoutes } from './sync.js';
import type { MappedScheduleRow } from '../ingest/master-schedule-mapping.js';
import type { ScheduleParseResult } from '../ingest/parse-schedule.js';
import {
  requireRole,
  type AppEnv,
  type SqlQuery,
  type TransactionHandler,
  type UserRole,
} from '@training-planner/shared';

type BatchState = {
  id: string;
  gcs_object_name: string;
  status: 'uploaded' | 'parsed' | 'applied' | 'blocked' | 'rejected';
  parse_result: unknown;
};

type SessionState = {
  id: string;
  external_ref: string;
  management_source: 'import' | 'application';
  course_code: string | null;
  trainer_id: string | null;
  venue_code: string | null;
  room_id: string | null;
  status: string;
  start_date: string;
  end_date: string;
  expected_pax: number | null;
  confirmed_pax: number | null;
  time_text: string | null;
  version: number;
};

type QueryCall = {
  scope: 'db' | 'transaction';
  sql: string;
  params: unknown[];
};

type StoreOptions = {
  failBatchWrite?: boolean;
};

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

function mapped(overrides: Partial<MappedScheduleRow> = {}): MappedScheduleRow {
  return {
    rowNumber: 3,
    tmsCode: 'ASKMEI-2026-1',
    courseCode: 'ASKMEI',
    sourceCourseName: 'Excel Intermediate',
    aliasBatchId: 'ASKMEI-2026-1',
    batchId: null,
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    trainerId: 'trainer-1',
    rawTrainerName: null,
    venueCode: 'IP',
    roomId: 'ip-class1',
    rawVenueText: 'IP Class 1',
    timeText: '9.00 AM - 6.00 PM',
    expectedPax: 12,
    confirmedPax: 10,
    status: 'confirmed',
    alerts: [],
    ...overrides,
  };
}

function parseResult(
  row: MappedScheduleRow,
  summary: Partial<ScheduleParseResult['summary']> = {},
): ScheduleParseResult {
  return {
    rows: [row],
    alerts: [],
    conflicts: [],
    summary: {
      totalRows: 1,
      validRows: 1,
      inserts: 1,
      updates: 0,
      unchanged: 0,
      skipped: 0,
      cancellations: 0,
      conflicts: 0,
      existingSessions: 0,
      changeCount: 1,
      autoApplied: false,
      requiresConfirmation: false,
      blocked: false,
      blockReason: null,
      ...summary,
    },
  };
}

function cloneState(state: { batch: BatchState; sessions: SessionState[] }) {
  return {
    batch: {
      ...state.batch,
      parse_result: state.batch.parse_result
        ? JSON.parse(JSON.stringify(state.batch.parse_result))
        : null,
    },
    sessions: state.sessions.map((session) => ({ ...session })),
  };
}

function createStore(batch: BatchState, options: StoreOptions = {}) {
  const state = { batch, sessions: [] as SessionState[] };
  const calls: QueryCall[] = [];
  let transactionCount = 0;

  function queryFor(
    activeState: { batch: BatchState; sessions: SessionState[] },
    scope: QueryCall['scope'],
  ): SqlQuery {
    return async <T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T[]> => {
      calls.push({ scope, sql, params });

      if (sql.includes('FROM upload_batches')) {
        if (params[0] !== activeState.batch.id) return [];
        return [{ ...activeState.batch }] as T[];
      }

      if (sql.includes('UPDATE upload_batches')) {
        if (options.failBatchWrite) throw new Error('simulated batch write failure');
        if (sql.includes("SET status = 'rejected'")) {
          activeState.batch.status = 'rejected';
          return [{ id: activeState.batch.id, status: activeState.batch.status }] as T[];
        }
        activeState.batch.status = params[1] as BatchState['status'];
        activeState.batch.parse_result = JSON.parse(params[2] as string);
        return [];
      }

      if (sql.includes('WHERE external_ref = ANY')) {
        const refs = params[0] as string[];
        return activeState.sessions.filter((session) => refs.includes(session.external_ref)) as T[];
      }

      if (sql.includes('WHERE external_ref = $1')) {
        return activeState.sessions.filter((session) => session.external_ref === params[0]) as T[];
      }

      if (sql.includes('INSERT INTO sessions')) {
        const inserted: SessionState = {
          id: `session-${activeState.sessions.length + 1}`,
          external_ref: params[15] as string,
          management_source: 'import',
          course_code: params[0] as string | null,
          trainer_id: params[3] as string | null,
          venue_code: params[5] as string | null,
          room_id: params[6] as string | null,
          status: params[9] as string,
          start_date: params[10] as string,
          end_date: params[11] as string,
          expected_pax: params[12] as number | null,
          confirmed_pax: params[13] as number | null,
          time_text: params[8] as string | null,
          version: 1,
        };
        activeState.sessions.push(inserted);
        return [inserted] as T[];
      }

      if (sql.includes('UPDATE sessions')) {
        const session = activeState.sessions.find(
          (candidate) =>
            candidate.id === params[0] &&
            candidate.management_source === 'import' &&
            candidate.version === params[16],
        );
        if (!session) return [];
        session.course_code = params[1] as string | null;
        session.trainer_id = params[4] as string | null;
        session.venue_code = params[6] as string | null;
        session.room_id = params[7] as string | null;
        session.time_text = params[9] as string | null;
        session.status = params[10] as string;
        session.start_date = params[11] as string;
        session.end_date = params[12] as string;
        session.expected_pax = params[13] as number | null;
        session.confirmed_pax = params[14] as number | null;
        session.version += 1;
        return [session] as T[];
      }

      return [];
    };
  }

  const db = queryFor(state, 'db');
  const transaction = async <T>(handler: TransactionHandler<T>): Promise<T> => {
    transactionCount += 1;
    const transactionalState = cloneState(state);
    const result = await handler(queryFor(transactionalState, 'transaction'));
    state.batch = transactionalState.batch;
    state.sessions = transactionalState.sessions;
    return result;
  };

  return {
    state,
    db,
    transaction,
    calls,
    get transactionCount() {
      return transactionCount;
    },
  };
}

function storageFor() {
  return {
    bucket: () => ({
      file: () => ({
        download: async (): Promise<[Buffer]> => [Buffer.from('schedule')],
      }),
    }),
  };
}

function createApp(
  store: ReturnType<typeof createStore>,
  result: ScheduleParseResult,
) {
  return createSyncRoutes({
    db: store.db,
    storage: storageFor(),
    parseWorkbook: async () => result,
    transaction: store.transaction,
    auth: authFor('admin'),
    writeRoles: requireRole('admin', 'ops'),
  });
}

async function withBucket<T>(callback: () => Promise<T>): Promise<T> {
  const previous = process.env.GCS_UPLOAD_BUCKET;
  process.env.GCS_UPLOAD_BUCKET = 'test-upload-bucket';
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.GCS_UPLOAD_BUCKET;
    else process.env.GCS_UPLOAD_BUCKET = previous;
  }
}

test('auto-apply commits sessions and upload status in one transaction', async () => {
  await withBucket(async () => {
    const row = mapped();
    const result = parseResult(row);
    const store = createStore({
      id: 'batch-auto',
      gcs_object_name: 'schedule.xlsx',
      status: 'uploaded',
      parse_result: null,
    });
    const response = await createApp(store, result).request('/sync/parse-schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadBatchId: 'batch-auto' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.applied.applied, 1);
    assert.equal(store.state.batch.status, 'applied');
    assert.equal(store.state.sessions.length, 1);
    assert.equal(store.transactionCount, 1);

    const transactionalCalls = store.calls.filter((call) => call.scope === 'transaction');
    assert.match(transactionalCalls[0].sql, /FOR UPDATE/);
    assert.equal(transactionalCalls.some((call) => call.sql.includes('INSERT INTO sessions')), true);
    assert.equal(transactionalCalls.some((call) => call.sql.includes('UPDATE upload_batches')), true);
    assert.equal(
      store.calls.some(
        (call) => call.scope === 'db' && /\b(INSERT|UPDATE|DELETE)\b/i.test(call.sql),
      ),
      false,
    );
  });
});

test('initial blocked parse returns the full parse result with a 409 contract', async () => {
  await withBucket(async () => {
    const result = parseResult(mapped({ status: 'cancelled' }), {
      requiresConfirmation: true,
      blocked: true,
      blockReason: 'Parse would cancel more than 50% of existing sessions.',
    });
    const store = createStore({
      id: 'batch-blocked-initial',
      gcs_object_name: 'schedule.xlsx',
      status: 'uploaded',
      parse_result: null,
    });

    const response = await createApp(store, result).request('/sync/parse-schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadBatchId: 'batch-blocked-initial' }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), result);
    assert.equal(store.state.batch.status, 'blocked');
    assert.deepEqual(store.state.batch.parse_result, result);
  });
});

test('replaying a blocked parse returns the same full 409 contract', async () => {
  const result = parseResult(mapped({ status: 'cancelled' }), {
    requiresConfirmation: true,
    blocked: true,
    blockReason: 'Parse would cancel more than 50% of existing sessions.',
  });
  const store = createStore({
    id: 'batch-blocked-replay',
    gcs_object_name: 'schedule.xlsx',
    status: 'blocked',
    parse_result: result,
  });

  const response = await createApp(store, parseResult(mapped())).request('/sync/parse-schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadBatchId: 'batch-blocked-replay' }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), result);
  assert.equal(store.transactionCount, 0);
  assert.equal(store.state.batch.status, 'blocked');
});

test('rolls back session writes when the batch result write fails', async () => {
  await withBucket(async () => {
    const store = createStore(
      {
        id: 'batch-rollback',
        gcs_object_name: 'schedule.xlsx',
        status: 'uploaded',
        parse_result: null,
      },
      { failBatchWrite: true },
    );
    const response = await createApp(store, parseResult(mapped())).request('/sync/parse-schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadBatchId: 'batch-rollback' }),
    });

    assert.equal(response.status, 500);
    assert.equal(store.state.batch.status, 'uploaded');
    assert.equal(store.state.batch.parse_result, null);
    assert.equal(store.state.sessions.length, 0);
  });
});

test('confirmation is idempotent after the first committed application', async () => {
  const result = parseResult(mapped(), { requiresConfirmation: true });
  const store = createStore({
    id: 'batch-confirm',
    gcs_object_name: 'schedule.xlsx',
    status: 'parsed',
    parse_result: result,
  });
  const app = createApp(store, result);
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  } satisfies RequestInit;

  const first = await app.request('/sync/batch-confirm/confirm', init);
  const firstBody = await first.json();
  const second = await app.request('/sync/batch-confirm/confirm', init);
  const secondBody = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(secondBody, firstBody);
  assert.equal(store.state.batch.status, 'applied');
  assert.equal(store.state.sessions.length, 1);
  assert.equal(
    store.calls.filter(
      (call) => call.scope === 'transaction' && call.sql.includes('INSERT INTO sessions'),
    ).length,
    1,
  );
  assert.equal(store.transactionCount, 2);
});

test('blocked confirmation preserves its 409 contract without mutating the batch', async () => {
  const result = parseResult(mapped({ status: 'cancelled' }), {
    requiresConfirmation: true,
    blocked: true,
    blockReason: 'Parse would cancel more than 50% of existing sessions.',
  });
  const store = createStore({
    id: 'batch-blocked',
    gcs_object_name: 'schedule.xlsx',
    status: 'blocked',
    parse_result: result,
  });
  const response = await createApp(store, result).request('/sync/batch-blocked/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(body, {
    error: 'Manual override is required for the cancellation guard.',
  });
  assert.equal(store.state.batch.status, 'blocked');
  assert.equal(store.state.sessions.length, 0);
});

test('cancellation locks an uploaded batch before parse and leaves no session effects', async () => {
  await withBucket(async () => {
    const result = parseResult(mapped());
    const store = createStore({
      id: 'batch-cancel-before-apply',
      gcs_object_name: 'schedule.xlsx',
      status: 'uploaded',
      parse_result: null,
    });
    const app = createApp(store, result);

    const cancelled = await app.request('/sync/batch-cancel-before-apply/cancel', {
      method: 'POST',
    });
    const cancelledBody = await cancelled.json();
    assert.equal(cancelled.status, 200);
    assert.deepEqual(cancelledBody, {
      id: 'batch-cancel-before-apply',
      status: 'rejected',
    });

    const parse = await app.request('/sync/parse-schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadBatchId: 'batch-cancel-before-apply' }),
    });
    const parseBody = await parse.json();

    assert.equal(parse.status, 409);
    assert.deepEqual(parseBody, { error: 'Upload batch is not ready for parsing.' });
    assert.equal(store.state.batch.status, 'rejected');
    assert.equal(store.state.sessions.length, 0);
    assert.equal(store.transactionCount, 1);
    const transactionCalls = store.calls.filter((call) => call.scope === 'transaction');
    assert.match(transactionCalls[0].sql, /FOR UPDATE/);
    assert.equal(transactionCalls.some((call) => call.sql.includes('UPDATE upload_batches')), true);
  });
});

test('cancellation after application returns 409 and later confirmation only replays', async () => {
  await withBucket(async () => {
    const result = parseResult(mapped());
    const store = createStore({
      id: 'batch-cancel-after-apply',
      gcs_object_name: 'schedule.xlsx',
      status: 'uploaded',
      parse_result: null,
    });
    const app = createApp(store, result);

    const applied = await app.request('/sync/parse-schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadBatchId: 'batch-cancel-after-apply' }),
    });
    const appliedBody = await applied.json();
    assert.equal(applied.status, 200);
    assert.equal(store.state.batch.status, 'applied');
    assert.equal(store.state.sessions.length, 1);

    const cancelled = await app.request('/sync/batch-cancel-after-apply/cancel', {
      method: 'POST',
    });
    const cancelledBody = await cancelled.json();
    assert.equal(cancelled.status, 409);
    assert.deepEqual(cancelledBody, {
      error: 'Applied upload batches cannot be cancelled.',
    });
    assert.equal(store.state.batch.status, 'applied');
    assert.equal(store.state.sessions.length, 1);

    const confirmed = await app.request('/sync/batch-cancel-after-apply/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const confirmedBody = await confirmed.json();
    assert.equal(confirmed.status, 200);
    assert.deepEqual(confirmedBody, appliedBody);
    assert.equal(store.state.batch.status, 'applied');
    assert.equal(store.state.sessions.length, 1);
    assert.equal(
      store.calls.filter(
        (call) => call.scope === 'transaction' && call.sql.includes('INSERT INTO sessions'),
      ).length,
      1,
    );
  });
});

test('cancellation is idempotent for rejected batches and allowed before application', async () => {
  for (const status of ['rejected', 'parsed', 'blocked'] as const) {
    const result = parseResult(mapped(), {
      requiresConfirmation: true,
      blocked: status === 'blocked',
    });
    const store = createStore({
      id: `batch-cancel-${status}`,
      gcs_object_name: 'schedule.xlsx',
      status,
      parse_result: result,
    });
    const app = createApp(store, result);

    const first = await app.request(`/sync/batch-cancel-${status}/cancel`, { method: 'POST' });
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.deepEqual(firstBody, { id: `batch-cancel-${status}`, status: 'rejected' });

    if (status === 'rejected') {
      const second = await app.request(`/sync/batch-cancel-${status}/cancel`, { method: 'POST' });
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), firstBody);
    } else {
      const confirmed = await app.request(`/sync/batch-cancel-${status}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(confirmed.status, 409);
      assert.deepEqual(await confirmed.json(), { error: 'Upload batch has been rejected.' });
      assert.equal(store.state.sessions.length, 0);
    }
    assert.equal(store.state.batch.status, 'rejected');
  }
});
