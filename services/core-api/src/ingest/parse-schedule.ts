import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { getDb } from '@training-planner/shared';
import type { SqlQuery } from '@training-planner/shared';
import {
  createCourseResolver,
  createTrainerResolver,
  createVenueResolver,
  hasScheduleSourceValues,
  mapMasterScheduleRow,
  MASTER_SCHEDULE_DATA_START_ROW,
  MASTER_SCHEDULE_HEADER_ROW,
  resolveMasterScheduleColumns,
  type MappedScheduleRow,
  type ScheduleAlertCode,
  type ScheduleParseAlert,
} from './master-schedule-mapping.js';
import { loadScheduleLookups } from './reference-data.js';

export interface ScheduleParseResult {
  rows: MappedScheduleRow[];
  alerts: ScheduleParseAlert[];
  conflicts: ScheduleImportConflict[];
  summary: {
    totalRows: number;
    validRows: number;
    inserts: number;
    updates: number;
    unchanged: number;
    skipped: number;
    cancellations: number;
    conflicts: number;
    existingSessions: number;
    changeCount: number;
    autoApplied: boolean;
    requiresConfirmation: boolean;
    blocked: boolean;
    blockReason: string | null;
  };
  previewDigest?: string;
  resolution?: ScheduleResolution;
}

export const SCHEDULE_PARSER_VERSION = 'sync-resolution-1';
export const REFERENCE_NAMESPACES = ['course_aliases', 'courses', 'room_aliases', 'rooms', 'venue_aliases', 'venues'] as const;

export interface ScheduleRowDecision {
  sourceRowId: string;
  action: 'skip';
  reason: string;
  actorId: string;
  decidedAt: string;
}

export interface ScheduleRowOutcome {
  sourceRowId: string;
  rowNumber: number;
  outcome: 'apply' | 'skipped' | 'blocked';
  operation: 'insert' | 'update' | 'unchanged' | 'cancellation' | null;
  canSkip: boolean;
  correspondenceProven: boolean;
  externalRef: string | null;
  sessionId: string | null;
  issues: string[];
  reason: string | null;
}

export interface ScheduleResolution {
  rechecked: boolean;
  decisions: ScheduleRowDecision[];
  outcomes: ScheduleRowOutcome[];
  counts: { total: number; apply: number; skipped: number; blocked: number };
  cancellation: {
    numerator: number;
    denominator: number;
    sourceRowIds: string[];
    sessionIds: string[];
    denominatorSessions: Array<{ id: string; version: number }>;
    hardBlocked: boolean;
  };
  freshness: {
    objectName: string;
    workbookSha256: string;
    parserVersion: string;
    namespaceRevisions: Array<{ namespace: string; revision: string }>;
    trainerReferenceDigest: string;
    resolvedTrainers: Array<{ trainer_id: string; version: number; is_active: boolean; scheduling_readiness: string }>;
    sessions: Array<{ externalRef: string; sessionId: string | null; version: number | null }>;
  };
}

export interface SchedulePreview extends ScheduleParseResult {
  previewDigest: string;
}

export interface ScheduleImportConflict {
  externalRef: string;
  rowNumber: number;
  sessionId: string;
  reason: 'application_managed_difference';
  fields: ScheduleImportConflictField[];
}

export interface ScheduleImportConflictField {
  field: string;
  current: string | number | null;
  incoming: string | number | null;
}

export interface ScheduleApplyResult {
  applied: number;
  skipped: number;
  unchanged: number;
  conflicts: ScheduleImportConflict[];
}

export class ScheduleApplyBlockedError extends Error {
  constructor() {
    super('Schedule Preview is blocked and cannot be applied.');
    this.name = 'ScheduleApplyBlockedError';
  }
}

export class ScheduleApplyConflictError extends Error {
  constructor(public readonly conflicts: ScheduleImportConflict[]) {
    super('An application-managed session conflict was discovered while applying the Preview.');
    this.name = 'ScheduleApplyConflictError';
  }
}

export class ScheduleApplyStaleError extends Error {
  constructor(message = 'A session changed while the schedule was being applied.') {
    super(message);
    this.name = 'ScheduleApplyStaleError';
  }
}

const BLOCKING_ALERT_CODES: ReadonlySet<ScheduleAlertCode> = new Set([
  'course_not_supplied',
  'unknown_course',
  'unknown_trainer',
  'unknown_venue',
  'unknown_room',
  'start_date_not_supplied',
  'invalid_start_date',
  'end_date_not_supplied',
  'invalid_end_date',
  'invalid_date_range',
  'invalid_expected_pax',
  'invalid_confirmed_pax',
  'status_not_supplied',
  'invalid_status',
]);

export function isBlockingScheduleAlertCode(code: string): boolean {
  return BLOCKING_ALERT_CODES.has(code as ScheduleAlertCode);
}

export function isSchedulePreviewBlocked(result: ScheduleParseResult): boolean {
  if (result.resolution) {
    return result.summary.blocked || result.resolution.counts.blocked > 0 || result.resolution.cancellation.hardBlocked;
  }
  const alerts = [
    ...result.alerts,
    ...result.rows.flatMap((row) => row.alerts),
  ];
  const cancellationGuard =
    result.summary.existingSessions > 0 &&
    result.summary.cancellations > result.summary.existingSessions / 2;

  return (
    result.summary.blocked ||
    result.conflicts.length > 0 ||
    cancellationGuard ||
    alerts.some((alert) => isBlockingScheduleAlertCode(alert.code))
  );
}

export function computeSchedulePreviewDigest(
  result: ScheduleParseResult & {
    applied?: ScheduleApplyResult;
  },
): string {
  const { previewDigest: _previewDigest, applied: _applied, ...previewPayload } = result;
  return createHash('sha256').update(stableSerialize(previewPayload)).digest('hex');
}

export function createSchedulePreview(result: ScheduleParseResult): SchedulePreview {
  return {
    ...result,
    previewDigest: computeSchedulePreviewDigest(result),
  };
}

interface ExistingSessionRow {
  id: string;
  external_ref: string;
  management_source: 'import' | 'application';
  course_code: string | null;
  trainer_id: string | null;
  venue_code: string | null;
  room_id: string | null;
  status: string;
  start_date: string;
  end_date: string;
  expected_pax: number | null;
  confirmed_pax: number | null;
  time_text: string | null;
  version: number;
}

type ScheduleRowClassification =
  | { kind: 'skipped' }
  | { kind: 'insert'; externalRef: string }
  | { kind: 'unchanged'; externalRef: string }
  | { kind: 'update'; externalRef: string; existing: ExistingSessionRow }
  | { kind: 'conflict'; externalRef: string; conflict: ScheduleImportConflict };

export async function parseScheduleWorkbook(buffer: Buffer, db: SqlQuery = getDb()): Promise<ScheduleParseResult> {
  const lookups = await loadScheduleLookups(db);
  const resolvers = {
    courses: createCourseResolver(lookups.courseAliases, lookups.courses),
    trainers: createTrainerResolver(lookups.trainerAliases, lookups.trainers),
    venues: createVenueResolver(lookups.venues, lookups.rooms, lookups.venueAliases, lookups.roomAliases),
  };

  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Workbook has no sheets');
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error('First worksheet is empty');
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    raw: false,
  });
  const headerRow = rawRows[MASTER_SCHEDULE_HEADER_ROW - 1];
  if (!headerRow) {
    throw new Error(`Schedule header row ${MASTER_SCHEDULE_HEADER_ROW} is missing.`);
  }
  const columns = resolveMasterScheduleColumns(headerRow);

  const mappedRows = rawRows
    .slice(MASTER_SCHEDULE_DATA_START_ROW - 1)
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => hasScheduleSourceValues(row, columns))
    .map(({ row, index }) =>
      mapMasterScheduleRow(
        row,
        index + MASTER_SCHEDULE_DATA_START_ROW,
        resolvers,
        columns,
      ),
    );

  return summarizeRows(mappedRows, db);
}

/** Acquire the same reference-write mutex as the Admin API, then prevent both
 * session phantoms and non-cooperating trainer/reference writes. Table locks
 * are transaction-scoped; no session write begins before the complete snapshot
 * is validated. Sessions are locked first because trainer amendments lock a
 * session before consulting trainer state. */
export async function lockScheduleResolution(db: SqlQuery): Promise<void> {
  await db('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['reference-data-writes']);
  await db('LOCK TABLE sessions IN SHARE ROW EXCLUSIVE MODE');
  await db('LOCK TABLE course_aliases, courses, reference_data_namespace_revisions, room_aliases, rooms, trainer_aliases, trainers, venue_aliases, venues IN SHARE MODE');
}

export function scheduleSourceRowId(batchId: string, workbookSha256: string, rowNumber: number): string {
  return createHash('sha256').update(stableSerialize([batchId, workbookSha256, rowNumber])).digest('hex');
}

/** Called only with the transaction's resolution locks held. Reads contain no
 * fees, economics, reference writes or inferred training dates. */
export async function resolveSchedulePreview(
  parsed: ScheduleParseResult,
  context: { batchId: string; objectName: string; workbookSha256: string; rechecked: boolean },
  decisions: ScheduleRowDecision[],
  db: SqlQuery,
): Promise<SchedulePreview> {
  const namespaceRevisions = await db<{ namespace: string; revision: string }>(
    'SELECT namespace, revision::text AS revision FROM reference_data_namespace_revisions ORDER BY namespace',
  );
  if (namespaceRevisions.length !== 6 || REFERENCE_NAMESPACES.some((name, index) =>
    namespaceRevisions[index]?.namespace !== name || !/^[1-9]\d*$/.test(namespaceRevisions[index]?.revision ?? ''))) {
    throw new Error('The six reference namespace revisions must be available before Sync.');
  }
  const trainers = await db<{ trainer_id: string; name: string; version: number; is_active: boolean; scheduling_readiness: string }>(
    'SELECT trainer_id, name, version, is_active, scheduling_readiness::text FROM trainers ORDER BY trainer_id',
  );
  const trainerAliases = await db<{ id: number; trainer_id: string; alias_name: string; source: string | null }>(
    'SELECT id, trainer_id, alias_name, source FROM trainer_aliases ORDER BY id',
  );
  const existingRows = await db<ExistingSessionRow>(
    `SELECT id, external_ref, management_source::text AS management_source,
      course_code, trainer_id, venue_code, room_id, status,
      start_date::text, end_date::text, expected_pax, confirmed_pax, time_text, version
     FROM sessions WHERE external_ref IS NOT NULL ORDER BY external_ref, id`,
  );
  const existingByRef = new Map(existingRows.map((row) => [row.external_ref, row]));
  const refs = parsed.rows.map((row) => row.startDate && row.endDate ? buildExternalRef(row) : null);
  const sourceIds = parsed.rows.map((row) => scheduleSourceRowId(context.batchId, context.workbookSha256, row.rowNumber));
  if (new Set(sourceIds).size !== sourceIds.length) throw new ScheduleApplyStaleError('Source row identities are not unique.');
  const decisionById = new Map(decisions.map((decision) => [decision.sourceRowId, decision]));
  if (decisionById.size !== decisions.length || decisions.some((decision) =>
    !sourceIds.includes(decision.sourceRowId) || decision.action !== 'skip' ||
    !decision.reason.trim() || decision.reason !== decision.reason.trim() || decision.reason.length > 500)) {
    throw new ScheduleApplyStaleError('Stored row decisions do not match this workbook.');
  }
  const conflicts: ScheduleImportConflict[] = [];
  let inserts = 0; let updates = 0; let unchanged = 0;
  const outcomes = parsed.rows.map((row, index): ScheduleRowOutcome => {
    const externalRef = refs[index];
    const existing = externalRef ? existingByRef.get(externalRef) ?? null : null;
    const classification = classifyScheduleRow(existing, row, externalRef ?? '');
    const blockers = row.alerts.filter((alert) => isBlockingScheduleAlertCode(alert.code));
    const malformed = blockers.some((alert) => !['unknown_course', 'unknown_trainer', 'unknown_venue', 'unknown_room'].includes(alert.code));
    const stableIds = [...new Set([row.aliasBatchId, row.batchId].filter(
      (value): value is string => Boolean(value && /^[A-Z]+-\d{4}-\d+$/.test(value)),
    ))];
    const duplicate = externalRef !== null && (refs.filter((ref) => ref === externalRef).length !== 1 ||
      existingRows.filter((session) => session.external_ref === externalRef).length > 1);
    // Unresolved fallback identity cannot prove correspondence: its course may
    // change after reference repair. Conflicting source batch IDs also fail closed.
    const correspondenceProven = Boolean(externalRef && !duplicate && stableIds.length <= 1 &&
      (stableIds.length === 1 || (row.courseCode && row.tmsCode && !malformed)));
    const issues = blockers.map((alert) => alert.message);
    if (duplicate) issues.push('Duplicate source correspondence must be corrected in the workbook.');
    if (stableIds.length > 1) issues.push('Conflicting source batch IDs prevent safe correspondence.');
    if (classification.kind === 'conflict') {
      conflicts.push(classification.conflict);
      issues.push('This row differs from an application-managed session.');
    }
    const canSkip = correspondenceProven && !malformed &&
      (blockers.length > 0 || classification.kind === 'conflict');
    const decision = decisionById.get(sourceIds[index]);
    if (decision && !canSkip) {
      throw new ScheduleApplyStaleError('A skip no longer has a skippable issue with proven cancellation correspondence.');
    }
    const outcome = decision ? 'skipped' :
      blockers.length > 0 || duplicate || stableIds.length > 1 || classification.kind === 'conflict' || classification.kind === 'skipped'
        ? 'blocked' : 'apply';
    const operation = outcome !== 'apply' ? null : row.status === 'cancelled' ? 'cancellation' :
      classification.kind === 'insert' ? 'insert' : classification.kind === 'update' ? 'update' : 'unchanged';
    if (outcome === 'apply') {
      if (classification.kind === 'insert') inserts++;
      if (classification.kind === 'update') updates++;
      if (classification.kind === 'unchanged') unchanged++;
    }
    return { sourceRowId: sourceIds[index], rowNumber: row.rowNumber, outcome, operation, canSkip,
      correspondenceProven, externalRef, sessionId: existing?.id ?? null, issues, reason: decision?.reason ?? null };
  });
  // Preserve the legacy guard: every non-skipped explicit cancelled source row
  // is in the numerator, even a new or already-cancelled session. It is NOT the
  // count of matched existing IDs, and workbook absence never proposes a cancel.
  const cancellations = outcomes.filter((outcome, index) =>
    outcome.outcome !== 'skipped' && parsed.rows[index].status === 'cancelled');
  const hardBlocked = existingRows.length > 0 && cancellations.length > existingRows.length / 2;
  const counts = { total: outcomes.length, apply: 0, skipped: 0, blocked: 0 };
  for (const outcome of outcomes) counts[outcome.outcome]++;
  const blocked = counts.blocked > 0 || hardBlocked;
  const resolution: ScheduleResolution = {
    rechecked: context.rechecked,
    decisions: [...decisions].sort((left, right) => compareExternalRefs(left.sourceRowId, right.sourceRowId)),
    outcomes, counts,
    cancellation: {
      numerator: cancellations.length, denominator: existingRows.length,
      sourceRowIds: cancellations.map((outcome) => outcome.sourceRowId).sort(),
      sessionIds: [...new Set(cancellations.flatMap((outcome) => outcome.sessionId ? [outcome.sessionId] : []))].sort(),
      denominatorSessions: existingRows.map((row) => ({ id: row.id, version: row.version })).sort((a, b) => compareExternalRefs(a.id, b.id)),
      hardBlocked,
    },
    freshness: {
      objectName: context.objectName, workbookSha256: context.workbookSha256, parserVersion: SCHEDULE_PARSER_VERSION,
      namespaceRevisions,
      trainerReferenceDigest: createHash('sha256').update(stableSerialize({ trainers, trainerAliases })).digest('hex'),
      resolvedTrainers: trainers.filter((trainer) => parsed.rows.some((row) => row.trainerId === trainer.trainer_id))
        .map(({ trainer_id, version, is_active, scheduling_readiness }) => ({ trainer_id, version, is_active, scheduling_readiness })),
      sessions: [...new Set(refs.filter((ref): ref is string => ref !== null))].sort().map((externalRef) => ({
        externalRef, sessionId: existingByRef.get(externalRef)?.id ?? null, version: existingByRef.get(externalRef)?.version ?? null,
      })),
    },
  };
  return createSchedulePreview({
    rows: parsed.rows, alerts: parsed.rows.flatMap((row) => row.alerts), conflicts,
    summary: {
      totalRows: counts.total, validRows: counts.apply, inserts, updates, unchanged, skipped: counts.skipped,
      cancellations: cancellations.length, conflicts: outcomes.filter((row) => row.outcome === 'blocked' && conflicts.some((conflict) => conflict.rowNumber === row.rowNumber)).length,
      existingSessions: existingRows.length, changeCount: inserts + updates,
      autoApplied: false, requiresConfirmation: true, blocked,
      blockReason: blocked ? [counts.blocked ? 'Resolve or safely skip every blocked row, then Re-check.' : '',
        hardBlocked ? 'More than 50% explicit cancellations is a hard block; no override is available.' : ''].filter(Boolean).join(' ') : null,
    },
    resolution,
  });
}

export async function applyScheduleParseResult(
  batchId: string,
  parseResult: ScheduleParseResult,
  db: SqlQuery = getDb(),
): Promise<ScheduleApplyResult> {
  if (isSchedulePreviewBlocked(parseResult)) {
    throw new ScheduleApplyBlockedError();
  }

  let applied = 0;
  let skipped = 0;
  let unchanged = 0;

  const skippedIds = new Set(parseResult.resolution?.outcomes.filter((row) => row.outcome === 'skipped').map((row) => row.rowNumber));
  const orderedRows = parseResult.rows
    .filter((row) => !skippedIds.has(row.rowNumber))
    .map((row, sourceIndex) => ({
      row,
      sourceIndex,
      externalRef: row.startDate && row.endDate ? buildExternalRef(row) : null,
    }))
    .filter(
      (entry): entry is {
        row: MappedScheduleRow;
        sourceIndex: number;
        externalRef: string;
      } => entry.externalRef !== null,
    )
    .sort(
      (left, right) =>
        compareExternalRefs(left.externalRef, right.externalRef) ||
        left.sourceIndex - right.sourceIndex,
    );
  skipped = parseResult.rows.length - orderedRows.length;

  const externalRefs = [
    ...new Set(orderedRows.map((entry) => entry.externalRef)),
  ];
  const existingByRef = new Map(
    (await findExistingSessions(db, externalRefs)).map((row) => [row.external_ref, row]),
  );

  // Preflight all ownership-sensitive rows before the first write. The
  // surrounding route transaction still protects against a race discovered
  // after this pass, but this keeps an already-known conflict from allowing
  // any safe row to be applied alongside it.
  const projectedByRef = new Map(existingByRef);
  const preflightConflicts: ScheduleImportConflict[] = [];
  for (const { row, externalRef, sourceIndex } of orderedRows) {
    const classification = classifyScheduleRow(
      projectedByRef.get(externalRef) ?? null,
      row,
      externalRef,
    );

    if (classification.kind === 'conflict') {
      preflightConflicts.push(classification.conflict);
      continue;
    }
    if (classification.kind === 'insert') {
      projectedByRef.set(
        externalRef,
        createExistingSessionFromRow(row, `preview-${sourceIndex}`),
      );
      continue;
    }
    if (classification.kind === 'update') {
      projectedByRef.set(externalRef, projectExistingSession(classification.existing, row));
    }
  }

  if (preflightConflicts.length > 0) {
    throw new ScheduleApplyConflictError(preflightConflicts);
  }

  const applyExisting = async (
    existing: ExistingSessionRow,
    row: MappedScheduleRow,
    externalRef: string,
  ): Promise<void> => {
    const classification = classifyScheduleRow(existing, row, externalRef);
    if (classification.kind === 'conflict') {
      throw new ScheduleApplyConflictError([classification.conflict]);
    }
    if (classification.kind === 'unchanged') {
      applied += 1;
      unchanged += 1;
      return;
    }
    if (classification.kind !== 'update') {
      throw new Error('Unexpected schedule row classification during apply.');
    }

    const updated = await updateImportManagedSession(
      db,
      existing.id,
      existing.version,
      batchId,
      row,
    );
    if (!updated) {
      throw new ScheduleApplyStaleError(
        'Import-managed session changed while the schedule was being applied.',
      );
    }
    existingByRef.set(externalRef, updated);
    applied += 1;
  };

  for (const { row, externalRef, sourceIndex } of orderedRows) {
    const classification = classifyScheduleRow(
      existingByRef.get(externalRef) ?? null,
      row,
      externalRef,
    );

    if (classification.kind === 'skipped') {
      skipped += 1;
      continue;
    }
    if (classification.kind === 'conflict') {
      throw new ScheduleApplyConflictError([classification.conflict]);
    }
    if (classification.kind === 'unchanged') {
      applied += 1;
      unchanged += 1;
      continue;
    }
    if (classification.kind === 'update') {
      await applyExisting(classification.existing, row, externalRef);
      continue;
    }

    const inserted = await insertImportManagedSession(db, batchId, row, externalRef);
    if (inserted) {
      existingByRef.set(externalRef, inserted);
      applied += 1;
      continue;
    }

    if (parseResult.resolution) throw new ScheduleApplyStaleError('A previously absent session now exists. Run Re-check.');
    // A concurrent importer won the unique-key race. Lock and classify the
    // winner instead of blindly overwriting it, preserving application ownership.
    const concurrent = await findExistingSessionForUpdate(db, externalRef);
    if (!concurrent) {
      throw new ScheduleApplyStaleError(
        'Concurrent schedule insert could not be reloaded safely.',
      );
    }
    existingByRef.set(externalRef, concurrent);
    await applyExisting(concurrent, row, externalRef);
  }

  return {
    applied,
    skipped,
    unchanged,
    conflicts: [],
  };
}

export async function summarizeRows(
  rows: MappedScheduleRow[],
  db: SqlQuery = getDb(),
): Promise<ScheduleParseResult> {
  const existingRows = await db<ExistingSessionRow>(
    `SELECT id, external_ref, management_source::text AS management_source,
      course_code, trainer_id, venue_code, room_id, status,
      start_date::text, end_date::text, expected_pax, confirmed_pax, time_text,
      version
     FROM sessions
     WHERE external_ref IS NOT NULL`,
  );
  const existingByRef = new Map(existingRows.map((row) => [row.external_ref, row]));

  let inserts = 0;
  let updates = 0;
  let unchanged = 0;
  let skipped = 0;
  let cancellations = 0;
  const conflicts: ScheduleImportConflict[] = [];

  for (const row of rows) {
    const externalRef = row.startDate && row.endDate ? buildExternalRef(row) : '';
    const classification = classifyScheduleRow(
      externalRef ? existingByRef.get(externalRef) ?? null : null,
      row,
      externalRef,
    );

    switch (classification.kind) {
      case 'skipped':
        skipped += 1;
        break;
      case 'insert':
        inserts += 1;
        if (row.status === 'cancelled') cancellations += 1;
        existingByRef.set(externalRef, createExistingSessionFromRow(row, 'preview'));
        break;
      case 'update':
        updates += 1;
        if (row.status === 'cancelled') cancellations += 1;
        existingByRef.set(externalRef, projectExistingSession(classification.existing, row));
        break;
      case 'unchanged':
        unchanged += 1;
        if (row.status === 'cancelled') cancellations += 1;
        break;
      case 'conflict':
        conflicts.push(classification.conflict);
        break;
    }
  }

  const changeCount = inserts + updates;
  const cancellationGuard = existingRows.length > 0 && cancellations > existingRows.length / 2;
  const blockingAlertCount = rows.reduce(
    (count, row) => count + row.alerts.filter((alert) => isBlockingScheduleAlertCode(alert.code)).length,
    0,
  );
  const blocked = cancellationGuard || blockingAlertCount > 0 || conflicts.length > 0;
  const blockReasons = [
    cancellationGuard ? 'Parse would cancel more than 50% of existing sessions.' : null,
    blockingAlertCount > 0 ? 'Schedule contains unresolved or malformed values.' : null,
    conflicts.length > 0 ? 'Upload conflicts with application-managed sessions.' : null,
  ].filter((reason): reason is string => reason !== null);

  return {
    rows,
    alerts: rows.flatMap((row) => row.alerts),
    conflicts,
    summary: {
      totalRows: rows.length,
      validRows: rows.length - skipped,
      inserts,
      updates,
      unchanged,
      skipped,
      cancellations,
      conflicts: conflicts.length,
      existingSessions: existingRows.length,
      changeCount,
      autoApplied: false,
      requiresConfirmation: true,
      blocked,
      blockReason: blockReasons.length > 0 ? blockReasons.join(' ') : null,
    },
  };
}

async function findExistingSessions(
  db: SqlQuery,
  externalRefs: string[],
): Promise<ExistingSessionRow[]> {
  if (externalRefs.length === 0) return [];

  return db<ExistingSessionRow>(
    `SELECT id, external_ref, management_source::text AS management_source,
      course_code, trainer_id, venue_code, room_id, status,
      start_date::text, end_date::text, expected_pax, confirmed_pax, time_text,
      version
     FROM sessions
     WHERE external_ref = ANY($1::text[])
     ORDER BY external_ref
     FOR UPDATE`,
    [externalRefs],
  );
}

async function findExistingSessionForUpdate(
  db: SqlQuery,
  externalRef: string,
): Promise<ExistingSessionRow | null> {
  const rows = await db<ExistingSessionRow>(
    `SELECT id, external_ref, management_source::text AS management_source,
      course_code, trainer_id, venue_code, room_id, status,
      start_date::text, end_date::text, expected_pax, confirmed_pax, time_text,
      version
     FROM sessions
     WHERE external_ref = $1
     FOR UPDATE`,
    [externalRef],
  );

  return rows[0] ?? null;
}

async function updateImportManagedSession(
  db: SqlQuery,
  sessionId: string,
  expectedVersion: number,
  batchId: string,
  row: MappedScheduleRow,
): Promise<ExistingSessionRow | null> {
  const rows = await db<ExistingSessionRow>(
    `UPDATE sessions
     SET course_code = $2,
       tms_code = $3,
       source_course_name = $4,
       trainer_id = $5,
       raw_trainer_name = $6,
       venue_code = $7,
       room_id = $8,
       raw_venue_text = $9,
       time_text = $10,
       status = $11,
       start_date = $12,
       end_date = $13,
       expected_pax = $14,
       confirmed_pax = $15,
       upload_batch_id = $16,
       raw_room_text = $18,
       version = version + 1,
       updated_at = now()
     WHERE id = $1
       AND management_source = 'import'
       AND version = $17
     RETURNING id, external_ref, management_source::text AS management_source,
       course_code, trainer_id, venue_code, room_id, status,
       start_date::text, end_date::text, expected_pax, confirmed_pax, time_text,
       version`,
    [
      sessionId,
      row.courseCode,
      row.tmsCode,
      row.sourceCourseName,
      row.trainerId,
      row.rawTrainerName,
      row.venueCode,
      row.roomId,
      row.rawVenueText,
      row.timeText,
      row.status,
      row.startDate,
      row.endDate,
      row.expectedPax,
      row.confirmedPax,
      batchId,
      expectedVersion,
      row.rawRoomText ?? null,
    ],
  );
  return rows[0] ?? null;
}

async function insertImportManagedSession(
  db: SqlQuery,
  batchId: string,
  row: MappedScheduleRow,
  externalRef: string,
): Promise<ExistingSessionRow | null> {
  const rows = await db<ExistingSessionRow>(
    `INSERT INTO sessions (
      course_code, tms_code, source_course_name, trainer_id, raw_trainer_name,
      venue_code, room_id, raw_venue_text, time_text, status,
      start_date, end_date, expected_pax, confirmed_pax, upload_batch_id, external_ref,
      version, raw_room_text
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16,
      1, $17
    )
    ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING
    RETURNING id, external_ref, management_source::text AS management_source,
      course_code, trainer_id, venue_code, room_id, status,
      start_date::text, end_date::text, expected_pax, confirmed_pax, time_text,
      version`,
    [
      row.courseCode,
      row.tmsCode,
      row.sourceCourseName,
      row.trainerId,
      row.rawTrainerName,
      row.venueCode,
      row.roomId,
      row.rawVenueText,
      row.timeText,
      row.status,
      row.startDate,
      row.endDate,
      row.expectedPax,
      row.confirmedPax,
      batchId,
      externalRef,
      row.rawRoomText ?? null,
    ],
  );

  return rows[0] ?? null;
}

function classifyScheduleRow(
  existing: ExistingSessionRow | null,
  row: MappedScheduleRow,
  externalRef: string,
): ScheduleRowClassification {
  if (!row.startDate || !row.endDate) return { kind: 'skipped' };
  if (!existing) return { kind: 'insert', externalRef };

  if (existing.management_source === 'application') {
    const conflict = buildConflict(existing, row, externalRef);
    return conflict
      ? { kind: 'conflict', externalRef, conflict }
      : { kind: 'unchanged', externalRef };
  }

  return rowChanged(existing, row)
    ? { kind: 'update', externalRef, existing }
    : { kind: 'unchanged', externalRef };
}

function createExistingSessionFromRow(
  row: MappedScheduleRow,
  id: string,
): ExistingSessionRow {
  if (!row.startDate || !row.endDate) {
    throw new Error('Cannot project an invalid schedule row into an existing session.');
  }
  return {
    id,
    external_ref: buildExternalRef(row),
    management_source: 'import',
    course_code: row.courseCode,
    trainer_id: row.trainerId,
    venue_code: row.venueCode,
    room_id: row.roomId,
    status: row.status,
    start_date: row.startDate,
    end_date: row.endDate,
    expected_pax: row.expectedPax,
    confirmed_pax: row.confirmedPax,
    time_text: row.timeText,
    version: 1,
  };
}

function projectExistingSession(
  existing: ExistingSessionRow,
  row: MappedScheduleRow,
): ExistingSessionRow {
  if (!row.startDate || !row.endDate) {
    throw new Error('Cannot project an invalid schedule row into an existing session.');
  }
  return {
    ...existing,
    course_code: row.courseCode,
    trainer_id: row.trainerId,
    venue_code: row.venueCode,
    room_id: row.roomId,
    status: row.status,
    start_date: row.startDate,
    end_date: row.endDate,
    expected_pax: row.expectedPax,
    confirmed_pax: row.confirmedPax,
    time_text: row.timeText,
    version: existing.version + 1,
  };
}

export function buildExternalRef(row: MappedScheduleRow): string {
  const stableBatchId = getStableBatchId(row);
  if (stableBatchId) {
    return `tms:${stableBatchId}`;
  }

  const code = normalizeExternalRefPart(row.tmsCode ?? row.courseCode ?? 'unknown');
  const start = row.startDate ?? 'no-start';
  const end = row.endDate ?? 'no-end';
  const time = normalizeExternalRefPart(row.timeText ?? 'no-time');
  return `tms:fallback:${code}:${start}:${end}:${time}`;
}

function getStableBatchId(row: MappedScheduleRow): string | null {
  const candidates = [row.aliasBatchId, row.batchId];
  const match = candidates.find(
    (value): value is string => Boolean(value && /^[A-Z]+-\d{4}-\d+$/.test(value)),
  );

  return match ?? null;
}

function rowChanged(existing: ExistingSessionRow, row: MappedScheduleRow): boolean {
  return getChangedFields(existing, row).length > 0;
}

function buildConflict(
  existing: ExistingSessionRow,
  row: MappedScheduleRow,
  externalRef: string,
): ScheduleImportConflict | null {
  const fields = getChangedFields(existing, row);
  if (fields.length === 0) return null;
  return {
    externalRef,
    rowNumber: row.rowNumber,
    sessionId: existing.id,
    reason: 'application_managed_difference',
    fields,
  };
}

function getChangedFields(
  existing: ExistingSessionRow,
  row: MappedScheduleRow,
): ScheduleImportConflictField[] {
  return [
    compareField('courseCode', existing.course_code, row.courseCode),
    compareField('trainerId', existing.trainer_id, row.trainerId),
    compareField('venueCode', existing.venue_code, row.venueCode),
    compareField('roomId', existing.room_id, row.roomId),
    compareField('status', existing.status, row.status),
    compareField('startDate', existing.start_date, row.startDate),
    compareField('endDate', existing.end_date, row.endDate),
    compareField('expectedPax', existing.expected_pax, row.expectedPax),
    compareField('confirmedPax', existing.confirmed_pax, row.confirmedPax),
    compareField('timeText', existing.time_text, row.timeText),
  ].filter((field): field is ScheduleImportConflictField => Boolean(field));
}

function compareField(
  field: string,
  current: string | number | null,
  incoming: string | number | null,
): ScheduleImportConflictField | null {
  if (current === incoming) return null;
  return { field, current, incoming };
}

function normalizeExternalRefPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'blank';
}

function compareExternalRefs(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 'null' : serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(',')}}`;
}
