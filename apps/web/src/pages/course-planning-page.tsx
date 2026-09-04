import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { BookOpen, CalendarDays, Check, Plus, RefreshCw, X } from 'lucide-react';
import {
  ApiError,
  approvePlannedCourseRun,
  createPlannedCourseRuns,
  fetchCoursePlanning,
  schedulePlannedCourseRun,
  type CoursePlanningCourse,
  type CoursePlanningResponse,
  type PlannedCourseRun,
} from '../api.js';
import { addCalendarMonths, getMonthEnd, getSingaporeDate } from '../lib/dates.js';
import {
  formatHistoryTime,
  formatMonths,
  formatNumber,
  formatPercent,
  formatPlanningActor,
  getProgrammeTone,
  profileSourceLabels,
} from '../lib/format.js';

type ActiveRole = 'admin' | 'ops' | 'finance' | 'viewer';
type ApiErrorHandler = (error: unknown, setError: (message: string) => void) => Promise<void>;

export default function CoursePlanningPage({
  user,
  role,
  onApiError,
}: {
  user: User;
  role: ActiveRole;
  onApiError: ApiErrorHandler;
}) {
  const currentMonth = useMemo(() => getSingaporeDate().slice(0, 7), []);
  const latestPlanningMonth = useMemo(
    () => addCalendarMonths(`${currentMonth}-01`, 12).slice(0, 7),
    [currentMonth],
  );
  const [month, setMonth] = useState(currentMonth);
  const [venueCode, setVenueCode] = useState('IP');
  const [programme, setProgramme] = useState('');
  const [courseSearch, setCourseSearch] = useState('');
  const [historySource, setHistorySource] = useState('');
  const [data, setData] = useState<CoursePlanningResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [reloadRequired, setReloadRequired] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [createCourseCode, setCreateCourseCode] = useState<string | null>(null);
  const [createCount, setCreateCount] = useState(1);
  const [createNote, setCreateNote] = useState('');
  const [scheduleRunId, setScheduleRunId] = useState<string | null>(null);
  const [scheduleStart, setScheduleStart] = useState(`${currentMonth}-01`);
  const [scheduleEnd, setScheduleEnd] = useState(`${currentMonth}-01`);
  const hasWriteRole = role === 'admin' || role === 'ops';
  const monthIsWritable = month >= currentMonth && month <= latestPlanningMonth;
  const canWrite = hasWriteRole && monthIsWritable;

  async function load() {
    setBusy(true);
    setError('');
    setActionError('');
    setReloadRequired(false);
    try {
      const result = await fetchCoursePlanning(user, month, venueCode);
      setData(result);
    } catch (caught) {
      void onApiError(caught, setError);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setCreateCourseCode(null);
    setScheduleRunId(null);
    setScheduleStart(`${month}-01`);
    setScheduleEnd(`${month}-01`);
    void load();
  }, [month, venueCode, user]);

  const filteredCourses = useMemo(() => {
    const search = courseSearch.trim().toLowerCase();
    return (data?.courses ?? []).filter((row) => {
      if (programme === '__standalone' && row.course.programmeCode !== null) return false;
      if (programme && programme !== '__standalone' && row.course.programmeCode !== programme) return false;
      if (historySource && row.planningProfile.source !== historySource) return false;
      if (search && !`${row.course.code} ${row.course.name}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [courseSearch, data, historySource, programme]);

  const summary = useMemo(() => {
    const runs = filteredCourses.flatMap((row) => row.runs);
    const historicalTarget = filteredCourses.reduce(
      (total, row) => total + (row.planningProfile.confirmedPerMonth ?? 0),
      0,
    );
    return {
      plannedRuns: runs.length,
      historicalTarget: Math.round(historicalTarget * 100) / 100,
      unscheduledRuns: runs.filter((run) => run.status === 'approved' && !run.session).length,
      evidenceGaps: filteredCourses.filter((row) => (
        row.planningProfile.source === 'no_history' || row.planningProfile.source === 'unavailable'
      )).length,
    };
  }, [filteredCourses]);

  const programmeGroups = useMemo(() => {
    const groups = new Map<string, CoursePlanningCourse[]>();
    for (const row of filteredCourses) {
      const key = row.course.programmeCode ?? '__standalone';
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [filteredCourses]);

  function replaceRun(updated: PlannedCourseRun) {
    setData((current) => current ? {
      ...current,
      courses: current.courses.map((row) => row.course.code === updated.courseCode ? {
        ...row,
        runs: row.runs.map((run) => run.id === updated.id ? updated : run),
      } : row),
    } : current);
  }

  function handleActionFailure(caught: unknown) {
    if (caught instanceof ApiError && caught.code === 'stale_planned_course_run_version') {
      setReloadRequired(true);
      setActionError('This planned run changed after you opened it. Reload Course Planning before trying again.');
      return;
    }
    void onApiError(caught, setActionError);
  }

  async function createRuns(course: CoursePlanningCourse) {
    setActionBusyId(`create-${course.course.code}`);
    setActionError('');
    setActionMessage('');
    try {
      const runs = await createPlannedCourseRuns(user, {
        planningMonth: month,
        courseCode: course.course.code,
        venueCode,
        count: createCount,
        note: createNote,
      });
      setData((current) => current ? {
        ...current,
        courses: current.courses.map((row) => row.course.code === course.course.code ? {
          ...row,
          runs: [...row.runs, ...runs],
        } : row),
      } : current);
      setActionMessage(`${runs.length} proposed ${runs.length === 1 ? 'run' : 'runs'} added for ${course.course.name}.`);
      setCreateCourseCode(null);
      setCreateCount(1);
      setCreateNote('');
    } catch (caught) {
      handleActionFailure(caught);
    } finally {
      setActionBusyId(null);
    }
  }

  async function approveRun(run: PlannedCourseRun) {
    setActionBusyId(run.id);
    setActionError('');
    setActionMessage('');
    try {
      const updated = await approvePlannedCourseRun(user, run.id, run.version);
      replaceRun(updated);
      setActionMessage('Planned run approved. Choose its dates when you are ready to create a draft Session.');
    } catch (caught) {
      handleActionFailure(caught);
    } finally {
      setActionBusyId(null);
    }
  }

  async function scheduleRun(run: PlannedCourseRun) {
    setActionBusyId(run.id);
    setActionError('');
    setActionMessage('');
    try {
      const result = await schedulePlannedCourseRun(user, run.id, {
        expectedVersion: run.version,
        startDate: scheduleStart,
        endDate: scheduleEnd,
      });
      replaceRun(result.run);
      setActionMessage(`Draft Session ${result.session.id} created for ${result.session.startDate} to ${result.session.endDate}.`);
      setScheduleRunId(null);
    } catch (caught) {
      handleActionFailure(caught);
    } finally {
      setActionBusyId(null);
    }
  }

  const metrics = [
    ['Planned runs', summary.plannedRuns, 'primary'],
    ['Historical target', formatNumber(summary.historicalTarget), 'info'],
    ['Approved, unscheduled', summary.unscheduledRuns, 'warning'],
    ['Evidence gaps', summary.evidenceGaps, 'danger'],
  ] as const;

  return (
    <section className="planning-stack course-planning-page">
      <div className="panel planning-hero course-planning-hero">
        <div className="hero-copy">
          <span className="eyebrow">Future course planning</span>
          <h2>Course Planning</h2>
          <p>Decide what to run by month and venue. Historical profiles are evidence, not recommendations.</p>
          <span className="range-label"><BookOpen size={14} /> {month} · {data?.courses[0]?.venue.name ?? venueCode}</span>
        </div>
        <button className="icon-button secondary" onClick={() => load()} disabled={busy} aria-label="Refresh Course Planning" title="Refresh Course Planning">
          <RefreshCw size={17} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <div className="metrics course-planning-metrics">
        {metrics.map(([label, value, tone]) => (
          <div className={`metric ${tone}`} key={label}>
            <span>{label}</span>
            <strong>{busy ? '...' : value}</strong>
          </div>
        ))}
      </div>

      <div className="panel filter-panel course-planning-filters">
        <div className="filter-panel-heading">
          <div>
            <span className="eyebrow">Planning lens</span>
            <h2>Month, venue and evidence</h2>
          </div>
          <span>Filters update the displayed evidence cards</span>
        </div>
        <div className="filter-grid course-planning-filter-grid">
          <label>
            Planning month
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <label>
            Venue
            <select value={venueCode} onChange={(event) => setVenueCode(event.target.value)}>
              {(data?.filters.venues ?? [{ code: 'IP', name: 'International Plaza', type: 'owned' }]).map((venue) => (
                <option key={venue.code} value={venue.code}>{venue.name}</option>
              ))}
            </select>
          </label>
          <label>
            Programme
            <select value={programme} onChange={(event) => setProgramme(event.target.value)}>
              <option value="">All active programmes</option>
              {data?.filters.programmes.map((item) => (
                <option key={item.code ?? '__standalone'} value={item.code ?? '__standalone'}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Course
            <input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="Search code or name" />
          </label>
          <label>
            History evidence
            <select value={historySource} onChange={(event) => setHistorySource(event.target.value)}>
              <option value="">All evidence states</option>
              {data?.filters.historySources.map((source) => (
                <option value={source} key={source}>{profileSourceLabels[source]}</option>
              ))}
            </select>
          </label>
        </div>
        <span className="field-help">
          Retained months remain readable. Adding, approving and scheduling planned runs is available from {currentMonth} through {latestPlanningMonth}.
          Hotel evidence groups Furama, Holiday Inn and Scotts under the committed HOTEL profile. Lavender and Outbound intentionally show unavailable evidence; other venues use exact matching.
        </span>
        {hasWriteRole && !monthIsWritable && (
          <span className="field-help">This retained month is read-only because it is outside the active planning window.</span>
        )}
      </div>

      <div aria-live="polite">
        {error && <p className="error">{error}</p>}
        {actionError && <p className="error">{actionError}</p>}
        {actionMessage && <p className="message">{actionMessage}</p>}
        {reloadRequired && (
          <button className="secondary" onClick={() => load()} disabled={busy}>
            <RefreshCw size={16} />
            Reload Course Planning
          </button>
        )}
      </div>

      {!busy && !error && filteredCourses.length === 0 && (
        <div className="panel"><p className="empty">No active courses match these planning filters.</p></div>
      )}

      <div className="course-planning-groups">
        {programmeGroups.map(([groupCode, courses]) => (
          <section className="panel programme-group" key={groupCode} aria-labelledby={`programme-${groupCode}`}>
            <div className="panel-heading row-heading">
              <div>
                <span className={`programme-pill ${getProgrammeTone(groupCode === '__standalone' ? null : groupCode)}`}>
                  {groupCode === '__standalone' ? 'Standalone' : groupCode}
                </span>
                <h2 id={`programme-${groupCode}`}>{courses[0].course.programmeName ?? 'Standalone courses'}</h2>
              </div>
              <span>{courses.length} {courses.length === 1 ? 'course' : 'courses'}</span>
            </div>
            <div className="course-plan-list">
              {courses.map((course) => {
                const profile = course.planningProfile;
                const hasEvidence = profile.source === 'direct' || profile.source === 'ft_proxy';
                return (
                  <article className="course-plan-card" key={course.course.code}>
                    <div className="course-plan-main">
                      <div className="course-plan-title">
                        <div>
                          <strong>{course.course.name}</strong>
                          <span>{course.course.code}</span>
                        </div>
                        <span className={`profile-source ${profile.source}`}>{profileSourceLabels[profile.source]}</span>
                      </div>
                      <div className="course-evidence" aria-label={`Historical evidence for ${course.course.name}`}>
                        <div><span>Cadence evidence</span><strong>{formatNumber(profile.confirmedPerMonth)} / month</strong></div>
                        <div><span>Confirmation</span><strong>{formatPercent(profile.confirmationRate)}</strong></div>
                        <div><span>Median gap</span><strong>{formatNumber(profile.medianGapDays)} days</strong></div>
                        <div><span>Planned</span><strong>{course.runs.length}</strong></div>
                      </div>
                      <div className="evidence-notes">
                        {hasEvidence ? (
                          <>
                            <span>Evidence: {profile.profileCourseCode} × {profile.evidenceVenueCode}</span>
                            <span>Strong: {formatMonths(profile.strongMonths)}</span>
                            <span>Weak: {formatMonths(profile.weakMonths)}</span>
                            {profile.lowHistoricalConfirmation && <span className="low-confirmation">Low historical confirmation</span>}
                          </>
                        ) : (
                          <span>{profile.source === 'no_history'
                            ? 'This new FT course has no historical profile. Use planner judgment.'
                            : 'No matching committed course × venue profile. Use planner judgment.'}</span>
                        )}
                      </div>
                    </div>

                    {canWrite && (
                      <div className="course-plan-actions">
                        <button
                          className="secondary"
                          onClick={() => {
                            setCreateCourseCode((current) => current === course.course.code ? null : course.course.code);
                            setCreateCount(1);
                            setCreateNote('');
                          }}
                        >
                          <Plus size={16} />
                          Add planned run
                        </button>
                      </div>
                    )}

                    {canWrite && createCourseCode === course.course.code && (
                      <form className="planned-run-form" onSubmit={(event) => {
                        event.preventDefault();
                        void createRuns(course);
                      }}>
                        <div className="form-heading">
                          <div>
                            <span className="eyebrow">Proposed change</span>
                            <h3>Add runs for {month}</h3>
                          </div>
                          <button type="button" className="icon-button secondary" onClick={() => setCreateCourseCode(null)} aria-label="Close add run form">
                            <X size={16} />
                          </button>
                        </div>
                        <div className="planned-run-form-grid">
                          <label>
                            Number of runs
                            <input type="number" min="1" max="20" value={createCount} onChange={(event) => setCreateCount(Number(event.target.value))} required />
                          </label>
                          <label className="wide-field">
                            Planning note (optional)
                            <textarea maxLength={500} value={createNote} onChange={(event) => setCreateNote(event.target.value)} />
                          </label>
                        </div>
                        <div className="planning-preview">
                          <span>Current</span><strong>{course.runs.length} planned</strong>
                          <span>Proposed</span><strong>{course.runs.length + createCount} planned</strong>
                        </div>
                        <button type="submit" disabled={actionBusyId === `create-${course.course.code}`}>
                          {actionBusyId === `create-${course.course.code}` ? <RefreshCw size={16} className="spin" /> : <Plus size={16} />}
                          Add proposed {createCount === 1 ? 'run' : 'runs'}
                        </button>
                      </form>
                    )}

                    {course.runs.length > 0 ? (
                      <ol className="planned-run-list">
                        {course.runs.map((run, index) => (
                          <li key={run.id}>
                            <div className="planned-run-heading">
                              <div>
                                <strong>Run {index + 1}</strong>
                                <span>Created by {formatPlanningActor(run.createdBy)} · version {run.version}</span>
                              </div>
                              <span className={`status-pill course-${run.status}`}>{run.status}</span>
                            </div>
                            {run.note && <p>{run.note}</p>}
                            {run.approvedAt && <span>Approved by {formatPlanningActor(run.approvedBy)} on {formatHistoryTime(run.approvedAt)}</span>}
                            {run.session ? (
                              <div className="planned-session-link">
                                <Check size={16} />
                                <div>
                                  <strong>Draft Session created</strong>
                                  <span>{run.session.startDate} to {run.session.endDate} · {run.session.id}</span>
                                </div>
                              </div>
                            ) : canWrite ? (
                              <div className="planned-run-buttons">
                                {run.status === 'proposed' && (
                                  <button onClick={() => void approveRun(run)} disabled={Boolean(actionBusyId)}>
                                    {actionBusyId === run.id ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}
                                    Approve run
                                  </button>
                                )}
                                {run.status === 'approved' && (
                                  <button className="secondary" onClick={() => {
                                    setScheduleRunId((current) => current === run.id ? null : run.id);
                                    setScheduleStart(`${month}-01`);
                                    setScheduleEnd(`${month}-01`);
                                  }}>
                                    <CalendarDays size={16} />
                                    Schedule class
                                  </button>
                                )}
                              </div>
                            ) : null}

                            {canWrite && run.status === 'approved' && scheduleRunId === run.id && (
                              <form className="planned-run-form schedule-form" onSubmit={(event) => {
                                event.preventDefault();
                                void scheduleRun(run);
                              }}>
                                <div className="form-heading">
                                  <div>
                                    <span className="eyebrow">Explicit Session dates</span>
                                    <h3>Create one draft Session</h3>
                                  </div>
                                  <button type="button" className="icon-button secondary" onClick={() => setScheduleRunId(null)} aria-label="Close schedule form">
                                    <X size={16} />
                                  </button>
                                </div>
                                <div className="planned-run-form-grid">
                                  <label>
                                    Start date
                                    <input type="date" min={`${month}-01`} max={getMonthEnd(month)} value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} required />
                                  </label>
                                  <label>
                                    End date
                                    <input type="date" min={scheduleStart} value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} required />
                                  </label>
                                </div>
                                <div className="planning-preview">
                                  <span>Course</span><strong>{course.course.code}</strong>
                                  <span>Venue</span><strong>{course.venue.name}</strong>
                                  <span>Trainer</span><strong>Unassigned</strong>
                                  <span>Status</span><strong>Draft</strong>
                                </div>
                                <p className="field-help">No trainer, room, time or pax will be generated. The start date must remain in {month}; the span may cross month-end.</p>
                                <button type="submit" disabled={actionBusyId === run.id || !scheduleStart || !scheduleEnd || scheduleEnd < scheduleStart}>
                                  {actionBusyId === run.id ? <RefreshCw size={16} className="spin" /> : <CalendarDays size={16} />}
                                  Create draft Session
                                </button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="empty course-empty">No runs proposed for this month and venue.</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
