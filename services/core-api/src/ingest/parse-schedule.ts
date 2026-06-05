import * as XLSX from 'xlsx';
import { getDb } from '@training-planner/shared';
import {
  createCourseResolver,
  createTrainerResolver,
  createVenueResolver,
  mapMasterScheduleRow,
  MASTER_SCHEDULE_DATA_START_ROW,
  type MappedScheduleRow,
  type ScheduleParseAlert,
} from './master-schedule-mapping.js';
import { loadScheduleLookups } from './reference-data.js';

export interface ScheduleParseResult {
  rows: MappedScheduleRow[];
  alerts: ScheduleParseAlert[];
  summary: {
    totalRows: number;
    validRows: number;
    inserts: number;
    updates: number;
    unchanged: number;
    skipped: number;
    cancellations: number;
    existingSessions: number;
    changeCount: number;
    autoApplied: boolean;
    requiresConfirmation: boolean;
    blocked: boolean;
    blockReason: string | null;
  };
}

interface ExistingSessionRow {
  external_ref: string;
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
}

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

  const mappedRows = rawRows
    .slice(MASTER_SCHEDULE_DATA_START_ROW - 1)
    .map((row, index) =>
      mapMasterScheduleRow(row, index + MASTER_SCHEDULE_DATA_START_ROW, resolvers),
    )
    .filter((row) => row.tmsCode || row.sourceCourseName || row.startDate || row.endDate);

  return summarizeRows(mappedRows);
}

export async function applyScheduleParseResult(
  batchId: string,
  parseResult: ScheduleParseResult,
): Promise<{ applied: number; skipped: number }> {
  const db = getDb();
  let applied = 0;
  let skipped = 0;

  for (const row of parseResult.rows) {
    if (!row.startDate || !row.endDate) {
      skipped += 1;
      continue;
    }

    await db(
      `INSERT INTO sessions (
        course_code, tms_code, source_course_name, trainer_id, raw_trainer_name,
        venue_code, room_id, raw_venue_text, time_text, status,
        start_date, end_date, expected_pax, confirmed_pax, upload_batch_id, external_ref
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16
      )
      ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET
        course_code = EXCLUDED.course_code,
        tms_code = EXCLUDED.tms_code,
        source_course_name = EXCLUDED.source_course_name,
        trainer_id = EXCLUDED.trainer_id,
        raw_trainer_name = EXCLUDED.raw_trainer_name,
        venue_code = EXCLUDED.venue_code,
        room_id = EXCLUDED.room_id,
        raw_venue_text = EXCLUDED.raw_venue_text,
        time_text = EXCLUDED.time_text,
        status = EXCLUDED.status,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        expected_pax = EXCLUDED.expected_pax,
        confirmed_pax = EXCLUDED.confirmed_pax,
        upload_batch_id = EXCLUDED.upload_batch_id,
        updated_at = now()`,
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
        buildExternalRef(row),
      ],
    );

    applied += 1;
  }

  return { applied, skipped };
}

async function summarizeRows(rows: MappedScheduleRow[]): Promise<ScheduleParseResult> {
  const db = getDb();
  const existingRows = (await db(
    `SELECT external_ref, course_code, trainer_id, venue_code, room_id, status,
      start_date::text, end_date::text, expected_pax, confirmed_pax, time_text
     FROM sessions
     WHERE external_ref IS NOT NULL`,
  )) as ExistingSessionRow[];
  const existingByRef = new Map(existingRows.map((row) => [row.external_ref, row]));

  let inserts = 0;
  let updates = 0;
  let unchanged = 0;
  let skipped = 0;
  const cancellations = rows.filter((row) => row.status === 'cancelled').length;

  for (const row of rows) {
    if (!row.startDate || !row.endDate) {
      skipped += 1;
      continue;
    }

    const existing = existingByRef.get(buildExternalRef(row));
    if (!existing) {
      inserts += 1;
    } else if (rowChanged(existing, row)) {
      updates += 1;
    } else {
      unchanged += 1;
    }
  }

  const changeCount = inserts + updates;
  const blocked = existingRows.length > 0 && cancellations > existingRows.length / 2;
  const requiresConfirmation = blocked || cancellations > 0 || changeCount >= 10;

  return {
    rows,
    alerts: rows.flatMap((row) => row.alerts),
    summary: {
      totalRows: rows.length,
      validRows: rows.length - skipped,
      inserts,
      updates,
      unchanged,
      skipped,
      cancellations,
      existingSessions: existingRows.length,
      changeCount,
      autoApplied: false,
      requiresConfirmation,
      blocked,
      blockReason: blocked
        ? 'Parse would cancel more than 50% of existing sessions.'
        : null,
    },
  };
}

function buildExternalRef(row: MappedScheduleRow): string {
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
  return (
    existing.course_code !== row.courseCode ||
    existing.trainer_id !== row.trainerId ||
    existing.venue_code !== row.venueCode ||
    existing.room_id !== row.roomId ||
    existing.status !== row.status ||
    existing.start_date !== row.startDate ||
    existing.end_date !== row.endDate ||
    existing.expected_pax !== row.expectedPax ||
    existing.confirmed_pax !== row.confirmedPax ||
    existing.time_text !== row.timeText
  );
}

function normalizeExternalRefPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'blank';
}