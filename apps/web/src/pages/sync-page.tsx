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
      void onApiError(caught, setError);
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
