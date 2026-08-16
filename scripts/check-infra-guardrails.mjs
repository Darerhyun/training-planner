import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function readText(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function assertArray(actual, expected, message) {
  assert(
    Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]),
    message,
  );
}

const guardrails = readJson('infra/cost-guardrails.json');
const lifecycle = readJson('infra/gcs-lifecycle.json');
const cors = readJson('infra/gcs-cors.example.json');

if (guardrails) {
  assert(guardrails.version === 1, 'cost guardrails: version must be 1');
  assert(guardrails.currency === 'USD', 'cost guardrails: currency must be USD');
  assert(guardrails.monthlyCost?.target === 15, 'cost guardrails: monthly target must be USD 15');
  assert(
    guardrails.monthlyCost?.emergencyCeiling === 25,
    'cost guardrails: emergency ceiling must be USD 25',
  );
  assertArray(
    guardrails.monthlyCost?.alertThresholds,
    [5, 10, 15],
    'cost guardrails: alert thresholds must be USD 5, 10, and 15',
  );
  assert(
    guardrails.monthlyCost?.alertsAreHardCaps === false,
    'cost guardrails: alerts must be documented as monitoring, not hard caps',
  );

  const cloudRun = guardrails.cloudRun;
  assert(cloudRun?.region === 'asia-southeast1', 'Cloud Run region must be asia-southeast1');
  assert(cloudRun?.billing === 'request-based', 'Cloud Run billing must be request-based');
  assert(cloudRun?.minInstances === 0, 'Cloud Run minimum instances must be 0');
  assert(cloudRun?.maxInstances === 2, 'Cloud Run maximum instances must be 2');
  assert(cloudRun?.cpu === 1, 'Cloud Run CPU must be 1');
  assert(cloudRun?.memory === '1Gi', 'Cloud Run memory must be 1Gi');
  assert(cloudRun?.concurrency === 20, 'Cloud Run concurrency must be 20');
  assert(cloudRun?.databasePoolPerInstance === 3, 'database pool per instance must be 3');
  assert(
    cloudRun?.maximumDocumentedDatabaseConnections === 6,
    'documented maximum database connections must be 6',
  );

  const database = guardrails.database;
  assert(database?.provider === 'Neon', 'database provider must be Neon');
  assert(database?.region === 'Singapore', 'database region must be Singapore');
  assert(database?.pooledConnectionRequired === true, 'Neon pooled connection must be required');
  assert(database?.tlsRequired === true, 'Neon TLS must be required');
  assert(database?.autoSuspendMinutes === 5, 'Neon autosuspend must be 5 minutes');
  assert(database?.monthlyTargetCeiling === 10, 'Neon monthly target ceiling must be USD 10');
  assert(
    database?.ceilingEnforcedWhereSupported === true,
    'Neon consumption ceiling must be required where supported',
  );

  assert(guardrails.uploads?.signedUrlMinutes === 15, 'signed upload URL must expire after 15 minutes');
  assert(guardrails.uploads?.retentionDays === 7, 'upload retention must be 7 days');
  assert(guardrails.artifactRegistry?.retentionDays === 30, 'artifact retention must be 30 days');

  assertArray(
    guardrails.prohibitedWithoutUserApprovedException,
    [
      'Cloud SQL',
      'Compute Engine',
      'GKE',
      'Cloud Run minimum instances greater than 0',
      'Cloud Run instance-based billing',
      'Serverless VPC Access',
      'Cloud NAT',
      'GPUs',
      'indefinite upload retention',
    ],
    'cost guardrails: prohibited-resource list changed',
  );
}

if (lifecycle) {
  assert(Array.isArray(lifecycle.rule), 'GCS lifecycle: rule must be an array');
  assert(lifecycle.rule?.length === 1, 'GCS lifecycle: exactly one rule is required');
  assert(lifecycle.rule?.[0]?.action?.type === 'Delete', 'GCS lifecycle: action must be Delete');
  assert(lifecycle.rule?.[0]?.condition?.age === 7, 'GCS lifecycle: age must be 7 days');
  assert(lifecycle.rule?.[0]?.condition?.isLive === true, 'GCS lifecycle: current objects must be targeted');
}

if (cors) {
  assert(Array.isArray(cors) && cors.length === 1, 'GCS CORS: exactly one entry is required');
  assertArray(
    cors?.[0]?.origin,
    ['https://replace-before-deployment.web.app'],
    'GCS CORS: origin must be the Firebase Hosting placeholder',
  );
  assertArray(cors?.[0]?.method, ['PUT'], 'GCS CORS: method must be PUT only');
  assertArray(
    cors?.[0]?.responseHeader,
    ['Content-Type'],
    'GCS CORS: responseHeader must contain Content-Type only',
  );
  assert(!JSON.stringify(cors).includes('*'), 'GCS CORS: wildcard values are forbidden');
}

const scopedRuntimeAndDocs = [
  'README.md',
  'docs/SETUP.md',
  'docs/00-INDEX.md',
  'docs/02-domain/trainer-rates.md',
  '.env.example',
  'apps/web/.env.production',
  'services/shared/src/db.ts',
  'db/schema.sql',
  'package.json',
  '.github/workflows/build.yml',
];
const scopedText = scopedRuntimeAndDocs
  .map((relativePath) => `--- ${relativePath} ---\n${readText(relativePath)}`)
  .join('\n');

const forbiddenFragments = [
  ['training-planner-499504', 'deleted Google project identifier'],
  ['core-api-866735226242.asia-southeast1.run.app', 'deleted Cloud Run endpoint'],
  ['Cloud SQL Auth Proxy', 'Cloud SQL Auth Proxy assumption'],
  ['host=/cloudsql/', 'Cloud SQL Unix socket assumption'],
];
for (const [fragment, description] of forbiddenFragments) {
  assert(!scopedText.includes(fragment), `scoped files contain ${description}: ${fragment}`);
}
assert(!/@gmail\.com\b/i.test(scopedText), 'scoped files contain a committed Gmail address');

const frontendEnvironment = readText('apps/web/.env.production').trim();
assert(
  frontendEnvironment.endsWith(
    'VITE_API_BASE_URL=https://replace-before-deployment.invalid',
  ),
  'production frontend API endpoint must use the deployment-blocking .invalid placeholder',
);

const databaseSource = readText('services/shared/src/db.ts');
assert(/max:\s*3\b/.test(databaseSource), 'database pool max must be 3');
assert(
  /connectionTimeoutMillis:\s*10_000\b/.test(databaseSource),
  'database connection timeout must be 10000 ms',
);
assert(
  /idleTimeoutMillis:\s*30_000\b/.test(databaseSource),
  'database idle timeout must be 30000 ms',
);
assert(!/Cloud SQL Auth Proxy|host=\/cloudsql\//.test(databaseSource), 'database source contains a Cloud SQL proxy or socket assumption');
assert(!/rejectUnauthorized\s*:\s*false/.test(databaseSource), 'database source disables TLS certificate validation');
assert(!/@neondatabase\//.test(databaseSource), 'database source must not add a Neon SDK');

if (errors.length > 0) {
  console.error('Infrastructure guardrail validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('Infrastructure guardrails validated.');
}
