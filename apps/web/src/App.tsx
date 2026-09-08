import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { BookOpen, CalendarDays, Check, ClipboardList, ListFilter, LogOut, RefreshCw, Upload } from 'lucide-react'; // FIX: restore auth and legacy navigation icons after extraction
import {
  ApiError,
  fetchMe,
  type AppProfile,
} from './api.js';
import { auth, completeMagicLink, isSignInWithEmailLink, sendMagicLink, signInWithPassword, signOut } from './firebase.js';
import AdminUserAccessPage from './pages/admin-user-access-page.js';
import AdminTrainerDirectoryPage from './pages/admin-trainer-directory-page.js';
import CoursePlanningPage from './pages/course-planning-page.js';
import LegacySessionsPage from './pages/legacy-sessions-page.js';
import SessionsPage from './pages/sessions-page.js';
import SyncPage from './pages/sync-page.js';

type View = 'course-planning' | 'sessions' | 'sync' | 'legacy-sessions' | 'admin';
type ActiveRole = 'admin' | 'ops' | 'finance' | 'viewer';

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? ' compact' : ''}`}>
      <span className="brand-mark" aria-hidden="true">ASK</span>
      <div>
        <span className="brand-eyebrow">ASK Training</span>
        {compact ? <strong>Training Planner</strong> : <h1>Training Planner</h1>}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [email, setEmail] = useState(window.localStorage.getItem('training-planner-email') ?? '');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [view, setView] = useState<View>('sessions');
  const [adminSection, setAdminSection] = useState<'users' | 'trainers'>('users');
  const [trainerDirty, setTrainerDirty] = useState(false);
  function changeView(next: View) {
    if (view === 'admin' && trainerDirty && !window.confirm('Discard unsaved trainer changes?')) return;
    setView(next);
  }
  function changeAdminSection(next: 'users' | 'trainers'): boolean {
    if (next === adminSection) return true;
    if (trainerDirty && !window.confirm('Discard unsaved trainer changes?')) return false;
    setAdminSection(next);
    return true;
  }

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setProfile(null);
    setAuthError('');
  }), []);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    setProfileLoading(true);
    fetchMe(user)
      .then((nextProfile) => {
        if (!cancelled) {
          setProfile(nextProfile);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          void handleApiError(error, setAuthError);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProfileLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href) && email) {
      completeMagicLink(email).catch((error: Error) => setAuthMessage(error.message));
    }
  }, [email]);

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <BrandLockup />
          <div className="auth-intro">
            <span className="eyebrow">Operations workspace</span>
            <h2>Welcome back</h2>
            <p>Sign in to manage training sessions and schedule imports.</p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setAuthBusy(true);
              setAuthError('');
              setAuthMessage('');
              signInWithPassword(email, password)
                .catch((error: unknown) => setAuthError(getSignInErrorMessage(error)))
                .finally(() => setAuthBusy(false));
            }}
          >
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <button type="submit" disabled={authBusy}>
              <Check size={16} />
              Sign In
            </button>
            <button
              type="button"
              className="secondary"
              disabled={authBusy || !email}
              onClick={() => {
                setAuthBusy(true);
                setAuthError('');
                setAuthMessage('');
                sendMagicLink(email)
                  .then(() => setAuthMessage('Check your email for the sign-in link.'))
                  .catch((error: unknown) => setAuthError(getSignInErrorMessage(error)))
                  .finally(() => setAuthBusy(false));
              }}
            >
              Email Me a Link
            </button>
          </form>
          {authMessage && <p className="message">{authMessage}</p>}
          {authError && <p className="error">{authError}</p>}
        </section>
      </main>
    );
  }

  if (profileLoading || !profile) {
    return (
      <main className="auth-shell">
        <section className="auth-panel status-panel">
          <BrandLockup />
          <RefreshCw size={20} className="spin status-icon" />
          <h2>Preparing your workspace</h2>
          <p className="empty">Loading your account profile...</p>
          {authError && <p className="error">{authError}</p>}
        </section>
      </main>
    );
  }

  if (profile.is_active === false || profile.role === 'pending' || profile.role === 'rejected') {
    return (
      <main className="auth-shell">
        <section className="auth-panel status-panel">
          <BrandLockup />
          <span className={`access-state ${profile.is_active === false ? 'deactivated' : profile.role}`}>{profile.is_active === false ? 'Access paused' : profile.role === 'pending' ? 'Account review' : 'Access restricted'}</span>
          <h2>{profile.is_active === false ? 'Account Deactivated' : profile.role === 'pending' ? 'Approval Pending' : 'Access Unavailable'}</h2>
          <p className="empty">{profile.is_active === false ? 'Your account is deactivated. Contact an administrator to request access.' : profile.message}</p>
          <p>{profile.email}</p>
          <button className="secondary" onClick={() => signOut(auth)}>
            <LogOut size={16} />
            Sign Out
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell${view === 'admin' ? ' administration-shell' : ''}`}>
      <header className="topbar">
        <div className="topbar-identity">
          <BrandLockup compact />
          <p>
            <span>{profile.display_name || profile.email}</span>
            <strong className="role-pill">{profile.role}</strong>
          </p>
        </div>
        <nav className="tabs" aria-label="Primary">
          <button className={view === 'course-planning' ? 'active' : ''} onClick={() => changeView('course-planning')}>
            <BookOpen size={16} />
            Course Planning
          </button>
          <button className={view === 'sessions' ? 'active' : ''} onClick={() => changeView('sessions')}>
            <CalendarDays size={16} />
            Sessions
          </button>
          <button className={view === 'sync' ? 'active' : ''} onClick={() => changeView('sync')}>
            <Upload size={16} />
            Sync
          </button>
          {profile.role === 'admin' && <button className={view === 'admin' ? 'active' : ''} onClick={() => changeView('admin')}>
            <ClipboardList size={16} />
            Admin
          </button>}
          <button className={`legacy-tab${view === 'legacy-sessions' ? ' active' : ''}`} onClick={() => changeView('legacy-sessions')}>
            <ListFilter size={16} />
            Legacy sessions
          </button>
        </nav>
        <button className="icon-button" onClick={() => signOut(auth)} aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      </header>
      {view === 'course-planning' && <CoursePlanningPage user={user} role={profile.role as ActiveRole} onApiError={handleApiError} />}
      {view === 'sessions' && <SessionsPage user={user} role={profile.role as ActiveRole} onApiError={handleApiError} />}
      {view === 'sync' && <SyncPage user={user} onApiError={handleApiError} />}
      {view === 'admin' && profile.role === 'admin' && <div className="administration-content">
        <header className="administration-heading"><span className="eyebrow">Controlled access</span><h1>Administration</h1><p>Manage application access and trainer reference records.</p></header>
        <div className="trainer-tabs" role="tablist" aria-label="Administration sections">
          {(['users', 'trainers'] as const).map((section) => <button key={section} role="tab" aria-selected={adminSection === section} tabIndex={adminSection === section ? 0 : -1} onClick={() => changeAdminSection(section)} onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault(); const next = event.key === 'Home' ? 'users' : event.key === 'End' ? 'trainers' : section === 'users' ? 'trainers' : 'users';
              // FIX: keyboard tab activation also moves DOM focus after discard approval.
              if (changeAdminSection(next)) (event.currentTarget.parentElement?.children[next === 'users' ? 0 : 1] as HTMLElement)?.focus();
            }
          }}>{section === 'users' ? 'User Access' : 'Trainer Directory'}</button>)}
        </div>
        <div role="tabpanel" aria-label={adminSection === 'users' ? 'User Access' : 'Trainer Directory'}>{adminSection === 'users' ? <AdminUserAccessPage user={user} /> : <AdminTrainerDirectoryPage user={user} onApiError={handleApiError} onDirtyChange={setTrainerDirty} />}</div>
      </div>}
      {view === 'legacy-sessions' && <LegacySessionsPage user={user} onApiError={handleApiError} />}
    </main>
  );
}

async function handleApiError(error: unknown, setError: (message: string) => void): Promise<void> {
  const message = error instanceof Error ? error.message : 'Request failed. Try again.';
  setError(message);

  if (error instanceof ApiError && error.status === 401) {
    await signOut(auth);
  }
}

function getSignInErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'auth/user-not-found':
      return 'No user exists for that email address. Ask an admin to create your account.';
    case 'auth/wrong-password':
      return 'The password is incorrect. Try again or ask an admin to reset it.';
    case 'auth/invalid-credential':
      return 'The email or password did not match an existing account.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Wait a moment, then try again.';
    default:
      return error instanceof Error ? error.message : 'Sign-in failed. Try again.';
  }
}
