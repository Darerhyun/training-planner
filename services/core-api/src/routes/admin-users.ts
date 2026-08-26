import { Hono } from 'hono';
import type { Context } from 'hono';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, UserRole } from '@training-planner/shared';

type UserAccessAction = 'approve' | 'reject' | 'change_role' | 'deactivate' | 'reactivate';

const activeRoles = new Set<UserRole>(['admin', 'ops', 'finance', 'viewer']);
const actions = new Set<UserAccessAction>(['approve', 'reject', 'change_role', 'deactivate', 'reactivate']);

export const adminUsersRoutes = new Hono<AppEnv>();
adminUsersRoutes.use('/admin/*', authMiddleware());
adminUsersRoutes.use('/admin/*', requireRole('admin'));

function publicUser(row: Record<string, unknown>) {
  const { firebase_uid: _firebaseUid, ...safe } = row;
  return safe;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function httpError(c: Context<AppEnv>, code: string, message: string, status = 400) {
  return c.json({ error: message, code }, status as 400 | 403 | 404 | 409 | 422);
}

adminUsersRoutes.get('/admin/users', async (c) => {
  const role = c.req.query('role');
  const status = c.req.query('status');
  const db = getDb();
  const params: unknown[] = [];
  const where: string[] = [];
  if (role && activeRoles.has(role as UserRole)) { params.push(role); where.push(`role = $${params.length}`); }
  if (status === 'active' || status === 'inactive') { params.push(status === 'active'); where.push(`is_active = $${params.length}`); }
  const rows = await db<Record<string, unknown>>(
    `SELECT id, email, display_name, role, is_active, version, created_at, updated_at
     FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(email), id`, params,
  );
  return c.json({ users: rows.map(publicUser) });
});

adminUsersRoutes.get('/admin/user-invitations', async (c) => {
  const status = c.req.query('status');
  const params: unknown[] = [];
  const where = status && ['pending', 'claimed', 'cancelled'].includes(status) ? `WHERE status = $1` : '';
  if (where) params.push(status);
  const rows = await getDb<Record<string, unknown>>(
    `SELECT id, email, intended_role, status, note, version, invited_by, claimed_by, claimed_at,
            cancelled_by, cancelled_at, created_at, updated_at
       FROM user_invitations ${where} ORDER BY created_at DESC, id`, params,
  );
  return c.json({ invitations: rows });
});

adminUsersRoutes.post('/admin/user-invitations', async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return httpError(c, 'invalid_json', 'Invalid JSON body'); }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const intendedRole = body.intendedRole ?? body.intended_role;
  const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() : undefined;
  if (!email || !email.includes('@')) return httpError(c, 'invalid_email', 'A valid email is required');
  if (typeof intendedRole !== 'string' || !activeRoles.has(intendedRole as UserRole)) return httpError(c, 'invalid_role', 'intendedRole must be an active role');
  if (note === undefined || (note !== null && note.length > 500)) return httpError(c, 'invalid_note', 'note must be at most 500 characters');
  const actor = c.get('auth').user;
  try {
    const invitation = await withTransaction(async (tx) => {
      const duplicate = await tx<{ id: string }>('SELECT id FROM user_invitations WHERE email = $1 AND status = \'pending\' FOR UPDATE', [email]);
      if (duplicate.length) throw new Error('open_invitation_exists');
      const created = await tx<Record<string, unknown>>(
        `INSERT INTO user_invitations (email, intended_role, note, invited_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, intended_role, status, note, version, invited_by, created_at, updated_at`,
        [email, intendedRole, note, actor.id],
      );
      await tx(`INSERT INTO user_access_events (user_id, invitation_id, action, actor_user_id, new_version, metadata)
                SELECT COALESCE((SELECT id FROM users WHERE email = $1), $4), $5, 'invite_created', $4, 1, jsonb_build_object('email', $1, 'intendedRole', $2)`,
        [email, intendedRole, note, actor.id, created[0].id]);
      return created[0];
    });
    return c.json({ invitation }, 201);
  } catch (error) {
    if (errorMessage(error) === 'open_invitation_exists') return httpError(c, 'open_invitation_exists', 'An open invitation already exists for this email', 409);
    throw error;
  }
});

adminUsersRoutes.patch('/admin/user-invitations/:id/cancel', async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return httpError(c, 'invalid_json', 'Invalid JSON body'); }
  const expectedVersion = body.expectedVersion ?? body.expected_version;
  if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) return httpError(c, 'invalid_expected_version', 'expectedVersion must be a positive integer');
  const actor = c.get('auth').user;
  try {
    const invitation = await withTransaction(async (tx) => {
      const found = await tx<Record<string, any>>('SELECT * FROM user_invitations WHERE id = $1 FOR UPDATE', [c.req.param('id')]);
      if (!found.length) throw new Error('invitation_not_found');
      const current = found[0];
      if (current.version !== Number(expectedVersion)) throw new Error('stale_invitation_version');
      if (current.status !== 'pending') throw new Error('invitation_not_pending');
      const updated = await tx<Record<string, unknown>>(
        `UPDATE user_invitations SET status = 'cancelled', cancelled_by = $1, cancelled_at = now(), version = version + 1, updated_at = now()
         WHERE id = $2 AND version = $3 RETURNING id, email, intended_role, status, note, version, invited_by, cancelled_by, cancelled_at, created_at, updated_at`,
        [actor.id, current.id, expectedVersion],
      );
      await tx(`INSERT INTO user_access_events (user_id, invitation_id, action, actor_user_id, previous_version, new_version, metadata)
                SELECT COALESCE((SELECT id FROM users WHERE email = $1), $2), $3, 'invite_cancelled', $2, $4, $4 + 1, jsonb_build_object('email', $1)`,
        [current.email, actor.id, current.id, expectedVersion]);
      return updated[0];
    });
    return c.json({ invitation });
  } catch (error) {
    const code = errorMessage(error);
    if (code === 'invitation_not_found') return httpError(c, code, 'Invitation not found', 404);
    if (code === 'stale_invitation_version') return httpError(c, code, 'Invitation changed; reload before cancelling', 409);
    if (code === 'invitation_not_pending') return httpError(c, code, 'Only pending invitations can be cancelled', 409);
    throw error;
  }
});

adminUsersRoutes.get('/admin/users/:id/history', async (c) => {
  const events = await getDb<Record<string, unknown>>(
    `SELECT id, invitation_id, action, actor_user_id, previous_role, new_role, previous_is_active, new_is_active,
            previous_version, new_version, metadata, created_at
       FROM user_access_events WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [c.req.param('id')],
  );
  return c.json({ events });
});

adminUsersRoutes.patch('/admin/users/:id/access', async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return httpError(c, 'invalid_json', 'Invalid JSON body'); }
  const expectedVersion = body.expectedVersion ?? body.expected_version;
  const action = body.action;
  const role = body.role;
  if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) return httpError(c, 'invalid_expected_version', 'expectedVersion must be a positive integer');
  if (typeof action !== 'string' || !actions.has(action as UserAccessAction)) return httpError(c, 'invalid_action', 'Unsupported access action');
  if ((action === 'approve' || action === 'change_role') && (typeof role !== 'string' || !activeRoles.has(role as UserRole))) return httpError(c, 'invalid_role', 'An active role is required');
  const actor = c.get('auth').user;
  try {
    const user = await withTransaction(async (tx) => {
      const targetRows = await tx<Record<string, any>>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [c.req.param('id')]);
      if (!targetRows.length) throw new Error('user_not_found');
      const target = targetRows[0];
      if (target.version !== Number(expectedVersion)) throw new Error('stale_user_version');
      if (target.id === actor.id && (action === 'deactivate' || (action === 'change_role' && role !== 'admin') || (action === 'reject'))) throw new Error('self_access_change_forbidden');
      const beforeRole = target.role as UserRole;
      const beforeActive = Boolean(target.is_active);
      let nextRole = beforeRole;
      let nextActive = beforeActive;
      let eventAction: string = action === 'approve' ? (beforeRole === 'rejected' ? 'user_reapproved' : 'user_approved') : action === 'change_role' ? 'role_changed' : action === 'reject' ? 'user_rejected' : action === 'deactivate' ? 'user_deactivated' : 'user_reactivated';
      if (action === 'approve' || action === 'change_role') nextRole = role as UserRole;
      if (action === 'reject') { nextRole = 'rejected'; nextActive = false; }
      if (action === 'deactivate') nextActive = false;
      if (action === 'reactivate') nextActive = true;
      if (beforeRole === 'admin' && beforeActive && (nextRole !== 'admin' || !nextActive)) {
        const admins = await tx<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE FOR UPDATE`);
        if (admins.length <= 1) throw new Error('last_active_admin_forbidden');
      }
      const updated = await tx<Record<string, unknown>>(
        `UPDATE users SET role = $1, is_active = $2, version = version + 1, updated_at = now()
         WHERE id = $3 AND version = $4
         RETURNING id, email, display_name, role, is_active, version, created_at, updated_at`,
        [nextRole, nextActive, target.id, expectedVersion],
      );
      if (!updated.length) throw new Error('stale_user_version');
      let invitationId: string | null = null;
      if (action === 'approve') {
        const invitation = await tx<Record<string, any>>(`SELECT id FROM user_invitations WHERE email = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [target.email]);
        if (invitation.length) {
          invitationId = invitation[0].id;
          await tx(`UPDATE user_invitations SET status = 'claimed', claimed_by = $1, claimed_at = now(), version = version + 1, updated_at = now() WHERE id = $2`, [target.id, invitationId]);
        }
      }
      await tx(`INSERT INTO user_access_events (user_id, invitation_id, action, actor_user_id, previous_role, new_role, previous_is_active, new_is_active, previous_version, new_version)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [target.id, invitationId, eventAction, actor.id, beforeRole, nextRole, beforeActive, nextActive, expectedVersion, Number(expectedVersion) + 1]);
      if (invitationId) await tx(`INSERT INTO user_access_events (user_id, invitation_id, action, actor_user_id, previous_version, new_version) VALUES ($1, $2, 'invite_claimed', $3, 1, 2)`, [target.id, invitationId, actor.id]);
      return publicUser(updated[0]);
    });
    return c.json({ user });
  } catch (error) {
    const code = errorMessage(error);
    const messages: Record<string, [string, number]> = {
      user_not_found: ['User not found', 404], stale_user_version: ['User changed; reload before applying access changes', 409],
      self_access_change_forbidden: ['Administrators cannot demote or deactivate themselves', 409],
      last_active_admin_forbidden: ['At least one active administrator must remain', 409],
    };
    if (messages[code]) return httpError(c, code, messages[code][0], messages[code][1]);
    throw error;
  }
});
