import { randomUUID } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, SqlQuery, TransactionHandler } from '@training-planner/shared';
import { HttpError } from '../lib/http-error.js';

type Trainer = {
  trainer_id: string; name: string; notes: string | null; is_active: boolean;
  version: number; eligibility_version: number; scheduling_readiness: 'ready' | 'needs_setup';
  readiness_origin: 'grandfathered' | 'admin_confirmed' | null;
  readiness_confirmed_at: string | null; readiness_confirmed_by: string | null;
  readiness_version: number | null; exclusions_acknowledged_at: string | null;
  exclusions_acknowledged_by: string | null; exclusions_acknowledged_version: number | null;
  created_at: string; updated_at: string;
};
type Link = { course_code: string; is_sme: boolean };
type Alias = { id: number; alias_name: string; source: string | null };
type Action = 'trainer_created' | 'trainer_updated' | 'trainer_deactivated' | 'trainer_reactivated'
  | 'alias_added' | 'alias_removed' | 'course_access_changed' | 'scheduling_readiness_changed';
export type AdminTrainersRouteDeps = {
  db?: SqlQuery; transaction?: <T>(handler: TransactionHandler<T>) => Promise<T>;
  auth?: () => MiddlewareHandler<AppEnv>; role?: () => MiddlewareHandler<AppEnv>;
};

const columns = `trainer_id,name,notes,is_active,version,eligibility_version,scheduling_readiness,
  readiness_origin,readiness_confirmed_at,readiness_confirmed_by,readiness_version,
  exclusions_acknowledged_at,exclusions_acknowledged_by,exclusions_acknowledged_version,created_at,updated_at`;
const selectedColumns = columns.split(',').map((column) => `t.${column.trim()}`).join(',');
const impactPredicate = `s.status NOT IN ('cancelled','completed')
  AND s.end_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::date`;
const resetFields = `scheduling_readiness='needs_setup',readiness_origin=NULL,
  readiness_confirmed_at=NULL,readiness_confirmed_by=NULL,readiness_version=NULL,
  exclusions_acknowledged_at=NULL,exclusions_acknowledged_by=NULL,exclusions_acknowledged_version=NULL`;

export function normalizeTrainerName(value: string): string { return value.trim().replace(/\s+/g, ' '); }
function invalid(message: string, code = 'invalid_request'): never { throw new HttpError(400, message, { code }); }
function positive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(`${field} must be a positive integer`, `invalid_${field}`);
  return value as number;
}
function nameInput(value: unknown): string {
  if (typeof value !== 'string') invalid('name is required', 'invalid_name');
  const name = normalizeTrainerName(value as string);
  if (name.length < 2 || name.length > 120) invalid('name must be 2–120 characters', 'invalid_name');
  return name;
}
function noteInput(value: unknown, required = false): string | null {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.trim().length > 500 || (required && !value.trim())) invalid('note must be 1–500 characters when required', 'invalid_note');
  return (value as string).trim() || null;
}
async function bodyInput(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required', 'invalid_json');
  return body as Record<string, unknown>;
}
function stale(currentVersion: number): never {
  throw new HttpError(409, 'This trainer changed after you opened it. Reload the latest version before saving.', { code: 'stale_trainer_version', currentVersion });
}
async function trainerRow(db: SqlQuery, id: string, lock = false): Promise<Trainer> {
  const rows = await db<Trainer>(`SELECT ${columns} FROM trainers WHERE trainer_id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Trainer not found', { code: 'trainer_not_found' });
  return rows[0];
}
async function identityLock(tx: SqlQuery) {
  // Serialize name/alias preflight across registration, profile and alias writes.
  await tx('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['pr3j.trainer-identities']);
}
async function rejectDuplicate(tx: SqlQuery, name: string, exceptId: string | null = null) {
  const rows = await tx<{ trainer_id: string }>(
    `SELECT trainer_id FROM trainers
     WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))=lower($1)
       AND ($2::text IS NULL OR trainer_id<>$2)
     UNION ALL SELECT trainer_id FROM trainer_aliases
     WHERE lower(regexp_replace(btrim(alias_name), '\\s+', ' ', 'g'))=lower($1) LIMIT 1`, [name, exceptId]);
  if (rows.length) throw new HttpError(409, 'A trainer name or alias already matches this name', { code: 'duplicate_trainer_identity' });
}
async function event(tx: SqlQuery, actor: string, action: Action, before: Trainer | null, after: Trainer, note: string | null, metadata: Record<string, unknown>) {
  await tx(`INSERT INTO trainer_change_events
    (trainer_id,actor_user_id,action,previous_is_active,new_is_active,
     previous_scheduling_readiness,new_scheduling_readiness,previous_version,new_version,
     previous_eligibility_version,new_eligibility_version,note,metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
  [after.trainer_id, actor, action, before?.is_active ?? null, after.is_active,
    before?.scheduling_readiness ?? null, after.scheduling_readiness, before?.version ?? null, after.version,
    before?.eligibility_version ?? null, after.eligibility_version, note, JSON.stringify(metadata)]);
}
async function update(tx: SqlQuery, before: Trainer, assignments: string, values: unknown[] = []): Promise<Trainer> {
  const rows = await tx<Trainer>(`UPDATE trainers SET ${assignments},version=version+1,updated_at=now()
    WHERE trainer_id=$1 AND version=$2 RETURNING ${columns}`, [before.trainer_id, before.version, ...values]);
  if (!rows[0]) stale(before.version);
  return rows[0];
}
async function impact(db: SqlQuery, id: string): Promise<number> {
  const rows = await db<{ count: number }>(`SELECT count(*)::integer AS count FROM sessions s WHERE s.trainer_id=$1 AND ${impactPredicate}`, [id]);
  if (!rows[0] || !Number.isSafeInteger(rows[0].count) || rows[0].count < 0) {
    throw new HttpError(503, 'Upcoming-session impact could not be checked. Retry before deactivating.', { code: 'deactivation_impact_unavailable' });
  }
  return rows[0].count;
}
async function linksAndExclusions(db: SqlQuery, id: string) {
  const links = await db<Link>('SELECT course_code,is_sme FROM trainer_courses WHERE trainer_id=$1 ORDER BY course_code', [id]);
  const exclusions = await db<{ course_code: string }>('SELECT course_code FROM trainer_course_exclusions WHERE trainer_id=$1 ORDER BY course_code', [id]);
  return { links, exclusions: exclusions.map((row) => row.course_code) };
}

export function createAdminTrainersRoutes(deps: AdminTrainersRouteDeps = {}) {
  const db: SqlQuery = deps.db ?? ((sql, params) => getDb()(sql, params));
  const transaction = deps.transaction ?? withTransaction;
  const routes = new Hono<AppEnv>();
  routes.use('/admin/trainers/*', (deps.auth ?? authMiddleware)(), (deps.role ?? (() => requireRole('admin')))());
  routes.onError((error, c) => {
    if (error instanceof HttpError) return c.json(error.body, error.status);
    if ('code' in error && error.code === '23505') return c.json({ error: 'A trainer name or alias already exists', code: 'duplicate_trainer_identity' }, 409);
    throw error;
  });

  routes.get('/admin/trainers', async (c) => {
    const state = c.req.query('state') ?? 'needs_setup';
    if (!['ready', 'needs_setup', 'inactive'].includes(state)) invalid('Invalid state');
    const query = (c.req.query('q') ?? '').trim();
    if (query.length > 200) invalid('Search is too long');
    const limit = Number(c.req.query('limit') ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('limit must be 1–100');
    let cursor: { name: string; id: string } | null = null;
    if (c.req.query('cursor')) {
      try {
        const decoded: unknown = JSON.parse(Buffer.from(c.req.query('cursor')!, 'base64url').toString());
        if (!decoded || typeof decoded !== 'object' || !('name' in decoded) || !('id' in decoded)
          || typeof decoded.name !== 'string' || typeof decoded.id !== 'string') invalid('Invalid cursor');
        cursor = decoded as { name: string; id: string };
      } catch { invalid('Invalid cursor'); }
    }
    const [result] = await db<{ trainers: (Trainer & Record<string, unknown>)[]; counts: Record<string, number>; filteredCount: number }>(`
      WITH directory AS (
        SELECT ${selectedColumns},
          CASE WHEN NOT t.is_active THEN 'inactive' ELSE t.scheduling_readiness::text END AS state,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'alias_name',a.alias_name,'source',a.source) ORDER BY lower(a.alias_name),a.id)
            FROM trainer_aliases a WHERE a.trainer_id=t.trainer_id),'[]'::jsonb) AS aliases,
          (SELECT count(*)::integer FROM trainer_courses l WHERE l.trainer_id=t.trainer_id AND NOT EXISTS
            (SELECT 1 FROM trainer_course_exclusions x WHERE x.trainer_id=l.trainer_id AND x.course_code=l.course_code)) AS eligible_course_count,
          (SELECT count(*)::integer FROM trainer_courses l WHERE l.trainer_id=t.trainer_id AND l.is_sme AND NOT EXISTS
            (SELECT 1 FROM trainer_course_exclusions x WHERE x.trainer_id=l.trainer_id AND x.course_code=l.course_code)) AS sme_count,
          (SELECT count(*)::integer FROM trainer_course_exclusions x WHERE x.trainer_id=t.trainer_id) AS exclusion_count,
          (SELECT count(*)::integer FROM sessions s WHERE s.trainer_id=t.trainer_id AND ${impactPredicate}) AS upcoming_session_count,
          (SELECT jsonb_build_object('id',u.id,'displayName',u.display_name,'email',u.email) FROM trainer_change_events e
            JOIN users u ON u.id=e.actor_user_id WHERE e.trainer_id=t.trainer_id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS updated_by,
          (SELECT c.code FROM trainer_courses l JOIN courses c ON c.code=l.course_code WHERE l.trainer_id=t.trainer_id
            AND (strpos(lower(c.code),lower($2))>0 OR strpos(lower(c.name),lower($2))>0) ORDER BY c.code LIMIT 1) AS matched_course
        FROM trainers t
      ), filtered AS (
        SELECT * FROM directory d WHERE state=$1 AND ($2='' OR strpos(lower(name),lower($2))>0 OR matched_course IS NOT NULL
          OR EXISTS (SELECT 1 FROM trainer_aliases a WHERE a.trainer_id=d.trainer_id AND strpos(lower(a.alias_name),lower($2))>0))
      ), page AS (
        SELECT * FROM filtered WHERE $3::text IS NULL OR (lower(name),trainer_id)>($3,$4)
        ORDER BY lower(name),trainer_id LIMIT $5
      ) SELECT COALESCE((SELECT jsonb_agg(page ORDER BY lower(name),trainer_id) FROM page),'[]'::jsonb) AS trainers,
        (SELECT jsonb_build_object('ready',count(*) FILTER (WHERE state='ready'),
          'needs_setup',count(*) FILTER (WHERE state='needs_setup'),'inactive',count(*) FILTER (WHERE state='inactive')) FROM directory) AS counts,
        (SELECT count(*)::integer FROM filtered) AS "filteredCount"`, [state, query, cursor?.name ?? null, cursor?.id ?? null, limit + 1]);
    const trainers = result.trainers.slice(0, limit);
    const last = trainers.at(-1);
    const nextCursor = result.trainers.length > limit && last
      ? Buffer.from(JSON.stringify({ name: last.name.toLowerCase(), id: last.trainer_id })).toString('base64url') : null;
    return c.json({ trainers, counts: result.counts, filteredCount: result.filteredCount, nextCursor });
  });

  routes.get('/admin/trainers/courses', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    if (query.length > 200) invalid('Search is too long');
    const courses = await db(`SELECT c.code,c.name,c.programme_code,p.name AS programme_name
      FROM courses c LEFT JOIN programmes p ON p.code=c.programme_code
      WHERE (c.programme_code IS NULL OR p.status='active')
        AND ($1='' OR strpos(lower(c.code),lower($1))>0 OR strpos(lower(c.name),lower($1))>0)
      ORDER BY COALESCE(p.name,'Standalone'),lower(c.name),c.code`, [query]);
    return c.json({ courses });
  });
  routes.get('/admin/trainers/:id', async (c) => {
    const trainer = await trainerRow(db, c.req.param('id'));
    const aliases = await db<Alias>('SELECT id,alias_name,source FROM trainer_aliases WHERE trainer_id=$1 ORDER BY lower(alias_name),id', [trainer.trainer_id]);
    const links = await db(`SELECT l.course_code,l.is_sme,c.name,c.programme_code,p.name AS programme_name,
      EXISTS (SELECT 1 FROM trainer_course_exclusions x WHERE x.trainer_id=l.trainer_id AND x.course_code=l.course_code) AS excluded
      FROM trainer_courses l JOIN courses c ON c.code=l.course_code LEFT JOIN programmes p ON p.code=c.programme_code
      WHERE l.trainer_id=$1 ORDER BY COALESCE(p.name,'Standalone'),c.code`, [trainer.trainer_id]);
    const exclusions = await db(`SELECT x.course_code,c.name,c.programme_code,p.name AS programme_name
      FROM trainer_course_exclusions x JOIN courses c ON c.code=x.course_code LEFT JOIN programmes p ON p.code=c.programme_code
      WHERE x.trainer_id=$1 ORDER BY c.code`, [trainer.trainer_id]);
    return c.json({ trainer: { ...trainer, aliases, links, exclusions } });
  });
  routes.get('/admin/trainers/:id/history', async (c) => {
    await trainerRow(db, c.req.param('id'));
    const events = await db(`SELECT e.id,e.trainer_id,e.action,e.previous_is_active,e.new_is_active,
      e.previous_scheduling_readiness,e.new_scheduling_readiness,e.previous_version,e.new_version,
      e.previous_eligibility_version,e.new_eligibility_version,e.note,e.metadata,e.created_at,
      jsonb_build_object('id',u.id,'displayName',u.display_name,'email',u.email) AS actor
      FROM trainer_change_events e JOIN users u ON u.id=e.actor_user_id
      WHERE e.trainer_id=$1 ORDER BY e.created_at DESC,e.id DESC`, [c.req.param('id')]);
    return c.json({ events });
  });
  routes.get('/admin/trainers/:id/deactivation-impact', async (c) => {
    const trainer = await trainerRow(db, c.req.param('id'));
    return c.json({ trainerId: trainer.trainer_id, version: trainer.version, upcomingSessionCount: await impact(db, trainer.trainer_id) });
  });
  routes.post('/admin/trainers', async (c) => {
    const body = await bodyInput(c);
    if ('trainer_id' in body || 'trainerId' in body || 'id' in body) invalid('Trainer ID is assigned by the server', 'immutable_trainer_id');
    const name = nameInput(body.name); const notes = noteInput(body.notes);
    const trainer = await transaction(async (tx) => {
      await identityLock(tx); await rejectDuplicate(tx, name);
      const [created] = await tx<Trainer>(`INSERT INTO trainers (trainer_id,name,notes,is_active,scheduling_readiness,version,eligibility_version)
        VALUES ($1,$2,$3,true,'needs_setup',1,1) RETURNING ${columns}`, [`tr_${randomUUID()}`, name, notes]);
      await event(tx, c.get('auth').user.id, 'trainer_created', null, created, null, { name, notes });
      return created;
    });
    return c.json({ trainer }, 201);
  });

  // All existing-record mutations share a row lock, strict expectedVersion,
  // one version increment, and exactly one append-only event in the transaction.
  function mutation(method: 'post' | 'patch' | 'put' | 'delete', path: string, action: Action,
    perform: (tx: SqlQuery, before: Trainer, body: Record<string, unknown>, c: Context<AppEnv>) => Promise<{ trainer: Trainer; metadata: Record<string, unknown> }>, identity = false) {
    routes[method](path, async (c) => {
      const body = await bodyInput(c); const expected = positive(body.expectedVersion, 'expectedVersion');
      const note = noteInput(body.note, action === 'alias_removed');
      const trainer = await transaction(async (tx) => {
        if (identity) await identityLock(tx);
        // FIX: generic mutation contexts do not infer named route parameters.
        const before = await trainerRow(tx, c.req.param('id') ?? '', true);
        if (before.version !== expected) stale(before.version);
        const result = await perform(tx, before, body, c);
        await event(tx, c.get('auth').user.id, action, before, result.trainer, note, result.metadata);
        return result.trainer;
      });
      return c.json({ trainer });
    });
  }
  mutation('patch', '/admin/trainers/:id/profile', 'trainer_updated', async (tx, before, body) => {
    if ('trainer_id' in body || 'trainerId' in body || 'id' in body) invalid('Trainer ID is immutable', 'immutable_trainer_id');
    const name = nameInput(body.name); const notes = noteInput(body.notes);
    await rejectDuplicate(tx, name, before.trainer_id);
    return { trainer: await update(tx, before, 'name=$3,notes=$4', [name, notes]),
      metadata: { before: { name: before.name, notes: before.notes }, after: { name, notes } } };
  }, true);
  mutation('put', '/admin/trainers/:id/eligibility', 'course_access_changed', async (tx, before, body) => {
    if (!Array.isArray(body.links) || !Array.isArray(body.exclusions)) invalid('links and exclusions must be arrays');
    const links: Link[] = (body.links as unknown[]).map((entry) => {
      if (!entry || typeof entry !== 'object' || !('courseCode' in entry) || typeof entry.courseCode !== 'string'
        || !('isSme' in entry) || typeof entry.isSme !== 'boolean' || !entry.courseCode.trim()) invalid('Each link requires courseCode and isSme');
      const link = entry as { courseCode: string; isSme: boolean };
      return { course_code: link.courseCode.trim(), is_sme: link.isSme };
    });
    const exclusions: string[] = (body.exclusions as unknown[]).map((entry) => {
      if (typeof entry !== 'string' || !entry.trim()) invalid('Each exclusion must be a course code');
      return (entry as string).trim();
    }).sort();
    if (new Set(links.map((l) => l.course_code)).size !== links.length || new Set(exclusions).size !== exclusions.length) invalid('Duplicate links or exclusions', 'duplicate_course_access');
    const previous = await linksAndExclusions(tx, before.trainer_id);
    const added = links.filter((l) => !previous.links.some((old) => old.course_code === l.course_code));
    const removed = previous.links.filter((l) => !links.some((next) => next.course_code === l.course_code));
    const exclusionsAdded = exclusions.filter((code) => !previous.exclusions.includes(code));
    const exclusionsRemoved = previous.exclusions.filter((code) => !exclusions.includes(code));
    const smeChanged = links.filter((l) => previous.links.some((old) => old.course_code === l.course_code && old.is_sme !== l.is_sme));
    // Historical obsolete links remain editable/removable; only additions use the active catalogue.
    const newCodes = [...new Set([...added.map((l) => l.course_code), ...exclusionsAdded])];
    if (newCodes.length) {
      const active = await tx<{ code: string }>(`SELECT c.code FROM courses c LEFT JOIN programmes p ON p.code=c.programme_code
        WHERE c.code=ANY($1::text[]) AND (c.programme_code IS NULL OR p.status='active')`, [newCodes]);
      if (active.length !== newCodes.length) invalid('New links and exclusions require active canonical courses', 'invalid_course');
    }
    for (const link of removed) await tx('DELETE FROM trainer_courses WHERE trainer_id=$1 AND course_code=$2', [before.trainer_id, link.course_code]);
    for (const link of [...added, ...smeChanged]) await tx(`INSERT INTO trainer_courses (trainer_id,course_code,is_sme) VALUES ($1,$2,$3)
      ON CONFLICT (trainer_id,course_code) DO UPDATE SET is_sme=EXCLUDED.is_sme`, [before.trainer_id, link.course_code, link.is_sme]);
    for (const code of exclusionsRemoved) await tx('DELETE FROM trainer_course_exclusions WHERE trainer_id=$1 AND course_code=$2', [before.trainer_id, code]);
    for (const code of exclusionsAdded) await tx('INSERT INTO trainer_course_exclusions (trainer_id,course_code) VALUES ($1,$2)', [before.trainer_id, code]);
    const reset = removed.length > 0 || exclusionsAdded.length > 0;
    const trainer = await update(tx, before, `module_excludes=$3::text[],eligibility_version=eligibility_version+1,
      ${reset ? resetFields : 'exclusions_acknowledged_version=CASE WHEN exclusions_acknowledged_version=eligibility_version THEN eligibility_version+1 ELSE NULL END'}`, [exclusions]);
    return { trainer, metadata: { linksAdded: added.map((l) => l.course_code), linksRemoved: removed.map((l) => l.course_code),
      smeEnabled: [...added, ...smeChanged].filter((l) => l.is_sme).map((l) => l.course_code),
      smeDisabled: [...removed, ...smeChanged].filter((l) => removed.includes(l) ? l.is_sme : !l.is_sme).map((l) => l.course_code),
      exclusionsAdded, exclusionsRemoved, readinessReset: reset } };
  });
  mutation('post', '/admin/trainers/:id/readiness/confirm', 'scheduling_readiness_changed', async (tx, before, body, c) => {
    const eligibility = positive(body.expectedEligibilityVersion, 'expectedEligibilityVersion');
    if (eligibility !== before.eligibility_version) throw new HttpError(409, 'Eligibility changed; reload before confirming', { code: 'stale_trainer_eligibility_version', currentVersion: before.version });
    if (body.acknowledgeExclusions !== true) invalid('Module exclusions must be acknowledged', 'exclusions_acknowledgement_required');
    if (!before.is_active) throw new HttpError(409, 'Inactive trainers cannot be confirmed', { code: 'inactive_trainer' });
    const { links, exclusions } = await linksAndExclusions(tx, before.trainer_id);
    const effective = links.filter((l) => !exclusions.includes(l.course_code));
    if (!effective.length) throw new HttpError(422, 'At least one effective eligible course is required', { code: 'no_effective_courses' });
    const trainer = await update(tx, before, `scheduling_readiness='ready',readiness_origin='admin_confirmed',
      readiness_confirmed_at=now(),readiness_confirmed_by=$3,readiness_version=version+1,
      exclusions_acknowledged_at=now(),exclusions_acknowledged_by=$3,exclusions_acknowledged_version=eligibility_version`, [c.get('auth').user.id]);
    return { trainer, metadata: { eligibilityVersion: eligibility, exclusionsAcknowledged: true, effectiveCourseCount: effective.length } };
  });
  mutation('post', '/admin/trainers/:id/aliases', 'alias_added', async (tx, before, body) => {
    const aliasName = nameInput(body.aliasName);
    await rejectDuplicate(tx, aliasName);
    const [alias] = await tx<Alias>(`INSERT INTO trainer_aliases (trainer_id,alias_name,source) VALUES ($1,$2,'admin') RETURNING id,alias_name,source`, [before.trainer_id, aliasName]);
    return { trainer: await update(tx, before, 'name=name'), metadata: { aliasId: alias.id, aliasName: alias.alias_name, source: alias.source } };
  }, true);
  mutation('delete', '/admin/trainers/:id/aliases/:aliasId', 'alias_removed', async (tx, before, body, c) => {
    // FIX: generic mutation contexts do not infer named route parameters.
    const rawId = c.req.param('aliasId') ?? '';
    if (normalizeTrainerName(rawId).toLowerCase() === normalizeTrainerName(before.name).toLowerCase() || rawId === before.trainer_id) invalid('The primary name cannot be removed', 'primary_name_removal_forbidden');
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) invalid('Invalid alias ID');
    const [alias] = await tx<Alias>('SELECT id,alias_name,source FROM trainer_aliases WHERE trainer_id=$1 AND id=$2 FOR UPDATE', [before.trainer_id, Number(rawId)]);
    if (!alias) throw new HttpError(404, 'Alias not found', { code: 'alias_not_found' });
    if (normalizeTrainerName(alias.alias_name).toLowerCase() === normalizeTrainerName(before.name).toLowerCase()) invalid('The primary name cannot be removed', 'primary_name_removal_forbidden');
    await tx('DELETE FROM trainer_aliases WHERE trainer_id=$1 AND id=$2', [before.trainer_id, alias.id]);
    return { trainer: await update(tx, before, 'name=name'), metadata: { aliasId: alias.id, aliasName: alias.alias_name, source: alias.source, note: noteInput(body.note, true) } };
  });
  mutation('post', '/admin/trainers/:id/deactivate', 'trainer_deactivated', async (tx, before, body) => {
    if (!before.is_active) throw new HttpError(409, 'Trainer is already inactive', { code: 'invalid_trainer_transition' });
    if (body.acknowledgeAssignments !== true) invalid('Existing assignments must be acknowledged', 'assignments_acknowledgement_required');
    const upcomingSessionCount = await impact(tx, before.trainer_id);
    return { trainer: await update(tx, before, `is_active=false,${resetFields}`), metadata: { upcomingSessionCount, assignmentsPreserved: true, readinessReset: true } };
  });
  mutation('post', '/admin/trainers/:id/reactivate', 'trainer_reactivated', async (tx, before) => {
    if (before.is_active) throw new HttpError(409, 'Trainer is already active', { code: 'invalid_trainer_transition' });
    return { trainer: await update(tx, before, `is_active=true,${resetFields}`), metadata: {} };
  });
  return routes;
}

export const adminTrainersRoutes = createAdminTrainersRoutes();
