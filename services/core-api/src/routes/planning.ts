import { Hono, type MiddlewareHandler } from 'hono';
import { authMiddleware, getDb, requireRole } from '@training-planner/shared';
import type { AppEnv, SessionStatus, SqlQuery } from '@training-planner/shared';
import { resolvePlanningProfile } from '../planning-profiles.js';

const allowedStatuses = new Set<SessionStatus>([
  'draft',
  'confirmed',
  'cancelled',
  'completed',
]);

const allowedIssues = new Set([
  'unassigned_trainer',
  'unresolved_venue',
  'owned_venue_missing_room',
  'capacity_overrun',
]);

type PlanningIssue =
  | 'unassigned_trainer'
  | 'unresolved_venue'
  | 'owned_venue_missing_room'
  | 'capacity_overrun';

type PlanningRouteOptions = {
  db?: SqlQuery;
  auth?: MiddlewareHandler<AppEnv>;
  roles?: MiddlewareHandler<AppEnv>;
};

type PlanningSessionRow = {
  id: string;
  external_ref: string | null;
  course_code: string | null;
  tms_code: string | null;
  course_name: string | null;
  programme_code: string | null;
  trainer_id: string | null;
  trainer_name: string | null;
  raw_trainer_name: string | null;
  venue_code: string | null;
  venue_name: string | null;
  venue_type: string | null;
  raw_venue_text: string | null;
  room_id: string | null;
  room_name: string | null;
  room_capacity: number | null;
  status: SessionStatus;
  start_date: string;
  end_date: string;
  time_text: string | null;
  span_days: number;
  expected_pax: number | null;
  confirmed_pax: number | null;
  management_source: 'import' | 'application';
  version: number;
  unassigned_trainer: boolean;
  unresolved_venue: boolean;
  owned_venue_missing_room: boolean;
  capacity_overrun: boolean;
};

type SummaryRow = {
  total: number;
  draft: number;
  confirmed: number;
  cancelled: number;
  completed: number;
  unassigned_trainer: number;
  unresolved_venue: number;
  owned_venue_missing_room: number;
  capacity_overrun: number;
  needs_attention: number;
};

const needsAttentionPredicate = [
  's.trainer_id IS NULL',
  's.venue_code IS NULL',
  "(v.type = 'owned' AND s.room_id IS NULL)",
  '(r.capacity IS NOT NULL AND COALESCE(s.confirmed_pax, s.expected_pax) > r.capacity)',
].join(' OR ');

function parseIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10) === value ? value : undefined;
}

function daysBetweenInclusive(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((toTime - fromTime) / 86_400_000) + 1;
}

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(parsed, 250);
}

function encodeCursor(row: PlanningSessionRow): string {
  return Buffer.from(
    JSON.stringify({ startDate: row.start_date, id: row.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string | undefined): { startDate: string; id: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      startDate?: unknown;
      id?: unknown;
    };
    if (typeof parsed.startDate !== 'string' || typeof parsed.id !== 'string') return undefined;
    if (!parseIsoDate(parsed.startDate)) return undefined;
    return { startDate: parsed.startDate, id: parsed.id };
  } catch {
    return undefined;
  }
}

function addFilter(
  filters: string[],
  params: unknown[],
  sql: string,
  value: unknown,
): void {
  params.push(value);
  filters.push(sql.replace('?', `$${params.length}`));
}

function buildWhere(params: unknown[], options: {
  from: string;
  to: string;
  includeCancelled: boolean;
  statuses: SessionStatus[];
  programme?: string;
  trainerId?: string;
  venueCode?: string;
  roomId?: string;
  issues: PlanningIssue[];
  needsAttention: boolean;
}): string {
  const filters = [
    's.end_date >= $1::date',
    's.start_date <= $2::date',
  ];

  if (!options.includeCancelled) {
    filters.push("s.status <> 'cancelled'");
  }

  if (options.statuses.length > 0) {
    addFilter(filters, params, 's.status::text = ANY(?::text[])', options.statuses);
  }

  if (options.programme === '__standalone') {
    filters.push('c.programme_code IS NULL');
  } else if (options.programme) {
    addFilter(filters, params, 'c.programme_code = ?', options.programme);
  }

  if (options.trainerId) {
    addFilter(filters, params, 's.trainer_id = ?', options.trainerId);
  }

  if (options.venueCode === '__unresolved') {
    filters.push('s.venue_code IS NULL');
  } else if (options.venueCode) {
    addFilter(filters, params, 's.venue_code = ?', options.venueCode);
  }

  if (options.roomId === '__unassigned') {
    filters.push('s.room_id IS NULL');
  } else if (options.roomId) {
    addFilter(filters, params, 's.room_id = ?', options.roomId);
  }

  for (const issue of options.issues) {
    if (issue === 'unassigned_trainer') filters.push('s.trainer_id IS NULL');
    if (issue === 'unresolved_venue') filters.push('s.venue_code IS NULL');
    if (issue === 'owned_venue_missing_room') filters.push("v.type = 'owned' AND s.room_id IS NULL");
    if (issue === 'capacity_overrun') {
      filters.push('r.capacity IS NOT NULL AND COALESCE(s.confirmed_pax, s.expected_pax) > r.capacity');
    }
  }

  if (options.needsAttention) filters.push(needsAttentionPredicate);

  return filters.map((filter) => `(${filter})`).join(' AND ');
}

function mapSession(row: PlanningSessionRow) {
  const effectivePax = row.confirmed_pax ?? row.expected_pax;
  return {
    id: row.id,
    externalRef: row.external_ref,
    course: {
      code: row.course_code,
      tmsCode: row.tms_code,
      name: row.course_name,
      programmeCode: row.programme_code,
    },
    trainer: {
      id: row.trainer_id,
      name: row.trainer_name,
      rawName: row.raw_trainer_name,
    },
    venue: {
      code: row.venue_code,
      name: row.venue_name,
      type: row.venue_type,
      rawText: row.raw_venue_text,
    },
    room: {
      id: row.room_id,
      name: row.room_name,
      capacity: row.room_capacity,
    },
    dates: {
      start: row.start_date,
      end: row.end_date,
      spanDays: row.span_days,
      timeText: row.time_text,
    },
    pax: {
      expected: row.expected_pax,
      confirmed: row.confirmed_pax,
      effective: effectivePax,
    },
    status: row.status,
    managementSource: row.management_source,
    version: row.version,
    issues: {
      unassignedTrainer: row.unassigned_trainer,
      unresolvedVenue: row.unresolved_venue,
      ownedVenueMissingRoom: row.owned_venue_missing_room,
      capacityOverrun: row.capacity_overrun,
    },
    planningProfile: resolvePlanningProfile(row.course_code, row.venue_code),
  };
}

export function createPlanningRoutes(options: PlanningRouteOptions = {}): Hono<AppEnv> {
  const planningRoutes = new Hono<AppEnv>();
  const db = options.db ?? getDb();

  planningRoutes.use(
    '/planning/*',
    options.auth ?? authMiddleware(),
    options.roles ?? requireRole('admin', 'ops', 'finance', 'viewer'),
  );

  planningRoutes.get('/planning/sessions', async (c) => {
    const from = parseIsoDate(c.req.query('from'));
    const to = parseIsoDate(c.req.query('to'));
    if (!from || !to) {
      return c.json({ error: 'from and to are required ISO dates in YYYY-MM-DD format' }, 400);
    }
    if (from > to) {
      return c.json({ error: 'from must be on or before to' }, 400);
    }
    if (daysBetweenInclusive(from, to) > 366) {
      return c.json({ error: 'date range must not exceed one year' }, 400);
    }

    const statuses = parseList(c.req.query('status'));
    const invalidStatus = statuses.find((status) => !allowedStatuses.has(status as SessionStatus));
    if (invalidStatus) return c.json({ error: `invalid status: ${invalidStatus}` }, 400);

    const issues = parseList(c.req.query('issue'));
    const invalidIssue = issues.find((issue) => !allowedIssues.has(issue));
    if (invalidIssue) return c.json({ error: `invalid issue: ${invalidIssue}` }, 400);

    const includeCancelled = parseBoolean(c.req.query('includeCancelled'));
    const limit = parseLimit(c.req.query('limit'));
    const cursor = decodeCursor(c.req.query('cursor'));
    if (c.req.query('cursor') && !cursor) return c.json({ error: 'invalid cursor' }, 400);

    const params: unknown[] = [from, to];
    const where = buildWhere(params, {
      from,
      to,
      includeCancelled,
      statuses: statuses as SessionStatus[],
      programme: c.req.query('programme'),
      trainerId: c.req.query('trainerId'),
      venueCode: c.req.query('venueCode'),
      roomId: c.req.query('roomId'),
      issues: issues as PlanningIssue[],
      needsAttention: parseBoolean(c.req.query('needsAttention')),
    });

    const summaryRows = await db<SummaryRow>(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE s.status = 'draft')::int AS draft,
        COUNT(*) FILTER (WHERE s.status = 'confirmed')::int AS confirmed,
        COUNT(*) FILTER (WHERE s.status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE s.status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE s.trainer_id IS NULL)::int AS unassigned_trainer,
        COUNT(*) FILTER (WHERE s.venue_code IS NULL)::int AS unresolved_venue,
        COUNT(*) FILTER (WHERE v.type = 'owned' AND s.room_id IS NULL)::int AS owned_venue_missing_room,
        COUNT(*) FILTER (WHERE r.capacity IS NOT NULL AND COALESCE(s.confirmed_pax, s.expected_pax) > r.capacity)::int AS capacity_overrun,
        COUNT(*) FILTER (WHERE (${needsAttentionPredicate}))::int AS needs_attention
       FROM sessions s
       LEFT JOIN courses c ON c.code = s.course_code
       LEFT JOIN venues v ON v.code = s.venue_code
       LEFT JOIN rooms r ON r.room_id = s.room_id
       WHERE ${where}`,
      params,
    );

    const pageParams = [...params];
    const pageFilters = [where];
    if (cursor) {
      pageParams.push(cursor.startDate, cursor.id);
      pageFilters.push(`(s.start_date, s.id) > ($${pageParams.length - 1}::date, $${pageParams.length}::uuid)`);
    }
    pageParams.push(limit + 1);

    const rows = await db<PlanningSessionRow>(
      `SELECT
        s.id,
        s.external_ref,
        s.course_code,
        s.tms_code,
        COALESCE(c.name, s.source_course_name) AS course_name,
        c.programme_code,
        s.trainer_id,
        COALESCE(t.name, s.raw_trainer_name) AS trainer_name,
        s.raw_trainer_name,
        s.venue_code,
        v.name AS venue_name,
        v.type::text AS venue_type,
        s.raw_venue_text,
        s.room_id,
        r.name AS room_name,
        r.capacity AS room_capacity,
        s.status,
        s.start_date::text AS start_date,
        s.end_date::text AS end_date,
        s.time_text,
        (s.end_date - s.start_date + 1)::int AS span_days,
        s.expected_pax,
        s.confirmed_pax,
        s.management_source::text AS management_source,
        s.version,
        (s.trainer_id IS NULL) AS unassigned_trainer,
        (s.venue_code IS NULL) AS unresolved_venue,
        (v.type = 'owned' AND s.room_id IS NULL) AS owned_venue_missing_room,
        (r.capacity IS NOT NULL AND COALESCE(s.confirmed_pax, s.expected_pax) > r.capacity) AS capacity_overrun
       FROM sessions s
       LEFT JOIN courses c ON c.code = s.course_code
       LEFT JOIN trainers t ON t.trainer_id = s.trainer_id
       LEFT JOIN venues v ON v.code = s.venue_code
       LEFT JOIN rooms r ON r.room_id = s.room_id
       WHERE ${pageFilters.map((filter) => `(${filter})`).join(' AND ')}
       ORDER BY s.start_date ASC, s.id ASC
       LIMIT $${pageParams.length}`,
      pageParams,
    );

    const programmes = await db(
      `SELECT code, name, status::text AS status
       FROM programmes
       ORDER BY code`,
    );
    const standalone = await db<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM courses WHERE programme_code IS NULL',
    );
    const trainers = await db(
      `SELECT trainer_id AS id, name, is_active
       FROM trainers
       ORDER BY name`,
    );
    const venues = await db(
      `SELECT code, name, type::text AS type
       FROM venues
       ORDER BY code`,
    );
    const rooms = await db(
      `SELECT room_id AS id, venue_code, name, capacity
       FROM rooms
       ORDER BY venue_code, name`,
    );

    const pageRows = rows.slice(0, limit);
    const summary = summaryRows[0] ?? {
      total: 0,
      draft: 0,
      confirmed: 0,
      cancelled: 0,
      completed: 0,
      unassigned_trainer: 0,
      unresolved_venue: 0,
      owned_venue_missing_room: 0,
      capacity_overrun: 0,
      needs_attention: 0,
    };

    return c.json({
      meta: {
        filterMode: 'session_span_overlap',
        spanFilter: 'end_date >= from AND start_date <= to',
        trainingDayConflictDetection: 'deferred_until_authoritative_training_dates_exist',
      },
      summary: {
        dateRange: { from, to },
        total: summary.total,
        byStatus: {
          draft: summary.draft,
          confirmed: summary.confirmed,
          cancelled: summary.cancelled,
          completed: summary.completed,
        },
        issues: {
          unassignedTrainers: summary.unassigned_trainer,
          unresolvedVenues: summary.unresolved_venue,
          ownedVenuesWithoutRooms: summary.owned_venue_missing_room,
          capacityOverruns: summary.capacity_overrun,
          needsAttention: summary.needs_attention,
        },
      },
      filters: {
        programmes: [
          ...programmes,
          ...(standalone[0]?.count ? [{ code: '__standalone', name: 'Standalone courses', status: 'active' }] : []),
        ],
        trainers,
        venues: [
          ...venues,
          { code: '__unresolved', name: 'Unresolved venue', type: null },
        ],
        rooms: [
          ...rooms,
          { id: '__unassigned', venue_code: null, name: 'Unassigned room', capacity: null },
        ],
        issues: [...allowedIssues].sort(),
      },
      sessions: pageRows.map(mapSession),
      page: {
        limit,
        nextCursor: rows.length > limit ? encodeCursor(pageRows[pageRows.length - 1]) : null,
      },
    });
  });

  return planningRoutes;
}
