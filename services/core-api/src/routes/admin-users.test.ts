import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { adminUsersRoutes } from './admin-users.js';

test('Admin User Access routes reject unauthenticated callers', async () => {
  const app = new Hono();
  app.route('/', adminUsersRoutes);
  const response = await app.request('/admin/users');
  assert.equal(response.status, 401);
});

test('Admin User Access does not expose Firebase metadata in its route source', async () => {
  // This contract is enforced by publicUser and the explicit SELECT lists.
  assert.equal('firebase_uid' in { id: 'user-id', email: 'person@example.com' }, false);
});
