import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { CalendarDays, Check, ClipboardList, ListFilter, LogOut, RefreshCw, Upload, X } from 'lucide-react';
import {
  ApiError,
  type AppProfile,
  type ApiSession,
  type ParseResult,
  type PlanningIssue,
  type PlanningResponse,
  type PlanningSession,
  type PlanningStatus,
  cancelSchedule,
  confirmSchedule,
  fetchMe,
  fetchPlanningSessions,
  fetchSessions,
  uploadMasterSchedule,
} from './api.js';
import { auth, completeMagicLink, isSignInWithEmailLink, sendMagicLink, signInWithPassword, signOut } from './firebase.js';

type View = 'planning' | 'sync' | 'sessions';

const planningStatuses: PlanningStatus[] = ['draft', 'confirmed', 'cancelled', 'completed'];
const planningIssues: PlanningIssue[] = [
  'unassigned_trainer',
  'unresolved_venue',
  'owned_venue_missing_room',
  'capacity_overrun',
];

const issueLabels: Record<PlanningIssue, string> = {
  unassigned_trainer: 'Unassigned trainer',
  unresolved_venue: 'Unresolved venue',
  owned_venue_missing_room: 'Owned venue missing room',
  capacity_overrun: 'Capacity overrun',
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [email, setEmail] = useState(window.localStorage.getItem('training-planner-email') ?? '');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [view, setView] = useState<View>('planning');

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
          <h1>Training Planner</h1>
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
          <RefreshCw size={18} className="spin" />
          <h1>Training Planner</h1>
          <p className="empty">Loading your account profile...</p>
          {authError && <p className="error">{authError}</p>}
        </section>
      </main>
    );
  }

  if (profile.role === 'pending' || profile.role === 'rejected') {
    return (
      <main className="auth-shell">
        <section className="auth-panel status-panel">
          <h1>{profile.role === 'pending' ? 'Approval Pending' : 'Access Unavailable'}</h1>
          <p className="empty">{profile.message}</p>
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
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Training Planner</h1>
          <p>{profile.display_name || profile.email} · {profile.role}</p>
        </div>
        <nav className="tabs" aria-label="Primary">
          <button className={view === 'planning' ? 'active' : ''} onClick={() => setView('planning')}>
            <CalendarDays size={16} />
            Planning
          </button>
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
      {view === 'planning' && <PlanningPage user={user} />}
      {view === 'sync' && <SyncPage user={user} />}
      {view === 'sessions' && <SessionsPage user={user} />}
    </main>
  );
}

function getSingaporeDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarMonths(dateText: string, months: number): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const targetMonthIndex = month - 1 + months;
  const lastDay = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, targetMonthIndex, Math.min(day, lastDay)));
  return date.toISOString().slice(0, 10);
}

function formatDateRange(from: string, to: string): string {
  return `${from} to ${to}`;
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function getSessionIssues(session: PlanningSession): PlanningIssue[] {
  return [
    session.issues.unassignedTrainer ? 'unassigned_trainer' : null,
    session.issues.unresolvedVenue ? 'unresolved_venue' : null,
    session.issues.ownedVenueMissingRoom ? 'owned_venue_missing_room' : null,
    session.issues.capacityOverrun ? 'capacity_overrun' : null,
  ].filter(Boolean) as PlanningIssue[];
}

function PlanningPage({ user }: { user: User }) {
  const initialFrom = useMemo(() => getSingaporeDate(), []);
  const initialTo = useMemo(() => addCalendarMonths(initialFrom, 6), [initialFrom]);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [statuses, setStatuses] = useState<PlanningStatus[]>([]);
  const [programme, setProgramme] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [venueCode, setVenueCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [issues, setIssues] = useState<PlanningIssue[]>([]);
  const [data, setData] = useState<PlanningResponse | null>(null);
  const [sessions, setSessions] = useState<PlanningSession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<PlanningSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const includeCancelled = statuses.includes('cancelled');
  const queryKey = useMemo(
    () => JSON.stringify({ from, to, statuses, programme, trainerId, venueCode, roomId, issues }),
    [from, to, statuses, programme, trainerId, venueCode, roomId, issues],
  );

  async function load(cursor?: string | null) {
    const append = Boolean(cursor);
    if (append) {
      setLoadingMore(true);
    } else {
      setBusy(true);
    }
    setError('');
    try {
      const result = await fetchPlanningSessions(user, {
        from,
        to,
        status: statuses,
        programme: programme || undefined,
        trainerId: trainerId || undefined,
        venueCode: venueCode || undefined,
        roomId: roomId || undefined,
        issue: issues,
        includeCancelled,
        limit: 100,
        cursor,
      });
      setData(result);
      setNextCursor(result.page.nextCursor);
      setSessions((current) => append ? mergePlanningSessions(current, result.sessions) : result.sessions);
      if (!append) {
        setSelectedSession(null);
      }
    } catch (caught) {
      void handleApiError(caught, setError);
    } finally {
      setBusy(false);
      setLoadingMore(false);
    }
  }

  function clearFilters() {
    setFrom(initialFrom);
    setTo(initialTo);
    setStatuses([]);
    setProgramme('');
    setTrainerId('');
    setVenueCode('');
    setRoomId('');
    setIssues([]);
  }

  useEffect(() => {
    setNextCursor(null);
    setSessions([]);
    void load(null);
  }, [queryKey]);

  return (
    <section className="planning-stack">
      <div className="panel planning-hero">
        <div>
          <h2>Planning</h2>
          <span>Session span · {formatDateRange(from, to)}</span>
        </div>
        <div className="toolbar">
          <button className="secondary" onClick={clearFilters} disabled={busy || loadingMore}>
            <X size={16} />
            Clear filters
          </button>
          <button className="icon-button" onClick={() => load(null)} disabled={busy || loadingMore} aria-label="Refresh planning" title="Refresh planning">
            <RefreshCw size={17} className={busy ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <PlanningSummary data={data} busy={busy} />

      <div className="panel filter-panel">
        <div className="filter-grid">
          <label>
            Session span from
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            Session span to
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label>
            Programme
            <select value={programme} onChange={(event) => setProgramme(event.target.value)}>
              <option value="">All programmes</option>
              {data?.filters.programmes.map((item) => (
                <option value={item.code} key={item.code}>{item.name} ({item.code})</option>
              ))}
            </select>
          </label>
          <label>
            Trainer
            <select value={trainerId} onChange={(event) => setTrainerId(event.target.value)}>
              <option value="">All trainers</option>
              {data?.filters.trainers.map((item) => (
                <option value={item.id} key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Venue
            <select value={venueCode} onChange={(event) => setVenueCode(event.target.value)}>
              <option value="">All venues</option>
              {data?.filters.venues.map((item) => (
                <option value={item.code} key={item.code}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Room
            <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              <option value="">All rooms</option>
              {data?.filters.rooms.map((item) => (
                <option value={item.id} key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="filter-options">
          <div>
            <span>Status</span>
            <div className="chip-row">
              {planningStatuses.map((status) => (
                <label className="filter-chip" key={status}>
                  <input
                    type="checkbox"
                    checked={statuses.includes(status)}
                    onChange={() => setStatuses((current) => toggleValue(current, status))}
                  />
                  {status}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span>Issues</span>
            <div className="chip-row">
              {planningIssues.map((issue) => (
                <label className="filter-chip" key={issue}>
                  <input
                    type="checkbox"
                    checked={issues.includes(issue)}
                    onChange={() => setIssues((current) => toggleValue(current, issue))}
                  />
                  {issueLabels[issue]}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="planning-content">
        <div className="panel table-panel planning-table-panel">
          <div className="panel-heading row-heading">
            <div>
              <h2>Sessions</h2>
              <span>{data ? `${data.summary.total} matching session spans` : 'Loading session spans'}</span>
            </div>
            {busy && <RefreshCw size={18} className="spin" />}
          </div>
          {error && <p className="error">{error}</p>}
          {!busy && !error && sessions.length === 0 && <p className="empty">No sessions match this session span and filter set.</p>}
          <div className="table-wrap">
            <table className="planning-table">
              <thead>
                <tr>
                  <th>Session span</th>
                  <th>Course</th>
                  <th>Programme</th>
                  <th>Trainer</th>
                  <th>Venue / Room</th>
                  <th>Pax</th>
                  <th>Status</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="selectable-row" onClick={() => setSelectedSession(session)}>
                    <td>
                      <strong>{session.dates.start}</strong>
                      <span>to {session.dates.end}</span>
                      <span>{session.dates.spanDays} day span</span>
                    </td>
                    <td>
                      <strong>{session.course.name ?? session.course.tmsCode ?? 'Unresolved'}</strong>
                      <span>{session.course.code ?? session.course.tmsCode ?? session.externalRef}</span>
                    </td>
                    <td>{session.course.programmeCode ?? 'Standalone'}</td>
                    <td>{session.trainer.name ?? session.trainer.rawName ?? 'Unassigned'}</td>
                    <td>
                      <strong>{session.venue.name ?? session.venue.rawText ?? 'Unresolved'}</strong>
                      <span>{session.room.name ?? (session.room.id ? session.room.id : 'No room')}</span>
                    </td>
                    <td>{session.pax.confirmed ?? session.pax.expected ?? '-'}</td>
                    <td><span className="status-pill">{session.status}</span></td>
                    <td><IssueBadges session={session} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-row">
            <button className="secondary" disabled={!nextCursor || busy || loadingMore} onClick={() => load(nextCursor)}>
              {loadingMore ? <RefreshCw size={16} className="spin" /> : <ClipboardList size={16} />}
              Load more
            </button>
          </div>
        </div>

        <SessionDetailPanel session={selectedSession} onClose={() => setSelectedSession(null)} />
      </div>
    </section>
  );
}

function mergePlanningSessions(current: PlanningSession[], next: PlanningSession[]): PlanningSession[] {
  const seen = new Set(current.map((session) => session.id));
  return [...current, ...next.filter((session) => !seen.has(session.id))];
}

function PlanningSummary({ data, busy }: { data: PlanningResponse | null; busy: boolean }) {
  const metrics = [
    ['Total sessions', data?.summary.total ?? '-'],
    ['Draft', data?.summary.byStatus.draft ?? '-'],
    ['Confirmed', data?.summary.byStatus.confirmed ?? '-'],
    ['Cancelled', data?.summary.byStatus.cancelled ?? '-'],
    ['Unresolved venues', data?.summary.issues.unresolvedVenues ?? '-'],
    ['Unassigned trainers', data?.summary.issues.unassignedTrainers ?? '-'],
    ['Missing owned rooms', data?.summary.issues.ownedVenuesWithoutRooms ?? '-'],
    ['Capacity overruns', data?.summary.issues.capacityOverruns ?? '-'],
  ];

  return (
    <div className="metrics planning-metrics">
      {metrics.map(([label, value]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{busy ? '...' : value}</strong>
        </div>
      ))}
    </div>
  );
}

function IssueBadges({ session }: { session: PlanningSession }) {
  const issues = getSessionIssues(session);
  if (issues.length === 0) return <span className="empty">None</span>;

  return (
    <div className="issue-list">
      {issues.map((issue) => <span className="issue-pill" key={issue}>{issueLabels[issue]}</span>)}
    </div>
  );
}

function SessionDetailPanel({ session, onClose }: { session: PlanningSession | null; onClose: () => void }) {
  if (!session) {
    return (
      <aside className="panel detail-panel muted-detail">
        <h2>Session details</h2>
        <p className="empty">Select a row to inspect the read-only session details.</p>
      </aside>
    );
  }

  const detailRows = [
    ['Course', session.course.name ?? 'Unresolved'],
    ['Course code', session.course.code ?? '-'],
    ['TMS code', session.course.tmsCode ?? '-'],
    ['External ref', session.externalRef ?? '-'],
    ['Status', session.status],
    ['Session span', `${session.dates.start} to ${session.dates.end}`],
    ['Span length', `${session.dates.spanDays} day span`],
    ['Time', session.dates.timeText ?? '-'],
    ['Trainer', session.trainer.name ?? session.trainer.rawName ?? 'Unassigned'],
    ['Venue', session.venue.name ?? 'Unresolved'],
    ['Raw venue', session.venue.rawText ?? '-'],
    ['Room', session.room.name ?? session.room.id ?? '-'],
    ['Room capacity', session.room.capacity ?? '-'],
    ['Expected pax', session.pax.expected ?? '-'],
    ['Confirmed pax', session.pax.confirmed ?? '-'],
    ['Effective pax', session.pax.effective ?? '-'],
  ];

  return (
    <aside className="panel detail-panel">
      <div className="panel-heading">
        <div>
          <h2>Session details</h2>
          <span>Read-only</span>
        </div>
        <button className="icon-button secondary" onClick={onClose} aria-label="Close details" title="Close details">
          <X size={16} />
        </button>
      </div>
      <IssueBadges session={session} />
      <dl className="detail-list">
        {detailRows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
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
      void handleApiError(caught, setError);
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
      void handleApiError(caught, setError);
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
      void handleApiError(caught, setError);
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
      void handleApiError(caught, setError);
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