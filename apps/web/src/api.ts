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
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number | null = null) {
    super(message);
    this.name = 'ApiError';
  }
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

export interface ParseResult {
  summary: {
    totalRows: number;
    validRows: number;
    inserts: number;
    updates: number;
    unchanged: number;
    skipped: number;
    cancellations: number;
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
  applied?: { applied: number; skipped: number };
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
    throw new ApiError(getApiMessage(response, data), response.status);
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