import type { User } from 'firebase/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const data = (await response.json()) as T;

  if (!response.ok && response.status !== 409) {
    throw new Error((data as { error?: string }).error ?? 'API request failed');
  }

  return data;
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