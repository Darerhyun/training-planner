import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, type HttpErrorExtra } from './http-error.js';

test('builds the default and typed response bodies without allowing error overrides', () => {
  const defaultError = new HttpError(404, 'Resource not found');
  assert.equal(defaultError.status, 404);
  assert.equal(defaultError.message, 'Resource not found');
  assert.deepEqual(defaultError.body, { error: 'Resource not found' });

  const extra = {
    code: 'stale_session_version',
    currentVersion: 3,
  } satisfies HttpErrorExtra;
  const typedError = new HttpError(409, 'Session changed', extra);
  assert.deepEqual(typedError.body, {
    error: 'Session changed',
    code: 'stale_session_version',
    currentVersion: 3,
  });
  assert.equal(typedError.body.error, 'Session changed');

  // @ts-expect-error HttpError extras cannot override the constructor message.
  const invalidExtra: HttpErrorExtra = { error: 'Override' };
  void invalidExtra;
});
