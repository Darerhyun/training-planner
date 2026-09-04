import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { CalendarDays, ClipboardList, RefreshCw, X } from 'lucide-react';
import {
  fetchPlanningSessions,
  fetchSessionHistory,
  fetchTrainerOptions,
  updateSessionTrainer,
  type PlanningIssue,
  type PlanningResponse,
  type PlanningSession,
  type PlanningStatus,
} from '../api.js';
import { addCalendarDays, addCalendarMonths, daysBetweenInclusive, formatDateRange, getSingaporeDate } from '../lib/dates.js';
import {
  formatNumber,
  formatPercent,
  getProgrammeTone,
  issueLabels,
  profileSourceLabels,
} from '../lib/format.js';
import SessionDetailPanel from './session-detail-panel.js';

type ActiveRole = 'admin' | 'ops' | 'finance' | 'viewer';
type DateMode = 'upcoming' | 'past' | 'custom';
type ApiErrorHandler = (error: unknown, setError: (message: string) => void) => Promise<void>;

const planningStatuses: PlanningStatus[] = ['draft', 'confirmed', 'cancelled', 'completed'];
const planningIssues: PlanningIssue[] = [
  'unassigned_trainer',
  'unresolved_venue',
  'owned_venue_missing_room',
  'capacity_overrun',
];

export default function SessionsPage({
  user,
  role,
  onApiError,
}: {
  user: User;
  role: ActiveRole;
  onApiError: ApiErrorHandler;
}) {
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
      void onApiError(caught, setError);
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
          onApiError={onApiError}
          IssueBadges={IssueBadges}
          PlanningProfileAnnotation={PlanningProfileAnnotation}
          onSessionUpdated={(updated) => {
            setSessions((current) => current.map((session) => session.id === updated.id ? updated : session));
            setSelectedSession(updated);
          }}
        />
      </div>
    </section>
  );
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

export function IssueBadges({ session }: { session: PlanningSession }) {
  const issues = getSessionIssues(session);
  if (issues.length === 0) return <span className="empty">None</span>;

  return (
    <div className="issue-list">
      {issues.map((issue) => <span className="issue-pill" key={issue}>{issueLabels[issue]}</span>)}
    </div>
  );
}

export function PlanningProfileAnnotation({ session }: { session: PlanningSession }) {
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
