import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { Check, ListFilter, LogOut, RefreshCw, Upload, X } from 'lucide-react';
import {
  type ApiSession,
  type ParseResult,
  cancelSchedule,
  confirmSchedule,
  fetchSessions,
  uploadMasterSchedule,
} from './api.js';
import { auth, completeMagicLink, isSignInWithEmailLink, sendMagicLink, signOut } from './firebase.js';

type View = 'sync' | 'sessions';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState(window.localStorage.getItem('training-planner-email') ?? '');
  const [authMessage, setAuthMessage] = useState('');
  const [view, setView] = useState<View>('sync');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href) && email) {
      completeMagicLink(email).catch((error: Error) => setAuthMessage(error.message));
    }
  }, [email]);

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <h1>Training Planner</h1>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              sendMagicLink(email)
                .then(() => setAuthMessage('Check your email for the sign-in link.'))
                .catch((error: Error) => setAuthMessage(error.message));
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
            <button type="submit">
              <Check size={16} />
              Send Link
            </button>
          </form>
          {authMessage && <p className="message">{authMessage}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Training Planner</h1>
          <p>{user.email}</p>
        </div>
        <nav className="tabs" aria-label="Primary">
          <button className={view === 'sync' ? 'active' : ''} onClick={() => setView('sync')}>
            <Upload size={16} />
            Sync
          </button>
          <button className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>
            <ListFilter size={16} />
            Sessions
          </button>
        </nav>
        <button className="icon-button" onClick={() => signOut(auth)} aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      </header>
      {view === 'sync' ? <SyncPage user={user} /> : <SessionsPage user={user} />}
    </main>
  );
}

function SyncPage({ user }: { user: User }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<(ParseResult & { uploadBatchId?: string }) | null>(null);
  const [manualOverride, setManualOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canConfirm = result?.uploadBatchId && result.summary.requiresConfirmation;

  async function submitUpload() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      setResult(await uploadMasterSchedule(user, file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!result?.uploadBatchId) return;
    setBusy(true);
    setError('');
    try {
      setResult(await confirmSchedule(user, result.uploadBatchId, manualOverride));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Confirm failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!result?.uploadBatchId) return;
    setBusy(true);
    setError('');
    try {
      await cancelSchedule(user, result.uploadBatchId);
      setResult(null);
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-grid">
      <div className="panel upload-panel">
        <div className="panel-heading">
          <h2>Sync</h2>
          <span>Master Schedule Excel</span>
        </div>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button disabled={!file || busy} onClick={submitUpload}>
          {busy ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
          Upload
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel result-panel">
        <div className="panel-heading">
          <h2>Parse Result</h2>
          {result?.summary.autoApplied && <span className="badge good">Applied</span>}
          {result?.summary.requiresConfirmation && <span className="badge warn">Review</span>}
        </div>
        {result ? <Summary result={result} /> : <p className="empty">No parse result yet.</p>}
        {result?.summary.blocked && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={manualOverride}
              onChange={(event) => setManualOverride(event.target.checked)}
            />
            Manual override
          </label>
        )}
        {canConfirm && (
          <div className="action-row">
            <button disabled={busy || (result.summary.blocked && !manualOverride)} onClick={confirm}>
              <Check size={16} />
              Confirm
            </button>
            <button className="secondary" disabled={busy} onClick={cancel}>
              <X size={16} />
              Cancel
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ result }: { result: ParseResult }) {
  const summary = result.summary;
  const metrics = [
    ['Rows', summary.totalRows],
    ['Valid', summary.validRows],
    ['Changes', summary.changeCount],
    ['Cancelled', summary.cancellations],
    ['Skipped', summary.skipped],
  ];

  return (
    <>
      <div className="metrics">
        {metrics.map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {summary.blockReason && <p className="error">{summary.blockReason}</p>}
      {result.applied && <p className="message">Applied {result.applied.applied} rows.</p>}
      <div className="alert-list">
        {result.alerts.slice(0, 12).map((alert) => (
          <div className="alert-row" key={`${alert.rowNumber}-${alert.code}-${alert.rawValue}`}>
            <span>Row {alert.rowNumber}</span>
            <strong>{alert.code}</strong>
            <em>{alert.rawValue ?? 'blank'}</em>
          </div>
        ))}
      </div>
    </>
  );
}

function SessionsPage({ user }: { user: User }) {
  const [sessions, setSessions] = useState<ApiSession[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filteredLabel = useMemo(
    () => (status ? status[0].toUpperCase() + status.slice(1) : 'All'),
    [status],
  );

  async function load() {
    setBusy(true);
    setError('');
    try {
      setSessions(await fetchSessions(user, status || undefined));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Load failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  return (
    <section className="panel table-panel">
      <div className="panel-heading row-heading">
        <div>
          <h2>Sessions</h2>
          <span>{filteredLabel}</span>
        </div>
        <div className="toolbar">
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>
          <button className="icon-button" onClick={load} disabled={busy} aria-label="Refresh" title="Refresh">
            <RefreshCw size={17} className={busy ? 'spin' : ''} />
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Course</th>
              <th>Trainer</th>
              <th>Venue</th>
              <th>Pax</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>{session.start_date}</td>
                <td>
                  <strong>{session.course_name ?? session.tms_code ?? 'Unresolved'}</strong>
                  <span>{session.course_code ?? session.tms_code}</span>
                </td>
                <td>{session.trainer_name ?? 'Unassigned'}</td>
                <td>{[session.venue_name, session.room_name].filter(Boolean).join(' / ') || 'TBD'}</td>
                <td>{session.confirmed_pax ?? session.expected_pax ?? '-'}</td>
                <td><span className="status-pill">{session.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}