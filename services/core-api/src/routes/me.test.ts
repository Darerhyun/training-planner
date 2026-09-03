import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { AppEnv, TransactionHandler } from '@training-planner/shared';
import type { MiddlewareHandler } from 'hono';
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
  const auth: () => MiddlewareHandler<AppEnv> = () => async (c, next) => { c.set('auth', { firebaseUid: user.firebase_uid, email: user.email, user }); await next(); };
  app.route('/', createMeRoutes({ auth, db: async () => [] }));
  const profile = await app.request('/me'); const profileBody = await profile.json() as { deactivated: boolean; version: number };
  assert.equal(profile.status, 200); assert.equal(profileBody.deactivated, true); assert.equal(profileBody.version, 4);
  const update = await app.request('/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Nope' }) });
  assert.equal(update.status, 403); assert.equal((await update.json()).code, 'account_deactivated');
});

test('ADMIN_EMAILS bootstrap keeps ordinary and invited users pending without first-sign-in invitation lookup', async () => {
  const { initialRole, findOrCreateUser } = await import('../../../shared/dist/auth.js');
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'admin@example.com';
  try {
    assert.equal(initialRole('admin@example.com'), 'admin');
    assert.equal(initialRole('ordinary@example.com'), 'pending');
    assert.equal(initialRole('invited@example.com'), 'pending');

    const calls: string[] = [];
    const transaction = async <T>(handler: TransactionHandler<T>): Promise<T> =>
      handler(async <R = Record<string, unknown>>(sql: string) => {
        calls.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) return [] as R[];
        if (sql.includes('FROM users WHERE firebase_uid')) return [] as R[];
        return [{
          id: 'new-user',
          firebase_uid: 'firebase',
          email: 'ordinary@example.com',
          display_name: null,
          role: 'pending',
          is_active: true,
          version: 1,
          created_at: '',
          updated_at: '',
        }] as R[];
      });

    const created = await findOrCreateUser(
      'firebase',
      'ordinary@example.com',
      null,
      transaction,
    );
    assert.equal(created.role, 'pending');
    assert.equal(
      calls[0],
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    );
    assert.equal(calls.some((sql) => sql.includes('user_invitations')), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});
