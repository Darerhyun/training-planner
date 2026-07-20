import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PlanningProfileSource = 'direct' | 'ft_proxy' | 'no_history' | 'unavailable';

export type ResolvedPlanningProfile = {
  source: PlanningProfileSource;
  profileCourseCode: string | null;
  scheduled18MonthCount: number | null;
  confirmationRate: number | null;
  confirmedPerMonth: number | null;
  medianGapDays: number | null;
  strongMonths: string[];
  weakMonths: string[];
  lowHistoricalConfirmation: boolean;
};

type CoursePlanningProfile = {
  courseCode: string;
  venue: string;
  scheduled18MonthCount: number;
  confirmationRate: number;
  confirmedPerMonth: number;
  medianGapDays: number | null;
};

type CourseMonthlyProfile = {
  courseCode: string;
  venue: string;
  strongMonths: string[];
  weakMonths: string[];
};

type PlanningProfileData = {
  planningProfiles: Map<string, CoursePlanningProfile>;
  monthlyProfiles: Map<string, CourseMonthlyProfile>;
  ftHistory: Map<string, string | null>;
};

let cachedProfiles: PlanningProfileData | undefined;

function profileKey(courseCode: string, venue: string): string {
  return `${courseCode}|${venue}`;
}

function parseNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRequiredNumber(value: string): number {
  const parsed = parseNumber(value);
  if (parsed === null) throw new Error(`Invalid planning profile number: ${value}`);
  return parsed;
}

function parseMonthList(value: string | undefined): string[] {
  return (value ?? '').split('|').map((item) => item.trim()).filter(Boolean);
}

function readCsvRows(filePath: string): string[][] {
  const text = readFileSync(filePath, 'utf8').trimEnd();
  if (!text) return [];
  return text.split(/\r?\n/).slice(1).map((line) => line.split(',').map((value) => value.trim()));
}

function findDocsRoot(): string {
  const candidates = [
    resolve(process.cwd(), 'docs', '02-domain'),
    resolve(process.cwd(), '..', '..', 'docs', '02-domain'),
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', '02-domain'),
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', '02-domain'),
  ];

  const docsRoot = candidates.find((candidate) => existsSync(join(candidate, 'course_planning_profiles.csv')));
  if (!docsRoot) {
    throw new Error('Planning profile CSVs were not found in bundled docs/02-domain');
  }
  return docsRoot;
}

function loadPlanningProfileData(): PlanningProfileData {
  if (cachedProfiles) return cachedProfiles;

  const docsRoot = findDocsRoot();
  const planningProfiles = new Map<string, CoursePlanningProfile>();
  const monthlyProfiles = new Map<string, CourseMonthlyProfile>();
  const ftHistory = new Map<string, string | null>();

  for (const row of readCsvRows(join(docsRoot, 'course_planning_profiles.csv'))) {
    const [courseCode, venue, scheduled18mo, , , confirmRate, confirmedPerMonth, medianGapDays] = row;
    const profile = {
      courseCode,
      venue,
      scheduled18MonthCount: parseRequiredNumber(scheduled18mo),
      confirmationRate: parseRequiredNumber(confirmRate),
      confirmedPerMonth: parseRequiredNumber(confirmedPerMonth),
      medianGapDays: parseNumber(medianGapDays),
    };
    planningProfiles.set(profileKey(courseCode, venue), profile);
  }

  for (const row of readCsvRows(join(docsRoot, 'course_monthly_profiles.csv'))) {
    const [courseCode, venue, , , , , , , , , , , , , , , strongMonths, weakMonths] = row;
    monthlyProfiles.set(profileKey(courseCode, venue), {
      courseCode,
      venue,
      strongMonths: parseMonthList(strongMonths),
      weakMonths: parseMonthList(weakMonths),
    });
  }

  for (const row of readCsvRows(join(docsRoot, 'ft_history_mapping.csv'))) {
    const [ftCourseCode, historicalCode] = row;
    ftHistory.set(ftCourseCode, historicalCode || null);
  }

  cachedProfiles = { planningProfiles, monthlyProfiles, ftHistory };
  return cachedProfiles;
}

function unavailable(): ResolvedPlanningProfile {
  return {
    source: 'unavailable',
    profileCourseCode: null,
    scheduled18MonthCount: null,
    confirmationRate: null,
    confirmedPerMonth: null,
    medianGapDays: null,
    strongMonths: [],
    weakMonths: [],
    lowHistoricalConfirmation: false,
  };
}

function noHistory(): ResolvedPlanningProfile {
  return {
    ...unavailable(),
    source: 'no_history',
  };
}

function resolvedProfile(
  source: 'direct' | 'ft_proxy',
  profile: CoursePlanningProfile,
  monthlyProfile: CourseMonthlyProfile | undefined,
): ResolvedPlanningProfile {
  return {
    source,
    profileCourseCode: profile.courseCode,
    scheduled18MonthCount: profile.scheduled18MonthCount,
    confirmationRate: profile.confirmationRate,
    confirmedPerMonth: profile.confirmedPerMonth,
    medianGapDays: profile.medianGapDays,
    strongMonths: monthlyProfile?.strongMonths ?? [],
    weakMonths: monthlyProfile?.weakMonths ?? [],
    lowHistoricalConfirmation: profile.scheduled18MonthCount >= 6 && profile.confirmationRate < 0.5,
  };
}

export function resolvePlanningProfile(courseCode: string | null, venue: string | null): ResolvedPlanningProfile {
  if (!courseCode || !venue) return unavailable();

  const data = loadPlanningProfileData();
  const directProfile = data.planningProfiles.get(profileKey(courseCode, venue));
  if (directProfile) {
    return resolvedProfile('direct', directProfile, data.monthlyProfiles.get(profileKey(courseCode, venue)));
  }

  if (!data.ftHistory.has(courseCode)) return unavailable();

  const historicalCode = data.ftHistory.get(courseCode);
  if (!historicalCode) return noHistory();

  const proxyProfile = data.planningProfiles.get(profileKey(historicalCode, venue));
  if (!proxyProfile) return unavailable();

  return resolvedProfile('ft_proxy', proxyProfile, data.monthlyProfiles.get(profileKey(historicalCode, venue)));
}