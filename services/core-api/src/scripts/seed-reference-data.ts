import '../env.js';
import {
  ensureTmsReferenceData,
  ensureFulltimeCourseData,
} from '../ingest/reference-data.js';

try {
  await ensureTmsReferenceData();
  console.log('TMS reference data seed complete.');
  await ensureFulltimeCourseData();
  console.log('Full-time 2026 course, alias, and trainer seed complete.');
} catch (error) {
  console.error('Reference data seed failed:', error);
  process.exitCode = 1;
}