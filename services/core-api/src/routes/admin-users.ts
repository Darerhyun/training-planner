import { Hono } from 'hono';
import type { Context } from 'hono';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, UserRole } from '@training-planner/shared';

export type UserAccessAction = 'approve' | 'reject' | 'change_role' | 'deactivate' | 'reactivate';
const activeRoles = new Set<UserRole>(['admin', 'ops', 'finance', 'viewer']);
const actions = new Set<UserAccessAction>(['approve', 'reject', 'change_role', 'deactivate', 'reactivate']);

export function normalizeInviteEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidAccessTransition(action: UserAccessAction, role: string | undefined, currentRole: string, active: boolean): boolean {
  if (action === 'approve') return (currentRole === 'pending' || currentRole === 'rejected') && !!role && activeRoles.has(role as UserRole);
  if (action === 'reject') return currentRole === 'pending';
  if (action === 'change_role') return currentRole !== 'pending' && currentRole !== 'rejected' && active && !!role && activeRoles.has(role as UserRole);
  if (action === 'deactivate') return currentRole !== 'pending' && currentRole !== 'rejected' && active;
  return currentRole !== 'pending' && currentRole !== 'rejected' && !active;
}

export function publicUser(row: Record<string, unknown>) {
  const { firebase_uid: _firebaseUid, ...safe } = row;
  return safe;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function statusCode(value: number): 400 | 403 | 404 | 409 | 422 { return value as 400 | 403 | 404 | 409 | 422; }
function httpError(c: Context<AppEnv>, code: string, error: string, status = 400) {
  return c.json({ error, code }, statusCode(status));
}
function isUnique(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'; }

type DbRow = Record<string, any>;
type EventInput = {
  userId: string | null; invitationId?: string | null; targetEmail: string; action: string; actorId: string;
  previousRole?: string | null; newRole?: string | null; previousActive?: boolean | null; newActive?: boolean | null;
  previousVersion?: number | null; newVersion?: number | null; note?: string | null;
};

async function recordEvent(tx: <T = DbRow>(sql: string, params?: unknown[]) => Promise<T[]>, event: EventInput) {
  await tx(
    `INSERT INTO user_access_events
      (user_id, invitation_id, target_email, action, actor_user_id, previous_role, new_role,
       previous_is_active, new_is_active, previous_version, new_version, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [event.userId, event.invitationId ?? null, event.targetEmail, event.action, event.actorId,
      event.previousRole ?? null, event.newRole ?? null, event.previousActive ?? null, event.newActive ?? null,
      event.previousVersion ?? null, event.newVersion ?? null, event.note ?? null],
  );
}

export const adminUsersRoutes = new Hono<AppEnv>();
adminUsersRoutes.use('/admin/*', authMiddleware());
adminUsersRoutes.use('/admin/*', requireRole('admin'));

adminUsersRoutes.get('/admin/users', async (c) => {
  const role = c.req.query('role'); const status = c.req.query('status'); const params: unknown[] = []; const where: string[] = [];
  if (role && activeRoles.has(role as UserRole)) { params.push(role); where.push(`role = $${params.length}`); }
  if (status === 'active' || status === 'inactive') { params.push(status === 'active'); where.push(`is_active = $${params.length}`); }
  const db = getDb();
  const rows = await db<DbRow>(`SELECT id,email,display_name,role,is_active,version,created_at,updated_at FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(email), id`, params);
  return c.json({ users: rows.map(publicUser) });
});

adminUsersRoutes.get('/admin/user-invitations', async (c) => {
  const status = c.req.query('status'); const params: unknown[] = [];
  const where = status && ['pending', 'claimed', 'cancelled'].includes(status) ? 'WHERE status = $1' : '';
  if (where) params.push(status);
  const db = getDb();
  const rows = await db<DbRow>(`SELECT id,email,intended_role,status,note,version,invited_by,claimed_by,claimed_at,cancelled_by,cancelled_at,created_at,updated_at FROM user_invitations ${where} ORDER BY created_at DESC,id`, params);
  return c.json({ invitations: rows });
});

adminUsersRoutes.post('/admin/user-invitations', async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return httpError(c, 'invalid_json', 'Invalid JSON body'); }
  const email = normalizeInviteEmail(body.email); const intendedRole = body.intendedRole ?? body.intended_role;
  const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() : undefined;
  if (!email || !email.includes('@')) return httpError(c, 'invalid_email', 'A valid email is required');
  if (typeof intendedRole !== 'string' || !activeRoles.has(intendedRole as UserRole)) return httpError(c, 'invalid_role', 'intendedRole must be an active role');
  if (note === undefined || (note !== null && note.length > 500)) return httpError(c, 'invalid_note', 'note must be at most 500 characters');
  const actor = c.get('auth').user;
  try {
    const invitation = await withTransaction(async (tx) => {
      const existing = await tx<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1 LIMIT 1 FOR UPDATE', [email]);
      if (existing.length) throw new Error('invited_user_exists');
      const created = await tx<DbRow>(`INSERT INTO user_invitations (email,intended_role,note,invited_by) VALUES ($1,$2,$3,$4) RETURNING id,email,intended_role,status,note,version,invited_by,created_at,updated_at`, [email, intendedRole, note, actor.id]);
      await recordEvent(tx, { userId: null, invitationId: created[0].id, targetEmail: email, action: 'invite_created', actorId: actor.id, previousVersion: null, newVersion: 1, note });
      return created[0];
    });
    return c.json({ invitation }, 201);
  } catch (error) {
    if (message(error) === 'invited_user_exists') return httpError(c, 'invited_user_exists', 'An application user already exists for this email', 409);
    if (isUnique(error)) return httpError(c, 'open_invitation_exists', 'An open invitation already exists for this email', 409);
    throw error;
  }
});

adminUsersRoutes.patch('/admin/user-invitations/:id/cancel', async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return httpError(c, 'invalid_json', 'Invalid JSON body'); }
  const expected = body.expectedVersion ?? body.expected_version;
  if (!Number.isInteger(expected) || Number(expected) < 1) return httpError(c, 'invalid_expected_version', 'expectedVersion must be a positive integer');
  const actor = c.get('auth').user; const id = c.req.param('id');
  try {
    const invitation = await withTransaction(async (tx) => {
      const rows = await tx<DbRow>('SELECT * FROM user_invitations WHERE id = $1 FOR UPDATE', [id]);
      if (!rows.length) throw new Error('invitation_not_found'); const current = rows[0];
      if (current.version !== Number(expected)) throw new Error('stale_invitation_version');
      if (current.status !== 'pending') throw new Error('invitation_not_pending');
      const updated = await tx<DbRow>(`UPDATE user_invitations SET status='cancelled',cancelled_by=$1,cancelled_at=now(),version=version+1,updated_at=now() WHERE id=$2 AND version=$3 RETURNING id,email,intended_role,status,note,version,invited_by,cancelled_by,cancelled_at,created_at,updated_at`, [actor.id, id, expected]);
      await recordEvent(tx, { userId: null, invitationId: id, targetEmail: current.email, action: 'invite_cancelled', actorId: actor.id, previousVersion: Number(expected), newVersion: Number(expected) + 1, note: current.note });
      return updated[0];
    });
    return c.json({ invitation });
  } catch (error) {
    const code = message(error); if (code === 'invitation_not_found') return httpError(c, code, 'Invitation not found', 404);
    if (code === 'stale_invitation_version') return httpError(c, code, 'Invitation changed; reload before cancelling', 409);
    if (code === 'invitation_not_pending') return httpError(c, code, 'Only pending invitations can be cancelled', 409); throw error;
  }
});

adminUsersRoutes.get('/admin/users/:id/history', async (c) => {
  const db = getDb(); const id = c.req.param('id');
  const events = await db<DbRow>(`SELECT id,invitation_id,target_email,action,actor_user_id,previous_role,new_role,previous_is_active,new_is_active,previous_version,new_version,note,metadata,created_at FROM user_access_events WHERE user_id = $1 OR target_email = (SELECT lower(email) FROM users WHERE id = $1) ORDER BY created_at DESC,id DESC`, [id]);
  return c.json({ events });
});

adminUsersRoutes.patch('/admin/users/:id/access', async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return httpError(c, 'invalid_json', 'Invalid JSON body'); }
  const expected = body.expectedVersion ?? body.expected_version; const action = body.action; const role = typeof body.role === 'string' ? body.role : undefined;
  const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() : undefined;
  if (!Number.isInteger(expected) || Number(expected) < 1) return httpError(c, 'invalid_expected_version', 'expectedVersion must be a positive integer');
  if (typeof action !== 'string' || !actions.has(action as UserAccessAction)) return httpError(c, 'invalid_action', 'Unsupported access action');
  if (note === undefined || (note !== null && note.length > 500)) return httpError(c, 'invalid_note', 'note must be at most 500 characters');
  if (action === 'approve' || action === 'change_role') if (!role || !activeRoles.has(role as UserRole)) return httpError(c, 'invalid_role', 'An active role is required');
  const actor = c.get('auth').user; const id = c.req.param('id');
  try {
    const user = await withTransaction(async (tx) => {
      // Every access mutation takes the active-admin locks in one deterministic
      // order before taking the target lock. This bounds the last-admin race
      // without allowing two concurrent demotions to pass the same check.
      const lockedAdmins = await tx<{ id: string }>(`SELECT id FROM users WHERE role='admin' AND is_active=TRUE ORDER BY id FOR UPDATE`, []);
      const rows = await tx<DbRow>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]); if (!rows.length) throw new Error('user_not_found'); const target = rows[0];
      if (target.version !== Number(expected)) throw new Error('stale_user_version');
      if (target.id === actor.id && (action === 'reject' || action === 'deactivate' || (action === 'change_role' && role !== 'admin'))) throw new Error('self_access_change_forbidden');
      const beforeRole = String(target.role); const beforeActive = Boolean(target.is_active);
      if (!isValidAccessTransition(action as UserAccessAction, role, beforeRole, beforeActive)) throw new Error('invalid_access_transition');
      let nextRole = beforeRole; let nextActive = beforeActive;
      if (action === 'approve' || action === 'change_role') nextRole = role!;
      if (action === 'reject') { nextRole = 'rejected'; nextActive = false; }
      if (action === 'deactivate') nextActive = false; if (action === 'reactivate') nextActive = true;
      if (beforeRole === 'admin' && beforeActive && (nextRole !== 'admin' || !nextActive)) {
        if (lockedAdmins.length <= 1) throw new Error('last_active_admin_forbidden');
      }
      const updated = await tx<DbRow>(`UPDATE users SET role=$1,is_active=$2,version=version+1,updated_at=now() WHERE id=$3 AND version=$4 RETURNING id,email,display_name,role,is_active,version,created_at,updated_at`, [nextRole, nextActive, id, expected]);
      if (!updated.length) throw new Error('stale_user_version');
      let invitationId: string | null = null;
      if (action === 'approve') {
        const invitations = await tx<DbRow>(`SELECT * FROM user_invitations WHERE email=$1 AND status='pending' ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [target.email]);
        if (invitations.length) { const invite = invitations[0]; invitationId = invite.id; await tx(`UPDATE user_invitations SET status='claimed',claimed_by=$1,claimed_at=now(),version=version+1,updated_at=now() WHERE id=$2 AND status='pending'`, [target.id, invite.id]); await recordEvent(tx, { userId: target.id, invitationId, targetEmail: target.email, action: 'invite_claimed', actorId: actor.id, previousVersion: invite.version, newVersion: invite.version + 1, note: invite.note }); }
      }
      const eventAction = action === 'approve' ? (beforeRole === 'rejected' ? 'user_reapproved' : 'user_approved') : action === 'change_role' ? 'role_changed' : action === 'reject' ? 'user_rejected' : action === 'deactivate' ? 'user_deactivated' : 'user_reactivated';
      await recordEvent(tx, { userId: target.id, invitationId, targetEmail: target.email, action: eventAction, actorId: actor.id, previousRole: beforeRole, newRole: nextRole, previousActive: beforeActive, newActive: nextActive, previousVersion: Number(expected), newVersion: Number(expected) + 1, note });
      return publicUser(updated[0]);
    });
    return c.json({ user });
  } catch (error) {
    const code = message(error); const errors: Record<string, [string, number]> = {
      user_not_found: ['User not found', 404], stale_user_version: ['User changed; reload before applying access changes', 409],
      self_access_change_forbidden: ['Administrators cannot demote or deactivate themselves', 409], last_active_admin_forbidden: ['At least one active administrator must remain', 409],
      invalid_access_transition: ['That access transition is no longer valid; reload the user first', 409],
    };
    if (errors[code]) return httpError(c, code, errors[code][0], errors[code][1]); throw error;
  }
});

