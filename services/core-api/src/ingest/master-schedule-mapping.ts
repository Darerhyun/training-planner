import type { SessionStatus } from '@training-planner/shared';

export const MASTER_SCHEDULE_HEADER_ROW = 2;
export const MASTER_SCHEDULE_DATA_START_ROW = 3;

export interface MasterScheduleColumns {
  tmsCode: number;
  courseName: number;
  aliasBatchId: number;
  batchId: number;
  startDate: number;
  endDate: number;
  trainerName: number;
  venueText: number;
  roomName?: number;
  timeText: number;
  expectedPax: number;
  confirmedPax: number;
  status: number;
}

const HEADER_ALIASES: Record<keyof MasterScheduleColumns, readonly string[]> = {
  tmsCode: ['Course / Program ID', 'Course / Programme ID'],
  courseName: ['Course / Program Name', 'Course / Programme Name'],
  aliasBatchId: ['Alias Batch ID'],
  batchId: ['Batch ID'],
  startDate: ['Start Date (DD-MM-YYYY)', 'Start Date'],
  endDate: ['End Date', 'End Date (DD-MM-YYYY)'],
  trainerName: ['Trainer'],
  venueText: ['Venue', 'Venue (address text)'],
  roomName: ['Room'],
  timeText: ['Time'],
  expectedPax: ['Cap'],
  confirmedPax: ['Confirm'],
  status: ['Status'],
};

const REQUIRED_HEADERS = Object.keys(HEADER_ALIASES).filter(
  (key): key is keyof MasterScheduleColumns => key !== 'roomName',
);

export class ScheduleHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleHeaderError';
  }
}

export function resolveMasterScheduleColumns(
  headerRow: readonly unknown[],
): MasterScheduleColumns {
  const foundHeaders = headerRow.map((value) => String(value ?? '').trim());
  const normalizedHeaders = foundHeaders.map(normalizeHeader);
  const resolved: Partial<MasterScheduleColumns> = {};

  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [keyof MasterScheduleColumns, readonly string[]]
  >) {
    const acceptedHeaders = aliases.map(normalizeHeader);
    const index = normalizedHeaders.findIndex((header) => acceptedHeaders.includes(header));
    if (index >= 0) {
      resolved[key] = index + 1;
    }
  }

  const missing = REQUIRED_HEADERS.filter((key) => resolved[key] === undefined);
  if (missing.length > 0) {
    const expected = missing
      .map((key) => HEADER_ALIASES[key].join(' or '))
      .join('; ');
    const found = foundHeaders.filter(Boolean).join(', ') || '(none)';
    throw new ScheduleHeaderError(
      `Missing required schedule headers. Expected: ${expected}. Found: ${found}.`,
    );
  }

  return resolved as MasterScheduleColumns;
}

export type ScheduleAlertCode =
  | 'unknown_course'
  | 'unknown_trainer'
  | 'unknown_venue'
  | 'unknown_room'
  | 'invalid_start_date'
  | 'invalid_end_date'
  | 'invalid_expected_pax'
  | 'invalid_confirmed_pax'
  | 'invalid_status';

export interface ScheduleParseAlert {
  code: ScheduleAlertCode;
  message: string;
  rowNumber: number;
  rawValue: string | null;
}

export interface CourseAliasRow {
  tms_code: string;
  catalog_code: string;
}

export interface TrainerAliasRow {
  tms_name: string;
  trainer_id: string | null;
}

export interface CourseLookupRow {
  code: string;
}

export interface TrainerLookupRow {
  trainer_id: string;
  name: string;
}

export interface VenueLookupRow {
  code: string;
  name: string;
  type: 'owned' | 'external' | 'virtual';
  address: string | null;
}

export interface RoomLookupRow {
  room_id: string;
  venue_code: string;
  name: string;
}

export interface CourseResolver {
  resolve(tmsCode: string): string | null;
}

export interface TrainerResolver {
  resolve(trainerName: string): string | null;
}

export interface VenueResolution {
  venueCode: string | null;
  roomId: string | null;
  roomWasExpected: boolean;
}

export interface VenueResolver {
  resolve(venueText: string, roomName?: string | null): VenueResolution;
}

export interface ScheduleLookupResolvers {
  courses: CourseResolver;
  trainers: TrainerResolver;
  venues: VenueResolver;
}

export interface MappedScheduleRow {
  rowNumber: number;
  tmsCode: string | null;
  courseCode: string | null;
  sourceCourseName: string | null;
  aliasBatchId: string | null;
  batchId: string | null;
  startDate: string | null;
  endDate: string | null;
  trainerId: string | null;
  rawTrainerName: string | null;
  venueCode: string | null;
  roomId: string | null;
  rawVenueText: string | null;
  timeText: string | null;
  expectedPax: number | null;
  confirmedPax: number | null;
  status: SessionStatus;
  alerts: ScheduleParseAlert[];
}

export function createCourseResolver(
  aliasRows: CourseAliasRow[],
  courses: CourseLookupRow[],
): CourseResolver {
  const aliases = new Map<string, string>();
  const directCodes = new Map<string, string>();

  for (const row of aliasRows) {
    aliases.set(normalizeCode(row.tms_code), row.catalog_code.trim());
  }

  for (const course of courses) {
    directCodes.set(normalizeCode(course.code), course.code.trim());
  }

  return {
    resolve(tmsCode: string): string | null {
      const key = normalizeCode(tmsCode);
      if (!key) {
        return null;
      }

      return aliases.get(key) ?? directCodes.get(key) ?? null;
    },
  };
}

export function createTrainerResolver(
  aliasRows: TrainerAliasRow[],
  trainers: TrainerLookupRow[],
): TrainerResolver {
  const aliases = new Map<string, string>();
  const directNames = new Map<string, string>();
  const directIds = new Map<string, string>();

  for (const row of aliasRows) {
    if (row.trainer_id) {
      aliases.set(normalizeName(row.tms_name), row.trainer_id.trim());
    }
  }

  for (const trainer of trainers) {
    directNames.set(normalizeName(trainer.name), trainer.trainer_id);
    directIds.set(normalizeName(trainer.trainer_id), trainer.trainer_id);
  }

  return {
    resolve(trainerName: string): string | null {
      const key = normalizeName(trainerName);
      if (!key) {
        return null;
      }

      return aliases.get(key) ?? directNames.get(key) ?? directIds.get(key) ?? null;
    },
  };
}

export function createVenueResolver(
  venues: VenueLookupRow[],
  rooms: RoomLookupRow[],
): VenueResolver {
  const venueAliases = new Map([['VIRTUAL', 'HBL']]);
  const addressVenuePatterns = [
    { venueCode: 'IP', pattern: normalizeText('10 Anson Road') },
    { venueCode: 'JTC', pattern: normalizeText('8 Jurong Town Hall Road') },
  ];
  const venuePatterns = venues.map((venue) => ({
    venueCode: venue.code,
    venueType: venue.type,
    patterns: [venue.code, venue.name, venue.address]
      .filter((value): value is string => Boolean(value))
      .map(normalizeText),
  }));

  const roomPatterns = rooms.map((room) => ({
    roomId: room.room_id,
    venueCode: room.venue_code,
    roomName: room.name,
    pattern: normalizeText(room.name),
  }));

  return {
    resolve(venueText: string, roomName?: string | null): VenueResolution {
      const normalizedVenueText = normalizeText(venueText);
      const venueCode = venueAliases.get(normalizedVenueText)
        ?? addressVenuePatterns.find((venue) =>
          normalizedVenueText.includes(venue.pattern),
        )?.venueCode
        ?? venuePatterns.find((venue) =>
          venue.patterns.some(
            (pattern) => pattern && normalizedVenueText.includes(pattern),
          ),
        )?.venueCode ?? null;
      const venueType =
        venuePatterns.find((venue) => venue.venueCode === venueCode)?.venueType ?? null;

      const possibleRooms = venueCode
        ? roomPatterns.filter((room) => room.venueCode === venueCode)
        : [];

      const roomInput = roomName === undefined
        ? normalizedVenueText
        : normalizeText(stripRoomPrefix(roomName ?? ''));
      const room = possibleRooms.find((candidate) =>
        roomNameAppearsInVenueText(candidate.roomName, roomInput),
      );

      return {
        venueCode,
        roomId: room?.roomId ?? null,
        roomWasExpected: venueType === 'owned',
      };
    },
  };
}

export function mapMasterScheduleRow(
  row: readonly unknown[],
  rowNumber: number,
  resolvers: ScheduleLookupResolvers,
  columns: MasterScheduleColumns,
): MappedScheduleRow {
  const alerts: ScheduleParseAlert[] = [];

  const tmsCode = readCell(row, columns.tmsCode);
  const sourceCourseName = readCell(row, columns.courseName);
  const aliasBatchId = readCell(row, columns.aliasBatchId);
  const batchId = readCell(row, columns.batchId);
  const rawStartDate = readCell(row, columns.startDate);
  const rawEndDate = readCell(row, columns.endDate);
  const rawTrainerName = readCell(row, columns.trainerName);
  const rawVenueText = readCell(row, columns.venueText);
  const rawRoomName = columns.roomName ? readCell(row, columns.roomName) : undefined;
  const timeText = readCell(row, columns.timeText);
  const rawExpectedPax = readCell(row, columns.expectedPax);
  const rawConfirmedPax = readCell(row, columns.confirmedPax);
  const rawStatus = readCell(row, columns.status);

  const courseCode = tmsCode ? resolvers.courses.resolve(tmsCode) : null;
  if (!courseCode) {
    alerts.push({
      code: 'unknown_course',
      message: 'Course / Program ID did not match course_aliases or courses.',
      rowNumber,
      rawValue: tmsCode,
    });
  }

  const startDate = parseScheduleDate(rawStartDate);
  if (rawStartDate && !startDate) {
    alerts.push({
      code: 'invalid_start_date',
      message: 'Start Date must use DD-MM-YYYY format.',
      rowNumber,
      rawValue: rawStartDate,
    });
  }

  const endDate = parseScheduleDate(rawEndDate);
  if (rawEndDate && !endDate) {
    alerts.push({
      code: 'invalid_end_date',
      message: 'End Date must use DD-MM-YYYY format.',
      rowNumber,
      rawValue: rawEndDate,
    });
  }

  const trainerId = rawTrainerName
    ? resolvers.trainers.resolve(rawTrainerName)
    : null;
  if (rawTrainerName && !trainerId) {
    alerts.push({
      code: 'unknown_trainer',
      message: 'Trainer did not match trainer_aliases_tms or trainers.',
      rowNumber,
      rawValue: rawTrainerName,
    });
  }

  const venue = rawVenueText
    ? resolvers.venues.resolve(rawVenueText, rawRoomName)
    : { venueCode: null, roomId: null, roomWasExpected: false };

  if (rawVenueText && !venue.venueCode) {
    alerts.push({
      code: 'unknown_venue',
      message: 'Venue text did not match a known venue.',
      rowNumber,
      rawValue: rawVenueText,
    });
  }

  if (rawVenueText && venue.roomWasExpected && !venue.roomId) {
    alerts.push({
      code: 'unknown_room',
      message: rawRoomName === undefined
        ? 'Owned venue was detected, but no known room name was found in the venue text.'
        : 'Room did not match a known room for the detected venue.',
      rowNumber,
      rawValue: rawRoomName ?? rawVenueText,
    });
  }

  const expectedPax = parsePax(rawExpectedPax);
  if (rawExpectedPax && expectedPax === null) {
    alerts.push({
      code: 'invalid_expected_pax',
      message: 'Cap must be a whole number.',
      rowNumber,
      rawValue: rawExpectedPax,
    });
  }

  const confirmedPax = parsePax(rawConfirmedPax);
  if (rawConfirmedPax && confirmedPax === null) {
    alerts.push({
      code: 'invalid_confirmed_pax',
      message: 'Confirm must be a whole number.',
      rowNumber,
      rawValue: rawConfirmedPax,
    });
  }

  const status = parseStatus(rawStatus);
  if (rawStatus && !status) {
    alerts.push({
      code: 'invalid_status',
      message: 'Status must be Plan, Confirmed, Cancelled, or Completed.',
      rowNumber,
      rawValue: rawStatus,
    });
  }

  return {
    rowNumber,
    tmsCode,
    courseCode,
    sourceCourseName,
    aliasBatchId,
    batchId,
    startDate,
    endDate,
    trainerId,
    rawTrainerName,
    venueCode: venue.venueCode,
    roomId: venue.roomId,
    rawVenueText,
    timeText,
    expectedPax,
    confirmedPax,
    status: status ?? 'draft',
    alerts,
  };
}

function readCell(row: readonly unknown[], oneBasedColumn: number): string | null {
  const value = row[oneBasedColumn - 1];

  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseScheduleDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function parsePax(value: string | null): number | null {
  if (!value) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  return Number(value);
}

function parseStatus(value: string | null): SessionStatus | null {
  switch (normalizeName(value ?? '')) {
    case 'PLAN':
      return 'draft';
    case 'CONFIRMED':
      return 'confirmed';
    case 'CANCELLED':
      return 'cancelled';
    case 'COMPLETED':
      return 'completed';
    default:
      return null;
  }
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeHeader(value: string): string {
  return normalizeName(value).replace(/\s*\/\s*/g, ' / ');
}

function stripRoomPrefix(value: string): string {
  return value.replace(/^ROOM\s+/i, '').trim();
}

function normalizeText(value: string): string {
  return value
    .trim()
    .replace(/[#(),./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function roomNameAppearsInVenueText(
  roomName: string,
  normalizedVenueText: string,
): boolean {
  const normalizedRoomName = normalizeText(roomName);
  if (normalizedVenueText.includes(normalizedRoomName)) {
    return true;
  }

  const compactRoomName = normalizedRoomName.replace(/\s+/g, '');
  const compactVenueText = normalizedVenueText.replace(/\s+/g, '');
  return compactVenueText.includes(compactRoomName);
}