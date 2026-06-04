import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

let firebaseAuth: Auth;

function parseServiceAccount(json: string): object {
  try {
    return JSON.parse(json) as object;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid JSON');
  }
}

/**
 * Returns a Firebase Auth admin instance.
 *
 * Initialisation strategy:
 * - If FIREBASE_SERVICE_ACCOUNT env var is set (JSON string), use explicit credentials.
 * - Otherwise fall back to Application Default Credentials (works on Cloud Run
 *   when the service account has Firebase Admin permissions).
 */
export function getFirebaseAuth(): Auth {
  if (!firebaseAuth) {
    let app: App;

    if (getApps().length > 0) {
      app = getApps()[0]!;
    } else {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (serviceAccountJson) {
        app = initializeApp({
          credential: cert(parseServiceAccount(serviceAccountJson)),
        });
      } else {
        app = initializeApp();
      }
    }

    firebaseAuth = getAuth(app);
  }
  return firebaseAuth;
}
