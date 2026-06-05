import { ensureTmsReferenceData } from '../ingest/reference-data.js';

try {
  await ensureTmsReferenceData();
  console.log('TMS reference data seed complete.');
} catch (error) {
  console.error('TMS reference data seed failed:', error);
  process.exitCode = 1;
}