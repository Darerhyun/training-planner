import type { MiddlewareHandler } from 'hono';
import { getFirebaseAuth } from './firebase.js';
import { getDb } from './db.js';
import type { User, UserRole, AuthContext, AppEnv } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Look up user by Firebase UID. If no record exists, create one.
 * New users get role = 'admin' if their email is in ADMIN_EMAILS, else 'pending'.
 */
async function findOrCreateUser(
  firebaseUid: string,
  email: string,
  displayName: string | null,
): Promise<User> {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error('Firebase token did not include an email address');
  }

  const existing = await db(
    `SELECT id, firebase_uid, email, display_name, role, created_at, updated_at
     FROM users
     WHERE firebase_uid = $1`,
    [firebaseUid],
  );

  if (existing.length > 0) {
    return existing[0] as User;
  }

  const adminEmails = getAdminEmails();
  const role: UserRole = adminEmails.has(normalizedEmail) ? 'admin' : 'pending';

  const inserted = await db(
    `INSERT INTO users (firebase_uid, email, display_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = now()
     RETURNING id, firebase_uid, email, display_name, role, created_at, updated_at`,
    [firebaseUid, normalizedEmail, displayName, role],
  );

  return inserted[0] as User;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Hono middleware that verifies a Firebase ID token from the Authorization
 * header and attaches the resolved user to the Hono context.
 *
 * On first-ever request for a Firebase user, a `users` row is created
 * (admin if in ADMIN_EMAILS, pending otherwise).
 *
 * Returns 401 if the token is missing or invalid.
 */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const idToken = header.slice(7); // strip "Bearer "

    try {
      const decoded = await getFirebaseAuth().verifyIdToken(idToken);
      const email = decoded.email;

      if (!email) {
        return c.json({ error: 'Authenticated Firebase user has no email address' }, 401);
      }

      const user = await findOrCreateUser(
        decoded.uid,
        email,
        decoded.name ?? null,
      );

      c.set('auth', {
        firebaseUid: decoded.uid,
        email: user.email,
        user,
      } satisfies AuthContext);

      await next();
    } catch (err) {
      console.error('Auth verification failed:', err);
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  };
}

/**
 * Hono middleware that gates access to one or more roles.
 * Must be placed AFTER authMiddleware() in the middleware chain.
 */
export function requireRole(...roles: UserRole[]): MiddlewareHandler<AppEnv> {
  const allowed = new Set(roles);
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ error: 'Not authenticated' }, 401);
    }
    if (!allowed.has(auth.user.role)) {
      // Rejected users get a specific message
      if (auth.user.role === 'rejected') {
        return c.json(
          { error: 'Your account request has been rejected. Please contact an administrator.' },
          403,
        );
      }
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  };
}
