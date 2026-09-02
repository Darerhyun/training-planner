import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import {
  ApiError,
  apiFetch,
  approvePlannedCourseRun,
  createAdminInvitation,
  schedulePlannedCourseRun,
  updateAdminUser,
  updateSessionTrainer,
  uploadMasterSchedule,
  type ParseResult,
} from './api.js';

const user = {
  getIdToken: async () => 'test-token',
} as unknown as User;

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function withFetch<T>(handler: FetchHandler, callback: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

function assertApiError(error: unknown, status: number, payload: unknown): error is ApiError {
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, status);
  assert.deepEqual(error.payload, payload);
  return true;
}

function blockedParsePayload(): ParseResult & { rows: unknown[] } {
  return {
    rows: [],
    summary: {
      totalRows: 3,
      validRows: 3,
      inserts: 0,
      updates: 0,
      unchanged: 0,
      skipped: 0,
      cancellations: 2,
      conflicts: 0,
      changeCount: 0,
      autoApplied: false,
      requiresConfirmation: true,
      blocked: true,
      blockReason: 'Parse would cancel more than 50% of existing sessions.',
    },
    alerts: [
      {
        code: 'unknown_course',
        message: 'Course code could not be resolved.',
        rowNumber: 3,
        rawValue: 'UNKNOWN',
      },
    ],
    conflicts: [],
  };
}

function successfulParsePayload(): ParseResult {
  return {
    summary: {
      totalRows: 1,
      validRows: 1,
      inserts: 1,
      updates: 0,
      unchanged: 0,
      skipped: 0,
      cancellations: 0,
      conflicts: 0,
      changeCount: 1,
      autoApplied: true,
      requiresConfirmation: false,
      blocked: false,
      blockReason: null,
    },
    alerts: [],
    conflicts: [],
    applied: {
      applied: 1,
      skipped: 0,
      unchanged: 0,
      conflicts: [],
    },
  };
}

function uploadFile(): File {
  return new File(['schedule'], 'schedule.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

test('apiFetch throws ApiError for non-2xx responses with metadata and parsed payload', async () => {
  const payload = {
    error: 'This session changed after you opened it. Reload before trying again.',
    code: 'stale_session_version',
    currentVersion: 7,
  };

  await withFetch(
    async () => jsonResponse(payload, 409),
    async () => {
      await assert.rejects(apiFetch(user, '/sessions/session-1/trainer'), (error: unknown) => {
        assert.ok(assertApiError(error, 409, payload));
        assert.equal(error.message, payload.error);
        assert.equal(error.code, payload.code);
        assert.equal(error.currentVersion, payload.currentVersion);
        return true;
      });
    },
  );
});

test('stale admin, session, and planned-run wrappers rethrow the transport ApiError', async () => {
  const payload = {
    error: 'The record changed after you opened it. Reload before trying again.',
    code: 'stale_user_version',
    currentVersion: 4,
  };
  const operations: Array<() => Promise<unknown>> = [
    () => createAdminInvitation(user, { email: 'new@example.com', intendedRole: 'ops' }),
    () => updateAdminUser(user, 'user-1', { expectedVersion: 1, action: 'approve', role: 'ops' }),
    () => updateSessionTrainer(user, 'session-1', null, 1, 'update'),
    () => approvePlannedCourseRun(user, 'run-1', 1),
    () =>
      schedulePlannedCourseRun(user, 'run-1', {
        expectedVersion: 1,
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      }),
  ];

  for (const operation of operations) {
    await withFetch(
      async () => jsonResponse(payload, 409),
      async () => {
        await assert.rejects(operation(), (error: unknown) => {
          assert.ok(assertApiError(error, 409, payload));
          assert.equal(error.code, payload.code);
          assert.equal(error.currentVersion, payload.currentVersion);
          return true;
        });
      },
    );
  }
});

test('uploadMasterSchedule recovers a valid blocked parse 409 payload', async () => {
  const blocked = blockedParsePayload();
  const responses = [
    jsonResponse({
      upload: { id: 'batch-blocked' },
      signedUrl: 'https://storage.example.test/schedule.xlsx',
      contentType: 'application/octet-stream',
    }),
    new Response(null, { status: 200 }),
    jsonResponse(blocked, 409),
  ];

  const result = await withFetch(
    async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    () => uploadMasterSchedule(user, uploadFile()),
  );

  assert.deepEqual(result, { ...blocked, uploadBatchId: 'batch-blocked' });
  assert.equal(result.summary.blocked, true);
  assert.equal(result.summary.requiresConfirmation, true);
});

test('uploadMasterSchedule rethrows malformed and not-ready parse 409 payloads', async () => {
  const blocked = blockedParsePayload();
  const malformed = {
    ...blocked,
    summary: { ...blocked.summary, blocked: 'true' },
  };
  const payloads: Array<[string, unknown]> = [
    ['malformed blocked result', malformed],
    ['not-ready error', { error: 'Upload batch is not ready for parsing.' }],
  ];

  for (const [, payload] of payloads) {
    const responses = [
      jsonResponse({
        upload: { id: 'batch-rejected' },
        signedUrl: 'https://storage.example.test/schedule.xlsx',
        contentType: 'application/octet-stream',
      }),
      new Response(null, { status: 200 }),
      jsonResponse(payload, 409),
    ];

    await withFetch(
      async () => {
        const response = responses.shift();
        assert.ok(response);
        return response;
      },
      async () => {
        await assert.rejects(uploadMasterSchedule(user, uploadFile()), (error: unknown) => {
          assert.ok(assertApiError(error, 409, payload));
          return true;
        });
      },
    );
  }
});

test('uploadMasterSchedule returns successful parse results with the upload batch id', async () => {
  const parsed = successfulParsePayload();
  const responses = [
    jsonResponse({
      upload: { id: 'batch-success' },
      signedUrl: 'https://storage.example.test/schedule.xlsx',
      contentType: 'application/octet-stream',
    }),
    new Response(null, { status: 200 }),
    jsonResponse(parsed, 200),
  ];

  const result = await withFetch(
    async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    () => uploadMasterSchedule(user, uploadFile()),
  );

  assert.deepEqual(result, { ...parsed, uploadBatchId: 'batch-success' });
});
