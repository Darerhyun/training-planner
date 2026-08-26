import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { BookOpen, CalendarDays, Check, ClipboardList, ListFilter, LogOut, Plus, RefreshCw, Upload, X } from 'lucide-react';
import {
  ApiError,
  type AppProfile,
  type ApiSession,
  type CoursePlanningCourse,
  type CoursePlanningResponse,
  type ParseResult,
  type PlannedCourseRun,
  type PlanningIssue,
  type PlanningResponse,
  type PlanningSession,
  type PlanningStatus,
  type SessionHistoryEntry,
  type TrainerOption,
  cancelSchedule,
  approvePlannedCourseRun,
  confirmSchedule,
  createPlannedCourseRuns,
  fetchCoursePlanning,
  fetchMe,
  fetchPlanningSessions,
  fetchSessionHistory,
  fetchSessions,
  fetchTrainerOptions,
  schedulePlannedCourseRun,
  updateSessionTrainer,
  uploadMasterSchedule,
} from './api.js';
import { auth, completeMagicLink, isSignInWithEmailLink, sendMagicLink, signInWithPassword, signOut } from './firebase.js';

type View = 'course-planning' | 'sessions' | 'sync' | 'legacy-sessions';
type ActiveRole = 'admin' | 'ops' | 'finance' | 'viewer';
type DateMode = 'upcoming' | 'past' | 'custom';

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
  capacity_overrun: 'Room pax over capacity',
};

const profileSourceLabels: Record<PlanningSession['planningProfile']['source'], string> = {
  direct: 'Direct history',
  ft_proxy: 'FT proxy history',
  no_history: 'No history',
  unavailable: 'Profile unavailable',
};

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

function getProgrammeTone(code: string | null): string {
  const normalized = code?.toUpperCase() ?? '';
  if (normalized === 'ACDM' || normalized === 'FTDM') return 'blue';
  if (normalized === 'DDM') return 'teal';
  if (normalized === 'SDDM' || normalized === 'DGAI') return 'purple';
  if (normalized.includes('IIO')) return 'amber';
  return 'neutral';
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

  if (profile.role === 'pending' || profile.role === 'rejected') {
    return (
      <main className="auth-shell">
        <section className="auth-panel status-panel">
          <BrandLockup />
          <span className={`access-state ${profile.role}`}>{profile.role === 'pending' ? 'Account review' : 'Access restricted'}</span>
          <h2>{profile.role === 'pending' ? 'Approval Pending' : 'Access Unavailable'}</h2>
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
        <div className="topbar-identity">
          <BrandLockup compact />
          <p>
            <span>{profile.display_name || profile.email}</span>
            <strong className="role-pill">{profile.role}</strong>
          </p>
        </div>
        <nav className="tabs" aria-label="Primary">
          <button className={view === 'course-planning' ? 'active' : ''} onClick={() => setView('course-planning')}>
            <BookOpen size={16} />
            Course Planning
          </button>
          <button className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>
            <CalendarDays size={16} />
            Sessions
          </button>
          <button className={view === 'sync' ? 'active' : ''} onClick={() => setView('sync')}>
            <Upload size={16} />
            Sync
          </button>
          <button className={`legacy-tab${view === 'legacy-sessions' ? ' active' : ''}`} onClick={() => setView('legacy-sessions')}>
            <ListFilter size={16} />
            Legacy sessions
          </button>
        </nav>
        <button className="icon-button" onClick={() => signOut(auth)} aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      </header>
      {view === 'course-planning' && <CoursePlanningPage user={user} role={profile.role as ActiveRole} />}
      {view === 'sessions' && <SessionsPage user={user} role={profile.role as ActiveRole} />}
      {view === 'sync' && <SyncPage user={user} />}
      {view === 'legacy-sessions' && <LegacySessionsPage user={user} />}
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

function addCalendarDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((toTime - fromTime) / 86_400_000) + 1;
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

function formatPercent(value: number | null): string {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatMonths(months: string[]): string {
  return months.length ? months.join(', ') : '-';
}

function getMonthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function CoursePlanningPage({ user, role }: { user: User; role: ActiveRole }) {
  const currentMonth = useMemo(() => getSingaporeDate().slice(0, 7), []);
  const latestPlanningMonth = useMemo(
    () => addCalendarMonths(`${currentMonth}-01`, 12).slice(0, 7),
    [currentMonth],
  );
  const [month, setMonth] = useState(currentMonth);
  const [venueCode, setVenueCode] = useState('IP');
  const [programme, setProgramme] = useState('');
  const [courseSearch, setCourseSearch] = useState('');
  const [historySource, setHistorySource] = useState('');
  const [data, setData] = useState<CoursePlanningResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [reloadRequired, setReloadRequired] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [createCourseCode, setCreateCourseCode] = useState<string | null>(null);
  const [createCount, setCreateCount] = useState(1);
  const [createNote, setCreateNote] = useState('');
  const [scheduleRunId, setScheduleRunId] = useState<string | null>(null);
  const [scheduleStart, setScheduleStart] = useState(`${currentMonth}-01`);
  const [scheduleEnd, setScheduleEnd] = useState(`${currentMonth}-01`);
  const hasWriteRole = role === 'admin' || role === 'ops';
  const monthIsWritable = month >= currentMonth && month <= latestPlanningMonth;
  const canWrite = hasWriteRole && monthIsWritable;

  async function load() {
    setBusy(true);
    setError('');
    setActionError('');
    setReloadRequired(false);
    try {
      const result = await fetchCoursePlanning(user, month, venueCode);
      setData(result);
    } catch (caught) {
      void handleApiError(caught, setError);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setCreateCourseCode(null);
    setScheduleRunId(null);
    setScheduleStart(`${month}-01`);
    setScheduleEnd(`${month}-01`);
    void load();
  }, [month, venueCode, user]);

  const filteredCourses = useMemo(() => {
    const search = courseSearch.trim().toLowerCase();
    return (data?.courses ?? []).filter((row) => {
      if (programme === '__standalone' && row.course.programmeCode !== null) return false;
      if (programme && programme !== '__standalone' && row.course.programmeCode !== programme) return false;
      if (historySource && row.planningProfile.source !== historySource) return false;
      if (search && !`${row.course.code} ${row.course.name}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [courseSearch, data, historySource, programme]);

  const summary = useMemo(() => {
    const runs = filteredCourses.flatMap((row) => row.runs);
    const historicalTarget = filteredCourses.reduce(
      (total, row) => total + (row.planningProfile.confirmedPerMonth ?? 0),
      0,
    );
    return {
      plannedRuns: runs.length,
      historicalTarget: Math.round(historicalTarget * 100) / 100,
      unscheduledRuns: runs.filter((run) => run.status === 'approved' && !run.session).length,
      evidenceGaps: filteredCourses.filter((row) => (
        row.planningProfile.source === 'no_history' || row.planningProfile.source === 'unavailable'
      )).length,
    };
  }, [filteredCourses]);

  const programmeGroups = useMemo(() => {
    const groups = new Map<string, CoursePlanningCourse[]>();
    for (const row of filteredCourses) {
      const key = row.course.programmeCode ?? '__standalone';
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [filteredCourses]);

  function replaceRun(updated: PlannedCourseRun) {
    setData((current) => current ? {
      ...current,
      courses: current.courses.map((row) => row.course.code === updated.courseCode ? {
        ...row,
        runs: row.runs.map((run) => run.id === updated.id ? updated : run),
      } : row),
    } : current);
  }

  function handleActionFailure(caught: unknown) {
    if (caught instanceof ApiError && caught.code === 'stale_planned_course_run_version') {
      setReloadRequired(true);
      setActionError('This planned run changed after you opened it. Reload Course Planning before trying again.');
      return;
    }
    void handleApiError(caught, setActionError);
  }

  async function createRuns(course: CoursePlanningCourse) {
    setActionBusyId(`create-${course.course.code}`);
    setActionError('');
    setActionMessage('');
    try {
      const runs = await createPlannedCourseRuns(user, {
        planningMonth: month,
        courseCode: course.course.code,
        venueCode,
        count: createCount,
        note: createNote,
      });
      setData((current) => current ? {
        ...current,
        courses: current.courses.map((row) => row.course.code === course.course.code ? {
          ...row,
          runs: [...row.runs, ...runs],
        } : row),
      } : current);
      setActionMessage(`${runs.length} proposed ${runs.length === 1 ? 'run' : 'runs'} added for ${course.course.name}.`);
      setCreateCourseCode(null);
      setCreateCount(1);
      setCreateNote('');
    } catch (caught) {
      handleActionFailure(caught);
    } finally {
      setActionBusyId(null);
    }
  }

  async function approveRun(run: PlannedCourseRun) {
    setActionBusyId(run.id);
    setActionError('');
    setActionMessage('');
    try {
      const updated = await approvePlannedCourseRun(user, run.id, run.version);
      replaceRun(updated);
      setActionMessage('Planned run approved. Choose its dates when you are ready to create a draft Session.');
    } catch (caught) {
      handleActionFailure(caught);
    } finally {
      setActionBusyId(null);
    }
  }

  async function scheduleRun(run: PlannedCourseRun) {
    setActionBusyId(run.id);
    setActionError('');
    setActionMessage('');
    try {
      const result = await schedulePlannedCourseRun(user, run.id, {
        expectedVersion: run.version,
        startDate: scheduleStart,
        endDate: scheduleEnd,
      });
      replaceRun(result.run);
      setActionMessage(`Draft Session ${result.session.id} created for ${result.session.startDate} to ${result.session.endDate}.`);
      setScheduleRunId(null);
    } catch (caught) {
      handleActionFailure(caught);
    } finally {
      setActionBusyId(null);
    }
  }

  const metrics = [
    ['Planned runs', summary.plannedRuns, 'primary'],
    ['Historical target', formatNumber(summary.historicalTarget), 'info'],
    ['Approved, unscheduled', summary.unscheduledRuns, 'warning'],
    ['Evidence gaps', summary.evidenceGaps, 'danger'],
  ] as const;

  return (
    <section className="planning-stack course-planning-page">
      <div className="panel planning-hero course-planning-hero">
        <div className="hero-copy">
          <span className="eyebrow">Future course planning</span>
          <h2>Course Planning</h2>
          <p>Decide what to run by month and venue. Historical profiles are evidence, not recommendations.</p>
          <span className="range-label"><BookOpen size={14} /> {month} · {data?.courses[0]?.venue.name ?? venueCode}</span>
        </div>
        <button className="icon-button secondary" onClick={() => load()} disabled={busy} aria-label="Refresh Course Planning" title="Refresh Course Planning">
          <RefreshCw size={17} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <div className="metrics course-planning-metrics">
        {metrics.map(([label, value, tone]) => (
          <div className={`metric ${tone}`} key={label}>
            <span>{label}</span>
            <strong>{busy ? '...' : value}</strong>
          </div>
        ))}
      </div>

      <div className="panel filter-panel course-planning-filters">
        <div className="filter-panel-heading">
          <div>
            <span className="eyebrow">Planning lens</span>
            <h2>Month, venue and evidence</h2>
          </div>
          <span>Filters update the displayed evidence cards</span>
        </div>
        <div className="filter-grid course-planning-filter-grid">
          <label>
            Planning month
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <label>
            Venue
            <select value={venueCode} onChange={(event) => setVenueCode(event.target.value)}>
              {(data?.filters.venues ?? [{ code: 'IP', name: 'International Plaza', type: 'owned' }]).map((venue) => (
                <option key={venue.code} value={venue.code}>{venue.name}</option>
              ))}
            </select>
          </label>
          <label>
            Programme
            <select value={programme} onChange={(event) => setProgramme(event.target.value)}>
              <option value="">All active programmes</option>
              {data?.filters.programmes.map((item) => (
                <option key={item.code ?? '__standalone'} value={item.code ?? '__standalone'}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Course
            <input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="Search code or name" />
          </label>
          <label>
            History evidence
            <select value={historySource} onChange={(event) => setHistorySource(event.target.value)}>
              <option value="">All evidence states</option>
              {data?.filters.historySources.map((source) => (
                <option value={source} key={source}>{profileSourceLabels[source]}</option>
              ))}
            </select>
          </label>
        </div>
        <span className="field-help">
          Retained months remain readable. Adding, approving and scheduling planned runs is available from {currentMonth} through {latestPlanningMonth}.
          Hotel evidence groups Furama, Holiday Inn and Scotts under the committed HOTEL profile. Lavender and Outbound intentionally show unavailable evidence; other venues use exact matching.
        </span>
        {hasWriteRole && !monthIsWritable && (
          <span className="field-help">This retained month is read-only because it is outside the active planning window.</span>
        )}
      </div>

      <div aria-live="polite">
        {error && <p className="error">{error}</p>}
        {actionError && <p className="error">{actionError}</p>}
        {actionMessage && <p className="message">{actionMessage}</p>}
        {reloadRequired && (
          <button className="secondary" onClick={() => load()} disabled={busy}>
            <RefreshCw size={16} />
            Reload Course Planning
          </button>
        )}
      </div>

      {!busy && !error && filteredCourses.length === 0 && (
        <div className="panel"><p className="empty">No active courses match these planning filters.</p></div>
      )}

      <div className="course-planning-groups">
        {programmeGroups.map(([groupCode, courses]) => (
          <section className="panel programme-group" key={groupCode} aria-labelledby={`programme-${groupCode}`}>
            <div className="panel-heading row-heading">
              <div>
                <span className={`programme-pill ${getProgrammeTone(groupCode === '__standalone' ? null : groupCode)}`}>
                  {groupCode === '__standalone' ? 'Standalone' : groupCode}
                </span>
                <h2 id={`programme-${groupCode}`}>{courses[0].course.programmeName ?? 'Standalone courses'}</h2>
              </div>
              <span>{courses.length} {courses.length === 1 ? 'course' : 'courses'}</span>
            </div>
            <div className="course-plan-list">
              {courses.map((course) => {
                const profile = course.planningProfile;
                const hasEvidence = profile.source === 'direct' || profile.source === 'ft_proxy';
                return (
                  <article className="course-plan-card" key={course.course.code}>
                    <div className="course-plan-main">
                      <div className="course-plan-title">
                        <div>
                          <strong>{course.course.name}</strong>
                          <span>{course.course.code}</span>
                        </div>
                        <span className={`profile-source ${profile.source}`}>{profileSourceLabels[profile.source]}</span>
                      </div>
                      <div className="course-evidence" aria-label={`Historical evidence for ${course.course.name}`}>
                        <div><span>Cadence evidence</span><strong>{formatNumber(profile.confirmedPerMonth)} / month</strong></div>
                        <div><span>Confirmation</span><strong>{formatPercent(profile.confirmationRate)}</strong></div>
                        <div><span>Median gap</span><strong>{formatNumber(profile.medianGapDays)} days</strong></div>
                        <div><span>Planned</span><strong>{course.runs.length}</strong></div>
                      </div>
                      <div className="evidence-notes">
                        {hasEvidence ? (
                          <>
                            <span>Evidence: {profile.profileCourseCode} × {profile.evidenceVenueCode}</span>
                            <span>Strong: {formatMonths(profile.strongMonths)}</span>
                            <span>Weak: {formatMonths(profile.weakMonths)}</span>
                            {profile.lowHistoricalConfirmation && <span className="low-confirmation">Low historical confirmation</span>}
                          </>
                        ) : (
                          <span>{profile.source === 'no_history'
                            ? 'This new FT course has no historical profile. Use planner judgment.'
                            : 'No matching committed course × venue profile. Use planner judgment.'}</span>
                        )}
                      </div>
                    </div>

                    {canWrite && (
                      <div className="course-plan-actions">
                        <button
                          className="secondary"
                          onClick={() => {
                            setCreateCourseCode((current) => current === course.course.code ? null : course.course.code);
                            setCreateCount(1);
                            setCreateNote('');
                          }}
                        >
                          <Plus size={16} />
                          Add planned run
                        </button>
                      </div>
                    )}

                    {canWrite && createCourseCode === course.course.code && (
                      <form className="planned-run-form" onSubmit={(event) => {
                        event.preventDefault();
                        void createRuns(course);
                      }}>
                        <div className="form-heading">
                          <div>
                            <span className="eyebrow">Proposed change</span>
                            <h3>Add runs for {month}</h3>
                          </div>
                          <button type="button" className="icon-button secondary" onClick={() => setCreateCourseCode(null)} aria-label="Close add run form">
                            <X size={16} />
                          </button>
                        </div>
                        <div className="planned-run-form-grid">
                          <label>
                            Number of runs
                            <input type="number" min="1" max="20" value={createCount} onChange={(event) => setCreateCount(Number(event.target.value))} required />
                          </label>
                          <label className="wide-field">
                            Planning note (optional)
                            <textarea maxLength={500} value={createNote} onChange={(event) => setCreateNote(event.target.value)} />
                          </label>
                        </div>
                        <div className="planning-preview">
                          <span>Current</span><strong>{course.runs.length} planned</strong>
                          <span>Proposed</span><strong>{course.runs.length + createCount} planned</strong>
                        </div>
                        <button type="submit" disabled={actionBusyId === `create-${course.course.code}`}>
                          {actionBusyId === `create-${course.course.code}` ? <RefreshCw size={16} className="spin" /> : <Plus size={16} />}
                          Add proposed {createCount === 1 ? 'run' : 'runs'}
                        </button>
                      </form>
                    )}

                    {course.runs.length > 0 ? (
                      <ol className="planned-run-list">
                        {course.runs.map((run, index) => (
                          <li key={run.id}>
                            <div className="planned-run-heading">
                              <div>
                                <strong>Run {index + 1}</strong>
                                <span>Created by {formatPlanningActor(run.createdBy)} · version {run.version}</span>
                              </div>
                              <span className={`status-pill course-${run.status}`}>{run.status}</span>
                            </div>
                            {run.note && <p>{run.note}</p>}
                            {run.approvedAt && <span>Approved by {formatPlanningActor(run.approvedBy)} on {formatHistoryTime(run.approvedAt)}</span>}
                            {run.session ? (
                              <div className="planned-session-link">
                                <Check size={16} />
                                <div>
                                  <strong>Draft Session created</strong>
                                  <span>{run.session.startDate} to {run.session.endDate} · {run.session.id}</span>
                                </div>
                              </div>
                            ) : canWrite ? (
                              <div className="planned-run-buttons">
                                {run.status === 'proposed' && (
                                  <button onClick={() => void approveRun(run)} disabled={Boolean(actionBusyId)}>
                                    {actionBusyId === run.id ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}
                                    Approve run
                                  </button>
                                )}
                                {run.status === 'approved' && (
                                  <button className="secondary" onClick={() => {
                                    setScheduleRunId((current) => current === run.id ? null : run.id);
                                    setScheduleStart(`${month}-01`);
                                    setScheduleEnd(`${month}-01`);
                                  }}>
                                    <CalendarDays size={16} />
                                    Schedule class
                                  </button>
                                )}
                              </div>
                            ) : null}

                            {canWrite && run.status === 'approved' && scheduleRunId === run.id && (
                              <form className="planned-run-form schedule-form" onSubmit={(event) => {
                                event.preventDefault();
                                void scheduleRun(run);
                              }}>
                                <div className="form-heading">
                                  <div>
                                    <span className="eyebrow">Explicit Session dates</span>
                                    <h3>Create one draft Session</h3>
                                  </div>
                                  <button type="button" className="icon-button secondary" onClick={() => setScheduleRunId(null)} aria-label="Close schedule form">
                                    <X size={16} />
                                  </button>
                                </div>
                                <div className="planned-run-form-grid">
                                  <label>
                                    Start date
                                    <input type="date" min={`${month}-01`} max={getMonthEnd(month)} value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} required />
                                  </label>
                                  <label>
                                    End date
                                    <input type="date" min={scheduleStart} value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} required />
                                  </label>
                                </div>
                                <div className="planning-preview">
                                  <span>Course</span><strong>{course.course.code}</strong>
                                  <span>Venue</span><strong>{course.venue.name}</strong>
                                  <span>Trainer</span><strong>Unassigned</strong>
                                  <span>Status</span><strong>Draft</strong>
                                </div>
                                <p className="field-help">No trainer, room, time or pax will be generated. The start date must remain in {month}; the span may cross month-end.</p>
                                <button type="submit" disabled={actionBusyId === run.id || !scheduleStart || !scheduleEnd || scheduleEnd < scheduleStart}>
                                  {actionBusyId === run.id ? <RefreshCw size={16} className="spin" /> : <CalendarDays size={16} />}
                                  Create draft Session
                                </button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="empty course-empty">No runs proposed for this month and venue.</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function formatPlanningActor(actor: PlannedCourseRun['createdBy'] | null): string {
  if (!actor) return 'Unknown user';
  return actor.name || actor.email || actor.id;
}

function SessionsPage({ user, role }: { user: User; role: ActiveRole }) {
  const initialFrom = useMemo(() => getSingaporeDate(), []);
  const initialTo = useMemo(() => addCalendarMonths(initialFrom, 6), [initialFrom]);
  const initialPastFrom = useMemo(() => addCalendarMonths(initialFrom, -6), [initialFrom]);
  const initialPastTo = useMemo(() => addCalendarDays(initialFrom, -1), [initialFrom]);
  const [dateMode, setDateMode] = useState<DateMode>('upcoming');
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
    if (!from || !to || from > to) {
      setError('Choose a valid session span with the start date on or before the end date.');
      setBusy(false);
      setLoadingMore(false);
      return;
    }
    if (daysBetweenInclusive(from, to) > 366) {
      setError('Custom session spans must not exceed one year. Choose another date window for older sessions.');
      setBusy(false);
      setLoadingMore(false);
      return;
    }
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
    setDateMode('upcoming');
    setFrom(initialFrom);
    setTo(initialTo);
    setStatuses([]);
    setProgramme('');
    setTrainerId('');
    setVenueCode('');
    setRoomId('');
    setIssues([]);
  }

  function changeDateMode(nextMode: DateMode) {
    setDateMode(nextMode);
    if (nextMode === 'upcoming') {
      setFrom(initialFrom);
      setTo(initialTo);
    } else if (nextMode === 'past') {
      setFrom(initialPastFrom);
      setTo(initialPastTo);
    }
  }

  useEffect(() => {
    setNextCursor(null);
    setSessions([]);
    void load(null);
  }, [queryKey]);

  return (
    <section className="planning-stack">
      <div className="panel planning-hero">
        <div className="hero-copy">
          <span className="eyebrow">Operations workspace</span>
          <h2>Sessions</h2>
          <p>Review session spans, trainers, venues and planning issues.</p>
          <span className="range-label"><CalendarDays size={14} /> {formatDateRange(from, to)}</span>
        </div>
        <div className="toolbar">
          <button className="secondary" onClick={clearFilters} disabled={busy || loadingMore}>
            <X size={16} />
            Clear filters
          </button>
          <button className="icon-button" onClick={() => load(null)} disabled={busy || loadingMore} aria-label="Refresh sessions" title="Refresh sessions">
            <RefreshCw size={17} className={busy ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <PlanningSummary data={data} busy={busy} />

      <div className="panel filter-panel">
        <div className="filter-panel-heading">
          <div>
            <span className="eyebrow">Refine the schedule</span>
            <h2>Filters</h2>
          </div>
          <span>Changes apply automatically</span>
        </div>
        <fieldset className="date-mode-fieldset">
          <legend>Session period</legend>
          <div className="date-mode-row">
            {(['upcoming', 'past', 'custom'] as DateMode[]).map((mode) => (
              <label className="date-mode-option" key={mode}>
                <input
                  type="radio"
                  name="session-period"
                  checked={dateMode === mode}
                  onChange={() => changeDateMode(mode)}
                />
                {mode[0].toUpperCase() + mode.slice(1)}
              </label>
            ))}
          </div>
          <span className="field-help">
            {dateMode === 'upcoming' && 'Singapore today through six calendar months ahead.'}
            {dateMode === 'past' && 'The preceding six calendar months through yesterday.'}
            {dateMode === 'custom' && 'Choose any retained period up to one year; use another window to reach older sessions.'}
          </span>
        </fieldset>
        <div className="filter-grid">
          <label>
            Session span from
            <input
              type="date"
              value={from}
              disabled={dateMode !== 'custom'}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            Session span to
            <input
              type="date"
              value={to}
              disabled={dateMode !== 'custom'}
              onChange={(event) => setTo(event.target.value)}
            />
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
            <table className="planning-table sessions-table">
              <thead>
                <tr>
                  <th>Session span</th>
                  <th>Course</th>
                  <th className="mobile-hide">History</th>
                  <th className="mobile-hide">Programme</th>
                  <th>Trainer</th>
                  <th className="mobile-hide">Venue / Room</th>
                  <th className="mobile-hide">Pax</th>
                  <th>Status</th>
                  <th className="mobile-hide">Issues</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr
                    key={session.id}
                    className="selectable-row"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${session.course.name ?? session.course.tmsCode ?? 'session'} details`}
                    aria-selected={selectedSession?.id === session.id}
                    onClick={() => setSelectedSession(session)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedSession(session);
                      }
                    }}
                  >
                    <td>
                      <strong>{session.dates.start}</strong>
                      <span>to {session.dates.end}</span>
                      <span>{session.dates.spanDays} day span</span>
                    </td>
                    <td>
                      <strong>{session.course.name ?? session.course.tmsCode ?? 'Unresolved'}</strong>
                      <span>{session.course.code ?? session.course.tmsCode ?? session.externalRef}</span>
                    </td>
                    <td className="mobile-hide"><PlanningProfileAnnotation session={session} /></td>
                    <td className="mobile-hide">
                      <span className={`programme-pill ${getProgrammeTone(session.course.programmeCode)}`}>
                        {session.course.programmeCode ?? 'Standalone'}
                      </span>
                    </td>
                    <td>{session.trainer.name ?? session.trainer.rawName ?? 'Unassigned'}</td>
                    <td className="mobile-hide">
                      <strong>{session.venue.name ?? session.venue.rawText ?? 'Unresolved'}</strong>
                      <span>{session.room.name ?? (session.room.id ? session.room.id : 'No room')}</span>
                    </td>
                    <td className="mobile-hide">{session.pax.confirmed ?? session.pax.expected ?? '-'}</td>
                    <td><span className={`status-pill ${session.status}`}>{session.status}</span></td>
                    <td className="mobile-hide"><IssueBadges session={session} /></td>
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

        <SessionDetailPanel
          user={user}
          role={role}
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onReload={() => load(null)}
          onSessionUpdated={(updated) => {
            setSessions((current) => current.map((session) => session.id === updated.id ? updated : session));
            setSelectedSession(updated);
          }}
        />
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
    ['Total sessions', data?.summary.total ?? '-', 'primary'],
    ['Draft', data?.summary.byStatus.draft ?? '-', 'info'],
    ['Confirmed', data?.summary.byStatus.confirmed ?? '-', 'success'],
    ['Cancelled', data?.summary.byStatus.cancelled ?? '-', 'danger'],
    ['Unresolved venues', data?.summary.issues.unresolvedVenues ?? '-', 'warning'],
    ['Unassigned trainers', data?.summary.issues.unassignedTrainers ?? '-', 'warning'],
    ['Missing owned rooms', data?.summary.issues.ownedVenuesWithoutRooms ?? '-', 'warning'],
    ['Room pax over capacity', data?.summary.issues.capacityOverruns ?? '-', 'warning'],
  ] as const;

  return (
    <div className="metrics planning-metrics">
      {metrics.map(([label, value, tone]) => (
        <div className={`metric ${tone}`} key={label}>
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

function PlanningProfileAnnotation({ session }: { session: PlanningSession }) {
  const profile = session.planningProfile;
  const hasProfile = profile.source === 'direct' || profile.source === 'ft_proxy';

  return (
    <div className="profile-annotation">
      <span className={`profile-source ${profile.source}`}>{profileSourceLabels[profile.source]}</span>
      {hasProfile ? (
        <>
          <span>{profile.profileCourseCode}</span>
          <span>{formatPercent(profile.confirmationRate)} confirm · {formatNumber(profile.confirmedPerMonth)}/mo</span>
          <span>Median gap {formatNumber(profile.medianGapDays)} days</span>
          {profile.lowHistoricalConfirmation && <span className="low-confirmation">Low historical confirmation</span>}
        </>
      ) : (
        <span>{profile.source === 'no_history' ? 'New FT course' : 'No matching course × venue profile'}</span>
      )}
    </div>
  );
}

function SessionDetailPanel({
  user,
  role,
  session,
  onClose,
  onReload,
  onSessionUpdated,
}: {
  user: User;
  role: ActiveRole;
  session: PlanningSession | null;
  onClose: () => void;
  onReload: () => void;
  onSessionUpdated: (session: PlanningSession) => void;
}) {
  const canEditTrainer = role === 'admin' || role === 'ops';
  const [history, setHistory] = useState<SessionHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [trainerOptions, setTrainerOptions] = useState<TrainerOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [proposedTrainerId, setProposedTrainerId] = useState('');
  const [note, setNote] = useState('');
  const [trainerSaving, setTrainerSaving] = useState(false);
  const [trainerError, setTrainerError] = useState('');
  const [trainerMessage, setTrainerMessage] = useState('');
  const [reloadRequired, setReloadRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setHistoryError('');
    setTrainerOptions([]);
    setOptionsError('');
    setTrainerError('');
    setTrainerMessage('');
    setReloadRequired(false);
    setNote('');
    setProposedTrainerId(session?.trainer.id ?? '');
    if (!session) return () => { cancelled = true; };

    setHistoryLoading(true);
    fetchSessionHistory(user, session.id)
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      .catch((error: unknown) => {
        if (!cancelled) void handleApiError(error, setHistoryError);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    if (canEditTrainer) {
      setOptionsLoading(true);
      fetchTrainerOptions(user, session.id)
        .then((options) => {
          if (!cancelled) setTrainerOptions(options);
        })
        .catch((error: unknown) => {
          if (!cancelled) void handleApiError(error, setOptionsError);
        })
        .finally(() => {
          if (!cancelled) setOptionsLoading(false);
        });
    } else {
      setOptionsLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [canEditTrainer, session?.id, user]);

  if (!session) {
    return (
      <aside className="panel detail-panel muted-detail">
        <h2>Session details</h2>
        <p className="empty">Select a row to inspect the read-only session details.</p>
      </aside>
    );
  }

  const currentTrainerId = session.trainer.id ?? '';
  const currentTrainerName = session.trainer.name ?? session.trainer.rawName ?? 'Unassigned';
  const selectedTrainer = trainerOptions.find((trainer) => trainer.id === proposedTrainerId);
  const proposedTrainerName = proposedTrainerId
    ? selectedTrainer?.name ?? (proposedTrainerId === currentTrainerId ? currentTrainerName : 'Unknown trainer')
    : 'Unassigned';
  const trainerChanged = proposedTrainerId !== currentTrainerId;
  const trainerAction = !currentTrainerId && proposedTrainerId
    ? 'Assign trainer'
    : currentTrainerId && !proposedTrainerId
      ? 'Unassign trainer'
      : 'Change trainer';

  async function saveTrainer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !trainerChanged) return;
    setTrainerSaving(true);
    setTrainerError('');
    setTrainerMessage('');
    setReloadRequired(false);

    try {
      const result = await updateSessionTrainer(
        user,
        session.id,
        proposedTrainerId || null,
        session.version,
        note,
      );
      const updated: PlanningSession = {
        ...session,
        trainer: result.session.trainer
          ? { id: result.session.trainer.id, name: result.session.trainer.name, rawName: null }
          : { id: null, name: null, rawName: null },
        managementSource: result.session.managementSource,
        version: result.session.version,
        issues: {
          ...session.issues,
          unassignedTrainer: result.session.trainer === null,
        },
      };
      onSessionUpdated(updated);
      setProposedTrainerId(result.session.trainer?.id ?? '');
      setNote('');
      setTrainerMessage(`${trainerAction} saved.`);
      setHistoryLoading(true);
      try {
        setHistory(await fetchSessionHistory(user, session.id));
        setHistoryError('');
      } catch (historyFailure) {
        void handleApiError(historyFailure, setHistoryError);
      } finally {
        setHistoryLoading(false);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_session_version') {
        setTrainerError('This session changed after you opened it. Reload the session before saving again.');
        setReloadRequired(true);
      } else {
        void handleApiError(error, setTrainerError);
      }
    } finally {
      setTrainerSaving(false);
    }
  }

  const detailRows = [
    ['Course', session.course.name ?? 'Unresolved'],
    ['Course code', session.course.code ?? '-'],
    ['TMS code', session.course.tmsCode ?? '-'],
    ['External ref', session.externalRef ?? '-'],
    ['Status', session.status],
    ['Management source', session.managementSource],
    ['Version', session.version],
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
    ['Planning profile', profileSourceLabels[session.planningProfile.source]],
    ['Profile course code', session.planningProfile.profileCourseCode ?? '-'],
    ['Scheduled 18-month count', session.planningProfile.scheduled18MonthCount ?? '-'],
    ['Confirmation rate', formatPercent(session.planningProfile.confirmationRate)],
    ['Confirmed per month', formatNumber(session.planningProfile.confirmedPerMonth)],
    ['Median gap days', formatNumber(session.planningProfile.medianGapDays)],
    ['Strong months', formatMonths(session.planningProfile.strongMonths)],
    ['Weak months', formatMonths(session.planningProfile.weakMonths)],
    ['Historical confirmation flag', session.planningProfile.lowHistoricalConfirmation ? 'Low historical confirmation' : '-'],
  ];

  return (
    <aside
      className="panel detail-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Selected session</span>
          <h2>Session details</h2>
          <span>{canEditTrainer ? 'Trainer changes enabled' : 'Read-only'}</span>
        </div>
        <button
          className="icon-button secondary"
          onClick={onClose}
          aria-label="Close details"
          title="Close details"
          autoFocus
        >
          <X size={16} />
        </button>
      </div>
      <IssueBadges session={session} />
      <PlanningProfileAnnotation session={session} />
      {canEditTrainer && (
        <form className="trainer-editor" onSubmit={saveTrainer}>
          <div className="panel-heading">
            <div>
              <h3>Trainer amendment</h3>
              <span>Eligible trainers for this course only</span>
            </div>
          </div>
          {optionsLoading && <p className="empty">Loading eligible trainers...</p>}
          {optionsError && <p className="error">{optionsError}</p>}
          {!optionsLoading && !optionsError && trainerOptions.length === 0 && (
            <p className="empty">No eligible trainers are currently available for this course.</p>
          )}
          <label>
            Proposed trainer
            <select
              value={proposedTrainerId}
              disabled={optionsLoading || trainerSaving || Boolean(optionsError) || reloadRequired}
              onChange={(event) => {
                setProposedTrainerId(event.target.value);
                setTrainerError('');
                setTrainerMessage('');
              }}
            >
              <option value="">Unassigned</option>
              {currentTrainerId && !trainerOptions.some((trainer) => trainer.id === currentTrainerId) && (
                <option value={currentTrainerId} disabled>{currentTrainerName} (current; not eligible)</option>
              )}
              {trainerOptions.map((trainer) => (
                <option value={trainer.id} key={trainer.id}>{trainer.name}</option>
              ))}
            </select>
          </label>
          <div className="trainer-preview" aria-live="polite">
            <span>Current</span>
            <strong>{currentTrainerName}</strong>
            <span aria-hidden="true">→</span>
            <span>Proposed</span>
            <strong>{proposedTrainerName}</strong>
          </div>
          <label>
            Optional note
            <textarea
              value={note}
              maxLength={500}
              disabled={trainerSaving || reloadRequired}
              onChange={(event) => setNote(event.target.value)}
            />
            <span className="field-help">{note.length}/500 characters</span>
          </label>
          {trainerMessage && <p className="message" role="status">{trainerMessage}</p>}
          {trainerError && <p className="error" role="alert">{trainerError}</p>}
          <div className="action-row">
            <button
              type="submit"
              disabled={!trainerChanged || trainerSaving || optionsLoading || Boolean(optionsError) || reloadRequired}
            >
              {trainerSaving ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}
              {trainerAction}
            </button>
            {reloadRequired && (
              <button type="button" className="secondary" onClick={onReload}>
                <RefreshCw size={16} />
                Reload sessions
              </button>
            )}
          </div>
        </form>
      )}
      <dl className="detail-list">
        {detailRows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className="history-section" aria-labelledby="session-history-heading">
        <div className="panel-heading">
          <div>
            <h3 id="session-history-heading">Session history</h3>
            <span>Newest first</span>
          </div>
          {historyLoading && <RefreshCw size={16} className="spin" aria-label="Loading history" />}
        </div>
        {historyError && <p className="error">{historyError}</p>}
        {!historyLoading && !historyError && history.length === 0 && (
          <p className="empty">No trainer changes have been recorded for this session.</p>
        )}
        {!historyError && history.length > 0 && (
          <ol className="history-list">
            {history.map((entry) => (
              <li key={entry.id}>
                <strong>{formatHistoryAction(entry.action)}</strong>
                <span>{formatHistoryTime(entry.createdAt)}</span>
                <span>By {entry.actor?.displayName ?? entry.actor?.email ?? entry.actor?.id ?? 'Unknown actor'}</span>
                <span>
                  {entry.previousTrainer?.name ?? entry.previousTrainer?.id ?? 'Unassigned'}
                  {' → '}
                  {entry.newTrainer?.name ?? entry.newTrainer?.id ?? 'Unassigned'}
                </span>
                {entry.note && <p>{entry.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}

function formatHistoryAction(action: SessionHistoryEntry['action']): string {
  const labels: Record<SessionHistoryEntry['action'], string> = {
    trainer_assigned: 'Trainer assigned',
    trainer_replaced: 'Trainer changed',
    trainer_unassigned: 'Trainer unassigned',
  };
  return labels[action];
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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
    <section className="workspace-grid sync-workspace">
      <div className="panel upload-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Schedule intake</span>
            <h2>Sync</h2>
          </div>
          <Upload size={20} />
        </div>
        <p className="panel-copy">Upload the Master Schedule Excel to preview changes before they are applied.</p>
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
          <div>
            <span className="eyebrow">Import review</span>
            <h2>Parse result</h2>
          </div>
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
  const conflicts = combineImportConflicts(result);
  const metrics = [
    ['Rows', summary.totalRows],
    ['Valid', summary.validRows],
    ['Changes', summary.changeCount],
    ['Cancelled', summary.cancellations],
    ['Conflicts', conflicts.length],
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
      {conflicts.length > 0 && (
        <section className="conflict-section" aria-labelledby="import-conflicts-heading">
          <h3 id="import-conflicts-heading">Protected import conflicts</h3>
          <p className="empty">Application-managed sessions were not overwritten by this upload.</p>
          <div className="conflict-list">
            {conflicts.map((conflict) => (
              <article className="conflict-card" key={getImportConflictKey(conflict)}>
                <strong>{conflict.externalRef}</strong>
                <span>Session {conflict.sessionId} · workbook row {conflict.rowNumber}</span>
                <p>This application-managed session was not overwritten.</p>
                <dl>
                  {conflict.fields.map((field) => (
                    <div key={field.field}>
                      <dt>{field.field}</dt>
                      <dd>Current: {formatConflictValue(field.current)}</dd>
                      <dd>Incoming: {formatConflictValue(field.incoming)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function combineImportConflicts(result: ParseResult): ParseResult['conflicts'] {
  const seen = new Set<string>();
  const combined: ParseResult['conflicts'] = [];

  for (const conflict of [...result.conflicts, ...(result.applied?.conflicts ?? [])]) {
    const key = getImportConflictKey(conflict);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(conflict);
  }

  return combined;
}

function getImportConflictKey(conflict: ParseResult['conflicts'][number]): string {
  const fields = conflict.fields
    .map((field) => [field.field, field.current, field.incoming] as const)
    .sort((left, right) => {
      const leftKey = JSON.stringify(left);
      const rightKey = JSON.stringify(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

  return JSON.stringify([
    conflict.sessionId,
    conflict.externalRef,
    conflict.rowNumber,
    conflict.reason,
    fields,
  ]);
}

function formatConflictValue(value: string | number | null): string {
  return value === null || value === '' ? 'blank' : String(value);
}

function LegacySessionsPage({ user }: { user: User }) {
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
    <section className="panel table-panel legacy-panel">
      <div className="panel-heading row-heading">
        <div>
          <span className="eyebrow">Parity reference</span>
          <h2>Legacy Sessions</h2>
          <span>{filteredLabel} · retained for acceptance checks</span>
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
                <td><span className={`status-pill ${session.status}`}>{session.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
