import { initializeApp } from 'firebase/app';
import {
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signOut,
} from 'firebase/auth';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
});

export const auth = getAuth(app);

export async function signInWithPassword(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
  window.localStorage.setItem('training-planner-email', email);
}

export async function sendMagicLink(email: string): Promise<void> {
  await sendSignInLinkToEmail(auth, email, {
    url: window.location.origin,
    handleCodeInApp: true,
  });
  window.localStorage.setItem('training-planner-email', email);
}

/** Invitation links are sent by an Admin but must not replace that Admin's remembered login email. */
export async function sendInvitationMagicLink(email: string): Promise<void> {
  await sendSignInLinkToEmail(auth, email, {
    url: window.location.origin,
    handleCodeInApp: true,
  });
}

export async function completeMagicLink(email: string): Promise<void> {
  if (isSignInWithEmailLink(auth, window.location.href)) {
    await signInWithEmailLink(auth, email, window.location.href);
    window.localStorage.removeItem('training-planner-email');
    window.history.replaceState({}, document.title, window.location.origin);
  }
}

export { isSignInWithEmailLink, signOut };
