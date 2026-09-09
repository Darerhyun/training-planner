import { useState } from 'react';
import type { User } from 'firebase/auth';
import { Check, RefreshCw, Upload, X } from 'lucide-react';
import {
  cancelSchedule,
  confirmSchedule,
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

  const canApply = Boolean(
    result?.uploadBatchId &&
      result.summary.requiresConfirmation &&
      !result.summary.blocked &&
      !result.applied,
  );
  const canCancel = Boolean(result?.uploadBatchId && !result.applied);

  async function submitUpload() {
    if (!file) return;
    setBusy(true);
    setError('');
    setAcknowledged(false);
    try {
      setResult(await uploadMasterSchedule(user, file));
    } catch (caught) {
      void onApiError(caught, setError);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!result?.uploadBatchId || !canApply) return;
    setBusy(true);
    setError('');
    try {
      setResult(await confirmSchedule(user, result.uploadBatchId, {
        previewDigest: result.previewDigest,
        acknowledged,
      }));
    } catch (caught) {
      void onApiError(caught, setError);
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
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel result-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Import review</span>
            <h2>Parse result</h2>
          </div>
          {result?.applied && <span className="badge good">Applied</span>}
          {result && !result.applied && result.summary.blocked && <span className="badge warn">Blocked</span>}
          {result && !result.applied && !result.summary.blocked && <span className="badge warn">Preview</span>}
        </div>
        {result ? <Summary result={result} /> : <p className="empty">No parse result yet.</p>}
        {result?.summary.blocked && !result.applied && (
          <p className="error" role="alert">
            Apply is blocked until the issues in this Preview are resolved in a later review.
          </p>
        )}
        {canApply && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={acknowledged}
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
        {result?.uploadBatchId && result.summary.requiresConfirmation && !result.applied && (
          <div className="action-row">
            {canApply && <button disabled={busy || !acknowledged} onClick={confirm}>
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
      {summary.blockReason && <p className="error" role="alert">{summary.blockReason}</p>}
      {result.applied && <p className="message">Applied {result.applied.applied} rows.</p>}
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
