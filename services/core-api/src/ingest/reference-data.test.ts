import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlQuery } from '@training-planner/shared';
import { finalizeTrainerDirectoryReferenceData, loadScheduleLookups } from './reference-data.js';

test('finalizes trainer-directory reference data through the shared database function', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: SqlQuery = async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    calls.push({ sql, params });
    return [] as T[];
  };

  await finalizeTrainerDirectoryReferenceData(db);

  assert.deepEqual(calls, [
    {
      sql: 'SELECT finalize_trainer_directory_reference_data()',
      params: [],
    },
  ]);
});

test('schedule reference reads filter active targets and venue-scoped owned rooms without writes', async () => {
  const calls: string[] = [];
  await loadScheduleLookups(async <T>(sql: string): Promise<T[]> => { calls.push(sql); return []; });
  assert.equal(calls.length, 8);
  assert.ok(calls.every((sql) => sql.startsWith('SELECT')));
  assert.ok(calls.find((sql) => sql.includes('FROM course_aliases'))?.includes('a.is_active AND c.is_active'));
  assert.ok(calls.find((sql) => sql.includes('FROM room_aliases'))?.includes('r.venue_code=a.venue_code'));
  assert.ok(calls.find((sql) => sql.includes('FROM room_aliases'))?.includes("v.type='owned'"));
});
