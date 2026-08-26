import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createMeRoutes, meRoutes } from './me.js';

test('GET /me requires Firebase authentication', async () => {
  const app = new Hono();
  app.route('/', meRoutes);
  const response = await app.request('/me');
  assert.equal(response.status, 401);
});

test('PATCH /me requires Firebase authentication', async () => {
  const app = new Hono();
  app.route('/', meRoutes);
  const response = await app.request('/me', { method: 'PATCH', body: JSON.stringify({ display_name: 'Test' }) });
  assert.equal(response.status, 401);
});

test('injected /me HTTP route exposes deactivated status and blocks profile writes', async () => {
  const user = { id: 'inactive', firebase_uid: 'firebase-inactive', email: 'inactive@example.com', display_name: 'Inactive', role: 'viewer' as const, is_active: false, version: 4, created_at: '', updated_at: '' };
  const app = new Hono<AppEnv>();
  app.route('/', createMeRoutes({ auth: () => async (c, next) => { c.set('auth', { firebaseUid: user.firebase_uid, email: user.email, user }); await next(); }, db: async () => [] }));
  const profile = await app.request('/me'); const profileBody = await profile.json() as { deactivated: boolean; version: number };
  assert.equal(profile.status, 200); assert.equal(profileBody.deactivated, true); assert.equal(profileBody.version, 4);
  const update = await app.request('/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Nope' }) });
  assert.equal(update.status, 403); assert.equal((await update.json()).code, 'account_deactivated');
});

