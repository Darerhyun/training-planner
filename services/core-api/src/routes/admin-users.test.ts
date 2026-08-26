import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { adminUsersRoutes, isValidAccessTransition, normalizeInviteEmail, publicUser } from './admin-users.js';

test('Admin User Access routes reject unauthenticated callers', async () => {
  const app = new Hono();
  app.route('/', adminUsersRoutes);
  const response = await app.request('/admin/users');
  assert.equal(response.status, 401);
});

test('Admin User Access does not expose Firebase metadata in its route source', async () => {
  assert.equal('firebase_uid' in publicUser({ id: 'user-id', email: 'person@example.com', firebase_uid: 'private' }), false);
});

test('normalizes invitation targets and rejects malformed values', () => {
  assert.equal(normalizeInviteEmail('  Person@Example.COM '), 'person@example.com');
  assert.equal(normalizeInviteEmail(null), '');
});

test('enforces the exact access transition matrix', () => {
  assert.equal(isValidAccessTransition('approve', 'ops', 'pending', true), true);
  assert.equal(isValidAccessTransition('approve', 'ops', 'rejected', false), true);
  assert.equal(isValidAccessTransition('reject', undefined, 'pending', true), true);
  assert.equal(isValidAccessTransition('reject', undefined, 'rejected', false), false);
  assert.equal(isValidAccessTransition('change_role', 'viewer', 'ops', true), true);
  assert.equal(isValidAccessTransition('change_role', 'viewer', 'pending', true), false);
  assert.equal(isValidAccessTransition('deactivate', undefined, 'admin', true), true);
  assert.equal(isValidAccessTransition('deactivate', undefined, 'admin', false), false);
  assert.equal(isValidAccessTransition('reactivate', undefined, 'admin', false), true);
  assert.equal(isValidAccessTransition('reactivate', undefined, 'admin', true), false);
});

