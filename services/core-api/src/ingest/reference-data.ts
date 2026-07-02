import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '@training-planner/shared';
import type {
  CourseAliasRow,
  CourseLookupRow,
  RoomLookupRow,
  TrainerAliasRow,
  TrainerLookupRow,
  VenueLookupRow,
} from './master-schedule-mapping.js';

interface CsvCourseRow {
  code: string;
  name: string;
  programme_code: string;
  duration_days: string;
  fee_with_gst: string;
  is_capstone: string;
  recently_added: string;
  notes: string;
}

interface CsvCourseAliasRow extends CourseAliasRow {
  notes: string;
}

interface CsvTrainerAliasRow {
  tms_name: string;
  trainer_id: string;
  confidence: string;
  notes: string;
}

interface CsvTrainerCourseRow {
  trainer_id: string;
  course_code: string;
  is_sme: string;
  notes: string;
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const domainDocsDir = path.resolve(currentDir, '../../../../docs/02-domain');

export async function ensureTmsReferenceData(): Promise<void> {
  const [newCourses, courseAliases, trainerAliases] = await Promise.all([
    readCsv<CsvCourseRow>('new_courses_from_tms.csv'),
    readCsv<CsvCourseAliasRow>('course_aliases.csv'),
    readCsv<CsvTrainerAliasRow>('trainer_aliases_tms.csv'),
  ]);

  const db = getDb();

  for (const course of newCourses) {
    await db(
      `INSERT INTO courses
        (code, name, programme_code, duration_days, fee_with_gst, is_capstone, recently_added, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (code) DO NOTHING`,
      [
        course.code,
        course.name,
        nullableText(course.programme_code),
        Number(course.duration_days),
        nullableNumber(course.fee_with_gst),
        parseBoolean(course.is_capstone),
        parseBoolean(course.recently_added),
        nullableText(course.notes),
      ],
    );
  }

  for (const alias of courseAliases) {
    await db(
      `INSERT INTO course_aliases (tms_code, catalog_code, notes)
       VALUES ($1, $2, $3)
      ON CONFLICT (tms_code) DO NOTHING`,
      [alias.tms_code, alias.catalog_code, nullableText(alias.notes)],
    );
  }

  for (const alias of trainerAliases) {
    if (!alias.trainer_id) {
      continue;
    }

    await db(
      `INSERT INTO trainer_aliases (trainer_id, alias_name, source)
       VALUES ($1, $2, 'tms')
      ON CONFLICT (alias_name) DO NOTHING`,
      [alias.trainer_id, alias.tms_name],
    );
  }
}

/**
 * Seeds the 35 full-time 2026 courses and their trainer-course skill links
 * from docs/02-domain. Idempotent (ON CONFLICT DO NOTHING) — matches the TMS
 * reference-data pattern. Programme rows themselves are seeded by the SQL
 * migration db/migrations/2026-06-30_programmes.sql, not here.
 */
export async function ensureFulltimeCourseData(): Promise<void> {
  const [fulltimeCourses, fulltimeTrainerCourses] = await Promise.all([
    readCsv<CsvCourseRow>('courses_fulltime_2026.csv'),
    readCsv<CsvTrainerCourseRow>('trainer_courses_fulltime_2026.csv'),
  ]);

  const db = getDb();

  for (const course of fulltimeCourses) {
    await db(
      `INSERT INTO courses
        (code, name, programme_code, duration_days, fee_with_gst, is_capstone, recently_added, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (code) DO NOTHING`,
      [
        course.code,
        course.name,
        nullableText(course.programme_code),
        Number(course.duration_days),
        nullableNumber(course.fee_with_gst),
        parseBoolean(course.is_capstone),
        parseBoolean(course.recently_added),
        nullableText(course.notes),
      ],
    );
  }

  for (const link of fulltimeTrainerCourses) {
    if (!link.trainer_id || !link.course_code) {
      continue;
    }

    await db(
      `INSERT INTO trainer_courses (trainer_id, course_code, is_sme, notes)
       VALUES ($1, $2, $3, $4)
      ON CONFLICT (trainer_id, course_code) DO NOTHING`,
      [
        link.trainer_id,
        link.course_code,
        parseBoolean(link.is_sme),
        nullableText(link.notes),
      ],
    );
  }
}

export async function loadScheduleLookups(): Promise<{
  courseAliases: CourseAliasRow[];
  courses: CourseLookupRow[];
  trainerAliases: TrainerAliasRow[];
  trainers: TrainerLookupRow[];
  venues: VenueLookupRow[];
  rooms: RoomLookupRow[];
}> {
  const db = getDb();
  const [courseAliases, courses, trainerAliases, trainers, venues, rooms] =
    await Promise.all([
      db('SELECT tms_code, catalog_code FROM course_aliases'),
      db('SELECT code FROM courses'),
      db(
        `SELECT alias_name AS tms_name, trainer_id
         FROM trainer_aliases
         WHERE source IN ('tms', 'rate_excel', 'schedule_excel')`,
      ),
      db('SELECT trainer_id, name FROM trainers WHERE is_active = TRUE'),
      db('SELECT code, name, type, address FROM venues'),
      db('SELECT room_id, venue_code, name FROM rooms'),
    ]);

  return {
    courseAliases: courseAliases as CourseAliasRow[],
    courses: courses as CourseLookupRow[],
    trainerAliases: trainerAliases as TrainerAliasRow[],
    trainers: trainers as TrainerLookupRow[],
    venues: venues as VenueLookupRow[],
    rooms: rooms as RoomLookupRow[],
  };
}

async function readCsv<T extends object>(filename: string): Promise<T[]> {
  const content = await readFile(path.join(domainDocsDir, filename), 'utf8');
  const [headerLine, ...lines] = content.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine ?? '');

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? '']),
      ) as T;
    });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function parseBoolean(value: string): boolean {
  return value.trim().toLowerCase() === 'true';
}