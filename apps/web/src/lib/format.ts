import type { PlanningIssue, PlanningSession, PlannedCourseRun, SessionHistoryEntry } from '../api.js';

export const issueLabels: Record<PlanningIssue, string> = {
  unassigned_trainer: 'Unassigned trainer',
  unresolved_venue: 'Unresolved venue',
  owned_venue_missing_room: 'Owned venue missing room',
  capacity_overrun: 'Room pax over capacity',
};

export const profileSourceLabels: Record<PlanningSession['planningProfile']['source'], string> = {
  direct: 'Direct history',
  ft_proxy: 'FT proxy history',
  no_history: 'No history',
  unavailable: 'Profile unavailable',
};

export function getProgrammeTone(code: string | null): string {
  const normalized = code?.toUpperCase() ?? '';
  if (normalized === 'ACDM' || normalized === 'FTDM') return 'blue';
  if (normalized === 'DDM') return 'teal';
  if (normalized === 'SDDM' || normalized === 'DGAI') return 'purple';
  if (normalized.includes('IIO')) return 'amber';
  return 'neutral';
}

export function formatPercent(value: number | null): string {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

export function formatNumber(value: number | null): string {
  if (value === null) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatMonths(months: string[]): string {
  return months.length ? months.join(', ') : '-';
}

export function formatPlanningActor(actor: PlannedCourseRun['createdBy'] | null): string {
  if (!actor) return 'Unknown user';
  return actor.name || actor.email || actor.id;
}

export function formatHistoryAction(action: SessionHistoryEntry['action']): string {
  const labels: Record<SessionHistoryEntry['action'], string> = {
    trainer_assigned: 'Trainer assigned',
    trainer_replaced: 'Trainer changed',
    trainer_unassigned: 'Trainer unassigned',
  };
  return labels[action];
}

export function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
