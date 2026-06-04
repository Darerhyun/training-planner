import { Hono } from 'hono';
import { authMiddleware, getDb } from '@training-planner/shared';
import type { AppEnv } from '@training-planner/shared';

export const meRoutes = new Hono<AppEnv>();

// All /me routes require authentication
meRoutes.use('/me', authMiddleware());

/**
 * GET /me
 *
 * Returns the authenticated user's profile. Behaviour varies by role:
 * - pending  → profile + "awaiting approval" message
 * - rejected → minimal profile + "contact admin" message, no data access
 * - active roles (admin/ops/finance/viewer) → full profile
 */
meRoutes.get('/me', async (c) => {
  const { user } = c.get('auth');

  if (user.role === 'rejected') {
    return c.json({
      id: user.id,
      email: user.email,
      role: user.role,
      message:
        'Your account request has been rejected. Please contact an administrator.',
    });
  }

  if (user.role === 'pending') {
    return c.json({
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      message: 'Your account is pending approval by an administrator.',
    });
  }

  return c.json({
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    created_at: user.created_at,
    updated_at: user.updated_at,
  });
});

/**
 * PATCH /me
 *
 * Allows authenticated users to update their own display name.
 */
meRoutes.patch('/me', async (c) => {
  const { user } = c.get('auth');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const displayName =
    typeof body.display_name === 'string' ? body.display_name.trim() : null;

  if (!displayName) {
    return c.json(
      { error: 'display_name is required and must be a non-empty string' },
      400,
    );
  }

  const db = getDb();
  const updated = await db(
    `UPDATE users
     SET display_name = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, firebase_uid, email, display_name, role, created_at, updated_at`,
    [displayName, user.id],
  );

  if (updated.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(updated[0]);
});
