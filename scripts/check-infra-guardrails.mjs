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

function assertOrdered(text, fragments, message) {
  let previousIndex = -1;
  for (const fragment of fragments) {
    const currentIndex = text.indexOf(fragment, previousIndex + 1);
    if (currentIndex === -1 || currentIndex <= previousIndex) {
      errors.push(`${message}: ${fragment}`);
      return;
    }
    previousIndex = currentIndex;
  }
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
  '.github/workflows/deploy-recovery.yml',
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

const deploymentWorkflow = readText('.github/workflows/deploy-recovery.yml');
const triggerSection = deploymentWorkflow.match(/^on:\n([\s\S]*?)^permissions:\n/m)?.[1] ?? '';
const topLevelTriggers = triggerSection.match(/^  [a-z_]+:/gm) ?? [];
assert(
  topLevelTriggers.length === 1 && topLevelTriggers[0] === '  workflow_dispatch:',
  'deployment workflow trigger must be workflow_dispatch only',
);
for (const forbiddenTrigger of [
  'push',
  'pull_request',
  'schedule',
  'workflow_run',
  'repository_dispatch',
]) {
  assert(
    !new RegExp(`^\\s{2}${forbiddenTrigger}:`, 'm').test(triggerSection),
    `deployment workflow contains forbidden automatic trigger: ${forbiddenTrigger}`,
  );
}

const permissionsSection = deploymentWorkflow.match(
  /^permissions:\n([\s\S]*?)^concurrency:\n/m,
)?.[1] ?? '';
const permissionEntries = permissionsSection.match(/^  [a-z-]+: [a-z-]+$/gm) ?? [];
assertArray(
  permissionEntries,
  ['  contents: read', '  id-token: write'],
  'deployment workflow permissions must be contents read and id-token write only',
);
assert(
  /concurrency:\n  group: training-planner-production\n  cancel-in-progress: false/.test(
    deploymentWorkflow,
  ),
  'deployment workflow must serialize production deployments without cancellation',
);
assert(
  /environment: production/.test(deploymentWorkflow),
  'deployment workflow must use the production environment',
);

assert(
  /confirmation:\n\s+description: Type DEPLOY TRAINING PLANNER to continue\n\s+required: true\n\s+type: string/.test(
    deploymentWorkflow,
  ),
  'deployment workflow must require the manual confirmation input',
);
assert(
  /target_project_id:\n\s+description: Confirm the configured target project ID\n\s+required: true\n\s+type: string/.test(
    deploymentWorkflow,
  ),
  'deployment workflow must require the target project input',
);
assert(
  deploymentWorkflow.includes(`"$CONFIRMATION" != 'DEPLOY TRAINING PLANNER'`),
  'deployment workflow must enforce the literal confirmation gate',
);
assert(
  deploymentWorkflow.includes(`"$TARGET_PROJECT_ID" != "$GCP_PROJECT_ID"`),
  'deployment workflow must compare the target input with GCP_PROJECT_ID',
);

const requiredDeploymentVariables = [
  'GCP_PROJECT_ID',
  'GCP_WORKLOAD_IDENTITY_PROVIDER',
  'GCP_DEPLOYER_SERVICE_ACCOUNT',
  'GCP_RUNTIME_SERVICE_ACCOUNT',
  'GCP_ARTIFACT_REPOSITORY',
  'GCP_DATABASE_SECRET',
  'GCP_ADMIN_EMAILS_SECRET',
  'GCS_UPLOAD_BUCKET',
  'FIREBASE_HOSTING_ORIGIN',
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
];
for (const variableName of requiredDeploymentVariables) {
  assert(
    deploymentWorkflow.includes('${{ vars.' + variableName + ' }}'),
    `deployment workflow must source required variable: ${variableName}`,
  );
}
assert(
  deploymentWorkflow.includes('required_variables=(') &&
    deploymentWorkflow.includes('${!variable_name:-}'),
  'deployment workflow must reject empty required variables before authentication',
);

assert(
  deploymentWorkflow.includes('node-version: 22'),
  'deployment workflow validation must use Node 22',
);
assertOrdered(
  deploymentWorkflow,
  [
    'run: npm ci',
    'run: npm run check:infra',
    'run: npm run typecheck',
    'run: npm test',
    'run: npm run build',
    'uses: google-github-actions/auth@v3',
  ],
  'deployment workflow must run repository validation before authentication',
);
assert(
  deploymentWorkflow.includes('uses: google-github-actions/setup-gcloud@v3'),
  'deployment workflow must use setup-gcloud v3',
);
assert(
  deploymentWorkflow.includes(
    'workload_identity_provider: ${{ env.GCP_WORKLOAD_IDENTITY_PROVIDER }}',
  ) &&
    deploymentWorkflow.includes(
      'service_account: ${{ env.GCP_DEPLOYER_SERVICE_ACCOUNT }}',
    ),
  'deployment workflow must authenticate with Workload Identity Federation',
);
assert(
  !/\$\{\{\s*secrets\./.test(deploymentWorkflow) &&
    !/credentials_json|service_account_key|service-account-key|--key-file|GOOGLE_APPLICATION_CREDENTIALS/i.test(
      deploymentWorkflow,
    ),
  'deployment workflow must not use a GitHub credential secret or service-account key',
);

for (const fragment of [
  "registry_host='asia-southeast1-docker.pkg.dev'",
  'services/core-api/Dockerfile',
  '/core-api:${GITHUB_SHA}',
  'gcloud run deploy core-api',
  '--project="$GCP_PROJECT_ID"',
  '--region=asia-southeast1',
  '--platform=managed',
  '--allow-unauthenticated',
  '--cpu=1',
  '--cpu-throttling',
  '--memory=1Gi',
  '--concurrency=20',
  '--min-instances=0',
  '--max-instances=2',
  '--service-account="$GCP_RUNTIME_SERVICE_ACCOUNT"',
  'DATABASE_URL=${GCP_DATABASE_SECRET}:latest',
  'ADMIN_EMAILS=${GCP_ADMIN_EMAILS_SECRET}:latest',
  'ALLOWED_ORIGINS=${FIREBASE_HOSTING_ORIGIN}',
  'GCS_UPLOAD_BUCKET=${GCS_UPLOAD_BUCKET}',
]) {
  assert(
    deploymentWorkflow.includes(fragment),
    `deployment workflow is missing locked deployment contract: ${fragment}`,
  );
}
assert(
  !deploymentWorkflow.includes('--no-cpu-throttling'),
  'deployment workflow must reject Cloud Run instance-based CPU allocation',
);

assertOrdered(
  deploymentWorkflow,
  [
    'gcloud run deploy core-api',
    'gcloud run services describe core-api',
    '"${cloud_run_url}/health"',
    'name: Build web for the verified API',
    'name: Deploy Firebase Hosting only',
  ],
  'deployment workflow must pass health before building and deploying Hosting',
);
for (const webVariable of [
  'VITE_API_BASE_URL',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
]) {
  assert(
    deploymentWorkflow.includes(webVariable),
    `deployment workflow must inject web build variable: ${webVariable}`,
  );
}

const firebaseToolVersions = [
  ...deploymentWorkflow.matchAll(/firebase-tools@([^\s]+)/g),
].map((match) => match[1]);
assertArray(
  firebaseToolVersions,
  ['15.27.0'],
  'deployment workflow must pin firebase-tools exactly to 15.27.0',
);
assert(
  deploymentWorkflow.includes('--only hosting') &&
    deploymentWorkflow.includes('--non-interactive') &&
    !/--only\s+(?!hosting\b)/.test(deploymentWorkflow),
  'deployment workflow must deploy Firebase Hosting only and non-interactively',
);

const summarySection = deploymentWorkflow.slice(
  deploymentWorkflow.indexOf('name: Record non-secret deployment evidence'),
);
assert(
  summarySection.includes('$GITHUB_STEP_SUMMARY'),
  'deployment workflow must write non-secret deployment evidence to the job summary',
);
for (const prohibitedSummaryValue of requiredDeploymentVariables) {
  assert(
    !summarySection.includes(prohibitedSummaryValue),
    `deployment summary must not include restricted value: ${prohibitedSummaryValue}`,
  );
}

if (errors.length > 0) {
  console.error('Infrastructure guardrail validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('Infrastructure guardrails validated.');
}
