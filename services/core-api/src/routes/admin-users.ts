import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, UserRole } from '@training-planner/shared';
import type { SqlQuery, TransactionHandler } from '@training-planner/shared';
import { HttpError } from '../lib/http-error.js';

export type UserAccessAction = 'approve' | 'reject' | 'change_role' | 'deactivate' | 'reactivate';
export type AdminUsersRouteDeps = {
  db?: SqlQuery;
  transaction?: <T>(handler: TransactionHandler<T>) => Promise<T>;
  auth?: () => MiddlewareHandler<AppEnv>;
  role?: () => MiddlewareHandler<AppEnv>;
};
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

export function createAdminUsersRoutes(deps: AdminUsersRouteDeps = {}) {
  const db: SqlQuery = deps.db ?? (async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => getDb()<T>(sql, params));
  const transaction = deps.transaction ?? withTransaction;
  const routes = new Hono<AppEnv>();
  routes.use('/admin/*', (deps.auth ?? authMiddleware)());
  routes.use('/admin/*', (deps.role ?? (() => requireRole('admin')))());

  routes.get('/admin/users', async (c) => {
  const role = c.req.query('role'); const status = c.req.query('status'); const params: unknown[] = []; const where: string[] = [];
  if (role && activeRoles.has(role as UserRole)) { params.push(role); where.push(`role = $${params.length}`); }
  if (status === 'active' || status === 'inactive') { params.push(status === 'active'); where.push(`is_active = $${params.length}`); }
  const rows = await db<DbRow>(`SELECT id,email,display_name,role,is_active,version,created_at,updated_at FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(email), id`, params);
  return c.json({ users: rows.map(publicUser) });
});

  routes.get('/admin/user-invitations', async (c) => {
  const status = c.req.query('status'); const params: unknown[] = [];
  const where = status && ['pending', 'claimed', 'cancelled'].includes(status) ? 'WHERE status = $1' : '';
  if (where) params.push(status);
  const rows = await db<DbRow>(`SELECT i.id,i.email,i.intended_role,i.status,i.note,i.version,i.invited_by,i.claimed_by,i.claimed_at,i.cancelled_by,i.cancelled_at,i.created_at,i.updated_at,
      jsonb_build_object('id',inv.id,'email',inv.email,'displayName',inv.display_name) AS inviter,
      CASE WHEN cl.id IS NULL THEN NULL ELSE jsonb_build_object('id',cl.id,'email',cl.email,'displayName',cl.display_name) END AS claimer,
      CASE WHEN ca.id IS NULL THEN NULL ELSE jsonb_build_object('id',ca.id,'email',ca.email,'displayName',ca.display_name) END AS canceller
      FROM user_invitations i JOIN users inv ON inv.id=i.invited_by LEFT JOIN users cl ON cl.id=i.claimed_by LEFT JOIN users ca ON ca.id=i.cancelled_by ${where ? where.replace('status', 'i.status') : ''} ORDER BY i.created_at DESC,i.id`, params);
  return c.json({ invitations: rows });
});

  routes.post('/admin/user-invitations', async (c) => {
    try {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        throw new HttpError(400, 'Invalid JSON body', { code: 'invalid_json' });
      }
      const email = normalizeInviteEmail(body.email);
      const intendedRole = body.intendedRole ?? body.intended_role;
      const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() : undefined;
      if (!email || !email.includes('@')) {
        throw new HttpError(400, 'A valid email is required', { code: 'invalid_email' });
      }
      if (typeof intendedRole !== 'string' || !activeRoles.has(intendedRole as UserRole)) {
        throw new HttpError(400, 'intendedRole must be an active role', { code: 'invalid_role' });
      }
      if (note === undefined || (note !== null && note.length > 500)) {
        throw new HttpError(400, 'note must be at most 500 characters', { code: 'invalid_note' });
      }
      const actor = c.get('auth').user;
      const invitation = await transaction(async (tx) => {
        await tx('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
        const existing = await tx<{ id: string }>(
          'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1 FOR UPDATE',
          [email],
        );
        if (existing.length) {
          throw new HttpError(
            409,
            'An application user already exists for this email',
            { code: 'invited_user_exists' },
          );
        }
        const created = await tx<DbRow>(
          `INSERT INTO user_invitations (email,intended_role,note,invited_by)
           VALUES ($1,$2,$3,$4)
           RETURNING id,email,intended_role,status,note,version,invited_by,created_at,updated_at`,
          [email, intendedRole, note, actor.id],
        );
        await recordEvent(tx, {
          userId: null,
          invitationId: created[0].id,
          targetEmail: email,
          action: 'invite_created',
          actorId: actor.id,
          previousVersion: null,
          newVersion: 1,
          note,
        });
        return created[0];
      });
      return c.json({ invitation }, 201);
    } catch (error) {
      if (isUnique(error)) {
        error = new HttpError(
          409,
          'An open invitation already exists for this email',
          { code: 'open_invitation_exists' },
        );
      }
      if (error instanceof HttpError) return c.json(error.body, error.status);
      throw error;
    }
  });
  routes.patch('/admin/user-invitations/:id/cancel', async (c) => {
    try {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        throw new HttpError(400, 'Invalid JSON body', { code: 'invalid_json' });
      }
      const expected = body.expectedVersion ?? body.expected_version;
      if (!Number.isInteger(expected) || Number(expected) < 1) {
        throw new HttpError(
          400,
          'expectedVersion must be a positive integer',
          { code: 'invalid_expected_version' },
        );
      }
      const cancellationNote = body.note == null
        ? null
        : typeof body.note === 'string'
          ? body.note.trim()
          : undefined;
      if (cancellationNote === undefined || (cancellationNote !== null && cancellationNote.length > 500)) {
        throw new HttpError(
          400,
          'note must be at most 500 characters',
          { code: 'invalid_note' },
        );
      }
      const actor = c.get('auth').user;
      const id = c.req.param('id');
      const invitation = await transaction(async (tx) => {
        const rows = await tx<DbRow>(
          'SELECT * FROM user_invitations WHERE id = $1 FOR UPDATE',
          [id],
        );
        if (!rows.length) throw new HttpError(404, 'Invitation not found', { code: 'invitation_not_found' });
        const current = rows[0];
        if (current.version !== Number(expected)) {
          throw new HttpError(
            409,
            'Invitation changed; reload before cancelling',
            { code: 'stale_user_invitation_version' },
          );
        }
        if (current.status !== 'pending') {
          throw new HttpError(
            409,
            'Only pending invitations can be cancelled',
            { code: 'invitation_not_pending' },
          );
        }
        const updated = await tx<DbRow>(
          `UPDATE user_invitations
           SET status='cancelled',cancelled_by=$1,cancelled_at=now(),version=version+1,updated_at=now()
           WHERE id=$2 AND version=$3
           RETURNING id,email,intended_role,status,note,version,invited_by,cancelled_by,cancelled_at,created_at,updated_at`,
          [actor.id, id, expected],
        );
        await recordEvent(tx, {
          userId: null,
          invitationId: id,
          targetEmail: current.email,
          action: 'invite_cancelled',
          actorId: actor.id,
          previousVersion: Number(expected),
          newVersion: Number(expected) + 1,
          note: cancellationNote,
        });
        return updated[0];
      });
      return c.json({ invitation });
    } catch (error) {
      if (error instanceof HttpError) return c.json(error.body, error.status);
      throw error;
    }
  });
  routes.get('/admin/users/:id/history', async (c) => {
  const id = c.req.param('id');
  const events = await db<DbRow>(`SELECT e.id,e.invitation_id,e.target_email,e.action,e.actor_user_id,e.previous_role,e.new_role,e.previous_is_active,e.new_is_active,e.previous_version,e.new_version,e.note,e.metadata,e.created_at,
      jsonb_build_object('id',a.id,'email',a.email,'displayName',a.display_name) AS actor
      FROM user_access_events e JOIN users a ON a.id=e.actor_user_id
      WHERE e.user_id = $1 OR e.target_email = (SELECT lower(email) FROM users WHERE id = $1)
      ORDER BY e.created_at DESC,e.id DESC`, [id]);
  return c.json({ events });
});

  routes.patch('/admin/users/:id/access', async (c) => {
    try {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch {
        throw new HttpError(400, 'Invalid JSON body', { code: 'invalid_json' });
      }
      const expected = body.expectedVersion ?? body.expected_version;
      const action = body.action;
      const role = typeof body.role === 'string' ? body.role : undefined;
      const note = body.note == null ? null : typeof body.note === 'string' ? body.note.trim() : undefined;
      if (!Number.isInteger(expected) || Number(expected) < 1) {
        throw new HttpError(
          400,
          'expectedVersion must be a positive integer',
          { code: 'invalid_expected_version' },
        );
      }
      if (typeof action !== 'string' || !actions.has(action as UserAccessAction)) {
        throw new HttpError(400, 'Unsupported access action', { code: 'invalid_action' });
      }
      if (note === undefined || (note !== null && note.length > 500)) {
        throw new HttpError(
          400,
          'note must be at most 500 characters',
          { code: 'invalid_note' },
        );
      }
      if (action === 'approve' || action === 'change_role') {
        if (!role || !activeRoles.has(role as UserRole)) {
          throw new HttpError(400, 'An active role is required', { code: 'invalid_role' });
        }
      }
      const actor = c.get('auth').user;
      const id = c.req.param('id');
      const user = await transaction(async (tx) => {
        // Every access mutation takes the active-admin locks in one deterministic
        // order before taking the target lock. This bounds the last-admin race
        // without allowing two concurrent demotions to pass the same check.
        const lockedAdmins = await tx<{ id: string }>(
          "SELECT id FROM users WHERE role='admin' AND is_active=TRUE ORDER BY id FOR UPDATE",
          [],
        );
        const rows = await tx<DbRow>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
        if (!rows.length) throw new HttpError(404, 'User not found', { code: 'user_not_found' });
        const target = rows[0];
        if (target.version !== Number(expected)) {
          throw new HttpError(
            409,
            'User changed; reload before applying access changes',
            { code: 'stale_user_version' },
          );
        }
        if (
          target.id === actor.id
          && (
            action === 'reject'
            || action === 'deactivate'
            || (action === 'change_role' && role !== 'admin')
          )
        ) {
          throw new HttpError(
            409,
            'Administrators cannot demote or deactivate themselves',
            { code: 'self_access_change_forbidden' },
          );
        }
        const beforeRole = String(target.role);
        const beforeActive = Boolean(target.is_active);
        if (!isValidAccessTransition(action as UserAccessAction, role, beforeRole, beforeActive)) {
          throw new HttpError(
            409,
            'That access transition is no longer valid; reload the user first',
            { code: 'invalid_access_transition' },
          );
        }
        let nextRole = beforeRole;
        let nextActive = beforeActive;
        if (action === 'approve' || action === 'change_role') nextRole = role!;
        if (action === 'approve') nextActive = true;
        if (action === 'reject') {
          nextRole = 'rejected';
          nextActive = false;
        }
        if (action === 'deactivate') nextActive = false;
        if (action === 'reactivate') nextActive = true;
        if (beforeRole === 'admin' && beforeActive && (nextRole !== 'admin' || !nextActive)) {
          if (lockedAdmins.length <= 1) {
            throw new HttpError(
              409,
              'At least one active administrator must remain',
              { code: 'last_active_admin_forbidden' },
            );
          }
        }
        const updated = await tx<DbRow>(
          `UPDATE users
           SET role=$1,is_active=$2,version=version+1,updated_at=now()
           WHERE id=$3 AND version=$4
           RETURNING id,email,display_name,role,is_active,version,created_at,updated_at`,
          [nextRole, nextActive, id, expected],
        );
        if (!updated.length) {
          throw new HttpError(
            409,
            'User changed; reload before applying access changes',
            { code: 'stale_user_version' },
          );
        }
        let invitationId: string | null = null;
        if (action === 'approve') {
          const invitations = await tx<DbRow>(
            `SELECT * FROM user_invitations
             WHERE email=$1 AND status='pending'
             ORDER BY created_at DESC,id DESC
             LIMIT 1 FOR UPDATE`,
            [target.email],
          );
          if (invitations.length) {
            const invite = invitations[0];
            invitationId = invite.id;
            await tx(
              `UPDATE user_invitations
               SET status='claimed',claimed_by=$1,claimed_at=now(),version=version+1,updated_at=now()
               WHERE id=$2 AND status='pending'`,
              [target.id, invite.id],
            );
            await recordEvent(tx, {
              userId: target.id,
              invitationId,
              targetEmail: target.email,
              action: 'invite_claimed',
              actorId: actor.id,
              previousVersion: invite.version,
              newVersion: invite.version + 1,
              note: invite.note,
            });
          }
        }
        const eventAction = action === 'approve'
          ? (beforeRole === 'rejected' ? 'user_reapproved' : 'user_approved')
          : action === 'change_role'
            ? 'role_changed'
            : action === 'reject'
              ? 'user_rejected'
              : action === 'deactivate'
                ? 'user_deactivated'
                : 'user_reactivated';
        await recordEvent(tx, {
          userId: target.id,
          invitationId,
          targetEmail: target.email,
          action: eventAction,
          actorId: actor.id,
          previousRole: beforeRole,
          newRole: nextRole,
          previousActive: beforeActive,
          newActive: nextActive,
          previousVersion: Number(expected),
          newVersion: Number(expected) + 1,
          note,
        });
        return publicUser(updated[0]);
      });
      return c.json({ user });
    } catch (error) {
      if (error instanceof HttpError) return c.json(error.body, error.status);
      throw error;
    }
  });
  return routes;
}

export const adminUsersRoutes = createAdminUsersRoutes();

