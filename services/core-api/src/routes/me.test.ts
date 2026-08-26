import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { meRoutes } from './me.js';

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
