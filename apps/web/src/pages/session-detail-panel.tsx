import { useEffect, useState } from 'react';
import type { ComponentType, FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { Check, RefreshCw, X } from 'lucide-react';
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
  formatHistoryAction,
  formatHistoryTime,
  formatMonths,
  formatNumber,
  formatPercent,
  profileSourceLabels,
} from '../lib/format.js';

type ActiveRole = 'admin' | 'ops' | 'finance' | 'viewer';
type ApiErrorHandler = (error: unknown, setError: (message: string) => void) => Promise<void>;
type SessionRenderer = ComponentType<{ session: PlanningSession }>;

export default function SessionDetailPanel({
  user,
  role,
  session,
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
  onClose: () => void;
  onReload: () => void;
  onSessionUpdated: (session: PlanningSession) => void;
  onApiError: ApiErrorHandler;
  IssueBadges: SessionRenderer;
  PlanningProfileAnnotation: SessionRenderer;
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
        if (!cancelled) void onApiError(error, setHistoryError);
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
          if (!cancelled) void onApiError(error, setOptionsError);
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
        void onApiError(historyFailure, setHistoryError);
      } finally {
        setHistoryLoading(false);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_session_version') {
        setTrainerError('This session changed after you opened it. Reload the session before saving again.');
        setReloadRequired(true);
      } else {
        void onApiError(error, setTrainerError);
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
