// ---------------------------------------------------------------------------
// Shared types — mirrors the Postgres schema enums and row shapes
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'ops' | 'finance' | 'viewer' | 'pending' | 'rejected';

export type SessionStatus = 'draft' | 'confirmed' | 'cancelled' | 'completed';

export type VenueType = 'owned' | 'external' | 'virtual';

/** Row shape from the `users` table. */
export interface User {
  id: string;
  firebase_uid: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

/** Authenticated request context, attached by auth middleware. */
export interface AuthContext {
  firebaseUid: string;
  email: string;
  user: User;
}

/** Hono environment — typed variables available via c.get(). */
export type AppEnv = {
  Variables: {
    auth: AuthContext;
  };
};
