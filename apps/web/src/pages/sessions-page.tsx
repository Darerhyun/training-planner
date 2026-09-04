import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Filter,
  MapPin,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  fetchPlanningSessions,
  type PlanningIssue,
  type PlanningRequest,
  type PlanningResponse,
  type PlanningSession,
  type PlanningStatus,
} from '../api.js';
import {
  addCalendarDays,
  addCalendarMonths,
  daysBetweenInclusive,
  formatCompactDateRange,
  formatDateRange,
  formatMonthHeading,
  getSingaporeDate,
} from '../lib/dates.js';
import {
  getProgrammeTone,
} from '../lib/format.js';
import SessionDetailPanel from './session-detail-panel.js';

type ActiveRole = 'admin' | 'ops' | 'finance' | 'viewer';
type DateMode = 'upcoming' | 'past' | 'custom';
type PrimaryView = 'attention' | 'upcoming' | 'past' | 'cancelled';
type ApiErrorHandler = (error: unknown, setError: (message: string) => void) => Promise<void>;
type IssueSummaryKey =
  | 'unassignedTrainers'
  | 'ownedVenuesWithoutRooms'
  | 'capacityOverruns'
  | 'unresolvedVenues';

type BaselineCounts = Record<PrimaryView, number | null>;

const planningStatuses: PlanningStatus[] = ['draft', 'confirmed', 'cancelled', 'completed'];

const issueOptions: Array<{
  value: PlanningIssue;
  label: string;
  summaryKey: IssueSummaryKey;
}> = [
  { value: 'unassigned_trainer', label: 'Unassigned trainer', summaryKey: 'unassignedTrainers' },
  { value: 'owned_venue_missing_room', label: 'Missing room', summaryKey: 'ownedVenuesWithoutRooms' },
  { value: 'capacity_overrun', label: 'Over capacity', summaryKey: 'capacityOverruns' },
  { value: 'unresolved_venue', label: 'Unresolved venue', summaryKey: 'unresolvedVenues' },
];

const issueLabels: Record<PlanningIssue, string> = {
  unassigned_trainer: 'Unassigned trainer',
  unresolved_venue: 'Unresolved venue',
  owned_venue_missing_room: 'Missing room',
  capacity_overrun: 'Over capacity',
};

const statusLabels: Record<PlanningStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

const primaryViewLabels: Record<PrimaryView, string> = {
  attention: 'Needs attention',
  upcoming: 'Upcoming',
  past: 'Past',
  cancelled: 'Cancelled',
};

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
  const displayYear = Number(initialFrom.slice(0, 4));
  const [primaryView, setPrimaryView] = useState<PrimaryView>('upcoming');
  const [dateMode, setDateMode] = useState<DateMode>('upcoming');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [statuses, setStatuses] = useState<PlanningStatus[]>([]);
  const [programme, setProgramme] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [venueCode, setVenueCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [issues, setIssues] = useState<PlanningIssue[]>([]);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [data, setData] = useState<PlanningResponse | null>(null);
  const [sessions, setSessions] = useState<PlanningSession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<PlanningSession | null>(null);
  const [focusTrainer, setFocusTrainer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [baselineCounts, setBaselineCounts] = useState<BaselineCounts>({
    attention: null,
    upcoming: null,
    past: null,
    cancelled: null,
  });
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineError, setBaselineError] = useState('');
  const openerRef = useRef<HTMLElement | null>(null);
  const requestSequence = useRef(0);
  const apiErrorRef = useRef(onApiError);
  apiErrorRef.current = onApiError;

  const activeStatuses = useMemo(() => {
    if (primaryView !== 'cancelled' || statuses.includes('cancelled')) return statuses;
    const next: PlanningStatus[] = ['cancelled', ...statuses]; // FIX: preserve the PlanningStatus union when adding the view constraint.
    return next;
  }, [primaryView, statuses]);

  const activeRequest = useMemo<PlanningRequest>(() => ({
    from,
    to,
    status: activeStatuses,
    programme: programme || undefined,
    trainerId: trainerId || undefined,
    venueCode: venueCode || undefined,
    roomId: roomId || undefined,
    issue: issues,
    needsAttention: primaryView === 'attention',
    includeCancelled: primaryView === 'cancelled' || activeStatuses.includes('cancelled'),
    limit: 100,
  }), [activeStatuses, from, issues, primaryView, programme, roomId, to, trainerId, venueCode]);

  const queryKey = useMemo(() => JSON.stringify(activeRequest), [activeRequest]);

  const refreshBaseline = useCallback(async () => {
    setBaselineBusy(true);
    setBaselineError('');
    try {
      const [upcoming, past, cancelled] = await Promise.all([
        fetchPlanningSessions(user, {
          from: initialFrom,
          to: initialTo,
          limit: 1,
        }),
        fetchPlanningSessions(user, {
          from: initialPastFrom,
          to: initialPastTo,
          limit: 1,
        }),
        fetchPlanningSessions(user, {
          from: initialFrom,
          to: initialTo,
          status: ['cancelled'],
          includeCancelled: true,
          limit: 1,
        }),
      ]);
      setBaselineCounts({
        upcoming: upcoming.summary.total,
        attention: upcoming.summary.issues.needsAttention,
        past: past.summary.total,
        cancelled: cancelled.summary.total,
      });
    } catch (caught) {
      void apiErrorRef.current(caught, setBaselineError);
    } finally {
      setBaselineBusy(false);
    }
  }, [initialFrom, initialPastFrom, initialPastTo, initialTo, user]);

  useEffect(() => {
    void refreshBaseline();
  }, [refreshBaseline]);

  async function loadActive(cursor?: string | null, preserveSelection = false): Promise<void> {
    const append = Boolean(cursor);
    const sequence = ++requestSequence.current;
    if (append) {
      setLoadingMore(true);
    } else {
      setBusy(true);
    }
    setError('');

    if (!activeRequest.from || !activeRequest.to || activeRequest.from > activeRequest.to) {
      setError('Choose a valid session span with the start date on or before the end date.');
      setBusy(false);
      setLoadingMore(false);
      return;
    }
    if (daysBetweenInclusive(activeRequest.from, activeRequest.to) > 366) {
      setError('Custom session spans must not exceed one year. Choose another date window for older sessions.');
      setBusy(false);
      setLoadingMore(false);
      return;
    }

    try {
      const result = await fetchPlanningSessions(user, { ...activeRequest, cursor });
      if (sequence !== requestSequence.current) return;
      setData(result);
      setNextCursor(result.page.nextCursor);
      setSessions((current) => append ? mergePlanningSessions(current, result.sessions) : result.sessions);
      if (!append && !preserveSelection) {
        setSelectedSession(null);
      } else if (!append && preserveSelection) {
        setSelectedSession((current) => {
          if (!current) return null;
          return result.sessions.find((item) => item.id === current.id) ?? null;
        });
      }
    } catch (caught) {
      if (sequence === requestSequence.current) void apiErrorRef.current(caught, setError);
    } finally {
      if (sequence === requestSequence.current) {
        setBusy(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    setNextCursor(null);
    setSessions([]);
    void loadActive(null);
  }, [queryKey]);

  function clearFilters() {
    setPrimaryView('upcoming');
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

  function selectPrimaryView(nextView: PrimaryView) {
    setPrimaryView(nextView);
    setStatuses(nextView === 'cancelled' ? ['cancelled'] : []);
    if (nextView === 'past') {
      setDateMode('past');
      setFrom(initialPastFrom);
      setTo(initialPastTo);
    } else {
      setDateMode('upcoming');
      setFrom(initialFrom);
      setTo(initialTo);
    }
  }

  function changeDateMode(nextMode: DateMode) {
    setDateMode(nextMode);
    if (nextMode === 'upcoming') {
      setFrom(initialFrom);
      setTo(initialTo);
      setPrimaryView('upcoming');
      if (primaryView === 'cancelled') {
        setStatuses((current) => current.filter((status) => status !== 'cancelled')); // FIX: drop the Cancelled tab's implicit status when switching to a non-cancelled period.
      }
    } else if (nextMode === 'past') {
      setFrom(initialPastFrom);
      setTo(initialPastTo);
      setPrimaryView('past');
      if (primaryView === 'cancelled') {
        setStatuses((current) => current.filter((status) => status !== 'cancelled')); // FIX: drop the Cancelled tab's implicit status when switching to a non-cancelled period.
      }
    }
  }

  function toggleIssue(issue: PlanningIssue) {
    setIssues((current) => current.includes(issue)
      ? current.filter((item) => item !== issue)
      : [...current, issue]);
  }

  function openDetails(session: PlanningSession, opener: HTMLElement, trainerFocus = false) {
    openerRef.current = opener;
    setFocusTrainer(trainerFocus);
    setSelectedSession(session);
  }

  function closeDetails() {
    const opener = openerRef.current;
    setSelectedSession(null);
    setFocusTrainer(false);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => opener?.focus());
    } else {
      opener?.focus();
    }
  }

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, PlanningSession[]>();
    for (const session of sessions) {
      const month = session.dates.start.slice(0, 7);
      const group = groups.get(month) ?? [];
      group.push(session);
      groups.set(month, group);
    }
    return [...groups.entries()];
  }, [sessions]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; remove: () => void }> = [];
    if (dateMode === 'custom') {
      chips.push({
        id: 'date-range',
        label: `Custom · ${formatCompactDateRange(from, to, displayYear)}`,
        remove: () => {
          setDateMode('upcoming');
          setFrom(initialFrom);
          setTo(initialTo);
          setPrimaryView('upcoming');
        },
      });
    }
    if (programme) {
      const selected = data?.filters.programmes.find((item) => item.code === programme);
      chips.push({
        id: 'programme',
        label: `Programme · ${selected?.name ?? programme}`,
        remove: () => setProgramme(''),
      });
    }
    if (trainerId) {
      const selected = data?.filters.trainers.find((item) => item.id === trainerId);
      chips.push({
        id: 'trainer',
        label: `Trainer · ${selected?.name ?? 'Selected trainer'}`,
        remove: () => setTrainerId(''),
      });
    }
    if (venueCode) {
      const selected = data?.filters.venues.find((item) => item.code === venueCode);
      chips.push({
        id: 'venue',
        label: `Venue · ${selected?.name ?? venueCode}`,
        remove: () => setVenueCode(''),
      });
    }
    if (roomId) {
      const selected = data?.filters.rooms.find((item) => item.id === roomId);
      chips.push({
        id: 'room',
        label: `Room · ${selected?.name ?? roomId}`,
        remove: () => setRoomId(''),
      });
    }
    statuses.filter((status) => !(primaryView === 'cancelled' && status === 'cancelled')).forEach((status) => chips.push({
      id: `status-${status}`,
      label: `Status · ${statusLabels[status]}`,
      remove: () => setStatuses((current) => current.filter((item) => item !== status)),
    }));
    issues.forEach((issue) => chips.push({
      id: `issue-${issue}`,
      label: `Issue · ${issueLabels[issue]}`,
      remove: () => toggleIssue(issue),
    }));
    return chips;
  }, [data, dateMode, displayYear, from, initialFrom, initialTo, issues, primaryView, programme, roomId, statuses, to, trainerId, venueCode]);

  return (
    <section className="planning-stack sessions-page">
      <header className="sessions-header">
        <div className="hero-copy">
          <span className="eyebrow">Operations workspace</span>
          <h2>Sessions</h2>
          <p>Review upcoming classes, trainer coverage and planning issues.</p>
        </div>
        <div className="sessions-header-actions">
          <span className="range-label"><CalendarDays size={14} /> Showing {formatDateRange(from, to)} · Singapore time</span>
          <button
            className="icon-button secondary"
            onClick={() => {
              void loadActive(null);
              void refreshBaseline();
            }}
            disabled={busy || loadingMore || baselineBusy}
            aria-label="Refresh sessions"
            title="Refresh sessions"
          >
            <RefreshCw size={17} className={busy || baselineBusy ? 'spin' : ''} />
          </button>
        </div>
      </header>

      <div className="panel sessions-control-panel">
        <nav className="session-view-tabs" aria-label="Session views">
          {(['attention', 'upcoming', 'past', 'cancelled'] as PrimaryView[]).map((view) => (
            <button
              type="button"
              className={primaryView === view ? 'active' : ''}
              key={view}
              aria-current={primaryView === view ? 'page' : undefined}
              onClick={() => selectPrimaryView(view)}
            >
              {primaryViewLabels[view]}
              <span className={`count-pill count-${view}`}>
                {baselineCounts[view] === null ? '—' : baselineCounts[view]}
              </span>
            </button>
          ))}
        </nav>

        <div className="issue-count-strip" aria-label="Current issue counts">
          {issueOptions.map((item) => {
            const activeCount = data?.summary.issues[item.summaryKey];
            return (
              <button
                type="button"
                className={`issue-count-button${issues.includes(item.value) ? ' active' : ''}`}
                key={item.value}
                aria-pressed={issues.includes(item.value)}
                onClick={() => toggleIssue(item.value)}
              >
                <span className="issue-dot" aria-hidden="true" />
                {item.label}
                <strong>{activeCount ?? '—'}</strong>
              </button>
            );
          })}
        </div>

        <div className="primary-filter-row">
          <fieldset className="period-control">
            <legend className="sr-only">Session period</legend>
            {(['upcoming', 'past', 'custom'] as DateMode[]).map((mode) => (
              <button
                type="button"
                className={dateMode === mode ? 'active' : ''}
                key={mode}
                aria-pressed={dateMode === mode}
                onClick={() => changeDateMode(mode)}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </fieldset>
          <label className="compact-filter">
            <span>Programme</span>
            <select value={programme} onChange={(event) => setProgramme(event.target.value)}>
              <option value="">All programmes</option>
              {data?.filters.programmes.map((item) => (
                <option value={item.code} key={item.code}>{item.name} ({item.code === '__standalone' ? 'Standalone' : item.code})</option>
              ))}
            </select>
          </label>
          <label className="compact-filter">
            <span>Trainer</span>
            <select value={trainerId} onChange={(event) => setTrainerId(event.target.value)}>
              <option value="">All trainers</option>
              {data?.filters.trainers.map((item) => (
                <option value={item.id} key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="compact-filter">
            <span>Venue</span>
            <select value={venueCode} onChange={(event) => setVenueCode(event.target.value)}>
              <option value="">All venues</option>
              {data?.filters.venues.map((item) => (
                <option value={item.code} key={item.code}>{item.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary more-filter-toggle"
            aria-expanded={moreFiltersOpen}
            onClick={() => setMoreFiltersOpen((current) => !current)}
          >
            <Filter size={15} />
            More filters
            <ChevronDown size={15} className={moreFiltersOpen ? 'rotate-180' : ''} />
          </button>
          <span className="auto-note">Changes apply automatically</span>
        </div>

        {moreFiltersOpen && (
          <div className="more-filters" aria-label="More session filters">
            <div className="custom-date-fields">
              <label>
                Custom date from
                <input
                  type="date"
                  value={from}
                  disabled={dateMode !== 'custom'}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                Custom date to
                <input
                  type="date"
                  value={to}
                  disabled={dateMode !== 'custom'}
                  onChange={(event) => setTo(event.target.value)}
                />
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
            <div className="filter-group">
              <span className="filter-group-label">Status</span>
              <div className="chip-row">
                {planningStatuses.map((status) => (
                  <label className="filter-chip" key={status}>
                    <input
                      type="checkbox"
                      checked={statuses.includes(status)}
                      onChange={() => setStatuses((current) => current.includes(status)
                        ? current.filter((item) => item !== status)
                        : [...current, status])}
                    />
                    {statusLabels[status]}
                  </label>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <span className="filter-group-label">Issues</span>
              <div className="chip-row">
                {issueOptions.map((item) => (
                  <label className="filter-chip" key={item.value}>
                    <input
                      type="checkbox"
                      checked={issues.includes(item.value)}
                      onChange={() => toggleIssue(item.value)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="active-filter-row">
          <span className="active-filter-label">Active filters</span>
          {activeFilterChips.length === 0 && <span className="no-active-filters">None</span>}
          {activeFilterChips.map((chip) => (
            <button type="button" className="active-filter-chip" key={chip.id} onClick={chip.remove}>
              {chip.label}
              <X size={13} aria-hidden="true" />
              <span className="sr-only">Remove</span>
            </button>
          ))}
          {activeFilterChips.length > 0 && (
            <button type="button" className="clear-all-button" onClick={clearFilters}>Clear all</button>
          )}
        </div>
        {baselineError && <p className="baseline-error" role="status">Counts could not be refreshed. {baselineError}</p>}
      </div>

      <div className="panel sessions-results">
        <div className="panel-heading row-heading">
          <div>
            <span className="eyebrow">{primaryViewLabels[primaryView]}</span>
            <h2>Session list</h2>
            <span>{data ? `${data.summary.total} matching session${data.summary.total === 1 ? '' : 's'}` : 'Loading sessions'}</span>
          </div>
          {busy && <RefreshCw size={18} className="spin" aria-label="Loading sessions" />}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {!busy && !error && sessions.length === 0 && <p className="empty">No sessions match this view and filter set.</p>}

        <div className="sessions-desktop-table">
          <table className="planning-table sessions-table">
            <thead>
              <tr>
                <th>Dates</th>
                <th>Course</th>
                <th>Trainer</th>
                <th>Venue / Room</th>
                <th>Pax</th>
                <th>Status</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <SessionTableRow
                  key={session.id}
                  session={session}
                  referenceYear={displayYear}
                  onOpen={(opener) => openDetails(session, opener)}
                  onTrainerOpen={(opener) => openDetails(session, opener, true)}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="sessions-mobile-groups">
          {groupedSessions.map(([month, monthSessions]) => (
            <section className="session-month-group" key={month} aria-labelledby={`month-${month}`}>
              <h3 id={`month-${month}`}>{formatMonthHeading(month)}</h3>
              <div className="session-card-list">
                {monthSessions.map((session) => (
                  <SessionMobileCard
                    key={session.id}
                    session={session}
                    referenceYear={displayYear}
                    onOpen={(opener) => openDetails(session, opener)}
                    onTrainerOpen={(opener) => openDetails(session, opener, true)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="pagination-row">
          <span className="pagination-summary">{data ? `Showing ${sessions.length} of ${data.summary.total} sessions` : ''}</span>
          <button className="secondary" disabled={!nextCursor || busy || loadingMore} onClick={() => void loadActive(nextCursor)}>
            {loadingMore ? <RefreshCw size={16} className="spin" /> : <ClipboardList size={16} />}
            Load more
          </button>
        </div>
      </div>

      <SessionDetailPanel
        user={user}
        role={role}
        session={selectedSession}
        focusTrainer={focusTrainer}
        returnFocusRef={openerRef}
        onClose={closeDetails}
        onReload={() => void loadActive(null, true)}
        onApiError={onApiError}
        IssueBadges={IssueBadges}
        onSessionUpdated={(updated) => {
          setSelectedSession(updated);
          setSessions((current) => current.map((item) => item.id === updated.id ? updated : item));
          void Promise.all([
            loadActive(null, true),
            refreshBaseline(),
          ]);
        }}
      />
    </section>
  );
}

function SessionTableRow({
  session,
  referenceYear,
  onOpen,
  onTrainerOpen,
}: {
  session: PlanningSession;
  referenceYear: number;
  onOpen: (opener: HTMLElement) => void;
  onTrainerOpen: (opener: HTMLElement) => void;
}) {
  const courseTitle = session.course.name ?? session.course.tmsCode ?? session.externalRef ?? 'Unresolved course';
  const trainerName = session.trainer.name ?? session.trainer.rawName;
  const roomLabel = getRoomLabel(session);
  return (
    <tr className={`${session.issues.unassignedTrainer ? 'needs-attention-row ' : ''}${session.status === 'cancelled' ? 'cancelled-row' : ''}`}>
      <td className="date-cell">
        <strong>{formatCompactDateRange(session.dates.start, session.dates.end, referenceYear)}</strong>
        <span>{session.dates.spanDays}d</span>
      </td>
      <td className="course-cell">
        <button
          type="button"
          className="course-link"
          title={session.course.name ?? undefined}
          aria-label={`Open ${courseTitle} details`}
          onClick={(event) => onOpen(event.currentTarget)}
        >
          <span className="course-link-title">{courseTitle}</span>
          <span className="course-link-meta">
            <span className={`programme-dot ${getProgrammeTone(session.course.programmeCode)}`} aria-hidden="true" />
            {session.course.code ?? session.course.tmsCode ?? 'No course code'}
            <span aria-hidden="true">·</span>
            {session.course.programmeCode ?? 'ASK standalone'}
          </span>
        </button>
      </td>
      <td className="trainer-cell">
        <button
          type="button"
          className={`trainer-link${!trainerName ? ' unassigned' : ''}`}
          aria-label={trainerName ? `Open ${trainerName} trainer amendment` : 'Assign trainer'}
          onClick={(event) => onTrainerOpen(event.currentTarget)}
        >
          {trainerName ? <span className="trainer-avatar" aria-hidden="true">{getInitials(trainerName)}</span> : null}
          <span>{trainerName ?? 'Assign trainer'}</span>
        </button>
      </td>
      <td className="venue-cell">
        <strong>{session.venue.name ?? session.venue.rawText ?? 'Unresolved venue'}</strong>
        {roomLabel && <span>{roomLabel}</span>}
      </td>
      <td className={`pax-cell${session.issues.capacityOverrun ? ' over-capacity' : ''}`}>
        {formatPax(session)}
      </td>
      <td><span className={`status-pill ${session.status}`}>{statusLabels[session.status]}</span></td>
      <td><IssueBadges session={session} compact /></td>
    </tr>
  );
}

function SessionMobileCard({
  session,
  referenceYear,
  onOpen,
  onTrainerOpen,
}: {
  session: PlanningSession;
  referenceYear: number;
  onOpen: (opener: HTMLElement) => void;
  onTrainerOpen: (opener: HTMLElement) => void;
}) {
  const courseTitle = session.course.name ?? session.course.tmsCode ?? session.externalRef ?? 'Unresolved course';
  const trainerName = session.trainer.name ?? session.trainer.rawName;
  const roomLabel = getRoomLabel(session);
  return (
    <article className={`session-card${session.issues.unassignedTrainer ? ' needs-attention-row' : ''}${session.status === 'cancelled' ? ' cancelled-row' : ''}`}>
      <div className="session-card-heading">
        <button
          type="button"
          className="course-link"
          title={session.course.name ?? undefined}
          aria-label={`Open ${courseTitle} details`}
          onClick={(event) => onOpen(event.currentTarget)}
        >
          <span className="course-link-title">{courseTitle}</span>
          <span className="course-link-meta">
            <span className={`programme-dot ${getProgrammeTone(session.course.programmeCode)}`} aria-hidden="true" />
            {session.course.code ?? session.course.tmsCode ?? 'No course code'} · {session.course.programmeCode ?? 'ASK standalone'}
          </span>
        </button>
        <span className={`status-pill ${session.status}`}>{statusLabels[session.status]}</span>
      </div>
      <div className="session-card-row">
        <CalendarDays size={14} aria-hidden="true" />
        <strong>{formatCompactDateRange(session.dates.start, session.dates.end, referenceYear)}</strong>
        <span>· {session.dates.spanDays}d</span>
        {session.dates.timeText && <span className="session-card-time">· {session.dates.timeText}</span>}
      </div>
      <div className="session-card-row">
        <button
          type="button"
          className={`trainer-link${!trainerName ? ' unassigned' : ''}`}
          aria-label={trainerName ? `Open ${trainerName} trainer amendment` : 'Assign trainer'}
          onClick={(event) => onTrainerOpen(event.currentTarget)}
        >
          {trainerName ? <span className="trainer-avatar" aria-hidden="true">{getInitials(trainerName)}</span> : null}
          <span>{trainerName ?? 'Assign trainer'}</span>
        </button>
        <span className="mobile-pax">{formatPax(session)} pax</span>
      </div>
      <div className="session-card-row venue-card-row">
        <MapPin size={14} aria-hidden="true" />
        <span>{session.venue.name ?? session.venue.rawText ?? 'Unresolved venue'}</span>
        {roomLabel && <span>· {roomLabel}</span>}
      </div>
      <div className="session-card-footer">
        <IssueBadges session={session} compact />
        <button type="button" className="card-detail-link" onClick={(event) => onOpen(event.currentTarget)}>
          View details
        </button>
      </div>
    </article>
  );
}

function getInitials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatPax(session: PlanningSession): string {
  if (session.pax.confirmed !== null && session.pax.expected !== null) {
    return `${session.pax.confirmed}/${session.pax.expected}`;
  }
  return String(session.pax.effective ?? session.pax.expected ?? '—');
}

function getRoomLabel(session: PlanningSession): string | null {
  if (session.room.name) return session.room.name;
  if (session.room.id) return session.room.id; // FIX: an assigned room id remains meaningful when the optional room name is absent.
  return session.venue.type === 'owned' ? 'No room assigned' : null;
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

export function IssueBadges({ session, compact = false }: { session: PlanningSession; compact?: boolean }) {
  const issues = getSessionIssues(session);
  if (issues.length === 0) return <span className="issue-none">—</span>;

  return (
    <div className={`issue-list${compact ? ' compact' : ''}`}>
      {issues.map((issue) => <span className="issue-pill" key={issue}>{issueLabels[issue]}</span>)}
    </div>
  );
}
