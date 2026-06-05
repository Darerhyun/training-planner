import { initializeApp } from 'firebase/app';
import {
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
} from 'firebase/auth';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
});

export const auth = getAuth(app);

export async function sendMagicLink(email: string): Promise<void> {
  await sendSignInLinkToEmail(auth, email, {
    url: window.location.origin,
    handleCodeInApp: true,
  });
  window.localStorage.setItem('training-planner-email', email);
}

export async function completeMagicLink(email: string): Promise<void> {
  if (isSignInWithEmailLink(auth, window.location.href)) {
    await signInWithEmailLink(auth, email, window.location.href);
    window.localStorage.removeItem('training-planner-email');
    window.history.replaceState({}, document.title, window.location.origin);
  }
}

export { isSignInWithEmailLink, signOut };