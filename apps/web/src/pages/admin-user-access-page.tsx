import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { RefreshCw } from 'lucide-react';
import {
  ApiError,
  fetchAdminInvitations,
  fetchAdminUserHistory,
  fetchAdminUsers,
  createAdminInvitation,
  cancelAdminInvitation,
  updateAdminUser,
  type AdminUser,
  type UserAccessEvent,
  type UserInvitation,
} from '../api.js';
import { sendInvitationMagicLink } from '../firebase.js';

type AdminUserView = 'pending' | 'active' | 'deactivated' | 'rejected';

const adminUserViews: Array<{ key: AdminUserView; label: string; emptyMessage: string }> = [
  { key: 'pending', label: 'Pending', emptyMessage: 'No accounts are waiting for approval.' },
  { key: 'active', label: 'Active', emptyMessage: 'No active accounts.' },
  { key: 'deactivated', label: 'Deactivated', emptyMessage: 'No deactivated accounts.' },
  { key: 'rejected', label: 'Rejected', emptyMessage: 'No rejected accounts.' },
];

export default function AdminUserAccessPage({ user }: { user: User }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [userView, setUserView] = useState<AdminUserView>('pending');
  const [history, setHistory] = useState<UserAccessEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'ops' | 'finance' | 'viewer'>('ops');
  const [note, setNote] = useState('');
  const [accessNote, setAccessNote] = useState('');
  const [pendingDelivery, setPendingDelivery] = useState('');
  const [approvalRoles, setApprovalRoles] = useState<Record<string, 'admin' | 'ops' | 'finance' | 'viewer'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const usersByView = useMemo<Record<AdminUserView, AdminUser[]>>(() => ({
    pending: users.filter((item) => item.role === 'pending'),
    active: users.filter((item) => item.role !== 'pending' && item.role !== 'rejected' && item.is_active),
    deactivated: users.filter((item) => item.role !== 'pending' && item.role !== 'rejected' && !item.is_active),
    rejected: users.filter((item) => item.role === 'rejected'),
  }), [users]);
  const visibleUsers = usersByView[userView];
  const currentView = adminUserViews.find((item) => item.key === userView) ?? adminUserViews[0];
  const openInvitationCount = useMemo(
    () => invitations.filter((item) => item.status === 'pending').length,
    [invitations],
  );

  const load = async () => {
    setBusy(true); setError('');
    try { const [nextUsers, nextInvitations] = await Promise.all([fetchAdminUsers(user), fetchAdminInvitations(user)]); setUsers(nextUsers); setInvitations(nextInvitations); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load access records'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [user]);
  const act = async (target: AdminUser, action: string, nextRole?: string) => {
    const proposedRole = nextRole ?? (action === 'reject' ? 'rejected' : target.role);
    const proposedActive = action === 'deactivate' || action === 'reject' ? false : action === 'reactivate' || action === 'approve' ? true : target.is_active;
    if (!window.confirm(`Confirm access change for ${target.email}?\n\nCurrent: ${target.role}, ${target.is_active ? 'active' : 'inactive'}\nProposed: ${proposedRole}, ${proposedActive ? 'active' : 'inactive'}${accessNote ? `\nNote: ${accessNote}` : ''}`)) return;
    setBusy(true); setError(''); setMessage('');
    try { const updated = await updateAdminUser(user, target.id, { expectedVersion: target.version, action, role: nextRole, note: accessNote || undefined }); setUsers((current) => current.map((item) => item.id === updated.id ? updated : item)); setSelected(updated); setAccessNote(''); setMessage('Access updated.'); if (selected?.id === updated.id) setHistory(await fetchAdminUserHistory(user, updated.id)); }
    catch (err) { setError(adminAccessError(err, 'Access update failed; reload and try again.')); }
    finally { setBusy(false); }
  };
  const invite = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage(''); setPendingDelivery('');
    const normalizedEmail = email.trim().toLowerCase();
    try {
      await createAdminInvitation(user, { email: normalizedEmail, intendedRole: role, note: note || undefined });
      setPendingDelivery(normalizedEmail); setEmail(''); setNote('');
      try { await sendInvitationMagicLink(normalizedEmail); setPendingDelivery(''); setMessage('Invitation created and sign-in link sent.'); }
      catch { setError('Invitation record saved, but the email link was not sent. Retry delivery below.'); }
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Invitation failed'); await load(); }
    finally { setBusy(false); }
  };
  const retryDelivery = async () => {
    if (!pendingDelivery) return;
    setBusy(true); setError('');
    try { await sendInvitationMagicLink(pendingDelivery); setPendingDelivery(''); setMessage('Invitation link sent.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Email delivery failed; retry again.'); }
    finally { setBusy(false); }
  };
  const approvalRoleFor = (target: AdminUser) => approvalRoles[target.id] ?? invitations.find((item) => item.email === target.email && item.status === 'pending')?.intended_role ?? 'ops';
  const selectUser = async (target: AdminUser) => { setSelected(target); setHistory([]); setHistoryError(''); setHistoryLoading(true); try { setHistory(await fetchAdminUserHistory(user, target.id)); } catch (err) { setHistoryError(err instanceof Error ? err.message : 'Unable to load access history.'); } finally { setHistoryLoading(false); } };
  const cancelInvite = async (item: UserInvitation) => {
    const cancellationNote = window.prompt('Optional cancellation note (500 characters maximum):', '');
    if (cancellationNote === null) return;
    if (cancellationNote.length > 500) { setError('Cancellation note must be at most 500 characters.'); return; }
    try { await cancelAdminInvitation(user, item.id, item.version, cancellationNote); await load(); }
    catch (err) { setError(adminAccessError(err, 'Cancellation failed; reload and try again.')); }
  };
  return <section className="admin-access-grid">
    <div className="panel admin-panel">
      <div className="panel-heading row-heading"><div><span className="eyebrow">Controlled access</span><h2>Admin User Access</h2><span>Approve people explicitly; invitations never grant a role automatically.</span></div><button className="icon-button" onClick={() => void load()} disabled={busy} aria-label="Refresh access records"><RefreshCw size={17} className={busy ? 'spin' : ''} /></button></div>
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
      <form className="admin-invite-form" onSubmit={invite}>
        <label htmlFor="invite-email">Email<input id="invite-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label htmlFor="invite-role">Intended role<select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="admin">Admin</option><option value="ops">Ops</option><option value="finance">Finance</option><option value="viewer">Viewer</option></select></label>
        <label htmlFor="invite-note">Invite note (optional)<textarea id="invite-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /><span>{note.length}/500 characters</span></label>
        <button className="primary" type="submit" disabled={busy}>Invite</button>
      </form>
      <div className="admin-access-note"><label htmlFor="admin-access-note">Change note (optional)<textarea id="admin-access-note" maxLength={500} value={accessNote} onChange={(event) => setAccessNote(event.target.value)} placeholder="Explain this access change" /></label><span>{accessNote.length}/500 characters</span></div>
      {pendingDelivery && <p className="warning" role="alert">Invitation saved for {pendingDelivery}, but the email link was not sent. <button className="small-button" onClick={() => void retryDelivery()} disabled={busy}>Retry email</button></p>}
      <div className="admin-access-metrics" aria-label="Access summary">
        {adminUserViews.map((item) => <button key={item.key} type="button" className={`admin-access-metric${userView === item.key ? ' active' : ''}`} onClick={() => setUserView(item.key)} aria-pressed={userView === item.key}><span>{item.label}</span><strong>{usersByView[item.key].length}</strong></button>)}
        <div className="admin-access-metric invitation-metric"><span>Open invitations</span><strong>{openInvitationCount}</strong></div>
      </div>
      <div className="admin-state-tabs" role="tablist" aria-label="User account state">
        {adminUserViews.map((item) => <button key={item.key} id={`admin-${item.key}-tab`} type="button" role="tab" aria-selected={userView === item.key} aria-controls="admin-users-panel" className={userView === item.key ? 'active' : ''} onClick={() => setUserView(item.key)}>{item.label}<span>{usersByView[item.key].length}</span></button>)}
      </div>
      <div id="admin-users-panel" role="tabpanel" aria-labelledby={`admin-${userView}-tab`}>
        <div className="admin-list-heading"><h3>{currentView.label} accounts</h3><span>{visibleUsers.length} {visibleUsers.length === 1 ? 'account' : 'accounts'}</span></div>
        {visibleUsers.length === 0 ? <p className="empty admin-user-empty">{currentView.emptyMessage}</p> : <div className="admin-table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Version</th><th>Actions</th></tr></thead><tbody>{visibleUsers.map((item) => <tr key={item.id} onClick={() => void selectUser(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') void selectUser(item); }}><td data-label="Account"><strong>{item.email}</strong><span>{item.display_name || 'No display name'}</span></td><td data-label="Role">{item.role}</td><td data-label="Status">{item.role === 'pending' ? 'Pending' : item.role === 'rejected' ? 'Rejected' : item.is_active ? 'Active' : 'Deactivated'}</td><td data-label="Version">{item.version}</td><td data-label="Actions" className="admin-actions">{(item.role === 'pending' || item.role === 'rejected') && <><select aria-label={`Proposed role for ${item.email}`} value={approvalRoleFor(item)} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); setApprovalRoles((current) => ({ ...current, [item.id]: event.target.value as typeof role })); }}><option value="admin">Admin</option><option value="ops">Ops</option><option value="finance">Finance</option><option value="viewer">Viewer</option></select><button className="small-button" onClick={(event) => { event.stopPropagation(); void act(item, 'approve', approvalRoleFor(item)); }}>Approve</button></>}{item.role === 'pending' && <button className="small-button" onClick={(event) => { event.stopPropagation(); void act(item, 'reject'); }}>Reject</button>}{item.role !== 'pending' && item.role !== 'rejected' && item.is_active && <select aria-label={`Change role for ${item.email}`} value={item.role} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void act(item, 'change_role', event.target.value); }}><option value="admin">Admin</option><option value="ops">Ops</option><option value="finance">Finance</option><option value="viewer">Viewer</option></select>}{item.role !== 'pending' && item.role !== 'rejected' && item.is_active && <button className="small-button" onClick={(event) => { event.stopPropagation(); void act(item, 'deactivate'); }}>Deactivate</button>}{item.role !== 'pending' && item.role !== 'rejected' && !item.is_active && <button className="small-button" onClick={(event) => { event.stopPropagation(); void act(item, 'reactivate'); }}>Reactivate</button>}</td></tr>)}</tbody></table></div>}
      </div>
    </div>
    <aside className="panel admin-side-panel" id="admin-invitations"><span className="eyebrow">Open invitations</span><h3>Invitation history</h3>{invitations.length === 0 && <p className="empty">No invitations yet.</p>}{invitations.map((item) => <div className="invitation-card" key={item.id}><strong>{item.email}</strong><span>{item.intended_role} · {item.status} · v{item.version}</span><span>Invited by {item.inviter?.displayName || item.inviter?.email || item.invited_by || 'Unknown'} · {new Date(item.created_at).toLocaleString()}</span>{item.note && <p>{item.note}</p>}{item.claimed_at && <span>Claimed by {item.claimer?.displayName || item.claimer?.email || item.claimed_by || 'Unknown'} · {new Date(item.claimed_at).toLocaleString()}</span>}{item.cancelled_at && <span>Cancelled by {item.canceller?.displayName || item.canceller?.email || item.cancelled_by || 'Unknown'} · {new Date(item.cancelled_at).toLocaleString()}</span>}{item.status === 'pending' && <button className="small-button" onClick={() => void cancelInvite(item)}>Cancel</button>}</div>)}{selected && <><span className="eyebrow">Immutable history</span><h3>{selected.email}</h3>{historyLoading && <p className="empty">Loading access history...</p>}{historyError && <p className="error" role="alert">{historyError}</p>}{!historyLoading && !historyError && history.length === 0 && <p className="empty">No history recorded for this user.</p>}{!historyLoading && !historyError && history.map((event) => <div className="history-item" key={event.id}><strong>{event.action}</strong><span>{new Date(event.created_at).toLocaleString()} · by {event.actor?.displayName || event.actor?.email || event.actor?.id || event.actor_user_id} · target {event.target_email ?? selected.email}</span><span>Role: {event.previous_role ?? '-'} → {event.new_role ?? '-'} · access: {event.previous_is_active == null ? '-' : event.previous_is_active ? 'active' : 'inactive'} → {event.new_is_active == null ? '-' : event.new_is_active ? 'active' : 'inactive'}</span><span>Version: {event.previous_version ?? '-'} → {event.new_version ?? '-'}</span>{event.note && <p>{event.note}</p>}</div>)}</>}</aside>
  </section>;
}

function adminAccessError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === 'stale_user_invitation_version') return 'This invitation changed after you opened it. Reload before cancelling.';
  if (error instanceof ApiError && error.code === 'stale_user_version') return 'This user changed after you opened it. Reload before applying access changes.';
  return error instanceof Error ? error.message : fallback;
}
