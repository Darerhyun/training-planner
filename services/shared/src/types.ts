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
  /** Access can be suspended without deleting the identity or its history. */
  is_active?: boolean;
  /** Optimistic-concurrency token for access changes. */
  version?: number;
  created_at: string;
  updated_at: string;
}

export type InvitationStatus = 'pending' | 'claimed' | 'cancelled';
export type UserAccessAction =
  | 'approve'
  | 'reject'
  | 'change_role'
  | 'deactivate'
  | 'reactivate';

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
