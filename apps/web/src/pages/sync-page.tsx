import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { Check, RefreshCw, Upload, X } from 'lucide-react';
import {
  cancelSchedule,
  confirmSchedule,
  recheckSchedule,
  uploadMasterSchedule,
  type ParseResult,
} from '../api.js';

type ApiErrorHandler = (error: unknown, setError: (message: string) => void) => Promise<void>;

export default function SyncPage({ user, onApiError }: { user: User; onApiError: ApiErrorHandler }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<(ParseResult & { uploadBatchId?: string }) | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [previewStale, setPreviewStale] = useState(false);
  const [skipReasons, setSkipReasons] = useState<Record<string, string>>({});
  const confirmAlert = useRef<HTMLParagraphElement>(null);
  const resultNotice = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!confirmError || busy) return;
    confirmAlert.current?.focus();
    confirmAlert.current?.scrollIntoView({ block: 'nearest' });
  }, [confirmError, busy]);

  useEffect(() => {
    if (!resultMessage || confirmError || busy) return;
    resultNotice.current?.focus();
  }, [resultMessage, confirmError, busy]);

  const canApply = Boolean(
    result?.uploadBatchId &&
      result.summary.requiresConfirmation &&
      !result.summary.blocked &&
      !result.applied &&
      result.resolution.rechecked &&
      !previewStale,
  );
  const canCancel = Boolean(result?.uploadBatchId && !result.applied);

  async function submitUpload() {
    if (!file) return;
    setBusy(true);
    setError('');
    setAcknowledged(false);
    try {
      const uploaded = await uploadMasterSchedule(user, file);
      setResult(uploaded);
      setSkipReasons(Object.fromEntries(uploaded.resolution.decisions.map((decision) => [decision.sourceRowId, decision.reason])));
      setConfirmError('');
      setResultMessage('');
      setPreviewStale(false);
    } catch (caught) {
      void onApiError(caught, setError);
    } finally {
      setBusy(false);
    }
  }

  function updateSkip(sourceRowId: string, reason: string | null) {
    setSkipReasons((current) => {
      const next = { ...current };
      if (reason === null) delete next[sourceRowId];
      else next[sourceRowId] = reason;
      return next;
    });
    setAcknowledged(false);
    setPreviewStale(true);
    setConfirmError('');
    setResultMessage('');
  }

  async function recheck() {
    if (!result?.uploadBatchId || result.applied || busy) return;
    setBusy(true);
    setError('');
    setConfirmError('');
    setResultMessage('');
    setAcknowledged(false);
    try {
      const checked = await recheckSchedule(user, result.uploadBatchId, {
        previewDigest: result.previewDigest,
        decisions: Object.entries(skipReasons).map(([sourceRowId, reason]) => ({ sourceRowId, action: 'skip', reason })),
      });
      setResult({ ...checked, uploadBatchId: result.uploadBatchId });
      setSkipReasons(Object.fromEntries(checked.resolution.decisions.map((decision) => [decision.sourceRowId, decision.reason])));
      setPreviewStale(false);
      setResultMessage('Re-check complete. Review this current Preview before acknowledging it.');
    } catch (caught) {
      setPreviewStale(true);
      setConfirmError('Re-check could not be completed. The last stored Preview is unchanged.');
      await onApiError(caught, setConfirmError);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!result?.uploadBatchId || !canApply || previewStale || !acknowledged || busy) return;
    setBusy(true);
    setError('');
    setConfirmError('');
    setResultMessage('');
    try {
      const applied = await confirmSchedule(user, result.uploadBatchId, {
        previewDigest: result.previewDigest,
        acknowledged,
      });
      setResult({ ...applied, uploadBatchId: result.uploadBatchId });
      setResultMessage(`Applied ${applied.applied?.applied ?? 0} rows.`);
    } catch (caught) {
      setAcknowledged(false);
      setPreviewStale(true);
      setConfirmError('Confirmation could not be completed. Run Re-check before trying to apply again.');
      await onApiError(caught, setConfirmError);
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
      setAcknowledged(false);
      setConfirmError('');
      setResultMessage('');
      setPreviewStale(false);
      setSkipReasons({});
    } catch (caught) {
      void onApiError(caught, setError);
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
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div className="panel result-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Import review</span>
            <h2>Parse result</h2>
          </div>
          {result?.applied && <span className="badge good">Applied</span>}
          {result && !result.applied && previewStale && <span className="badge warn">Stale</span>}
          {result && !result.applied && !previewStale && result.summary.blocked && <span className="badge warn">Blocked</span>}
          {result && !result.applied && !previewStale && !result.summary.blocked && <span className="badge warn">Preview</span>}
        </div>
        {result ? <Summary result={result} skipReasons={skipReasons} onSkipChange={updateSkip} disabled={busy} /> : <p className="empty">No parse result yet.</p>}
        {result?.summary.blocked && !result.applied && (
          <p className="error" role="alert">
            Apply is blocked. Repair Admin Reference data or use an available reasoned Skip, then run Re-check.
          </p>
        )}
        {canApply && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy || previewStale}
              onChange={(event) => setAcknowledged(event.target.checked)}
              aria-describedby="sync-preview-acknowledgement-help"
            />
            I acknowledge this exact Preview and want to apply it.
          </label>
        )}
        {canApply && (
          <p className="field-help" id="sync-preview-acknowledgement-help">
            Applying writes the stored Preview as one transaction. Any changed Preview must be reviewed again.
          </p>
        )}
        {confirmError && (
          <p className="error" role="alert" tabIndex={-1} ref={confirmAlert}>
            This Preview cannot be applied until recovery succeeds. {confirmError}
          </p>
        )}
        {resultMessage && (
          <p className="message" role="status" tabIndex={-1} ref={resultNotice}>{resultMessage}</p>
        )}
        {result?.uploadBatchId && result.summary.requiresConfirmation && !result.applied && (
          <div className="action-row">
            <button className="secondary" disabled={busy || Object.values(skipReasons).some((reason) => !reason.trim() || reason.trim().length > 500)} onClick={recheck}>
              <RefreshCw size={16} />
              Re-check
            </button>
            {canApply && <button disabled={busy || previewStale || !acknowledged} onClick={confirm}>
              <Check size={16} />
              Apply Preview
            </button>}
            {canCancel && <button className="secondary" disabled={busy} onClick={cancel}>
              <X size={16} />
              Cancel
            </button>}
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ result, skipReasons, onSkipChange, disabled }: {
  result: ParseResult;
  skipReasons: Record<string, string>;
  onSkipChange: (sourceRowId: string, reason: string | null) => void;
  disabled: boolean;
}) {
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
      {summary.blockReason && <p className="error" role="alert">{summary.blockReason}</p>}
      {!result.applied && !result.resolution.rechecked && (
        <p className="message">Run Re-check to validate this Preview against current reference data before acknowledgement is available.</p>
      )}
      {result.resolution.cancellation.numerator > 0 && (
        <section className="sync-cancellation-evidence" aria-labelledby="sync-cancellation-heading">
          <h3 id="sync-cancellation-heading">Explicit cancellation scope</h3>
          <p>{result.resolution.cancellation.numerator} source rows out of {result.resolution.cancellation.denominator} existing imported sessions.</p>
          <p>{result.resolution.cancellation.sessionIds.length} existing sessions correspond to those source rows. Cancelled inserts and already-cancelled matches remain in the source-row count.</p>
          {result.resolution.cancellation.hardBlocked && <p className="error">More than 50% is a hard block. No override is available.</p>}
        </section>
      )}
      {result.alerts.length > 0 && (
        <section aria-labelledby="schedule-alerts-heading">
          <h3 id="schedule-alerts-heading">Preview issues ({result.alerts.length})</h3>
          <div className="alert-list" role="list" aria-label="Schedule Preview issues">
            {result.alerts.map((alert, index) => {
              const blocking = isBlockingAlertCode(alert.code);
              return (
                <div
                  className="alert-row"
                  key={`${alert.rowNumber}-${alert.code}-${alert.rawValue ?? 'blank'}-${index}`}
                  role="listitem"
                >
                  <span>Row {alert.rowNumber}</span>
                  <strong>{blocking ? 'Blocking' : 'Warning'}: {formatAlertCode(alert.code)}</strong>
                  <em>{alert.rawValue ?? 'blank'} — {alert.message}</em>
                </div>
              );
            })}
          </div>
        </section>
      )}
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
      {!result.applied && result.resolution.outcomes.some((outcome) => outcome.canSkip || outcome.outcome === 'skipped') && (
        <section aria-labelledby="sync-row-decisions-heading">
          <h3 id="sync-row-decisions-heading">Row resolution</h3>
          <p className="field-help">Skips apply only to this batch, retain source presence, and never create, update, or cancel a session.</p>
          <div className="sync-resolution-list">
            {result.resolution.outcomes.filter((outcome) => outcome.canSkip || outcome.outcome === 'skipped').map((outcome) => {
              const selected = Object.prototype.hasOwnProperty.call(skipReasons, outcome.sourceRowId);
              const reason = skipReasons[outcome.sourceRowId] ?? '';
              return (
                <article className="sync-resolution-row" key={outcome.sourceRowId}>
                  <div>
                    <strong>Workbook row {outcome.rowNumber}</strong>
                    <span>{outcome.externalRef ?? 'Source correspondence pending'}</span>
                    {outcome.issues.map((issue) => <p key={issue}>{issue}</p>)}
                  </div>
                  {selected ? (
                    <div className="sync-skip-control">
                      <label htmlFor={`skip-${outcome.sourceRowId}`}>Skip reason</label>
                      <textarea
                        id={`skip-${outcome.sourceRowId}`}
                        value={reason}
                        maxLength={500}
                        disabled={disabled}
                        onChange={(event) => onSkipChange(outcome.sourceRowId, event.target.value)}
                      />
                      <span>{reason.trim().length}/500</span>
                      <button className="secondary" disabled={disabled} onClick={() => onSkipChange(outcome.sourceRowId, null)}>Restore row</button>
                    </div>
                  ) : (
                    <button className="secondary" disabled={disabled} onClick={() => onSkipChange(outcome.sourceRowId, '')}>Skip row</button>
                  )}
                </article>
              );
            })}
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

function isBlockingAlertCode(code: string): boolean {
  return new Set([
    'course_not_supplied',
    'unknown_course',
    'unknown_trainer',
    'unknown_venue',
    'unknown_room',
    'start_date_not_supplied',
    'invalid_start_date',
    'end_date_not_supplied',
    'invalid_end_date',
    'invalid_date_range',
    'invalid_expected_pax',
    'invalid_confirmed_pax',
    'status_not_supplied',
    'invalid_status',
  ]).has(code);
}

function formatAlertCode(code: string): string {
  return code
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
