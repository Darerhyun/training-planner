import { randomUUID } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { authMiddleware, getDb, requireRole, withTransaction } from '@training-planner/shared';
import type { AppEnv, SqlQuery, TransactionHandler } from '@training-planner/shared';
import { HttpError } from '../lib/http-error.js';

type Row = Record<string, unknown> & { version: number; is_active: boolean };
type Definition = { table: string; entity: string; key: string; fields: string[]; immutable: string[]; target?: string; parent?: string };
const definitions: Record<string, Definition> = {
  courses: { table: 'courses', entity: 'course', key: 'code', fields: ['code', 'name', 'programme_code', 'duration_days', 'is_capstone', 'recently_added', 'notes'], immutable: ['code'] },
  venues: { table: 'venues', entity: 'venue', key: 'code', fields: ['code', 'name', 'type', 'address', 'notes'], immutable: ['code'] },
  rooms: { table: 'rooms', entity: 'room', key: 'room_id', fields: ['room_id', 'venue_code', 'name', 'capacity', 'notes'], immutable: ['room_id', 'venue_code'] },
  'course-aliases': { table: 'course_aliases', entity: 'course_alias', key: 'tms_code', fields: ['tms_code', 'catalog_code', 'notes'], immutable: ['tms_code'], target: 'catalog_code', parent: 'courses' },
  'venue-aliases': { table: 'venue_aliases', entity: 'venue_alias', key: 'alias', fields: ['alias', 'venue_code', 'notes'], immutable: ['alias'], target: 'venue_code', parent: 'venues' },
  'room-aliases': { table: 'room_aliases', entity: 'room_alias', key: 'id', fields: ['id', 'alias', 'venue_code', 'room_id', 'notes'], immutable: ['id', 'alias', 'venue_code'], target: 'room_id', parent: 'rooms' },
};
const lifecycle = ['is_active', 'version', 'created_at', 'updated_at'];
const columns = (d: Definition) => [...d.fields, ...lifecycle].join(',');
function invalid(message: string): never { throw new HttpError(400, message, { code: 'invalid_reference_data' }); }
function conflict(message: string, code = 'reference_data_conflict'): never { throw new HttpError(409, message, { code }); }
function definition(kind: string): Definition {
  const value = Object.hasOwn(definitions, kind) ? definitions[kind] : undefined;
  if (!value) throw new HttpError(404, 'Reference namespace not found', { code: 'reference_namespace_not_found' });
  return value;
}
function routeDefinition(c: Context<AppEnv>): Definition {
  const parent = definition(c.req.param('kind')!);
  if (parent.target) throw new HttpError(404, 'Reference namespace not found');
  return c.req.path.split('/')[5] === 'aliases' ? definition(`${parent.entity}-aliases`) : parent;
}
async function parentRecord(db: SqlQuery, c: Context<AppEnv>, lock = false): Promise<Row | null> {
  return c.req.path.split('/')[5] === 'aliases' ? row(db, definition(c.req.param('kind')!), c.req.param('id')!, lock) : null;
}
async function requestRecord(db: SqlQuery, d: Definition, c: Context<AppEnv>, lock = false): Promise<Row> {
  const parent = await parentRecord(db, c, lock);
  const record = await row(db, d, c.req.param('aliasId') ?? c.req.param('id')!, lock);
  if (parent && record[d.target!] !== parent[definition(c.req.param('kind')!).key]) throw new HttpError(404, 'Alias not found under this reference record', { code: 'reference_alias_not_found' });
  return record;
}
function text(value: unknown, name: string, required = true): string | null {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.trim().length > 500 || (required && !value.trim())) invalid(`${name} must be ${required ? '1–' : '0–'}500 characters`);
  return (value as string).trim() || null;
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid('expectedVersion must be a positive integer');
  return value as number;
}
function fields(d: Definition, input: Record<string, unknown>, create: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (['note', 'expectedVersion'].includes(key)) continue;
    if (!d.fields.includes(key) || (!create && d.immutable.includes(key)) || key === 'id') invalid(`${key} is not writable`);
    const value = input[key];
    if (key === 'capacity' || key === 'duration_days') {
      if (key === 'capacity' && value === null) result[key] = null;
      else if (typeof value !== 'number' || !Number.isFinite(value) || value < (key === 'capacity' ? 0 : Number.MIN_VALUE) || (key === 'capacity' && !Number.isSafeInteger(value))) invalid(`Invalid ${key}`);
      else result[key] = value;
    } else if (['is_capstone', 'recently_added'].includes(key)) {
      if (typeof value !== 'boolean') invalid(`Invalid ${key}`);
      result[key] = value;
    } else if (key === 'type') {
      if (!['owned', 'external', 'virtual'].includes(String(value))) invalid('Invalid venue type');
      result[key] = value;
    } else result[key] = text(value, key, !['notes', 'address', 'programme_code'].includes(key));
  }
  if (create) {
    const required = d.target ? d.fields.filter((f) => !['notes', 'id'].includes(f)) : d.table === 'courses' ? ['code', 'name', 'duration_days'] : d.table === 'venues' ? ['code', 'name', 'type'] : ['room_id', 'venue_code', 'name'];
    for (const key of required) if (result[key] == null) invalid(`${key} is required`);
    if (d.table === 'room_aliases') result.id = randomUUID();
  }
  return result;
}
async function row(db: SqlQuery, d: Definition, id: string, lock = false): Promise<Row> {
  if (d.key === 'id' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) invalid('Invalid alias ID');
  const [found] = await db<Row>(`SELECT ${columns(d)} FROM ${d.table} WHERE ${d.key}=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!found) throw new HttpError(404, 'Reference record not found', { code: 'reference_data_not_found' });
  return found;
}
async function dependencies(tx: SqlQuery, d: Definition, before: Row): Promise<void> {
  const clauses = d.table === 'courses' ? ['SELECT 1 FROM course_aliases WHERE catalog_code=$1 AND is_active']
    : d.table === 'venues' ? ['SELECT 1 FROM venue_aliases WHERE venue_code=$1 AND is_active', 'SELECT 1 FROM rooms WHERE venue_code=$1 AND is_active']
      : d.table === 'rooms' ? ['SELECT 1 FROM room_aliases WHERE room_id=$1 AND is_active'] : [];
  for (const clause of clauses) if ((await tx(`${clause} LIMIT 1`, [before[d.key]])).length) conflict('Deactivate active dependents separately first', 'active_reference_dependents');
}
async function targetGuard(tx: SqlQuery, d: Definition, after: Record<string, unknown>): Promise<void> {
  if (d.table === 'rooms' || d.table === 'room_aliases') {
    const venue = await row(tx, definitions.venues!, String(after.venue_code), true);
    if (!venue.is_active || venue.type !== 'owned') conflict('An active owned venue is required', 'invalid_reference_parent');
  }
  if (d.parent && d.target) {
    const parent = await row(tx, definitions[d.parent]!, String(after[d.target]), true);
    if (!parent.is_active || (d.table === 'room_aliases' && parent.venue_code !== after.venue_code)) conflict('An active target in the same scope is required', 'invalid_reference_target');
  }
}
async function audit(tx: SqlQuery, d: Definition, actor: string, action: string, before: Row | null, after: Row, note: string | null) {
  const revisions = await tx(`UPDATE reference_data_namespace_revisions SET revision=revision+1,updated_at=now() WHERE namespace=$1 RETURNING revision`, [d.table]);
  if (revisions.length !== 1) throw new Error('Reference namespace revision is missing');
  await tx(`INSERT INTO reference_data_change_events
    (entity_type,entity_id,namespace,actor_user_id,action,previous_version,new_version,previous_state,new_state,note)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
  [d.entity, String(after[d.key]), d.table, actor, `${d.entity}_${action}`, before?.version ?? null, after.version, before ? JSON.stringify(before) : null, JSON.stringify(after), note]);
}
export type AdminReferenceDataDeps = {
  db?: SqlQuery; transaction?: <T>(handler: TransactionHandler<T>) => Promise<T>;
  auth?: () => MiddlewareHandler<AppEnv>;
};
export function createAdminReferenceDataRoutes(deps: AdminReferenceDataDeps = {}) {
  const db: SqlQuery = deps.db ?? ((sql, params) => getDb()(sql, params));
  const transaction = deps.transaction ?? withTransaction;
  const routes = new Hono<AppEnv>();
  routes.use('/admin/reference-data/*', (deps.auth ?? authMiddleware)(), requireRole('admin'));
  routes.onError((error, c) => {
    if (error instanceof HttpError) return c.json(error.body, error.status);
    if ('code' in error && error.code === '23505') return c.json({ error: 'Normalized identity already exists', code: 'duplicate_reference_identity' }, 409);
    if ('code' in error && ['23503', '23514'].includes(String(error.code))) return c.json({ error: 'Reference constraint rejected the change', code: 'reference_constraint_conflict' }, 409);
    throw error;
  });
  routes.on('GET', ['/admin/reference-data/:kind', '/admin/reference-data/:kind/:id/aliases'], async (c) => {
    const d = routeDefinition(c); const parent = await parentRecord(db, c);
    const q = text(c.req.query('q') ?? '', 'q', false) ?? '';
    const state = c.req.query('state') ?? 'active';
    if (!['active', 'inactive', 'all'].includes(state)) invalid('Invalid state');
    const limit = Number(c.req.query('limit') ?? 50);
    const cursor = c.req.query('cursor') ?? '';
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor.length > 500) invalid('Invalid pagination');
    const search = d.fields.filter((f) => !['capacity', 'duration_days', 'is_capstone', 'recently_added'].includes(f)).map((f) => `strpos(lower(COALESCE(${f}::text,'')),lower($1))>0`).join(' OR ');
    const records = await db<Row>(`SELECT ${columns(d)} FROM ${d.table} WHERE ($1='' OR ${search}) AND ($2='all' OR is_active=($2='active')) AND ($4='' OR ${d.key}::text>$4)${parent ? ` AND ${d.target}=$5` : ''} ORDER BY ${d.key}::text LIMIT $3`, [q, state, limit + 1, cursor, ...(parent ? [parent[definition(c.req.param('kind')!).key]] : [])]);
    return c.json({ records: records.slice(0, limit), nextCursor: records.length > limit ? String(records[limit - 1]![d.key]) : null });
  });
  routes.on('GET', ['/admin/reference-data/:kind/:id/history', '/admin/reference-data/:kind/:id/aliases/:aliasId/history'], async (c) => {
    const d = routeDefinition(c);
    const record = await requestRecord(db, d, c);
    const limit = Number(c.req.query('limit') ?? 50); let cursor: { time: string; id: string } | null = null;
    if (c.req.query('cursor')) {
      try { cursor = JSON.parse(Buffer.from(c.req.query('cursor')!, 'base64url').toString()); } catch { invalid('Invalid cursor'); }
      if (!cursor || typeof cursor.time !== 'string' || !Number.isFinite(Date.parse(cursor.time)) || typeof cursor.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(cursor.id)) invalid('Invalid cursor');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid('Invalid pagination');
    const events = await db<Record<string, unknown>>(`SELECT id,entity_type,entity_id,actor_user_id,action,previous_version,new_version,previous_state,new_state,note,metadata,created_at FROM reference_data_change_events WHERE entity_type=$1 AND entity_id=$2 AND ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT $3`, [d.entity, String(record[d.key]), limit + 1, cursor?.time ?? null, cursor?.id ?? null]);
    const last = events[limit - 1];
    return c.json({ events: events.slice(0, limit), nextCursor: events.length > limit && last ? Buffer.from(JSON.stringify({ time: last.created_at, id: last.id })).toString('base64url') : null });
  });
  routes.on('GET', ['/admin/reference-data/:kind/:id', '/admin/reference-data/:kind/:id/aliases/:aliasId'], async (c) => c.json({ record: await requestRecord(db, routeDefinition(c), c) }));
  routes.on('POST', ['/admin/reference-data/:kind', '/admin/reference-data/:kind/:id/aliases'], async (c) => {
    const d = routeDefinition(c); const input: unknown = await c.req.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('JSON object required');
    const body = input as Record<string, unknown>;
    if (d.target) {
      if (body[d.target] != null && body[d.target] !== c.req.param('id')) invalid('Alias target must match its parent');
      body[d.target] = c.req.param('id');
    }
    const note = text(body.note, 'note', Boolean(d.target));
    const record = await transaction(async (tx) => {
      await tx('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['reference-data-writes']);
      const parent = await parentRecord(tx, c, true);
      if (d.table === 'room_aliases' && parent) {
        if (body.venue_code != null && body.venue_code !== parent.venue_code) invalid('Alias venue must match its room');
        body.venue_code = parent.venue_code;
      }
      const values = fields(d, body, true);
      await targetGuard(tx, d, values);
      const keys = Object.keys(values);
      const [after] = await tx<Row>(`INSERT INTO ${d.table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING ${columns(d)}`, Object.values(values));
      if (!after) throw new Error('Reference insert returned no record');
      await audit(tx, d, c.get('auth').user.id, 'created', null, after, note); return after;
    });
    return c.json({ record }, 201);
  });
  routes.on('POST', ['/admin/reference-data/:kind/:id/:action', '/admin/reference-data/:kind/:id/aliases/:aliasId/:action'], async (c) => {
    const d = routeDefinition(c); const action = c.req.param('action')!;
    if (!(d.target ? ['retarget', 'deactivate', 'reactivate'] : ['profile', 'deactivate', 'reactivate']).includes(action)) invalid('Invalid action');
    const input: unknown = await c.req.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('JSON object required');
    const body = input as Record<string, unknown>; const expected = version(body.expectedVersion);
    const note = text(body.note, 'note', action !== 'profile');
    const values = fields(d, body, false);
    if (action === 'retarget' && (Object.keys(values).some((key) => key !== d.target) || !values[d.target!])) invalid('Only the alias target can be retargeted');
    if (['deactivate', 'reactivate'].includes(action) && Object.keys(values).length) invalid('Lifecycle changes accept only version and note');
    if (action === 'profile' && !Object.keys(values).length) invalid('No profile fields supplied');
    const record = await transaction(async (tx) => {
      // All reference API writers share this lock; parent checks cannot race a dependent creation.
      await tx('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['reference-data-writes']);
      const before = await requestRecord(tx, d, c, true);
      if (before.version !== expected) throw new HttpError(409, 'Reload the reference record before saving', { code: 'stale_reference_version', currentVersion: before.version });
      if (action === 'deactivate') { if (!before.is_active) conflict('Record is already inactive'); await dependencies(tx, d, before); values.is_active = false; }
      if (action === 'reactivate') { if (before.is_active) conflict('Record is already active'); values.is_active = true; }
      const proposed = { ...before, ...values };
      if (proposed.is_active || action === 'retarget') await targetGuard(tx, d, proposed);
      if (d.table === 'venues' && before.type === 'owned' && proposed.type !== 'owned' && (await tx('SELECT 1 FROM rooms WHERE venue_code=$1 LIMIT 1', [before.code])).length) conflict('Owned venue type cannot change while rooms exist', 'venue_has_rooms');
      const keys = Object.keys(values);
      const [after] = await tx<Row>(`UPDATE ${d.table} SET ${keys.map((key, i) => `${key}=$${i + 3}`).join(',')},version=version+1,updated_at=now() WHERE ${d.key}=$1 AND version=$2 RETURNING ${columns(d)}`, [before[d.key], expected, ...Object.values(values)]);
      if (!after) conflict('Reload the reference record before saving', 'stale_reference_version');
      await audit(tx, d, c.get('auth').user.id, action === 'profile' ? 'updated' : action === 'retarget' ? 'retargeted' : `${action}d`, before, after, note); return after;
    });
    return c.json({ record });
  });
  return routes;
}
export const adminReferenceDataRoutes = createAdminReferenceDataRoutes();
