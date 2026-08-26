import type { User } from 'firebase/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

export type AppRole = 'admin' | 'ops' | 'finance' | 'viewer' | 'pending' | 'rejected';

export interface AppProfile {
  id: string;
  email: string;
  display_name?: string | null;
  role: AppRole;
  message?: string;
  created_at?: string;
  updated_at?: string;
  is_active?: boolean;
  version?: number;
  deactivated?: boolean;
}

export interface AdminUser {
  id: string; email: string; display_name?: string | null; role: AppRole;
  is_active: boolean; version: number; created_at: string; updated_at: string;
}
export interface UserInvitation {
  id: string; email: string; intended_role: Exclude<AppRole, 'pending' | 'rejected'>;
  status: 'pending' | 'claimed' | 'cancelled'; note?: string | null; version: number;
  created_at: string; updated_at: string;
}
export interface UserAccessEvent {
  id: string; action: string; actor_user_id: string; previous_role?: AppRole | null;
  new_role?: AppRole | null; previous_is_active?: boolean | null; new_is_active?: boolean | null;
  previous_version?: number | null; new_version?: number | null; created_at: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly code: string | null = null,
    public readonly currentVersion: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchAdminUsers(user: User): Promise<AdminUser[]> {
  const data = await apiFetch(user, '/admin/users') as { users: AdminUser[] };
  return data.users;
}
export async function fetchAdminInvitations(user: User): Promise<UserInvitation[]> {
  const data = await apiFetch(user, '/admin/user-invitations') as { invitations: UserInvitation[] };
  return data.invitations;
}
export async function createAdminInvitation(user: User, input: { email: string; intendedRole: string; note?: string }): Promise<UserInvitation> {
  const data = await apiFetch(user, '/admin/user-invitations', { method: 'POST', body: JSON.stringify(input) }) as { invitation: UserInvitation };
  return data.invitation;
}
export async function cancelAdminInvitation(user: User, id: string, expectedVersion: number): Promise<UserInvitation> {
  const data = await apiFetch(user, `/admin/user-invitations/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ expectedVersion }) }) as { invitation: UserInvitation };
  return data.invitation;
}
export async function updateAdminUser(user: User, id: string, input: { expectedVersion: number; action: string; role?: string }): Promise<AdminUser> {
  const data = await apiFetch(user, `/admin/users/${id}/access`, { method: 'PATCH', body: JSON.stringify(input) }) as { user: AdminUser };
  return data.user;
}
export async function fetchAdminUserHistory(user: User, id: string): Promise<UserAccessEvent[]> {
  const data = await apiFetch(user, `/admin/users/${id}/history`) as { events: UserAccessEvent[] };
  return data.events;
}

export interface ApiSession {
  id: string;
  course_code: string | null;
  tms_code: string | null;
  course_name: string | null;
  trainer_name: string | null;
  venue_name: string | null;
  room_name: string | null;
  status: string;
  start_date: string;
  end_date: string;
  time_text: string | null;
  expected_pax: number | null;
  confirmed_pax: number | null;
}

export type PlanningStatus = 'draft' | 'confirmed' | 'cancelled' | 'completed';

export type PlanningIssue =
  | 'unassigned_trainer'
  | 'unresolved_venue'
  | 'owned_venue_missing_room'
  | 'capacity_overrun';

export type PlanningProfileSource = 'direct' | 'ft_proxy' | 'no_history' | 'unavailable';

export interface PlanningRequest {
  from: string;
  to: string;
  status?: PlanningStatus[];
  programme?: string;
  trainerId?: string;
  venueCode?: string;
  roomId?: string;
  issue?: PlanningIssue[];
  includeCancelled?: boolean;
  limit?: number;
  cursor?: string | null;
}

export interface PlanningSession {
  id: string;
  externalRef: string | null;
  course: {
    code: string | null;
    tmsCode: string | null;
    name: string | null;
    programmeCode: string | null;
  };
  trainer: {
    id: string | null;
    name: string | null;
    rawName: string | null;
  };
  venue: {
    code: string | null;
    name: string | null;
    type: string | null;
    rawText: string | null;
  };
  room: {
    id: string | null;
    name: string | null;
    capacity: number | null;
  };
  dates: {
    start: string;
    end: string;
    spanDays: number;
    timeText: string | null;
  };
  pax: {
    expected: number | null;
    confirmed: number | null;
    effective: number | null;
  };
  status: PlanningStatus;
  managementSource: 'import' | 'application';
  version: number;
  issues: {
    unassignedTrainer: boolean;
    unresolvedVenue: boolean;
    ownedVenueMissingRoom: boolean;
    capacityOverrun: boolean;
  };
  planningProfile: {
    source: PlanningProfileSource;
    profileCourseCode: string | null;
    scheduled18MonthCount: number | null;
    confirmationRate: number | null;
    confirmedPerMonth: number | null;
    medianGapDays: number | null;
    strongMonths: string[];
    weakMonths: string[];
    lowHistoricalConfirmation: boolean;
  };
}

export interface PlanningResponse {
  meta: {
    filterMode: string;
    spanFilter: string;
    trainingDayConflictDetection: string;
  };
  summary: {
    dateRange: { from: string; to: string };
    total: number;
    byStatus: Record<PlanningStatus, number>;
    issues: {
      unassignedTrainers: number;
      unresolvedVenues: number;
      ownedVenuesWithoutRooms: number;
      capacityOverruns: number;
    };
  };
  filters: {
    programmes: Array<{ code: string; name: string; status: string }>;
    trainers: Array<{ id: string; name: string; is_active: boolean }>;
    venues: Array<{ code: string; name: string; type: string | null }>;
    rooms: Array<{ id: string; venue_code: string | null; name: string; capacity: number | null }>;
    issues: PlanningIssue[];
  };
  sessions: PlanningSession[];
  page: {
    limit: number;
    nextCursor: string | null;
  };
}

export type PlannedCourseRunStatus = 'proposed' | 'approved' | 'scheduled';

export interface PlannedCourseRun {
  id: string;
  planningMonth: string;
  courseCode: string;
  venueCode: string;
  status: PlannedCourseRunStatus;
  note: string | null;
  version: number;
  createdBy: { id: string; email: string | null; name: string | null };
  approvedBy: { id: string; email: string | null; name: string | null } | null;
  approvedAt: string | null;
  scheduledBy: { id: string; email: string | null; name: string | null } | null;
  scheduledAt: string | null;
  session: {
    id: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoursePlanningCourse {
  course: {
    code: string;
    name: string;
    programmeCode: string | null;
    programmeName: string | null;
  };
  venue: {
    code: string;
    name: string;
    type: string;
  };
  planningProfile: {
    source: PlanningProfileSource;
    profileCourseCode: string | null;
    evidenceVenueCode: string;
    scheduled18MonthCount: number | null;
    confirmationRate: number | null;
    confirmedPerMonth: number | null;
    medianGapDays: number | null;
    strongMonths: string[];
    weakMonths: string[];
    lowHistoricalConfirmation: boolean;
  };
  runs: PlannedCourseRun[];
}

export interface CoursePlanningResponse {
  meta: {
    planningMonth: string;
    venueCode: string;
    evidenceVenueCode: string;
    evidenceMode: 'committed_profiles_read_only';
  };
  summary: {
    plannedRuns: number;
    historicalTarget: number;
    unscheduledRuns: number;
    evidenceGaps: number;
  };
  filters: {
    venues: Array<{ code: string; name: string; type: string }>;
    programmes: Array<{ code: string | null; name: string }>;
    historySources: PlanningProfileSource[];
  };
  courses: CoursePlanningCourse[];
}

export interface ScheduledDraftSession {
  id: string;
  courseCode: string;
  venueCode: string;
  status: 'draft';
  startDate: string;
  endDate: string;
  managementSource: 'application';
  version: number;
  trainer: null;
  room: null;
  timeText: null;
  pax: null;
}

export interface ParseResult {
  summary: {
    totalRows: number;
    validRows: number;
    inserts: number;
    updates: number;
    unchanged: number;
    skipped: number;
    cancellations: number;
    conflicts: number;
    changeCount: number;
    autoApplied: boolean;
    requiresConfirmation: boolean;
    blocked: boolean;
    blockReason: string | null;
  };
  alerts: Array<{
    code: string;
    message: string;
    rowNumber: number;
    rawValue: string | null;
  }>;
  conflicts: ScheduleImportConflict[];
  applied?: {
    applied: number;
    skipped: number;
    unchanged: number;
    conflicts: ScheduleImportConflict[];
  };
}

export interface ScheduleImportConflict {
  externalRef: string;
  rowNumber: number;
  sessionId: string;
  reason: 'application_managed_difference';
  fields: Array<{
    field: string;
    current: string | number | null;
    incoming: string | number | null;
  }>;
}

export interface SessionHistoryEntry {
  id: string;
  sessionId: string;
  action: 'trainer_assigned' | 'trainer_replaced' | 'trainer_unassigned';
  actor: {
    id: string;
    email: string | null;
    displayName: string | null;
  } | null;
  previousTrainer: { id: string; name: string | null } | null;
  newTrainer: { id: string; name: string | null } | null;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TrainerOption {
  id: string;
  name: string;
}

export interface SessionTrainerUpdateResponse {
  session: {
    id: string;
    trainer: TrainerOption | null;
    previousTrainer: TrainerOption | null;
    managementSource: 'import' | 'application';
    version: number;
    updatedAt: string;
  };
  history: {
    id: string;
    action: SessionHistoryEntry['action'];
    createdAt: string;
  };
}

export async function apiFetch<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const token = await user.getIdToken();
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError('Could not connect to the Training Planner API. Check your network and try again.');
  }

  const data = await readResponseBody(response);

  if (!response.ok && response.status !== 409) {
    throw new ApiError(
      getApiMessage(response, data),
      response.status,
      getResponseCode(data),
      getCurrentVersion(data),
    );
  }

  return data as T;
}

export async function fetchMe(user: User): Promise<AppProfile> {
  return apiFetch<AppProfile>(user, '/me');
}

export async function uploadMasterSchedule(user: User, file: File): Promise<ParseResult & { uploadBatchId: string }> {
  const signed = await apiFetch<{
    upload: { id: string };
    signedUrl: string;
    contentType: string;
  }>(user, '/uploads/signed-url', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });

  await fetch(signed.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': signed.contentType },
    body: file,
  }).then((response) => {
    if (!response.ok) {
      throw new ApiError('Upload to storage failed. Try again, or ask an admin to check bucket CORS.');
    }
  }).catch((error: unknown) => {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError('Could not upload to storage. Check your connection and try again.');
  });

  const result = await apiFetch<ParseResult>(user, '/sync/parse-schedule', {
    method: 'POST',
    body: JSON.stringify({ uploadBatchId: signed.upload.id }),
  });

  return { ...result, uploadBatchId: signed.upload.id };
}

export async function confirmSchedule(user: User, batchId: string, manualOverride: boolean): Promise<ParseResult> {
  return apiFetch<ParseResult>(user, `/sync/${batchId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ manualOverride }),
  });
}

export async function cancelSchedule(user: User, batchId: string): Promise<void> {
  await apiFetch(user, `/sync/${batchId}/cancel`, { method: 'POST', body: '{}' });
}

export async function fetchSessions(user: User, status?: string): Promise<ApiSession[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await apiFetch<{ sessions: ApiSession[] }>(user, `/sessions${query}`);
  return data.sessions;
}

export async function fetchPlanningSessions(user: User, request: PlanningRequest): Promise<PlanningResponse> {
  const query = new URLSearchParams({ from: request.from, to: request.to });

  if (request.status?.length) query.set('status', request.status.join(','));
  if (request.programme) query.set('programme', request.programme);
  if (request.trainerId) query.set('trainerId', request.trainerId);
  if (request.venueCode) query.set('venueCode', request.venueCode);
  if (request.roomId) query.set('roomId', request.roomId);
  if (request.issue?.length) query.set('issue', request.issue.join(','));
  if (request.includeCancelled) query.set('includeCancelled', 'true');
  if (request.limit) query.set('limit', String(request.limit));
  if (request.cursor) query.set('cursor', request.cursor);

  return apiFetch<PlanningResponse>(user, `/planning/sessions?${query.toString()}`);
}

export async function fetchCoursePlanning(
  user: User,
  month: string,
  venueCode: string,
): Promise<CoursePlanningResponse> {
  const query = new URLSearchParams({ month, venueCode });
  return apiFetch<CoursePlanningResponse>(user, `/course-planning?${query.toString()}`);
}

export async function createPlannedCourseRuns(
  user: User,
  input: {
    planningMonth: string;
    courseCode: string;
    venueCode: string;
    count: number;
    note: string;
  },
): Promise<PlannedCourseRun[]> {
  const data = await apiFetch<{ runs: PlannedCourseRun[] }>(user, '/course-planning/runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.runs;
}

export async function approvePlannedCourseRun(
  user: User,
  runId: string,
  expectedVersion: number,
): Promise<PlannedCourseRun> {
  const data = await apiFetch<{ run: PlannedCourseRun } | Record<string, unknown>>(
    user,
    `/course-planning/runs/${encodeURIComponent(runId)}/approve`,
    {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion }),
    },
  );
  throwIfPlannedRunStale(data);
  return (data as { run: PlannedCourseRun }).run;
}

export async function schedulePlannedCourseRun(
  user: User,
  runId: string,
  input: { expectedVersion: number; startDate: string; endDate: string },
): Promise<{ run: PlannedCourseRun; session: ScheduledDraftSession }> {
  const data = await apiFetch<
    { run: PlannedCourseRun; session: ScheduledDraftSession } | Record<string, unknown>
  >(
    user,
    `/course-planning/runs/${encodeURIComponent(runId)}/session`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  throwIfPlannedRunStale(data);
  return data as { run: PlannedCourseRun; session: ScheduledDraftSession };
}

export async function fetchSessionHistory(user: User, sessionId: string): Promise<SessionHistoryEntry[]> {
  const data = await apiFetch<{ history: SessionHistoryEntry[] }>(
    user,
    `/sessions/${encodeURIComponent(sessionId)}/history`,
  );
  return data.history;
}

export async function fetchTrainerOptions(user: User, sessionId: string): Promise<TrainerOption[]> {
  const data = await apiFetch<{ trainers: TrainerOption[] }>(
    user,
    `/sessions/${encodeURIComponent(sessionId)}/trainer-options`,
  );
  return data.trainers;
}

export async function updateSessionTrainer(
  user: User,
  sessionId: string,
  trainerId: string | null,
  expectedVersion: number,
  note: string,
): Promise<SessionTrainerUpdateResponse> {
  const data = await apiFetch<SessionTrainerUpdateResponse | Record<string, unknown>>(
    user,
    `/sessions/${encodeURIComponent(sessionId)}/trainer`,
    {
      method: 'PATCH',
      body: JSON.stringify({ trainerId, expectedVersion, note }),
    },
  );

  if (getResponseCode(data) === 'stale_session_version') {
    throw new ApiError(
      getResponseMessage(data) ?? 'This session changed after you opened it. Reload before trying again.',
      409,
      'stale_session_version',
      getCurrentVersion(data),
    );
  }

  return data as SessionTrainerUpdateResponse;
}

function throwIfPlannedRunStale(data: unknown): void {
  if (getResponseCode(data) === 'stale_planned_course_run_version') {
    throw new ApiError(
      getResponseMessage(data) ?? 'This planned run changed after you opened it. Reload before trying again.',
      409,
      'stale_planned_course_run_version',
      getCurrentVersion(data),
    );
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getApiMessage(response: Response, data: unknown): string {
  if (response.status === 401) {
    return 'Your session expired or is invalid. Sign in again.';
  }

  if (response.status === 403) {
    return getResponseMessage(data) ?? 'You are not authorized to access this area.';
  }

  return getResponseMessage(data) ?? `API request failed with status ${response.status}.`;
}

function getResponseMessage(data: unknown): string | null {
  if (typeof data === 'object' && data && 'error' in data) {
    const error = (data as { error?: unknown }).error;
    return typeof error === 'string' ? error : null;
  }

  if (typeof data === 'object' && data && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }

  return typeof data === 'string' ? data : null;
}

function getResponseCode(data: unknown): string | null {
  if (typeof data !== 'object' || !data || !('code' in data)) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function getCurrentVersion(data: unknown): number | null {
  if (typeof data !== 'object' || !data || !('currentVersion' in data)) return null;
  const currentVersion = (data as { currentVersion?: unknown }).currentVersion;
  return typeof currentVersion === 'number' ? currentVersion : null;
}
