import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlQuery } from '@training-planner/shared';
import {
  applyScheduleParseResult,
  buildExternalRef,
  summarizeRows,
  type ScheduleApplyResult,
  type ScheduleParseResult,
} from './parse-schedule.js';
import type { MappedScheduleRow } from './master-schedule-mapping.js';

type ExistingRow = {
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

function existingFor(row: MappedScheduleRow, overrides: Partial<ExistingRow> = {}): ExistingRow {
  return {
    id: `session-${row.rowNumber}`,
    external_ref: buildExternalRef(row),
    management_source: 'import',
    course_code: row.courseCode,
    trainer_id: row.trainerId,
    venue_code: row.venueCode,
    room_id: row.roomId,
    status: row.status,
    start_date: row.startDate ?? '2026-08-01',
    end_date: row.endDate ?? '2026-08-02',
    expected_pax: row.expectedPax,
    confirmed_pax: row.confirmedPax,
    time_text: row.timeText,
    version: 1,
    ...overrides,
  };
}

type FakeDbOptions = {
  insertConflict?: {
    externalRef: string;
    winner: ExistingRow;
  };
  failUpdate?: boolean;
};

function createFakeDb(existing: ExistingRow[], options: FakeDbOptions = {}) {
  const rows = [...existing];
  const calls: string[] = [];
  const db: SqlQuery = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    calls.push(sql);
    if (sql.includes('FROM sessions') && sql.includes('WHERE external_ref IS NOT NULL')) return rows as T[];
    if (sql.includes('WHERE external_ref = ANY')) {
      const refs = params[0] as string[];
      return rows.filter((row) => refs.includes(row.external_ref)) as T[];
    }
    if (sql.includes('WHERE external_ref = $1')) {
      return rows.filter((row) => row.external_ref === params[0]) as T[];
    }
    if (sql.includes('UPDATE sessions')) {
      const row = options.failUpdate
        ? undefined
        : rows.find(
            (item) =>
              item.id === params[0] &&
              item.management_source === 'import' &&
              item.version === params[16],
          );
      if (row) {
        row.course_code = params[1] as string | null;
        row.trainer_id = params[4] as string | null;
        row.venue_code = params[6] as string | null;
        row.room_id = params[7] as string | null;
        row.time_text = params[9] as string | null;
        row.status = params[10] as string;
        row.start_date = params[11] as string;
        row.end_date = params[12] as string;
        row.expected_pax = params[13] as number | null;
        row.confirmed_pax = params[14] as number | null;
        row.version += 1;
      }
      return (row ? [row] : []) as T[];
    }
    if (sql.includes('INSERT INTO sessions')) {
      const externalRef = params[15] as string;
      if (options.insertConflict?.externalRef === externalRef) {
        if (!rows.some((row) => row.external_ref === externalRef)) {
          rows.push(options.insertConflict.winner);
        }
        return [];
      }
      const inserted: ExistingRow = {
        id: `inserted-${rows.length + 1}`,
        external_ref: externalRef,
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
      rows.push(inserted);
      return [inserted] as T[];
    }
    return [];
  };
  return { db, rows, calls };
}

function createConcurrentInsertDb() {
  const rows: ExistingRow[] = [];
  const owners = new Map<string, string>();
  const heldByWorker = new Map<string, Set<string>>();
  const waiters = new Map<string, Array<{
    worker: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>();
  const insertOrder = new Map<string, string[]>();

  function rememberHeld(worker: string, externalRef: string): void {
    const held = heldByWorker.get(worker) ?? new Set<string>();
    held.add(externalRef);
    heldByWorker.set(worker, held);
  }

  function acquire(worker: string, externalRef: string): Promise<void> {
    const owner = owners.get(externalRef);
    if (!owner || owner === worker) {
      owners.set(externalRef, worker);
      rememberHeld(worker, externalRef);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = waiters.get(externalRef) ?? [];
        waiters.set(
          externalRef,
          pending.filter((entry) => entry.worker !== worker),
        );
        reject(new Error(`deadlock waiting for ${externalRef}`));
      }, 250);
      const pending = waiters.get(externalRef) ?? [];
      pending.push({ worker, resolve, reject, timer });
      waiters.set(externalRef, pending);
    });
  }

  function release(worker: string): void {
    const held = heldByWorker.get(worker) ?? new Set<string>();
    for (const externalRef of held) {
      if (owners.get(externalRef) !== worker) continue;
      const pending = waiters.get(externalRef) ?? [];
      const next = pending.shift();
      if (next) {
        clearTimeout(next.timer);
        owners.set(externalRef, next.worker);
        rememberHeld(next.worker, externalRef);
        next.resolve();
        waiters.set(externalRef, pending);
      } else {
        owners.delete(externalRef);
        waiters.delete(externalRef);
      }
    }
    heldByWorker.delete(worker);
  }

  function dbFor(worker: string): SqlQuery {
    return async <T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T[]> => {
      if (sql.includes('WHERE external_ref = ANY')) {
        const refs = params[0] as string[];
        return rows.filter((row) => refs.includes(row.external_ref)) as T[];
      }
      if (sql.includes('WHERE external_ref = $1')) {
        return rows.filter((row) => row.external_ref === params[0]) as T[];
      }
      if (sql.includes('INSERT INTO sessions')) {
        const externalRef = params[15] as string;
        const order = insertOrder.get(worker) ?? [];
        order.push(externalRef);
        insertOrder.set(worker, order);
        await acquire(worker, externalRef);
        if (rows.some((row) => row.external_ref === externalRef)) return [];
        const inserted: ExistingRow = {
          id: `${worker}-${rows.length + 1}`,
          external_ref: externalRef,
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
        rows.push(inserted);
        return [inserted] as T[];
      }
      return [];
    };
  }

  async function apply(worker: string, incoming: MappedScheduleRow[]): Promise<ScheduleApplyResult> {
    try {
      return await applyScheduleParseResult(
        `batch-${worker}`,
        {
          rows: incoming,
          alerts: [],
          conflicts: [],
          summary: {
            totalRows: incoming.length,
            validRows: incoming.length,
            inserts: incoming.length,
            updates: 0,
            unchanged: 0,
            skipped: 0,
            cancellations: 0,
            conflicts: 0,
            existingSessions: 0,
            changeCount: incoming.length,
            autoApplied: false,
            requiresConfirmation: false,
            blocked: false,
            blockReason: null,
          },
        },
        dbFor(worker),
      );
    } finally {
      release(worker);
    }
  }

  return { apply, insertOrder, rows };
}

test('summarizes existing new unchanged update and cancellation Sync behavior', async () => {
  const unchanged = mapped({ rowNumber: 3, aliasBatchId: 'ASKMEI-2026-1' });
  const changed = mapped({ rowNumber: 4, aliasBatchId: 'ASKMEI-2026-2', trainerId: 'trainer-2' });
  const cancelled = mapped({ rowNumber: 5, aliasBatchId: 'ASKMEI-2026-3', status: 'cancelled' });
  const inserted = mapped({ rowNumber: 6, aliasBatchId: 'ASKMEI-2026-4' });
  const fake = createFakeDb([
    existingFor(unchanged),
    existingFor(changed, { trainer_id: 'trainer-1' }),
    existingFor(cancelled, { status: 'confirmed' }),
  ]);

  const result = await summarizeRows([unchanged, changed, cancelled, inserted], fake.db);

  assert.equal(result.summary.inserts, 1);
  assert.equal(result.summary.updates, 2);
  assert.equal(result.summary.unchanged, 1);
  assert.equal(result.summary.cancellations, 1);
  assert.equal(result.summary.changeCount, 3);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.summary.requiresConfirmation, true);
});

test('app-managed identical incoming rows remain unchanged', async () => {
  const row = mapped({ rowNumber: 3, aliasBatchId: 'ASKMEI-2026-10' });
  const fake = createFakeDb([existingFor(row, { management_source: 'application' })]);

  const result = await summarizeRows([row], fake.db);
  const applied = await applyScheduleParseResult('batch-1', { ...result, rows: [row] }, fake.db);

  assert.equal(result.summary.unchanged, 1);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(applied.applied, 1);
  assert.equal(applied.unchanged, 1);
  assert.equal(applied.conflicts.length, 0);
});

test('app-managed trainer status date venue room and pax differences become conflicts', async () => {
  const cases: Array<[string, Partial<MappedScheduleRow>, Partial<ExistingRow>]> = [
    ['trainerId', { trainerId: 'trainer-2' }, { trainer_id: 'trainer-1' }],
    ['status', { status: 'cancelled' }, { status: 'confirmed' }],
    ['startDate', { startDate: '2026-08-03' }, { start_date: '2026-08-01' }],
    ['endDate', { endDate: '2026-08-04' }, { end_date: '2026-08-02' }],
    ['venueCode', { venueCode: 'JTC' }, { venue_code: 'IP' }],
    ['roomId', { roomId: 'jtc-classroom' }, { room_id: 'ip-class1' }],
    ['expectedPax', { expectedPax: 18 }, { expected_pax: 12 }],
    ['confirmedPax', { confirmedPax: 16 }, { confirmed_pax: 10 }],
  ];

  for (const [field, rowPatch, existingPatch] of cases) {
    const row = mapped({ rowNumber: 10, aliasBatchId: `ASKMEI-2026-${field}`, ...rowPatch });
    const fake = createFakeDb([existingFor(row, { management_source: 'application', ...existingPatch })]);
    const result = await summarizeRows([row], fake.db);

    assert.equal(result.summary.conflicts, 1, field);
    assert.equal(result.summary.requiresConfirmation, true, field);
    assert.equal(result.conflicts[0].fields.some((changed) => changed.field === field), true, field);
  }
});

test('safe rows apply while app-managed conflicts are skipped', async () => {
  const safe = mapped({ rowNumber: 3, aliasBatchId: 'ASKMEI-2026-41', trainerId: 'trainer-2' });
  const conflict = mapped({ rowNumber: 4, aliasBatchId: 'ASKMEI-2026-42', status: 'cancelled' });
  const fake = createFakeDb([
    existingFor(safe, { trainer_id: 'trainer-1', management_source: 'import' }),
    existingFor(conflict, { status: 'confirmed', management_source: 'application' }),
  ]);
  const parseResult = await summarizeRows([safe, conflict], fake.db);

  const applied = await applyScheduleParseResult('batch-1', parseResult, fake.db);

  assert.equal(applied.applied, 1);
  assert.equal(applied.skipped, 1);
  assert.equal(applied.conflicts.length, 1);
  assert.equal(fake.rows.find((row) => row.external_ref === buildExternalRef(safe))?.trainer_id, 'trainer-2');
  assert.equal(fake.rows.find((row) => row.external_ref === buildExternalRef(conflict))?.status, 'confirmed');
});

test('apply rechecks ownership at confirm time before updating', async () => {
  const row = mapped({ rowNumber: 3, aliasBatchId: 'ASKMEI-2026-race', trainerId: 'trainer-2' });
  const fake = createFakeDb([existingFor(row, { trainer_id: 'trainer-1', management_source: 'application' })]);
  const staleParseResult: ScheduleParseResult = {
    rows: [row],
    alerts: [],
    conflicts: [],
    summary: {
      totalRows: 1,
      validRows: 1,
      inserts: 0,
      updates: 1,
      unchanged: 0,
      skipped: 0,
      cancellations: 0,
      conflicts: 0,
      existingSessions: 1,
      changeCount: 1,
      autoApplied: false,
      requiresConfirmation: true,
      blocked: false,
      blockReason: null,
    },
  };

  const applied = await applyScheduleParseResult('batch-1', staleParseResult, fake.db);

  assert.equal(applied.applied, 0);
  assert.equal(applied.skipped, 1);
  assert.equal(applied.conflicts.length, 1);
  assert.equal(applied.conflicts[0].fields[0].field, 'trainerId');
});

test('bulk-locks refs in deterministic order and increments import versions once per change', async () => {
  const unchanged = mapped({ rowNumber: 20, aliasBatchId: 'ASKMEI-2026-20' });
  const changed = mapped({ rowNumber: 21, aliasBatchId: 'ASKMEI-2026-21', trainerId: 'trainer-2' });
  const inserted = mapped({ rowNumber: 22, aliasBatchId: 'ASKMEI-2026-22' });
  const duplicate = mapped({ rowNumber: 23, aliasBatchId: 'ASKMEI-2026-22' });
  const fake = createFakeDb([
    existingFor(unchanged, { version: 4 }),
    existingFor(changed, { trainer_id: 'trainer-1', version: 7 }),
  ]);

  const applied = await applyScheduleParseResult(
    'batch-versions',
    {
      ...(await summarizeRows([unchanged, changed, inserted, duplicate], fake.db)),
      rows: [unchanged, changed, inserted, duplicate],
    },
    fake.db,
  );

  const bulkLocks = fake.calls.filter((sql) => sql.includes('WHERE external_ref = ANY'));
  assert.equal(bulkLocks.length, 1);
  assert.match(bulkLocks[0], /ORDER BY external_ref\s+FOR UPDATE/);
  assert.equal(fake.calls.filter((sql) => sql.includes('WHERE external_ref = $1')).length, 0);
  assert.equal(applied.applied, 4);
  assert.equal(applied.unchanged, 2);
  assert.equal(fake.rows.find((row) => row.external_ref === buildExternalRef(changed))?.version, 8);
  assert.equal(fake.rows.find((row) => row.external_ref === buildExternalRef(inserted))?.version, 1);
});

test('preview and apply classify duplicate incoming refs consistently', async () => {
  const first = mapped({ rowNumber: 30, aliasBatchId: 'ASKMEI-2026-30', trainerId: 'trainer-1' });
  const second = mapped({ rowNumber: 31, aliasBatchId: 'ASKMEI-2026-30', trainerId: 'trainer-2' });
  const fake = createFakeDb([]);

  const preview = await summarizeRows([first, second], fake.db);
  assert.equal(preview.summary.inserts, 1);
  assert.equal(preview.summary.updates, 1);

  const applied = await applyScheduleParseResult('batch-duplicates', preview, fake.db);
  assert.equal(applied.applied, 2);
  assert.equal(applied.unchanged, 0);
  assert.equal(fake.rows.length, 1);
  assert.equal(fake.rows[0].trainer_id, 'trainer-2');
  assert.equal(fake.rows[0].version, 2);
});

test('does not overwrite an application-managed winner of a concurrent insert race', async () => {
  const row = mapped({ rowNumber: 40, aliasBatchId: 'ASKMEI-2026-40', trainerId: 'trainer-2' });
  const externalRef = buildExternalRef(row);
  const winner = existingFor(row, {
    id: 'application-winner',
    management_source: 'application',
    trainer_id: 'trainer-1',
  });
  const fake = createFakeDb([], { insertConflict: { externalRef, winner } });

  const applied = await applyScheduleParseResult(
    'batch-race',
    { ...(await summarizeRows([row], fake.db)), rows: [row] },
    fake.db,
  );

  assert.equal(applied.applied, 0);
  assert.equal(applied.skipped, 1);
  assert.equal(applied.conflicts.length, 1);
  assert.equal(fake.rows[0].id, 'application-winner');
  assert.equal(fake.rows[0].trainer_id, 'trainer-1');
  assert.equal(fake.rows[0].version, 1);
});

test('fails closed when an import-managed version changes before its update', async () => {
  const row = mapped({ rowNumber: 50, aliasBatchId: 'ASKMEI-2026-50', trainerId: 'trainer-2' });
  const fake = createFakeDb([existingFor(row, { trainer_id: 'trainer-1' })], { failUpdate: true });

  await assert.rejects(
    applyScheduleParseResult(
      'batch-stale-version',
      { ...(await summarizeRows([row], fake.db)), rows: [row] },
      fake.db,
    ),
    /changed while the schedule was being applied/,
  );
  assert.equal(fake.rows[0].trainer_id, 'trainer-1');
  assert.equal(fake.rows[0].version, 1);
});

test('parallel inverse-order imports acquire missing external-ref keys in one order', async () => {
  const first = mapped({ rowNumber: 60, aliasBatchId: 'ASKMEI-2026-60' });
  const second = mapped({ rowNumber: 61, aliasBatchId: 'ASKMEI-2026-61' });
  const fake = createConcurrentInsertDb();

  const [left, right] = await Promise.all([
    fake.apply('left', [second, first]),
    fake.apply('right', [first, second]),
  ]);

  const expectedOrder = [buildExternalRef(first), buildExternalRef(second)].sort();
  assert.deepEqual(fake.insertOrder.get('left'), expectedOrder);
  assert.deepEqual(fake.insertOrder.get('right'), expectedOrder);
  assert.equal(left.applied, 2);
  assert.equal(right.applied, 2);
  assert.equal(fake.rows.length, 2);
});
