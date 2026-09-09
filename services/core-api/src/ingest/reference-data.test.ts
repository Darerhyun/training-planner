import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlQuery } from '@training-planner/shared';
import { finalizeTrainerDirectoryReferenceData } from './reference-data.js';

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
