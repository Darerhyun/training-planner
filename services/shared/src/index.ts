// ---------------------------------------------------------------------------
// @training-planner/shared — public API
// ---------------------------------------------------------------------------

// Types
export type {
  UserRole,
  SessionStatus,
  VenueType,
  User,
  AuthContext,
  AppEnv,
} from './types.js';

// Database
export { checkDbConnection, getDb } from './db.js';

// Firebase
export { getFirebaseAuth } from './firebase.js';

// Auth middleware
export { authMiddleware, requireRole } from './auth.js';
