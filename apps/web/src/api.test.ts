import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { User } from 'firebase/auth';
import { hasTrainerDialogInput, restoreTrainerFocus, trainerAccessDenied, trainerAliasFocusTarget } from './pages/admin-trainer-directory-page.js';
import {
  ApiError,
  apiFetch,
  approvePlannedCourseRun,
  createAdminInvitation,
  fetchPlanningSessions,
  fetchAdminTrainers,
  fetchTrainerSnapshot,
  mutateAdminTrainer,
  schedulePlannedCourseRun,
  updateAdminUser,
  updateSessionTrainer,
  uploadMasterSchedule,
  type ParseResult,
} from './api.js';

const user = {
  getIdToken: async () => 'test-token',
} as unknown as User;

test('trainer directory query and audited alias removal preserve exact contract', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  await withFetch(async (input, init) => { requests.push({ url: String(input), init }); return jsonResponse({ trainer: { version: 10 }, trainers: [], counts: { ready: 0, needs_setup: 0, inactive: 0 } }); }, async () => {
    await fetchAdminTrainers(user, { state: 'ready', q: 'Demo & Trainer', cursor: 'cursor/+' });
    await mutateAdminTrainer(user, 'demo/id', 9, { action: 'remove-alias', aliasId: 4, note: 'Duplicate mapping removed.' });
  });
  assert.equal(new URL(requests[0].url).searchParams.get('q'), 'Demo & Trainer');
  assert.equal(new URL(requests[0].url).searchParams.get('cursor'), 'cursor/+');
  assert.ok(requests[1].url.endsWith('/admin/trainers/demo%2Fid/aliases/4'));
  assert.equal(requests[1].init?.method, 'DELETE');
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { aliasId: 4, note: 'Duplicate mapping removed.', expectedVersion: 9 });
});

test('trainer snapshot does not resolve before authoritative History and list counts', async () => {
  let finishHistory: (() => void) | undefined; let finished = false;
  await withFetch(async (input) => {
    if (String(input).endsWith('/history')) { await new Promise<void>((resolve) => { finishHistory = resolve; }); return jsonResponse({ events: [{ id: 'event-10' }] }); }
    if (String(input).includes('?')) return jsonResponse({ trainers: [], counts: { ready: 2, needs_setup: 1, inactive: 0 } });
    return jsonResponse({ trainer: { trainer_id: 'demo', version: 10 } });
  }, async () => {
    const pending = fetchTrainerSnapshot(user, 'demo', { state: 'ready' }).then((value) => { finished = true; return value; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false); assert.ok(finishHistory); finishHistory();
    const snapshot = await pending; assert.equal(snapshot.trainer.version, 10); assert.equal(snapshot.history[0].id, 'event-10'); assert.equal(snapshot.list.counts.ready, 2);
  });
});

test('trainer mutation preserves typed stale and not-found failures without retry', async () => {
  for (const [status, code] of [[409, 'stale_trainer_version'], [404, 'trainer_not_found']] as const) {
    let calls = 0;
    await withFetch(async () => { calls++; return jsonResponse({ error: 'Reload trainer', code, currentVersion: 10 }, status); }, async () => {
      await assert.rejects(mutateAdminTrainer(user, 'demo', 9, { action: 'deactivate', acknowledgeAssignments: true, note: '' }), (error: unknown) => {
        assert.ok(error instanceof ApiError); assert.equal(error.status, status); assert.equal(error.code, code); return true;
      });
    });
    assert.equal(calls, 1);
  }
});

test('directory regression guards cover staged success, awaited History, shared 404 cleanup and exact mobile gutters', async () => {
  const page = await readFile(new URL('./pages/admin-trainer-directory-page.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
  assert.match(page, /const snapshot = await fetchTrainerSnapshot/);
  assert.ok(page.indexOf('const snapshot = await fetchTrainerSnapshot') < page.indexOf('setMessage(success)'));
  assert.match(page, /await Promise\.all\(\[fetchAdminTrainer\(user, id\), fetchAdminTrainerHistory\(user, id\), fetchAdminTrainers/);
  assert.match(page, /async function unavailable\(\)[\s\S]*?await loadList\(\);\s*setRestoreFocusVersion/);
  assert.match(page, /useLayoutEffect\(\(\) => \{[\s\S]*?restoreTrainerFocus\(opener.current, searchRef.current\)/);
  assert.match(page, /const dirty = profileDirty \|\| eligibilityDirty \|\| hasTrainerDialogInput\(dialogName, dialogNote\)/);
  assert.match(page, /if \(accessDenied\) return[\s\S]*?Admin access is required for Trainer Directory\./);
  assert.match(css, /\.administration-shell > \.topbar \{ margin: 0 0 24px;/);
  assert.match(css, /\.administration-content \{ width: auto; margin-inline: 12px; \}/);
  assert.match(css, /\.administration-content \{ margin-inline: 8px; \}/);
  assert.match(page, /\['smeEnabled', 'enabled'\], \['smeDisabled', 'disabled'\]/);
  assert.match(page, /if \(savedId\) \{\s*setStale\(true\)/);
  assert.match(page, /The change was saved, but the updated records could not be loaded/);
  assert.match(app, /if \(changeAdminSection\(next\)\).*\.focus\(\)/);
});

test('hidden stale dialog input remains dirty until explicitly cleared', () => {
  for (const [name, note] of [['Demo alias', ''], ['', 'Required audit reason'], ['', ' ']]) {
    assert.equal(hasTrainerDialogInput(name, note), true);
    // Closing the dialog changes visibility, not these retained values.
    const shouldConfirmReload = hasTrainerDialogInput(name, note);
    assert.equal(shouldConfirmReload, true);
  }
  assert.equal(hasTrainerDialogInput('', ''), false);
});

test('alias removal focuses next chip or Add alias when the removed chip was last', () => {
  const first = { id: 'first' }; const next = { id: 'next' }; const add = { id: 'add' };
  assert.equal(trainerAliasFocusTarget([next], 0, add), next);
  assert.equal(trainerAliasFocusTarget([first], 1, add), add);
  assert.equal(trainerAliasFocusTarget([], 0, add), add);
});

test('post-commit restoration rechecks detached opener and focuses connected search', () => {
  const focused: string[] = [];
  const opener = { isConnected: true, focus: () => focused.push('opener') };
  const search = { isConnected: true, focus: () => focused.push('search') };
  const afterCommit = () => restoreTrainerFocus(opener, search);
  opener.isConnected = false;
  afterCommit();
  assert.deepEqual(focused, ['search']);
  opener.isConnected = true; afterCommit();
  assert.deepEqual(focused, ['search', 'opener']);
});

test('typed 403 Insufficient permissions reaches the Admin-required classifier', async () => {
  await withFetch(async () => jsonResponse({ error: 'Insufficient permissions' }, 403), async () => {
    await assert.rejects(fetchAdminTrainers(user, { state: 'ready' }), (failure: unknown) => {
      assert.equal(trainerAccessDenied(failure), true); return true;
    });
  });
  assert.equal(trainerAccessDenied(new ApiError('Server error', 500)), false);
  assert.equal(trainerAccessDenied(new Error('403')), false);
});

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type StalePayload = { error: string; code: string; currentVersion: number };

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

function blockedParsePayload(): ParseResult {
  return {
    rows: [
      {
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
        status: 'cancelled',
        alerts: [],
      },
    ],
    summary: {
      totalRows: 3,
      validRows: 3,
      inserts: 0,
      updates: 0,
      unchanged: 0,
      skipped: 0,
      cancellations: 2,
      conflicts: 0,
      existingSessions: 3,
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
    rows: [],
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

test('apiFetch throws ApiError for common non-2xx responses with metadata and parsed payload', async () => {
  const cases: Array<[number, { error: string; code: string; currentVersion?: number }]> = [
    [401, { error: 'Token expired.', code: 'auth_required' }],
    [403, { error: 'You are not authorized to access this area.', code: 'forbidden' }],
    [409, {
      error: 'This session changed after you opened it. Reload before trying again.',
      code: 'stale_session_version',
      currentVersion: 7,
    }],
    [422, { error: 'The schedule file is invalid.', code: 'invalid_schedule' }],
    [500, { error: 'Internal server error.', code: 'internal_error' }],
  ];

  for (const [status, payload] of cases) {
    await withFetch(
      async () => jsonResponse(payload, status),
      async () => {
        await assert.rejects(apiFetch(user, '/test'), (error: unknown) => {
          assert.ok(assertApiError(error, status, payload));
          assert.equal(error.code, payload.code);
          assert.equal(error.currentVersion, payload.currentVersion ?? null);
          if (status === 401) {
            assert.equal(error.message, 'Your session expired or is invalid. Sign in again.');
          } else {
            assert.equal(error.message, payload.error);
          }
          return true;
        });
      },
    );
  }
});

test('stale admin, session, and planned-run wrappers rethrow the transport ApiError', async () => {
  const adminPayload = {
    error: 'This user changed; reload before applying access changes.',
    code: 'stale_user_version',
    currentVersion: 4,
  };
  const sessionPayload = {
    error: 'This session changed after you opened it. Reload before trying again.',
    code: 'stale_session_version',
    currentVersion: 8,
  };
  const plannedPayload = {
    error: 'This planned run changed after you opened it. Reload and try again.',
    code: 'stale_planned_course_run_version',
    currentVersion: 3,
  };
  const operations: Array<[StalePayload, () => Promise<unknown>]> = [
    [adminPayload, () => createAdminInvitation(user, { email: 'new@example.com', intendedRole: 'ops' })],
    [adminPayload, () => updateAdminUser(user, 'user-1', { expectedVersion: 1, action: 'approve', role: 'ops' })],
    [sessionPayload, () => updateSessionTrainer(user, 'session-1', null, 1, 'update')],
    [plannedPayload, () => approvePlannedCourseRun(user, 'run-1', 1)],
    [plannedPayload, () => schedulePlannedCourseRun(user, 'run-1', {
      expectedVersion: 1,
      startDate: '2026-09-01',
      endDate: '2026-09-02',
    })],
  ];

  for (const [payload, operation] of operations) {
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
  const { rows: _rows, ...missingRows } = blocked;
  const { existingSessions: _existingSessions, ...summaryWithoutExistingSessions } = blocked.summary;
  const missingExistingSessions = {
    ...blocked,
    summary: summaryWithoutExistingSessions,
  };
  const nullBlockReason = {
    ...blocked,
    summary: { ...blocked.summary, blockReason: null },
  };
  const payloads: Array<[string, unknown]> = [
    ['malformed blocked result', malformed],
    ['missing rows', missingRows],
    ['missing existing sessions', missingExistingSessions],
    ['null block reason', nullBlockReason],
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

test('uploadMasterSchedule recovers valid initial and replay blocked parse 409 payloads', async () => {
  const blocked = blockedParsePayload();

  for (const batchId of ['batch-blocked-initial', 'batch-blocked-replay']) {
    const responses = [
      jsonResponse({
        upload: { id: batchId },
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

    assert.deepEqual(result, { ...blocked, uploadBatchId: batchId });
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

test('fetchPlanningSessions serializes needsAttention only when true and maps its summary', async () => {
  const requests: string[] = [];
  const responseBody = { summary: { issues: { needsAttention: 4 } } };

  await withFetch(
    async (input) => {
      requests.push(String(input));
      return jsonResponse(responseBody);
    },
    async () => {
      const baseRequest = { from: '2026-08-01', to: '2026-08-31' };
      await fetchPlanningSessions(user, baseRequest);
      await fetchPlanningSessions(user, { ...baseRequest, needsAttention: false });
      const result = await fetchPlanningSessions(user, { ...baseRequest, needsAttention: true });
      assert.equal(result.summary.issues.needsAttention, 4);
    },
  );

  assert.equal(new URL(requests[0]).searchParams.has('needsAttention'), false);
  assert.equal(new URL(requests[1]).searchParams.has('needsAttention'), false);
  assert.equal(new URL(requests[2]).searchParams.get('needsAttention'), 'true');
});
