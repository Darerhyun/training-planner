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

export async function parseScheduleWorkbook(buffer: Buffer): Promise<ScheduleParseResult> {
  const lookups = await loadScheduleLookups();
  const resolvers = {
    courses: createCourseResolver(lookups.courseAliases, lookups.courses),
    trainers: createTrainerResolver(lookups.trainerAliases, lookups.trainers),
    venues: createVenueResolver(lookups.venues, lookups.rooms),
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
    blankrows: false,
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

  return summarizeRows(mappedRows);
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

  const orderedRows = parseResult.rows
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
      version
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16,
      1
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
