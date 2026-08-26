import { Hono, type MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, SqlQuery, TransactionHandler } from '@training-planner/shared';
import { resolvePlanningProfile } from '../planning-profiles.js';

type PlannedCourseRunStatus = 'proposed' | 'approved' | 'scheduled';

type CoursePlanningRouteOptions = {
  db?: SqlQuery;
  auth?: MiddlewareHandler<AppEnv>;
  activeRoles?: MiddlewareHandler<AppEnv>;
  writeRoles?: MiddlewareHandler<AppEnv>;
  transaction?: <T>(handler: TransactionHandler<T>) => Promise<T>;
  currentMonth?: () => string;
};

type CourseRow = {
  code: string;
  name: string;
  programme_code: string | null;
  programme_name: string | null;
};

type VenueRow = {
  code: string;
  name: string;
  type: string;
};

type PlannedRunRow = {
  id: string;
  planning_month: string;
  course_code: string;
  venue_code: string;
  status: PlannedCourseRunStatus;
  note: string | null;
  version: number;
  created_by: string;
  created_by_email: string | null;
  created_by_name: string | null;
  approved_by: string | null;
  approved_by_email: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  scheduled_by: string | null;
  scheduled_by_email: string | null;
  scheduled_by_name: string | null;
  scheduled_at: string | null;
  session_id: string | null;
  session_status: string | null;
  session_start_date: string | null;
  session_end_date: string | null;
  created_at: string;
  updated_at: string;
};

type LockedRunRow = {
  id: string;
  planning_month: string;
  course_code: string;
  venue_code: string;
  status: PlannedCourseRunStatus;
  note: string | null;
  version: number;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  scheduled_by: string | null;
  scheduled_at: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
};

type CreatedSessionRow = {
  id: string;
  course_code: string;
  venue_code: string;
  status: 'draft';
  start_date: string;
  end_date: string;
  management_source: 'application';
  version: number;
};

class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    message: string,
    public readonly body: Record<string, unknown> = { error: message },
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function parseMonth(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 7) !== value) return undefined;
  return `${value}-01`;
}

function parseIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  return value;
}

function addMonths(month: string, amount: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function getSingaporeMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function getEvidenceVenueCode(venueCode: string): string {
  if (venueCode === 'FURAMA' || venueCode === 'HOLIDAYINN' || venueCode === 'SCOTTS') {
    return 'HOTEL';
  }
  return venueCode;
}

function actor(id: string | null, email: string | null, name: string | null) {
  return id ? { id, email, name } : null;
}

function mapRun(row: PlannedRunRow | LockedRunRow) {
  const rich = row as PlannedRunRow;
  return {
    id: row.id,
    planningMonth: row.planning_month.slice(0, 7),
    courseCode: row.course_code,
    venueCode: row.venue_code,
    status: row.status,
    note: row.note,
    version: row.version,
    createdBy: actor(row.created_by, rich.created_by_email ?? null, rich.created_by_name ?? null),
    approvedBy: actor(row.approved_by, rich.approved_by_email ?? null, rich.approved_by_name ?? null),
    approvedAt: row.approved_at,
    scheduledBy: actor(row.scheduled_by, rich.scheduled_by_email ?? null, rich.scheduled_by_name ?? null),
    scheduledAt: row.scheduled_at,
    session: row.session_id ? {
      id: row.session_id,
      status: rich.session_status ?? 'draft',
      startDate: rich.session_start_date ?? null,
      endDate: rich.session_end_date ?? null,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCreateBody(body: unknown):
  | { planningMonth: string; courseCode: string; venueCode: string; count: number; note: string | null }
  | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'JSON body is required' };
  const value = body as Record<string, unknown>;
  const planningMonth = parseMonth(typeof value.planningMonth === 'string' ? value.planningMonth : undefined);
  if (!planningMonth) return { error: 'planningMonth must use YYYY-MM format' };
  const courseCode = typeof value.courseCode === 'string' ? value.courseCode.trim() : '';
  if (!courseCode) return { error: 'courseCode is required' };
  const venueCode = typeof value.venueCode === 'string' ? value.venueCode.trim() : '';
  if (!venueCode) return { error: 'venueCode is required' };
  const count = Number(value.count);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    return { error: 'count must be an integer from 1 to 20' };
  }
  const note = typeof value.note === 'string' ? value.note.trim() : null;
  if (note !== null && note.length > 500) return { error: 'note must be 500 characters or fewer' };
  return { planningMonth, courseCode, venueCode, count, note: note || null };
}

function parseExpectedVersion(body: unknown): { expectedVersion: number } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'JSON body is required' };
  const expectedVersion = Number((body as Record<string, unknown>).expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return { error: 'expectedVersion must be a positive integer' };
  }
  return { expectedVersion };
}

function parseScheduleBody(body: unknown):
  | { expectedVersion: number; startDate: string; endDate: string }
  | { error: string } {
  const version = parseExpectedVersion(body);
  if ('error' in version) return version;
  const value = body as Record<string, unknown>;
  const startDate = parseIsoDate(value.startDate);
  const endDate = parseIsoDate(value.endDate);
  if (!startDate || !endDate) return { error: 'startDate and endDate must be valid YYYY-MM-DD dates' };
  if (endDate < startDate) return { error: 'endDate must be on or after startDate' };
  return { expectedVersion: version.expectedVersion, startDate, endDate };
}

function staleRun(version: number): HttpError {
  return new HttpError(409, 'This planned run changed after you opened it. Reload and try again.', {
    error: 'This planned run changed after you opened it. Reload and try again.',
    code: 'stale_planned_course_run_version',
    currentVersion: version,
  });
}

export function createCoursePlanningRoutes(options: CoursePlanningRouteOptions = {}): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const db: SqlQuery = options.db ?? ((query, params) => getDb()(query, params));
  const runTransaction = options.transaction ?? withTransaction;
  const currentMonth = options.currentMonth ?? getSingaporeMonth;

  routes.use(
    '/course-planning/*',
    options.auth ?? authMiddleware(),
    options.activeRoles ?? requireRole('admin', 'ops', 'finance', 'viewer'),
  );

  routes.get('/course-planning', async (c) => {
    const planningMonth = parseMonth(c.req.query('month'));
    const venueCode = c.req.query('venueCode')?.trim();
    if (!planningMonth) return c.json({ error: 'month must use YYYY-MM format' }, 400);
    if (!venueCode) return c.json({ error: 'venueCode is required' }, 400);

    const venues = await db<VenueRow>(
      `SELECT code, name, type::text AS type
       FROM venues
       ORDER BY lower(name) ASC, code ASC`,
    );
    const venue = venues.find((item) => item.code === venueCode);
    if (!venue) return c.json({ error: 'Venue not found' }, 404);

    const courses = await db<CourseRow>(
      `SELECT
        c.code,
        c.name,
        c.programme_code,
        p.name AS programme_name
       FROM courses c
       LEFT JOIN programmes p ON p.code = c.programme_code
       WHERE c.programme_code IS NULL OR p.status = 'active'
       ORDER BY COALESCE(p.name, 'Standalone') ASC, lower(c.name) ASC, c.code ASC`,
    );

    const runs = await db<PlannedRunRow>(
      `SELECT
        r.id,
        r.planning_month::text AS planning_month,
        r.course_code,
        r.venue_code,
        r.status::text AS status,
        r.note,
        r.version,
        r.created_by,
        cu.email AS created_by_email,
        cu.display_name AS created_by_name,
        r.approved_by,
        au.email AS approved_by_email,
        au.display_name AS approved_by_name,
        r.approved_at,
        r.scheduled_by,
        su.email AS scheduled_by_email,
        su.display_name AS scheduled_by_name,
        r.scheduled_at,
        r.session_id,
        s.status::text AS session_status,
        s.start_date::text AS session_start_date,
        s.end_date::text AS session_end_date,
        r.created_at,
        r.updated_at
       FROM planned_course_runs r
       LEFT JOIN users cu ON cu.id = r.created_by
       LEFT JOIN users au ON au.id = r.approved_by
       LEFT JOIN users su ON su.id = r.scheduled_by
       LEFT JOIN sessions s ON s.id = r.session_id
       WHERE r.planning_month = $1::date
         AND r.venue_code = $2
       ORDER BY r.course_code ASC, r.created_at ASC, r.id ASC`,
      [planningMonth, venueCode],
    );

    const runsByCourse = new Map<string, PlannedRunRow[]>();
    for (const run of runs) {
      const group = runsByCourse.get(run.course_code) ?? [];
      group.push(run);
      runsByCourse.set(run.course_code, group);
    }

    const evidenceVenueCode = getEvidenceVenueCode(venueCode);
    const courseRows = courses.map((course) => ({
      course: {
        code: course.code,
        name: course.name,
        programmeCode: course.programme_code,
        programmeName: course.programme_name,
      },
      venue,
      planningProfile: {
        ...resolvePlanningProfile(course.code, evidenceVenueCode),
        evidenceVenueCode,
      },
      runs: (runsByCourse.get(course.code) ?? []).map(mapRun),
    }));

    const historicalTarget = courseRows.reduce(
      (total, row) => total + (row.planningProfile.confirmedPerMonth ?? 0),
      0,
    );

    return c.json({
      meta: {
        planningMonth: planningMonth.slice(0, 7),
        venueCode,
        evidenceVenueCode,
        evidenceMode: 'committed_profiles_read_only',
      },
      summary: {
        plannedRuns: runs.length,
        historicalTarget: Math.round(historicalTarget * 100) / 100,
        unscheduledRuns: runs.filter((run) => run.status === 'approved' && !run.session_id).length,
        evidenceGaps: courseRows.filter((row) => (
          row.planningProfile.source === 'no_history' || row.planningProfile.source === 'unavailable'
        )).length,
      },
      filters: {
        venues,
        programmes: [...new Map(courses.map((course) => [
          course.programme_code ?? '__standalone',
          {
            code: course.programme_code,
            name: course.programme_name ?? 'Standalone',
          },
        ])).values()],
        historySources: ['direct', 'ft_proxy', 'no_history', 'unavailable'],
      },
      courses: courseRows,
    });
  });

  routes.post(
    '/course-planning/runs',
    options.writeRoles ?? requireRole('admin', 'ops'),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = parseCreateBody(body);
      if ('error' in parsed) return c.json({ error: parsed.error }, 400);

      const activeMonth = currentMonth();
      const requestedMonth = parsed.planningMonth.slice(0, 7);
      if (requestedMonth < activeMonth || requestedMonth > addMonths(activeMonth, 12)) {
        return c.json({
          error: 'New planned runs must be within the current Singapore month and 12 calendar months ahead.',
          code: 'planning_month_out_of_range',
        }, 422);
      }

      const { user } = c.get('auth');
      try {
        const created = await runTransaction(async (tx) => {
          const courseRows = await tx<CourseRow>(
            `SELECT c.code, c.name, c.programme_code, p.name AS programme_name
             FROM courses c
             LEFT JOIN programmes p ON p.code = c.programme_code
             WHERE c.code = $1
               AND (c.programme_code IS NULL OR p.status = 'active')`,
            [parsed.courseCode],
          );
          if (!courseRows[0]) {
            throw new HttpError(422, 'Course is not in the active planning catalog.', {
              error: 'Course is not in the active planning catalog.',
              code: 'inactive_or_unknown_course',
            });
          }

          const venueRows = await tx<VenueRow>(
            'SELECT code, name, type::text AS type FROM venues WHERE code = $1',
            [parsed.venueCode],
          );
          if (!venueRows[0]) throw new HttpError(404, 'Venue not found');

          return tx<PlannedRunRow>(
            `INSERT INTO planned_course_runs (
              planning_month, course_code, venue_code, note, created_by
             )
             SELECT $1::date, $2, $3, $4, $5
             FROM generate_series(1, $6::int)
             RETURNING
               id,
               planning_month::text AS planning_month,
               course_code,
               venue_code,
               status::text AS status,
               note,
               version,
               created_by,
               NULL::text AS created_by_email,
               NULL::text AS created_by_name,
               approved_by,
               NULL::text AS approved_by_email,
               NULL::text AS approved_by_name,
               approved_at,
               scheduled_by,
               NULL::text AS scheduled_by_email,
               NULL::text AS scheduled_by_name,
               scheduled_at,
               session_id,
               NULL::text AS session_status,
               NULL::text AS session_start_date,
               NULL::text AS session_end_date,
               created_at,
               updated_at`,
            [parsed.planningMonth, parsed.courseCode, parsed.venueCode, parsed.note, user.id, parsed.count],
          );
        });

        return c.json({ runs: created.map(mapRun) }, 201);
      } catch (error) {
        if (error instanceof HttpError) return c.json(error.body, error.status);
        throw error;
      }
    },
  );

  routes.patch(
    '/course-planning/runs/:id/approve',
    options.writeRoles ?? requireRole('admin', 'ops'),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = parseExpectedVersion(body);
      if ('error' in parsed) return c.json({ error: parsed.error }, 400);
      const { user } = c.get('auth');

      try {
        const updated = await runTransaction(async (tx) => {
          const locked = await lockRun(tx, c.req.param('id'));
          if (locked.version !== parsed.expectedVersion) throw staleRun(locked.version);
          if (locked.status !== 'proposed') {
            throw new HttpError(422, 'Only proposed runs can be approved.', {
              error: 'Only proposed runs can be approved.',
              code: 'planned_run_not_proposed',
            });
          }

          const rows = await tx<LockedRunRow>(
            `UPDATE planned_course_runs
             SET status = 'approved',
               approved_by = $2,
               approved_at = now(),
               version = version + 1,
               updated_at = now()
             WHERE id = $1 AND version = $3
             RETURNING *`,
            [locked.id, user.id, parsed.expectedVersion],
          );
          if (!rows[0]) throw staleRun(locked.version);
          return rows[0];
        });

        return c.json({ run: mapRun(updated) });
      } catch (error) {
        if (error instanceof HttpError) return c.json(error.body, error.status);
        throw error;
      }
    },
  );

  routes.post(
    '/course-planning/runs/:id/session',
    options.writeRoles ?? requireRole('admin', 'ops'),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = parseScheduleBody(body);
      if ('error' in parsed) return c.json({ error: parsed.error }, 400);
      const { user } = c.get('auth');

      try {
        const result = await runTransaction(async (tx) => {
          const locked = await lockRun(tx, c.req.param('id'));
          if (locked.version !== parsed.expectedVersion) throw staleRun(locked.version);
          if (locked.status !== 'approved' || locked.session_id) {
            throw new HttpError(422, 'Only approved, unscheduled runs can create a Session.', {
              error: 'Only approved, unscheduled runs can create a Session.',
              code: 'planned_run_not_schedulable',
            });
          }
          if (parsed.startDate.slice(0, 7) !== locked.planning_month.slice(0, 7)) {
            throw new HttpError(422, 'Session start date must fall within the planning month.', {
              error: 'Session start date must fall within the planning month.',
              code: 'session_start_outside_planning_month',
            });
          }

          const sessions = await tx<CreatedSessionRow>(
            `INSERT INTO sessions (
              course_code,
              venue_code,
              status,
              start_date,
              end_date,
              management_source,
              version,
              app_managed_at,
              app_managed_by
             ) VALUES ($1, $2, 'draft', $3::date, $4::date, 'application', 1, now(), $5)
             RETURNING
               id,
               course_code,
               venue_code,
               status::text AS status,
               start_date::text AS start_date,
               end_date::text AS end_date,
               management_source::text AS management_source,
               version`,
            [locked.course_code, locked.venue_code, parsed.startDate, parsed.endDate, user.id],
          );

          const updated = await tx<LockedRunRow>(
            `UPDATE planned_course_runs
             SET status = 'scheduled',
               scheduled_by = $2,
               scheduled_at = now(),
               session_id = $3,
               version = version + 1,
               updated_at = now()
             WHERE id = $1 AND version = $4
             RETURNING *`,
            [locked.id, user.id, sessions[0].id, parsed.expectedVersion],
          );
          if (!updated[0]) throw staleRun(locked.version);

          return {
            run: mapRun({
              ...updated[0],
              session_status: sessions[0].status,
              session_start_date: sessions[0].start_date,
              session_end_date: sessions[0].end_date,
            } as PlannedRunRow),
            session: {
              id: sessions[0].id,
              courseCode: sessions[0].course_code,
              venueCode: sessions[0].venue_code,
              status: sessions[0].status,
              startDate: sessions[0].start_date,
              endDate: sessions[0].end_date,
              managementSource: sessions[0].management_source,
              version: sessions[0].version,
              trainer: null,
              room: null,
              timeText: null,
              pax: null,
            },
          };
        });

        return c.json(result, 201);
      } catch (error) {
        if (error instanceof HttpError) return c.json(error.body, error.status);
        throw error;
      }
    },
  );

  return routes;
}

async function lockRun(db: SqlQuery, id: string): Promise<LockedRunRow> {
  const rows = await db<LockedRunRow>(
    `SELECT
      id,
      planning_month::text AS planning_month,
      course_code,
      venue_code,
      status::text AS status,
      note,
      version,
      created_by,
      approved_by,
      approved_at,
      scheduled_by,
      scheduled_at,
      session_id,
      created_at,
      updated_at
     FROM planned_course_runs
     WHERE id = $1
     FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'Planned run not found');
  return rows[0];
}
