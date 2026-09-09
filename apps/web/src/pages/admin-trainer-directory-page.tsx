import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  ApiError, createAdminTrainer, fetchAdminTrainer, fetchAdminTrainerHistory, fetchAdminTrainers,
  fetchTrainerCourses, fetchTrainerImpact, fetchTrainerSnapshot, mutateAdminTrainer,
  type TrainerAlias, type TrainerCourse, type TrainerDetail, type TrainerExclusion,
  type TrainerHistory, type TrainerLink, type TrainerList, type TrainerMutation, type TrainerState,
} from '../api.js';

const labels: Record<TrainerState, string> = { ready: 'Ready', needs_setup: 'Needs setup', inactive: 'Inactive' };
const sourceLabel = (source: string | null) => source === 'rate_excel' ? 'Rate workbook' : source === 'tms' || source === 'schedule_excel' ? 'Master schedule' : 'Admin entry';
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(date));
const stateOf = (trainer: { is_active: boolean; scheduling_readiness: 'ready' | 'needs_setup' }): TrainerState => trainer.is_active ? trainer.scheduling_readiness : 'inactive';
const focusLater = (target: HTMLElement | null) => requestAnimationFrame(() => target?.isConnected && target.focus());
export const hasTrainerDialogInput = (name: string, note: string) => name.length > 0 || note.length > 0;
export const trainerSetupBlocker = (eligibleCount: number) => eligibleCount === 0 ? 'No eligible courses' : 'Not yet confirmed';
export const trainerAccessDenied = (failure: unknown) => failure instanceof ApiError && failure.status === 403;
export function trainerAliasFocusTarget<T>(remaining: ArrayLike<T>, removedIndex: number, addAlias: T | null): T | null {
  return remaining[removedIndex] ?? addAlias;
}
export function restoreTrainerFocus(opener: { isConnected: boolean; focus: () => void } | null, fallback: { isConnected: boolean; focus: () => void } | null) {
  (opener?.isConnected ? opener : fallback?.isConnected ? fallback : null)?.focus();
}

function Tabs<T extends string>({ values, active, change, label, counts }: { values: T[]; active: T; change: (value: T) => void; label: string; counts?: Record<T, number> }) {
  return <div className="trainer-tabs" role="tablist" aria-label={label}>{values.map((value, index) => <button key={value} role="tab" aria-selected={active === value} tabIndex={active === value ? 0 : -1} onClick={() => change(value)} onKeyDown={(event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
    change(values[next]); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
  }}>{labels[value as TrainerState] ?? value}{counts && <span className="trainer-count">{counts[value]}</span>}</button>)}</div>;
}

function Modal({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input, textarea, button')?.focus(); }, []);
  return <div className="trainer-modal-backdrop"><div ref={ref} className="trainer-modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => trap(event, ref.current, () => { if (!busy) close(); })}><h3>{title}</h3>{children}</div></div>;
}
function trap(event: KeyboardEvent, root: HTMLElement | null, close: () => void) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  if (event.key !== 'Tab') return;
  const nodes = [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])].filter((node) => node.getClientRects().length);
  const first = nodes[0]; const last = nodes.at(-1);
  if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus(); }
}

function CoursePicker({ title, courses, added, add, disabled }: { title: string; courses: TrainerCourse[]; added: string[]; add: (course: TrainerCourse) => void; disabled: boolean }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [index, setIndex] = useState(0);
  const matches = courses.filter((course) => `${course.code} ${course.name}`.toLowerCase().includes(query.toLowerCase()));
  const id = title.replaceAll(' ', '-');
  return <div className="trainer-course-picker"><label htmlFor={id}>{title}</label><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && matches[index] ? `${id}-${index}` : undefined} value={query} disabled={disabled} placeholder="Search course code or title" onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true); }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setIndex((value) => Math.max(0, Math.min(matches.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))); }
    if (event.key === 'Enter' && open && matches[index]) { event.preventDefault(); if (!added.includes(matches[index].code)) add(matches[index]); setOpen(false); setQuery(''); }
  }} />{open && <ul id={`${id}-list`} role="listbox" aria-label={title}>{matches.map((course, position) => <li key={course.code} id={`${id}-${position}`} role="option" aria-selected={position === index} aria-disabled={added.includes(course.code)} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (!added.includes(course.code)) add(course); setOpen(false); setQuery(''); }}><strong>{course.code}</strong> {course.name} {added.includes(course.code) && '— Added'}</li>)}{!matches.length && <li>No canonical courses match "{query}".</li>}</ul>}</div>;
}

function historyLines(event: TrainerHistory): string[] {
  const metadata = event.metadata;
  if (event.action === 'alias_added' || event.action === 'alias_removed') return [`"${String(metadata.aliasName ?? '')}" · ${sourceLabel(typeof metadata.source === 'string' ? metadata.source : null)}`];
  const lines: string[] = [];
  for (const [key, label] of [['linksAdded', 'Added'], ['linksRemoved', 'Removed'], ['exclusionsAdded', 'Added exclusion'], ['exclusionsRemoved', 'Removed exclusion']] as const) {
    if (Array.isArray(metadata[key])) for (const value of metadata[key]) lines.push(`${label} ${typeof value === 'string' ? value : String(value.course_code ?? value.courseCode ?? '')}`);
  }
  // FIX: eligibility events expose separate enabled/disabled arrays.
  for (const [key, label] of [['smeEnabled', 'enabled'], ['smeDisabled', 'disabled']] as const) {
    if (Array.isArray(metadata[key])) for (const code of metadata[key]) lines.push(`Subject matter expert ${label} on ${String(code)}`);
  }
  if (metadata.readinessReset) lines.push('Readiness reset: Ready → Needs setup');
  if (event.action === 'trainer_updated') {
    for (const key of ['name', 'notes']) {
      const before = metadata.before as Record<string, unknown> | undefined; const after = metadata.after as Record<string, unknown> | undefined;
      if (before?.[key] !== after?.[key]) lines.push(`${key === 'name' ? 'Name' : 'Notes'}: ${String(before?.[key] ?? 'Not recorded')} → ${String(after?.[key] ?? 'Not recorded')}`);
    }
  }
  return lines;
}

type Dialog = 'register' | 'alias' | 'remove' | 'deactivate' | 'reactivate' | 'ready' | null;
export default function AdminTrainerDirectoryPage({ user, onApiError, onDirtyChange }: { user: User; onApiError: (error: unknown, setError: (message: string) => void) => Promise<void>; onDirtyChange: (dirty: boolean) => void }) {
  const [state, setState] = useState<TrainerState>('needs_setup'); const [query, setQuery] = useState(''); const [search, setSearch] = useState('');
  const [list, setList] = useState<TrainerList | null>(null); const [listLoading, setListLoading] = useState(false); const [listError, setListError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false); const [restoreFocusVersion, setRestoreFocusVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null); const [detail, setDetail] = useState<TrainerDetail | null>(null); const [history, setHistory] = useState<TrainerHistory[]>([]);
  const [detailLoading, setDetailLoading] = useState(false); const [detailError, setDetailError] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'Overview' | 'Eligibility' | 'History'>('Overview'); const [busy, setBusy] = useState(false); const [stale, setStale] = useState(false);
  const [name, setName] = useState(''); const [notes, setNotes] = useState(''); const [links, setLinks] = useState<TrainerLink[]>([]); const [exclusions, setExclusions] = useState<TrainerExclusion[]>([]);
  const [courses, setCourses] = useState<TrainerCourse[]>([]); const [courseError, setCourseError] = useState(''); const [ack, setAck] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null); const [dialogName, setDialogName] = useState(''); const [dialogNote, setDialogNote] = useState(''); const [dialogAck, setDialogAck] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<'opener' | 'error' | 'reload' | null>(null);
  const [alias, setAlias] = useState<TrainerAlias | null>(null); const [impact, setImpact] = useState<number | null>(null); const [impactError, setImpactError] = useState('');
  const opener = useRef<HTMLElement | null>(null); const dialogOpener = useRef<HTMLElement | null>(null); const searchRef = useRef<HTMLInputElement>(null); const drawer = useRef<HTMLElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const listEpoch = useRef(0); const detailEpoch = useRef(0); const landed = useRef(false);
  const profileDirty = !!detail && (name !== detail.name || notes !== (detail.notes ?? ''));
  const eligibilityDirty = !!detail && JSON.stringify([links.map((l) => [l.course_code, l.is_sme]).sort(), exclusions.map((e) => e.course_code).sort()]) !== JSON.stringify([detail.links.map((l) => [l.course_code, l.is_sme]).sort(), detail.exclusions.map((e) => e.course_code).sort()]);
  // FIX: stale dialogs retain their input even while the dialog is closed.
  const dirty = profileDirty || eligibilityDirty || hasTrainerDialogInput(dialogName, dialogNote);
  const blocked = busy || stale || detailLoading;
  const effective = links.filter((link) => !exclusions.some((entry) => entry.course_code === link.course_code));
  const resets = !!detail && (detail.links.some((old) => !links.some((next) => next.course_code === old.course_code)) || exclusions.some((next) => !detail.exclusions.some((old) => old.course_code === next.course_code)));
  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false); }, [dirty, busy, onDirtyChange]);
  useLayoutEffect(() => {
    // FIX: resolve connectivity only after React commits refreshed rows.
    if (restoreFocusVersion) restoreTrainerFocus(opener.current, searchRef.current);
  }, [restoreFocusVersion]);
  useLayoutEffect(() => {
    if (!pendingFocus || busy) return;
    if (pendingFocus === 'reload') drawer.current?.querySelector<HTMLElement>('[data-trainer-reload]')?.focus();
    else if (pendingFocus === 'opener') dialogOpener.current?.focus();
    else {
      const modal = document.querySelector<HTMLElement>('.trainer-modal');
      (modal ? modal.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled)') : drawer.current?.querySelector<HTMLElement>('input:not(:disabled)'))?.focus();
    }
    setPendingFocus(null);
  }, [pendingFocus, busy, dialog, stale]);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  function applyDetail(trainer: TrainerDetail, events: TrainerHistory[]) {
    setDialogName(''); setDialogNote('');
    setDetail(trainer); setHistory(events); setName(trainer.name); setNotes(trainer.notes ?? ''); setLinks(trainer.links); setExclusions(trainer.exclusions); setAck(trainer.exclusions_acknowledged_version === trainer.eligibility_version); setStale(false);
  }
  async function reportFailure(failure: unknown, setFailure: (message: string) => void) {
    // FIX: typed authorization failures hide all cached Admin-only content.
    if (trainerAccessDenied(failure)) {
      listEpoch.current++; detailEpoch.current++; setAccessDenied(true); setList(null); setDetail(null); setHistory([]); setCourses([]); setSelectedId(null); setDialog(null); setDialogName(''); setDialogNote('');
      return;
    }
    await onApiError(failure, setFailure);
  }
  async function loadList(more = false): Promise<TrainerList | null> {
    const epoch = ++listEpoch.current; setListLoading(true); setListError('');
    try {
      const result = await fetchAdminTrainers(user, { state, q: search, cursor: more ? list?.nextCursor ?? undefined : undefined });
      if (epoch !== listEpoch.current) return null;
      if (!landed.current) { landed.current = true; if (!result.counts.needs_setup) { setState('ready'); return result; } }
      setList(more ? { ...result, trainers: [...(list?.trainers ?? []), ...result.trainers] } : result); return result;
    } catch (failure) { if (epoch === listEpoch.current) { setList(null); await reportFailure(failure, setListError); } return null; }
    finally { if (epoch === listEpoch.current) setListLoading(false); }
  }
  useEffect(() => { void loadList(); return () => { listEpoch.current++; }; }, [state, search, user]);
  async function loadCourses() { try { setCourses(await fetchTrainerCourses(user)); setCourseError(''); } catch (failure) { await reportFailure(failure, setCourseError); } }
  useEffect(() => { void loadCourses(); }, [user]);
  async function unavailable() {
    detailEpoch.current++; setSelectedId(null); setDetail(null); setHistory([]); setDialog(null); setDialogName(''); setDialogNote(''); setError(''); setDetailError('');
    setMessage('This trainer is no longer available');
    await loadList();
    setRestoreFocusVersion((version) => version + 1);
  }
  async function loadDetail(id: string) {
    const epoch = ++detailEpoch.current; setDetailLoading(true); setDetailError(''); setError('');
    try {
      const [trainer, events, currentList] = await Promise.all([fetchAdminTrainer(user, id), fetchAdminTrainerHistory(user, id), fetchAdminTrainers(user, { state, q: search })]);
      if (epoch === detailEpoch.current) {
        // FIX: reload recovery stages list/counts alongside detail and History.
        listEpoch.current++; setList(currentList); setListLoading(false); applyDetail(trainer, events);
      }
    } catch (failure) {
      if (epoch !== detailEpoch.current) return;
      if (failure instanceof ApiError && failure.status === 404) await unavailable();
      else await reportFailure(failure, setDetailError);
    } finally { if (epoch === detailEpoch.current) setDetailLoading(false); }
  }
  function closeDrawer() {
    if (busy || dirty && !window.confirm('Discard unsaved trainer changes?')) return;
    detailEpoch.current++; setSelectedId(null); setDetail(null); setDialogName(''); setDialogNote(''); setError(''); setDetailLoading(false); focusLater(opener.current?.isConnected ? opener.current : searchRef.current);
  }
  function openTrainer(id: string, target: HTMLElement) { opener.current = target; setSelectedId(id); setDetail(null); setTab('Overview'); setMessage(''); void loadDetail(id); requestAnimationFrame(() => heading.current?.focus()); }
  function openDialog(next: Dialog, target: HTMLElement) { dialogOpener.current = target; setDialog(next); setDialogName(''); setDialogNote(''); setDialogAck(false); setError(''); }
  function closeDialog() { if (busy) return; setDialog(null); setDialogName(''); setDialogNote(''); setError(''); focusLater(dialogOpener.current); }
  async function checkImpact() {
    if (!detail) return; setImpact(null); setImpactError('');
    try { const result = await fetchTrainerImpact(user, detail.trainer_id); if (result.version !== detail.version) { setStale(true); setDialog(null); setError('This trainer changed. Reload trainer before deactivating.'); setPendingFocus('reload'); } else setImpact(result.upcomingSessionCount); }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) await unavailable();
      else if (failure instanceof ApiError && failure.code?.startsWith('stale_trainer')) { setStale(true); setDialog(null); setError('This trainer changed. Reload trainer before deactivating.'); setPendingFocus('reload'); }
      else await reportFailure(failure, setImpactError);
    }
  }
  async function save(input: TrainerMutation | null, success: string) {
    setBusy(true); setError(''); setMessage('');
    let savedId: string | null = null;
    const removedIndex = input?.action === 'remove-alias' ? detail?.aliases.findIndex((entry) => entry.id === input.aliasId) ?? 0 : -1;
    try {
      const saved = input && detail ? await mutateAdminTrainer(user, detail.trainer_id, detail.version, input) : await createAdminTrainer(user, { name: dialogName.trim(), notes: dialogNote });
      savedId = saved.trainer_id;
      const snapshot = await fetchTrainerSnapshot(user, saved.trainer_id, { state, q: search });
      listEpoch.current++; applyDetail(snapshot.trainer, snapshot.history); setList(snapshot.list); setSelectedId(saved.trainer_id); setDetailError(''); setDialog(null); setDialogName(''); setDialogNote('');
      setMessage(success);
      requestAnimationFrame(() => {
        // FIX: removing the last chip focuses Add alias, never the previous chip.
        if (removedIndex >= 0) { const buttons = drawer.current?.querySelectorAll<HTMLElement>('[data-alias-remove]'); trainerAliasFocusTarget(buttons ?? [], removedIndex, drawer.current?.querySelector<HTMLElement>('[data-add-alias]') ?? null)?.focus(); }
        else heading.current?.focus();
      });
    } catch (failure) {
      if (trainerAccessDenied(failure)) await reportFailure(failure, setError);
      else if (failure instanceof ApiError && failure.status === 404) await unavailable();
      else {
        // FIX: a committed write must never be retried after a refresh failure.
        if (savedId) {
          setStale(true); setSelectedId(savedId); setDialog(null); setDialogName(''); setDialogNote('');
          setPendingFocus('reload');
          setError('The change was saved, but the updated records could not be loaded. Reload trainer before making another change.');
          await reportFailure(failure, () => undefined);
          return;
        }
        await reportFailure(failure, setError);
        if (failure instanceof ApiError && failure.code?.startsWith('stale_trainer')) { setStale(true); setDialog(null); setPendingFocus('reload'); }
        else if (input?.action === 'remove-alias') { setDialog(null); setDialogName(''); setDialogNote(''); setPendingFocus('opener'); }
        else setPendingFocus('error');
      }
    } finally { setBusy(false); }
  }
  const modalTitle = dialog === 'register' ? 'Register trainer' : dialog === 'alias' ? 'Add alias' : dialog === 'remove' ? 'Remove alias' : dialog === 'ready' ? 'Confirm ready for scheduling' : dialog === 'deactivate' ? 'Deactivate trainer' : 'Reactivate trainer';
  if (accessDenied) return <section className="trainer-directory" aria-label="Trainer Directory"><h2>Trainer Directory</h2><p role="alert">Admin access is required for Trainer Directory.</p></section>;
  return <section className="trainer-directory" aria-label="Trainer Directory">
    <div className="trainer-heading"><div><span className="eyebrow">Trainer records</span><h2>Trainer Directory</h2><p>Manage who can teach each course and who is ready for scheduling.</p></div><div className="trainer-actions"><button className="secondary" aria-label="Refresh trainers" onClick={() => void loadList()} disabled={listLoading || busy}>↻</button><button onClick={(event) => { opener.current = event.currentTarget; openDialog('register', event.currentTarget); }}>Register trainer</button></div></div>
    <div role="status" className="trainer-status">{message}</div>
    <div className="trainer-search"><label htmlFor="trainer-search">Search trainers</label><input ref={searchRef} id="trainer-search" value={query} maxLength={200} placeholder="Name, alias, course code or course title" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setSearch(query.trim()); }} />{query && <button className="secondary" aria-label="Clear trainer search" onClick={() => { setQuery(''); setSearch(''); searchRef.current?.focus(); }}>Clear</button>}</div>
    <Tabs values={['ready', 'needs_setup', 'inactive']} active={state} change={setState} label="Trainer status" counts={listError ? undefined : list?.counts} />
    {listError ? <div role="alert"><p>{listError.includes('403') || listError.toLowerCase().includes('authorized') ? 'Admin access is required for Trainer Directory.' : 'Trainer records could not be loaded.'}</p><button className="secondary" onClick={() => void loadList()}>Retry</button></div> : <div aria-busy={listLoading}>
      <p role="status">{listLoading ? list ? 'Refreshing trainers…' : 'Loading trainers…' : `${list?.filteredCount ?? 0} trainers in ${labels[state]}`}</p>
      {!list && listLoading && <div className="trainer-skeletons">{[1, 2, 3, 4, 5].map((n) => <div key={n} className="trainer-skeleton" />)}</div>}
      {list && !list.trainers.length && <p className="empty">{search ? `No trainers match "${search}" in ${labels[state]}.` : state === 'ready' ? 'No trainers are ready for scheduling.' : state === 'needs_setup' ? 'No trainers need eligibility setup.' : 'No inactive trainers.'}{search && <button className="secondary" onClick={() => { setQuery(''); setSearch(''); }}>Clear search</button>}</p>}
      {!!list?.trainers.length && <><table className="trainer-table"><colgroup>{[29, 16, 14, 10, 13, 18].map((width) => <col key={width} style={{ width: `${width}%` }} />)}</colgroup><thead><tr>{['Trainer', 'Readiness', 'Eligible courses', 'Exclusions', 'Upcoming sessions', 'Last updated'].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>{list.trainers.map((row) => <tr key={row.trainer_id} tabIndex={0} aria-selected={selectedId === row.trainer_id} onClick={(event) => openTrainer(row.trainer_id, event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTrainer(row.trainer_id, event.currentTarget); } }}><td><strong>{row.name}</strong><small title={row.aliases.map((a) => a.alias_name).join(' · ')}>{row.aliases.map((a) => a.alias_name).join(' · ')}</small>{search && row.matched_course && <small>Matched course: {row.matched_course}</small>}</td><td><span className={`trainer-pill ${stateOf(row)}`}>{labels[stateOf(row)]}</span>{state === 'needs_setup' && <small>{trainerSetupBlocker(row.eligible_course_count)}</small>}</td><td aria-label={`${row.eligible_course_count} eligible courses, ${row.sme_count} subject matter expert links`}>{row.eligible_course_count} eligible · {row.sme_count} SME</td><td>{row.exclusion_count || 'None'}</td><td>{row.upcoming_session_count}</td><td><small>{dateLabel(row.updated_at)}</small><small>{row.updated_by?.displayName || row.updated_by?.email || 'Not recorded'}</small></td></tr>)}</tbody></table>
      <div className="trainer-cards">{list.trainers.map((row) => <article key={row.trainer_id} className={selectedId === row.trainer_id ? 'selected' : ''}><div className="trainer-heading"><h3>{row.name}</h3><span className={`trainer-pill ${stateOf(row)}`}>{labels[stateOf(row)]}</span></div><p>{row.aliases.map((a) => a.alias_name).join(' · ')}</p>{search && row.matched_course && <p>Matched course: {row.matched_course}</p>}{state === 'needs_setup' && <p>{trainerSetupBlocker(row.eligible_course_count)}</p>}<p>{row.eligible_course_count} eligible · {row.sme_count} SME · {row.exclusion_count} exclusions</p><p>{row.upcoming_session_count} upcoming sessions</p><p>{dateLabel(row.updated_at)} · {row.updated_by?.displayName || row.updated_by?.email || 'Not recorded'}</p><button className="secondary" onClick={(event) => openTrainer(row.trainer_id, event.currentTarget)}>View trainer<span className="sr-only"> {row.name}</span></button></article>)}</div></>}
      {list?.nextCursor && <button className="secondary" disabled={listLoading} onClick={() => void loadList(true)}>Load more</button>}
    </div>}
    {selectedId && <div className="trainer-drawer-backdrop"><aside ref={drawer} className="trainer-drawer" role="dialog" aria-modal="true" aria-label="Trainer details" onKeyDown={(event) => { if (!dialog) trap(event, drawer.current, closeDrawer); }}>
      <header className="trainer-drawer-header"><div><h3 ref={heading} tabIndex={-1}>{detail?.name ?? 'Trainer details'}</h3>{detail && <><span className={`trainer-pill ${stateOf(detail)}`}>{labels[stateOf(detail)]}</span><small>ID {detail.trainer_id} · Version {detail.version}</small></>}</div><button className="secondary" aria-label="Close trainer details" disabled={busy} onClick={closeDrawer}>×</button></header>
      {detailLoading && <div aria-busy="true"><p role="status">Loading trainer details and History…</p><div className="trainer-skeleton" /></div>}
      {detailError && <div role="alert"><p>Trainer details could not be loaded.</p><button onClick={() => void loadDetail(selectedId)}>Retry</button></div>}
      {stale && <div role="alert"><p>This trainer changed after you opened it. Reload the latest version before saving.</p><button data-trainer-reload className="secondary" onClick={() => { if (!dirty || window.confirm('Discard unsaved input and reload trainer?')) void loadDetail(selectedId); }}>Reload trainer</button></div>}
      {error && !dialog && <p role="alert">{error}</p>}
      {detail && !detailError && <><Tabs values={['Overview', 'Eligibility', 'History']} active={tab} change={setTab} label="Trainer details" /><div role="tabpanel" aria-label={tab} className="trainer-drawer-content">
      {tab === 'Overview' && <><h4>Profile</h4><label htmlFor="trainer-name">Name</label><input id="trainer-name" value={name} minLength={2} maxLength={120} disabled={blocked} onChange={(event) => setName(event.target.value)} /><label htmlFor="trainer-notes">Administrative notes</label><textarea id="trainer-notes" maxLength={500} value={notes} disabled={blocked} onChange={(event) => setNotes(event.target.value)} /><small>{notes.length}/500</small><button disabled={blocked || !profileDirty || eligibilityDirty || name.trim().length < 2} onClick={() => void save({ action: 'profile', name, notes }, 'Trainer profile saved.')}>Save profile</button>
        <h4>Aliases</h4><p>The primary name is not an alias.</p><div className="trainer-aliases">{detail.aliases.map((entry) => <span key={entry.id}>{entry.alias_name}<small>{sourceLabel(entry.source)}</small><button data-alias-remove className="secondary" title="Remove alias" aria-label={`Remove ${entry.alias_name} alias`} disabled={blocked || dirty} onClick={(event) => { setAlias(entry); openDialog('remove', event.currentTarget); }}>×</button></span>)}</div><button data-add-alias className="secondary" disabled={blocked || dirty} onClick={(event) => openDialog('alias', event.currentTarget)}>Add alias</button>
        <h4>Record</h4><p>Created {dateLabel(detail.created_at)}</p><p>Updated {dateLabel(detail.updated_at)}</p><hr /><h4>Lifecycle</h4><button className={detail.is_active ? 'trainer-danger-outline' : 'secondary'} disabled={blocked || dirty} onClick={(event) => { openDialog(detail.is_active ? 'deactivate' : 'reactivate', event.currentTarget); if (detail.is_active) void checkImpact(); }}>{detail.is_active ? 'Deactivate trainer' : 'Reactivate trainer'}</button></>}
      {tab === 'Eligibility' && <><section className="trainer-readiness"><h4>Scheduling readiness</h4><ul>{[[detail.is_active, 'Trainer is active'], [effective.length > 0, 'At least one effective eligible course'], [ack, 'Module exclusions reviewed'], [!eligibilityDirty && !profileDirty, 'No unsaved changes']].map(([pass, text]) => <li key={String(text)}><span aria-hidden="true">{pass ? '✓' : '○'}</span><span className="sr-only">{pass ? 'Met: ' : 'Not met: '}</span> {text}</li>)}</ul><p>{detail.readiness_origin === 'grandfathered' ? 'Readiness carried forward from existing eligibility.' : detail.readiness_confirmed_at ? `Admin confirmed ${dateLabel(detail.readiness_confirmed_at)}` : 'Not yet confirmed by an administrator.'}</p><button disabled={blocked || dirty || !detail.is_active || !effective.length || !ack || detail.scheduling_readiness === 'ready'} onClick={(event) => openDialog('ready', event.currentTarget)}>Confirm ready for scheduling</button></section>
        <h4>Eligible courses</h4>{!links.length && <p>No eligible courses added. Add at least one course before confirming readiness.</p>}
        {[...new Set(links.map((link) => link.programme_name ?? 'ASK standalone'))].map((programme) => <section key={programme}><h5>{programme}</h5>{links.filter((link) => (link.programme_name ?? 'ASK standalone') === programme).map((link) => <div className="trainer-course-row" key={link.course_code}><strong className={`trainer-course-code ${link.programme_code?.toLowerCase() ?? 'ask'}`}>{link.course_code}</strong><span title={link.name}>{link.name}</span>{exclusions.some((e) => e.course_code === link.course_code) && <p className="trainer-warning">Excluded — unavailable for scheduling</p>}<label><input type="checkbox" disabled={blocked} checked={link.is_sme} aria-label={`Subject matter expert for ${link.course_code}`} onChange={(event) => setLinks(links.map((l) => l.course_code === link.course_code ? { ...l, is_sme: event.target.checked } : l))} />Subject matter expert</label><button className="secondary" disabled={blocked} aria-label={`Remove ${link.course_code} eligibility`} onClick={() => setLinks(links.filter((l) => l.course_code !== link.course_code))}>Remove</button></div>)}</section>)}
        <CoursePicker title="Add eligible course" courses={courses} added={links.map((link) => link.course_code)} disabled={blocked} add={(course) => setLinks([...links, { ...course, course_code: course.code, is_sme: false }])} />
        <h4>Module exclusions</h4>{!exclusions.length && <p>No module exclusions recorded.</p>}{exclusions.map((entry) => <div className="trainer-course-row" key={entry.course_code}><strong>{entry.course_code}</strong><span>{entry.name}</span><button className="secondary" disabled={blocked} aria-label={`Remove ${entry.course_code} exclusion`} onClick={() => setExclusions(exclusions.filter((e) => e.course_code !== entry.course_code))}>Remove exclusion</button></div>)}
        <CoursePicker title="Add exclusion" courses={courses} added={exclusions.map((entry) => entry.course_code)} disabled={blocked} add={(course) => setExclusions([...exclusions, { ...course, course_code: course.code }])} />
        {courseError && <div role="alert">Canonical courses could not be loaded. <button className="secondary" onClick={() => void loadCourses()}>Retry courses</button></div>}
        <label className="trainer-checkbox"><input type="checkbox" checked={ack} disabled={blocked || eligibilityDirty || profileDirty} onChange={(event) => setAck(event.target.checked)} />I have reviewed module exclusions; none are missing</label>
        {resets && detail.scheduling_readiness === 'ready' && <p className="trainer-warning">Saving these changes will move this trainer to Needs setup. Confirm readiness again after reviewing the saved record.</p>}
        <footer className="trainer-save-bar"><span>{eligibilityDirty ? 'Unsaved eligibility changes' : 'No unsaved changes'}</span><button className="secondary" disabled={blocked || !eligibilityDirty} onClick={() => { setLinks(detail.links); setExclusions(detail.exclusions); }}>Discard</button><button disabled={blocked || !eligibilityDirty || profileDirty} onClick={() => void save({ action: 'eligibility', links: links.map((link) => ({ courseCode: link.course_code, isSme: link.is_sme })), exclusions: exclusions.map((entry) => entry.course_code) }, 'Eligibility saved. Review scheduling readiness.')}>Save eligibility changes</button></footer></>}
      {tab === 'History' && <><h4>Immutable change history</h4><p>Recorded changes cannot be edited or deleted.</p>{!history.length && <p>No changes recorded.</p>}{history.map((event) => <article className="trainer-history" key={event.id}><h5>{event.action.split('_').join(' ').replace(/^./, (letter) => letter.toUpperCase())}</h5>{historyLines(event).map((line, index) => <p key={index}>{line}</p>)}{event.note && <p>{event.note}</p>}<small>{event.actor.displayName || event.actor.email || event.actor.id} · {dateLabel(event.created_at)} · Version {event.new_version}</small></article>)}</>}
      </div></>}
    </aside></div>}
    {dialog && <Modal title={modalTitle} close={closeDialog} busy={busy}>
      {detail && dialog !== 'register' && <p>{detail.name} · ID {detail.trainer_id} · Version {detail.version}</p>}
      {(dialog === 'register' || dialog === 'alias') && <><label htmlFor="trainer-dialog-name">{dialog === 'register' ? 'Name' : 'Alias'} (required)</label><input id="trainer-dialog-name" value={dialogName} minLength={2} maxLength={120} disabled={busy} aria-invalid={!!error} onChange={(event) => setDialogName(event.target.value)} /></>}
      {dialog === 'register' && <p>The ID is assigned on save. This trainer starts as Needs setup. No aliases, course links or exclusions are created.</p>}
      {dialog === 'remove' && <><p>Remove "{alias?.alias_name}" · {sourceLabel(alias?.source ?? null)}</p><p className="trainer-warning">Future imports may no longer match this alias. Rows using this alias will need manual resolution until mapped again.</p></>}
      {dialog === 'deactivate' && <>{impact === null ? <p role="status">Checking upcoming-session impact…</p> : <p>{impact === 0 ? 'This trainer has no current or upcoming session assignments.' : `${impact} current or upcoming ${impact === 1 ? 'session will' : 'sessions will'} remain assigned to this trainer.`}</p>}{impactError && <div role="alert"><p>Upcoming-session impact could not be checked. Retry before deactivating.</p><button className="secondary" onClick={() => void checkImpact()}>Retry impact check</button></div>}<p>Deactivation prevents new assignments. It does not unassign existing sessions or remove history. Reactivation returns the trainer to Needs setup.</p><label className="trainer-checkbox"><input type="checkbox" checked={dialogAck} disabled={busy} onChange={(event) => setDialogAck(event.target.checked)} />I understand existing session assignments will remain unchanged</label></>}
      {dialog === 'reactivate' && <p>Reactivation returns this trainer to Needs setup. Review eligibility and confirm readiness before scheduling.</p>}
      {dialog === 'ready' && <p>{effective.length} effective eligible courses · {effective.filter((link) => link.is_sme).length} subject matter expert links · {exclusions.length} exclusions. Confirm exclusions have been reviewed for eligibility version {detail?.eligibility_version}.</p>}
      {['register', 'remove', 'deactivate', 'reactivate'].includes(dialog) && <><label htmlFor="trainer-dialog-note">{dialog === 'register' ? 'Administrative notes (optional)' : dialog === 'remove' ? 'Audit note (required)' : 'Audit note (optional)'}</label><textarea id="trainer-dialog-note" value={dialogNote} maxLength={500} disabled={busy} placeholder={dialog === 'register' ? 'Administrative notes or context Ops should know' : undefined} onChange={(event) => setDialogNote(event.target.value)} /><small aria-live="polite">{dialogNote.length}/500</small></>}
      {error && <p role="alert">{error}</p>}
      <div className="trainer-actions"><button className="secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button className={dialog === 'remove' || dialog === 'deactivate' ? 'trainer-danger' : ''} disabled={busy || stale || (dialog === 'register' || dialog === 'alias') && dialogName.trim().length < 2 || dialog === 'remove' && !dialogNote.trim() || dialog === 'deactivate' && (impact === null || !dialogAck)} onClick={() => {
        if (dialog === 'register') void save(null, 'Trainer registered. Add eligible courses, review exclusions, then confirm scheduling readiness.');
        if (dialog === 'alias') void save({ action: 'aliases', aliasName: dialogName }, 'Alias added.');
        if (dialog === 'remove' && alias) void save({ action: 'remove-alias', aliasId: alias.id, note: dialogNote }, `Alias "${alias.alias_name}" removed.`);
        if (dialog === 'deactivate') void save({ action: 'deactivate', acknowledgeAssignments: true, note: dialogNote }, 'Trainer deactivated. Existing assignments remain unchanged.');
        if (dialog === 'reactivate') void save({ action: 'reactivate', note: dialogNote }, 'Trainer reactivated to Needs setup.');
        if (dialog === 'ready' && detail) void save({ action: 'readiness/confirm', expectedEligibilityVersion: detail.eligibility_version, acknowledgeExclusions: true }, 'Trainer confirmed ready for scheduling.');
      }}>{busy ? 'Saving…' : modalTitle}</button></div>
    </Modal>}
  </section>;
}
