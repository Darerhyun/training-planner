import { useEffect, useRef, useState } from 'react';
import type { ComponentType, FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, Check, ChevronRight, RefreshCw, X } from 'lucide-react';
import {
  ApiError,
  fetchSessionHistory,
  fetchTrainerOptions,
  updateSessionTrainer,
  type PlanningSession,
  type SessionHistoryEntry,
  type TrainerOption,
} from '../api.js';
import {
  formatCompactDateRange,
  formatReadableDate,
} from '../lib/dates.js';
import {
  formatHistoryAction,
  formatHistoryTime,
  formatMonths,
  formatNumber,
  formatPercent,
  getProgrammeTone, // FIX: render the approved programme tone in the drawer identity.
  profileSourceLabels,
} from '../lib/format.js';

type ActiveRole = 'admin' | 'ops' | 'finance' | 'viewer';
type ApiErrorHandler = (error: unknown, setError: (message: string) => void) => Promise<void>;
type IssueRenderer = ComponentType<{ session: PlanningSession; compact?: boolean }>;
type ProfileRenderer = ComponentType<{ session: PlanningSession }>;

const issueDetails = [
  {
    key: 'unassignedTrainer',
    label: 'Unassigned trainer',
    description: 'No trainer is assigned. An eligible trainer is needed before the session can be confirmed.',
  },
  {
    key: 'unresolvedVenue',
    label: 'Unresolved venue',
    description: 'The venue could not be matched to a canonical venue record.',
  },
  {
    key: 'ownedVenueMissingRoom',
    label: 'Missing room',
    description: 'This owned venue does not have a room assigned to the session.',
  },
  {
    key: 'capacityOverrun',
    label: 'Over capacity',
    description: 'The effective pax is above the assigned room capacity.',
  },
] as const;

const statusLabels: Record<PlanningSession['status'], string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

export default function SessionDetailPanel({
  user,
  role,
  session,
  focusTrainer = false,
  returnFocusRef,
  onClose,
  onReload,
  onSessionUpdated,
  onApiError,
  IssueBadges,
  PlanningProfileAnnotation,
}: {
  user: User;
  role: ActiveRole;
  session: PlanningSession | null;
  focusTrainer?: boolean;
  returnFocusRef: { current: HTMLElement | null };
  onClose: () => void;
  onReload: () => void;
  onSessionUpdated: (session: PlanningSession) => void;
  onApiError: ApiErrorHandler;
  IssueBadges: IssueRenderer;
  PlanningProfileAnnotation: ProfileRenderer;
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const trainerSelectRef = useRef<HTMLSelectElement | null>(null);
  const apiErrorRef = useRef(onApiError);
  const onCloseRef = useRef(onClose);
  apiErrorRef.current = onApiError;
  onCloseRef.current = onClose;

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
    if (!session) return undefined;

    setHistoryLoading(true);
    fetchSessionHistory(user, session.id)
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      .catch((error: unknown) => {
        if (!cancelled) void apiErrorRef.current(error, setHistoryError);
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
          if (!cancelled) void apiErrorRef.current(error, setOptionsError);
        })
        .finally(() => {
          if (!cancelled) setOptionsLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [canEditTrainer, session?.id, user]);

  useEffect(() => {
    if (!session || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const animationFrame = typeof window === 'undefined' ? 0 : window.requestAnimationFrame(() => {
      if (focusTrainer && canEditTrainer && !optionsLoading) {
        trainerSelectRef.current?.focus();
      } else {
        closeButtonRef.current?.focus();
      }
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0); // FIX: fixed-position drawer controls have no offsetParent but must remain tabbable.
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [canEditTrainer, focusTrainer, optionsLoading, session?.id]);

  if (!session) return null;

  const courseTitle = session.course.name ?? session.course.tmsCode ?? session.externalRef ?? 'Unresolved course';
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
  const orderedHistory = [...history].sort((left, right) => (
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  ));

  async function saveTrainer(event: FormEvent<HTMLFormElement>) {
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
        void apiErrorRef.current(historyFailure, setHistoryError);
      } finally {
        setHistoryLoading(false);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_session_version') {
        setTrainerError('This session changed after you opened it. Reload the session before saving again.');
        setReloadRequired(true);
      } else {
        void apiErrorRef.current(error, setTrainerError);
      }
    } finally {
      setTrainerSaving(false);
    }
  }

  return (
    <div className="detail-overlay">
      <div className="detail-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={dialogRef}
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`session-detail-heading-${session.id}`}
        tabIndex={-1}
      >
        <header className="detail-drawer-header">
          <div className="detail-course-heading">
            <span className="eyebrow">Session details</span>
            <h2 id={`session-detail-heading-${session.id}`} title={session.course.name ?? undefined}>{courseTitle}</h2>
            <div className="detail-identity">
              <span className="detail-programme"><span className={`programme-dot ${getProgrammeTone(session.course.programmeCode)}`} aria-hidden="true" />{session.course.programmeCode ?? 'ASK standalone'}</span>
              <span>Code {session.course.code ?? '—'}</span>
              <span>TMS {session.course.tmsCode ?? '—'}</span>
              <span>Ref {session.externalRef ?? '—'}</span>
            </div>
          </div>
          <div className="detail-header-actions">
            <span className={`status-pill ${session.status}`}>{statusLabels[session.status]}</span>
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-button secondary"
              onClick={onClose}
              aria-label="Close session details"
              title="Close session details"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <section className="detail-section detail-facts" aria-label="Session details">
          <dl>
            <DetailFact label="Dates" value={`${formatReadableDate(session.dates.start)} → ${formatReadableDate(session.dates.end)} · ${session.dates.spanDays} days`} />
            <DetailFact label="Venue" value={session.venue.name ?? session.venue.rawText ?? 'Unresolved venue'} />
            <DetailFact label="Room" value={getRoomLabel(session)} />
            <DetailFact label="Pax" value={`${session.pax.expected ?? '—'} expected · ${session.pax.confirmed ?? '—'} confirmed`} />
            <DetailFact label="Time" value={session.dates.timeText ?? 'Not provided'} />
            <DetailFact label="Trainer" value={currentTrainerName} />
          </dl>
        </section>

        <section className="detail-section" aria-labelledby={`session-issues-heading-${session.id}`}>
          <div className="detail-section-heading">
            <h3 id={`session-issues-heading-${session.id}`}>Issues</h3>
            <IssueBadges session={session} />
          </div>
          <div className="issue-explanation-list">
            {issueDetails.filter((issue) => session.issues[issue.key]).map((issue) => (
              <div className="issue-explanation" key={issue.key}>
                <AlertTriangle size={17} aria-hidden="true" />
                <div><strong>{issue.label}</strong><p>{issue.description}</p></div>
              </div>
            ))}
            {getIssueCount(session) === 0 && <p className="empty">No planning issues recorded.</p>}
          </div>
        </section>

        {canEditTrainer ? (
          <form className="trainer-editor detail-section" onSubmit={saveTrainer} aria-labelledby={`trainer-amendment-heading-${session.id}`}>
            <div className="detail-section-heading">
              <div>
                <h3 id={`trainer-amendment-heading-${session.id}`}>Trainer amendment</h3>
                <span>Eligible trainers only</span>
              </div>
            </div>
            {optionsLoading && <p className="empty">Loading eligible trainers...</p>}
            {optionsError && <p className="error" role="alert">{optionsError}</p>}
            {!optionsLoading && !optionsError && trainerOptions.length === 0 && (
              <p className="empty">No eligible trainers are currently available for this course.</p>
            )}
            <label>
              Proposed trainer
              <select
                ref={trainerSelectRef}
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
              <ChevronRight size={15} aria-hidden="true" />
              <span>Proposed</span>
              <strong>{proposedTrainerName}</strong>
            </div>
            <label>
              Note <span className="optional-label">(optional)</span>
              <textarea
                value={note}
                maxLength={500}
                disabled={trainerSaving || reloadRequired}
                placeholder="Why this trainer?"
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
                  Reload session
                </button>
              )}
            </div>
          </form>
        ) : (
          <section className="detail-section read-only-trainer" aria-labelledby={`trainer-readonly-heading-${session.id}`}>
            <div className="detail-section-heading">
              <div>
                <h3 id={`trainer-readonly-heading-${session.id}`}>Trainer amendment</h3>
                <span>Read-only for {role === 'finance' ? 'Finance' : 'Viewer'}</span>
              </div>
            </div>
            <p>Current trainer: <strong>{currentTrainerName}</strong></p>
          </section>
        )}

        <section className="detail-section history-evidence" aria-labelledby={`history-evidence-heading-${session.id}`}>
          <div className="detail-section-heading">
            <h3 id={`history-evidence-heading-${session.id}`}>History evidence</h3>
            <span className={`profile-source ${session.planningProfile.source}`}>{profileSourceLabels[session.planningProfile.source]}</span>
          </div>
          <div className="evidence-grid">
            <div><span>Confirmation</span><strong>{formatPercent(session.planningProfile.confirmationRate)}</strong></div>
            <div><span>Cadence</span><strong>{formatNumber(session.planningProfile.confirmedPerMonth)} /mo</strong></div>
            <div><span>Median gap</span><strong>{formatNumber(session.planningProfile.medianGapDays)} days</strong></div>
          </div>
          <PlanningProfileAnnotation session={session} />
          <p className="evidence-footnote">
            {session.planningProfile.profileCourseCode
              ? `${session.planningProfile.profileCourseCode} · ${formatMonths(session.planningProfile.strongMonths)} strong months${session.planningProfile.weakMonths.length ? ` · ${formatMonths(session.planningProfile.weakMonths)} weak months` : ''}`
              : 'No matching course × venue profile.'}
          </p>
        </section>

        <section className="detail-section audit-section" aria-labelledby={`audit-history-heading-${session.id}`}>
          <div className="detail-section-heading">
            <div>
              <h3 id={`audit-history-heading-${session.id}`}>Audit history</h3>
              <span>Newest first</span>
            </div>
            {historyLoading && <RefreshCw size={16} className="spin" aria-label="Loading audit history" />}
          </div>
          {historyError && <p className="error" role="alert">{historyError}</p>}
          {!historyLoading && !historyError && orderedHistory.length === 0 && (
            <p className="empty">No trainer changes have been recorded for this session.</p>
          )}
          {!historyError && orderedHistory.length > 0 && (
            <ol className="history-list">
              {orderedHistory.map((entry) => (
                <li key={entry.id}>
                  <div className="history-entry-heading">
                    <strong>{formatHistoryAction(entry.action)}</strong>
                    <time dateTime={entry.createdAt}>{formatHistoryTime(entry.createdAt)}</time>
                  </div>
                  <span>By {entry.actor?.displayName ?? entry.actor?.email ?? entry.actor?.id ?? 'Unknown actor'}</span>
                  <div className="history-transition">
                    <span>{entry.previousTrainer?.name ?? entry.previousTrainer?.id ?? 'Unassigned'}</span>
                    <ChevronRight size={14} aria-hidden="true" />
                    <span>{entry.newTrainer?.name ?? entry.newTrainer?.id ?? 'Unassigned'}</span>
                  </div>
                  {entry.note && <p>{entry.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="detail-provenance">
          <span className="provenance-label">{session.managementSource === 'import' ? 'Imported from Excel' : 'Managed in Training Planner'}</span>
          <span>External ref <code>{session.externalRef ?? '—'}</code></span>
        </footer>
      </aside>
    </div>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function getRoomLabel(session: PlanningSession): string {
  if (session.room.name) return session.room.name;
  if (session.venue.type === 'external') return 'Not needed (external venue)';
  return 'No room assigned';
}

function getIssueCount(session: PlanningSession): number {
  return issueDetails.filter((issue) => session.issues[issue.key]).length;
}
