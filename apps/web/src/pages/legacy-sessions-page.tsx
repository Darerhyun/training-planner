import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { RefreshCw } from 'lucide-react';
import { fetchSessions, type ApiSession } from '../api.js';

type ApiErrorHandler = (error: unknown, setError: (message: string) => void) => Promise<void>;

export default function LegacySessionsPage({ user, onApiError }: { user: User; onApiError: ApiErrorHandler }) {
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
      void onApiError(caught, setError);
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
