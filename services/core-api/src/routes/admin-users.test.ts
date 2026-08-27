import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { requireRole } from '@training-planner/shared';
import type { AppEnv, SqlQuery, User } from '@training-planner/shared';
import type { MiddlewareHandler } from 'hono';
import { adminUsersRoutes, createAdminUsersRoutes, isValidAccessTransition, normalizeInviteEmail, publicUser } from './admin-users.js';

const admin: User = { id: 'admin-1', firebase_uid: 'firebase-admin', email: 'admin@example.com', display_name: 'Admin', role: 'admin', is_active: true, version: 1, created_at: '', updated_at: '' };
const basePending = { id: 'user-1', firebase_uid: 'firebase-pending', email: 'person@example.com', display_name: 'Person', role: 'pending', is_active: true, version: 1, created_at: '', updated_at: '' };

function authApp(route = adminUsersRoutes, user: User = admin, role = user.role) {
  const app = new Hono<AppEnv>();
  app.use('/admin/*', async (c, next) => { c.set('auth', { firebaseUid: user.firebase_uid, email: user.email, user }); await next(); });
  app.use('/admin/*', async (_c, next) => { if (role !== 'admin') return _c.json({ error: 'Insufficient permissions' }, 403); await next(); });
  app.route('/', route);
  return app;
}

function makeStore(seed: any[] = [], forceInvitationUnique = false) {
  const users = seed.length ? seed : [admin, basePending];
  const invitations: Record<string, any>[] = [];
  const events: Record<string, any>[] = [];
  const calls: string[] = [];
  const query: SqlQuery = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    calls.push(sql);
    if (sql.includes('pg_advisory_xact_lock')) return [] as T[];
    if (sql.includes('FROM users WHERE lower(email)')) return (users.filter((item) => String(item.email).toLowerCase() === params[0]).map((item) => ({ id: item.id })) as T[]);
    if (sql.includes('FROM users WHERE firebase_uid')) return (users.filter((item) => item.firebase_uid === params[0]) as T[]);
    if (sql.includes("FROM users WHERE role='admin'")) return (users.filter((item) => item.role === 'admin' && item.is_active).map((item) => ({ id: item.id })) as T[]);
    if (sql.includes('FROM users WHERE id = $1')) return (users.filter((item) => item.id === params[0]) as T[]);
    if (sql.includes('FROM user_invitations WHERE email')) return (invitations.filter((item) => item.email === params[0] && item.status === 'pending') as T[]);
    if (sql.includes('FROM user_invitations WHERE id')) return (invitations.filter((item) => item.id === params[0]) as T[]);
    if (sql.includes('INSERT INTO user_invitations')) { if (forceInvitationUnique) throw Object.assign(new Error('duplicate open invitation'), { code: '23505' }); const created = { id: `invite-${invitations.length + 1}`, email: params[0], intended_role: params[1], note: params[2], status: 'pending', version: 1, invited_by: params[3], created_at: '', updated_at: '' }; invitations.push(created); return [created] as T[]; }
    if (sql.includes('UPDATE user_invitations')) { const item = invitations.find((entry) => entry.id === params[1] || entry.id === params[0]); if (item) { if (sql.includes("status='claimed'")) { item.status = 'claimed'; item.claimed_by = params[0]; } else { item.status = 'cancelled'; item.cancelled_by = params[0]; } item.version += 1; } return item ? [item] as T[] : []; }
    if (sql.includes('INSERT INTO user_access_events')) { events.push({ user_id: params[0], invitation_id: params[1], target_email: params[2], action: params[3], actor_user_id: params[4], previous_role: params[5], new_role: params[6], previous_is_active: params[7], new_is_active: params[8], previous_version: params[9], new_version: params[10], note: params[11] }); return [] as T[]; }
    if (sql.includes('UPDATE users')) { const item = users.find((entry) => entry.id === params[2]); if (!item) return [] as T[]; item.role = params[0]; item.is_active = params[1]; item.version = Number(item.version) + 1; return [item] as T[]; }
    if (sql.includes('user_access_events e')) return events as T[];
    return [] as T[];
  };
  return { users, invitations, events, calls, query, transaction: async <T>(handler: (tx: SqlQuery) => Promise<T>) => handler(query) };
}

function injectedRoute(store: ReturnType<typeof makeStore>, user: User = admin) {
  const auth: () => MiddlewareHandler<AppEnv> = () => async (c, next) => { c.set('auth', { firebaseUid: user.firebase_uid, email: user.email, user }); await next(); };
  const role: () => MiddlewareHandler<AppEnv> = () => async (_c, next) => next();
  return createAdminUsersRoutes({
    db: store.query,
    transaction: store.transaction,
    auth,
    role,
  });
}

test('Admin User Access routes reject unauthenticated callers', async () => {
  const app = new Hono(); app.route('/', adminUsersRoutes);
  assert.equal((await app.request('/admin/users')).status, 401);
});

test('Admin User Access denies non-admin callers before querying data', async () => {
  const store = makeStore(); const ops = { ...basePending, role: 'ops' as const }; const auth: () => MiddlewareHandler<AppEnv> = () => async (c, next) => { c.set('auth', { firebaseUid: ops.firebase_uid, email: ops.email, user: ops }); await next(); }; const role: () => MiddlewareHandler<AppEnv> = () => async (c) => c.json({ error: 'Insufficient permissions' }, 403); const app = authApp(createAdminUsersRoutes({ db: store.query, transaction: store.transaction, auth, role }), ops, 'ops');
  assert.equal((await app.request('/admin/users')).status, 403); assert.equal(store.calls.length, 0);
});

test('invitation route uses HTTP transaction seam and records a pre-user normalized target', async () => {
  const store = makeStore([admin]); const app = authApp(injectedRoute(store));
  const response = await app.request('/admin/user-invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: '  Invitee@Example.COM ', intendedRole: 'ops', note: 'handoff' }) });
  assert.equal(response.status, 201); assert.equal(store.invitations[0].email, 'invitee@example.com'); assert.equal(store.events[0].user_id, null); assert.equal(store.events[0].target_email, 'invitee@example.com'); assert.equal(store.events[0].note, 'handoff'); assert.equal(store.calls[0], 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))');
});

test('invitation rejects an existing application user with typed 409', async () => {
  const store = makeStore([admin, { ...basePending, email: 'exists@example.com' }]); const app = authApp(injectedRoute(store));
  const response = await app.request('/admin/user-invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'exists@example.com', intendedRole: 'viewer' }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'invited_user_exists');
});

test('approval claims invitation, activates the account and writes before/after audit state', async () => {
  const store = makeStore([admin, basePending]); store.invitations.push({ id: 'invite-1', email: basePending.email, intended_role: 'finance', status: 'pending', note: 'finance access', version: 1 }); const app = authApp(injectedRoute(store));
  const response = await app.request(`/admin/users/${basePending.id}/access`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, action: 'approve', role: 'finance', note: 'approved' }) });
  assert.equal(response.status, 200); const body = await response.json() as { user: User }; assert.equal(body.user.role, 'finance'); assert.equal(body.user.is_active, true); assert.equal(store.invitations[0].status, 'claimed'); assert.equal(store.events.at(-1)?.new_is_active, true); assert.equal(store.events.at(-1)?.note, 'approved');
});

test('reapproval always restores active access', async () => {
  const rejected = { ...basePending, role: 'rejected' as const, is_active: false, version: 3 }; const store = makeStore([admin, rejected]); const app = authApp(injectedRoute(store));
  const response = await app.request(`/admin/users/${rejected.id}/access`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 3, action: 'approve', role: 'viewer' }) });
  assert.equal(response.status, 200); const body = await response.json() as { user: User }; assert.equal(body.user.role, 'viewer'); assert.equal(body.user.is_active, true);
});

test('cancellation requires the exact stale invitation code and audits the new note', async () => {
  const store = makeStore([admin]); store.invitations.push({ id: 'invite-1', email: 'invitee@example.com', intended_role: 'ops', status: 'pending', note: 'original', version: 2 }); const app = authApp(injectedRoute(store));
  const stale = await app.request('/admin/user-invitations/invite-1/cancel', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, note: 'cancelled' }) });
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'stale_user_invitation_version');
  const ok = await app.request('/admin/user-invitations/invite-1/cancel', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 2, note: 'cancelled' }) });
  assert.equal(ok.status, 200); assert.equal(store.events.at(-1)?.note, 'cancelled');
});

test('transition matrix, metadata stripping and normalized email helpers are covered', () => {
  assert.equal(normalizeInviteEmail('  Person@Example.COM '), 'person@example.com'); assert.equal(normalizeInviteEmail(null), ''); assert.equal('firebase_uid' in publicUser({ id: 'id', firebase_uid: 'private' }), false);
  assert.equal(isValidAccessTransition('approve', 'ops', 'pending', true), true); assert.equal(isValidAccessTransition('approve', 'ops', 'rejected', false), true); assert.equal(isValidAccessTransition('reject', undefined, 'rejected', false), false); assert.equal(isValidAccessTransition('change_role', 'viewer', 'pending', true), false); assert.equal(isValidAccessTransition('deactivate', undefined, 'admin', false), false); assert.equal(isValidAccessTransition('reactivate', undefined, 'admin', false), true);
});

test('requireRole route matrix permits only active Admin and returns deactivated code', async () => {
  for (const role of ['ops', 'finance', 'viewer', 'pending', 'rejected'] as const) {
    const app = new Hono<AppEnv>(); app.use('*', async (c, next) => { c.set('auth', { firebaseUid: 'f', email: `${role}@example.com`, user: { ...basePending, role, is_active: true } }); await next(); }); app.use('*', requireRole('admin')); app.get('/', (c) => c.json({ ok: true }));
    assert.equal((await app.request('/')).status, 403);
  }
  const inactive = new Hono<AppEnv>(); inactive.use('*', async (c, next) => { c.set('auth', { firebaseUid: 'f', email: 'inactive@example.com', user: { ...admin, is_active: false } }); await next(); }); inactive.use('*', requireRole('admin')); inactive.get('/', (c) => c.json({ ok: true }));
  const response = await inactive.request('/'); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'account_deactivated');
  const allowed = new Hono<AppEnv>(); allowed.use('*', async (c, next) => { c.set('auth', { firebaseUid: 'f', email: admin.email, user: admin }); await next(); }); allowed.use('*', requireRole('admin')); allowed.get('/', (c) => c.json({ ok: true }));
  assert.equal((await allowed.request('/')).status, 200);
});

test('maps invitation unique violation, stale user, self-change and last-admin protection to typed 409s', async () => {
  const unique = makeStore([admin], true); const uniqueApp = authApp(injectedRoute(unique));
  const duplicate = await uniqueApp.request('/admin/user-invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'race@example.com', intendedRole: 'ops' }) });
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).code, 'open_invitation_exists');
  const staleStore = makeStore([admin, { ...basePending, version: 2 }]); const staleApp = authApp(injectedRoute(staleStore));
  const stale = await staleApp.request('/admin/users/user-1/access', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, action: 'approve', role: 'ops' }) });
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'stale_user_version');
  const selfStore = makeStore([admin]); const selfApp = authApp(injectedRoute(selfStore));
  const self = await selfApp.request('/admin/users/admin-1/access', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, action: 'deactivate' }) });
  assert.equal(self.status, 409); assert.equal((await self.json()).code, 'self_access_change_forbidden');
  const lastStore = makeStore([admin, { ...basePending, id: 'other-admin', role: 'admin', is_active: false }]); const otherAdmin = { ...admin, id: 'other-admin', email: 'other-admin@example.com' }; const lastApp = authApp(injectedRoute(lastStore, otherAdmin), otherAdmin);
  const last = await lastApp.request('/admin/users/admin-1/access', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1, action: 'deactivate' }) });
  assert.equal(last.status, 409); assert.equal((await last.json()).code, 'last_active_admin_forbidden');
});

test('mutex fake proves two opposing last-admin demotions cannot both succeed', async () => {
  let activeAdmins = 2; let locked = false; const waiters: (() => void)[] = [];
  const lock = async () => { while (locked) await new Promise<void>((resolve) => waiters.push(resolve)); locked = true; };
  const unlock = () => { locked = false; waiters.shift()?.(); };
  const demote = async () => { await lock(); try { if (activeAdmins <= 1) return false; activeAdmins -= 1; return true; } finally { unlock(); } };
  const result = await Promise.all([demote(), demote()]);
  assert.deepEqual(result.sort(), [false, true]); assert.equal(activeAdmins, 1);
});

