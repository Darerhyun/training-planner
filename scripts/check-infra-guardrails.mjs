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
  assert(guardrails.uploads?.retentionDays === 1, 'upload retention must be 1 day');
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
  assert(lifecycle.rule?.[0]?.condition?.age === 1, 'GCS lifecycle: age must be 1 day');
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

const forbiddenPatterns = [
  [/training-planner-\d{5,}/i, 'numeric Google project identifier'],
  [/https:\/\/core-api-\d+\.[a-z0-9-]+\.run\.app/i, 'live Cloud Run endpoint'],
  [/Cloud SQL Auth Proxy/i, 'Cloud SQL Auth Proxy assumption'],
  [/host=\/cloudsql\//i, 'Cloud SQL Unix socket assumption'],
  [
    /repository_(?:owner_)?id\s*(?:==|:|=)\s*['"]?\d+/i,
    'numeric repository or owner identity',
  ],
];
for (const [pattern, description] of forbiddenPatterns) {
  assert(!pattern.test(scopedText), `scoped files contain ${description}`);
}
assert(!/@gmail\.com\b/i.test(scopedText), 'scoped files contain a committed Gmail address');

const setupDocument = readText('docs/SETUP.md');
const recoverySafetyHeading = '## Recovery execution safety checklist';
assert(
  setupDocument.split(recoverySafetyHeading).length === 2,
  'setup guide must contain exactly one Recovery execution safety checklist section',
);
const recoverySafetyStart = setupDocument.indexOf(recoverySafetyHeading);
const recoverySafetyRemainder = setupDocument.slice(recoverySafetyStart);
const recoverySafetyEnd = recoverySafetyRemainder.indexOf('\n## ', 1);
const recoverySafetySection =
  recoverySafetyEnd === -1
    ? recoverySafetyRemainder
    : recoverySafetyRemainder.slice(0, recoverySafetyEnd);
for (const [fragment, description] of [
  ['remote repository, intended branch, exact base SHA', 'remote state verification'],
  ['exact three-file allowlist after every edit group', 'three-file allowlist enforcement'],
  ['each with an explicit timeout', 'staged validation timeouts'],
  ['active command or session', 'evidence-based running status'],
  ['Stop and report lost execution state', 'lost-state fail-closed rule'],
  ['durable\n  branch commit and draft pull request', 'durable branch and draft PR checkpoint'],
  ['never publish synthetic-baseline diffs', 'synthetic-baseline diff prohibition'],
]) {
  assert(
    recoverySafetySection.includes(fragment),
    `recovery safety checklist must preserve ${description}`,
  );
}
for (const gateName of [
  '**Merge gate**',
  '**Repository configuration gate**',
  '**IAM and provider gate**',
  '**Dispatch gate**',
]) {
  assert(setupDocument.includes(gateName), `setup guide must preserve the separate ${gateName}`);
}

const frontendEnvironment = readText('apps/web/.env.production').trim();assert(
  !setupDocument.includes('**Environment gate**'),
  'setup guide must replace the Environment gate name',
);
for (const [fragment, description] of [
  ['### GitHub repository configuration', 'repository configuration section'],
  ['private GitHub Free initial phase', 'private-Free configuration context'],
  ['repository-level Actions variables', 'repository-level variable documentation'],
  ['not equivalent to independent GitHub-native approval', 'single-owner residual-risk wording'],
  ['residual risk is single-owner control', 'single-owner residual-risk contract'],
  ['fresh explicit authorization', 'fresh user authorization process gate'],
  ['Sol performs preflight', 'Sol preflight process gate'],
  // FIX: match the documented Terra wording across wrapped lines.
  ['Terra performs', 'Terra read-only process gate'],
  ['independent read-only verification', 'Terra read-only verification wording'],
]) {
  assert(setupDocument.includes(fragment), `setup guide must document ${description}`);
}

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
  !/^\s*environment\s*:/m.test(deploymentWorkflow),
  'deployment workflow must not reference a GitHub environment',
);
assert(
  /timeout-minutes: 30/.test(deploymentWorkflow),
  'deployment workflow must set a 30-minute job timeout',
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
  /expected_commit_sha:\n\s+description: [^\n]+\n\s+required: true\n\s+type: string/.test(
    deploymentWorkflow,
  ),
  'deployment workflow must require the expected commit SHA input',
);
assert(
  /cost_acknowledgement:\n\s+description: Type I ACKNOWLEDGE LOW-COST LIMITS to continue\n\s+required: true\n\s+type: string/.test(
    deploymentWorkflow,
  ),
  'deployment workflow must require the exact low-cost acknowledgement input',
);
for (const [fragment, description] of [
  ['ACTOR: ${{ github.actor }}', 'github.actor input binding'],
  ['REF: ${{ github.ref }}', 'github.ref input binding'],
  ['EXPECTED_COMMIT_SHA: ${{ inputs.expected_commit_sha }}', 'expected commit input binding'],
  ['GITHUB_SHA_VALUE: ${{ github.sha }}', 'github.sha input binding'],
  ['COST_ACKNOWLEDGEMENT: ${{ inputs.cost_acknowledgement }}', 'cost acknowledgement input binding'],
  ['if [[ "$ACTOR" != \'Darerhyun\' ]]', 'exact actor comparison'],
  ['if [[ "$REF" != \'refs/heads/main\' ]]', 'exact ref comparison'],
  ['if [[ -z "$EXPECTED_COMMIT_SHA" || "$EXPECTED_COMMIT_SHA" != "$GITHUB_SHA_VALUE" ]]', 'exact SHA comparison'],
  ['if [[ "$COST_ACKNOWLEDGEMENT" != \'I ACKNOWLEDGE LOW-COST LIMITS\' ]]', 'exact cost comparison'],
]) {
  assert(deploymentWorkflow.includes(fragment), `deployment workflow must enforce ${description}`);
}
assertOrdered(
  deploymentWorkflow,
  [
    'name: Verify manual confirmation and configuration',
    'name: Checkout',
    'name: Authenticate to Google Cloud without a key',
  ],
  'manual/configuration verification must precede checkout and authentication',
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
assertOrdered(
  deploymentWorkflow,
  [
    'uses: google-github-actions/setup-gcloud@v3',
    'name: Verify pre-provisioned deployment targets',
    'gcloud artifacts repositories describe "$GCP_ARTIFACT_REPOSITORY"',
    'gcloud run services describe core-api',
    'name: Build and push immutable API image',
  ],
  'deployment workflow must verify existing targets before publishing or deploying',
);
for (const forbiddenProvisioningCommand of [
  'gcloud services enable',
  'gcloud artifacts repositories create',
  'gcloud storage buckets create',
  'gcloud secrets create',
  'gcloud projects add-iam-policy-binding',
  'gcloud iam service-accounts create',
  'firebase projects:create',
  'psql ',
  'db/schema.sql',
]) {
  assert(
    !deploymentWorkflow.includes(forbiddenProvisioningCommand),
    `deployment workflow must not provision or run SQL: ${forbiddenProvisioningCommand}`,
  );
}
assert(
  deploymentWorkflow.includes('name: Verify public Cloud Run invocation prerequisite') &&
    deploymentWorkflow.includes('gcloud run services get-iam-policy core-api') &&
    deploymentWorkflow.includes('--format=json') &&
    deploymentWorkflow.includes("binding.role === 'roles/run.invoker'") &&
    deploymentWorkflow.includes("binding.members.includes('allUsers')") &&
    deploymentWorkflow.includes('binding.condition == null'),
  'deployment workflow must perform an unconditional read-only public invocation IAM preflight',
);
assertOrdered(
  deploymentWorkflow,
  [
    'uses: google-github-actions/setup-gcloud@v3',
    'name: Verify public Cloud Run invocation prerequisite',
    'gcloud run services get-iam-policy core-api',
    'name: Verify pre-provisioned deployment targets',
    'name: Build and push immutable API image',
    'name: Deploy locked Cloud Run service',
  ],
  'public invocation IAM preflight must run after WIF/setup-gcloud and before image publication or Cloud Run deployment',
);
const forbiddenIamCommandPattern =
  /^[ \t]*gcloud\b[^\n]*(?:add-iam-policy-binding|remove-iam-policy-binding|set-iam-policy)\b/m;
assert(
  !forbiddenIamCommandPattern.test(deploymentWorkflow),
  'deployment workflow must not contain any gcloud IAM policy mutation command',
);
for (const forbiddenIamFlag of [
  '--allow-unauthenticated',
  '--no-allow-unauthenticated',
  '--no-invoker-iam-check',
]) {
  assert(
    !deploymentWorkflow.includes(forbiddenIamFlag),
    'deployment workflow must not use public-auth flag: ' + forbiddenIamFlag,
  );
}

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
  '--cpu=1',
  '--cpu-throttling',
  '--memory=1Gi',
  '--concurrency=20',
  '--min-instances=0',
  '--max-instances=2',
  '--service-account="$GCP_RUNTIME_SERVICE_ACCOUNT"',
  // Require the verified database version-3 and admin-email version-2 pins.
  'DATABASE_URL=${GCP_DATABASE_SECRET}:3',
  'ADMIN_EMAILS=${GCP_ADMIN_EMAILS_SECRET}:2',
  'ALLOWED_ORIGINS=${FIREBASE_HOSTING_ORIGIN}',
  'GCS_UPLOAD_BUCKET=${GCS_UPLOAD_BUCKET}',
]) {
  assert(
    deploymentWorkflow.includes(fragment),
    `deployment workflow is missing locked deployment contract: ${fragment}`,
  );
}
assert(
  deploymentWorkflow.includes(
    'DATABASE_URL=${GCP_DATABASE_SECRET}:3,ADMIN_EMAILS=${GCP_ADMIN_EMAILS_SECRET}:2',
  ),
  'deployment workflow must pin DATABASE_URL to version :3 and ADMIN_EMAILS to version :2',
);
assert(
  !deploymentWorkflow.includes(':latest'),
  'deployment workflow must not use floating Secret Manager :latest pins',
);

assert(
  !deploymentWorkflow.includes('--no-cpu-throttling'),
  'deployment workflow must reject Cloud Run instance-based CPU allocation',
);
assert(
  !deploymentWorkflow.includes('--allow-unauthenticated') &&
    !deploymentWorkflow.includes('--no-allow-unauthenticated'),
  'deployment workflow must leave Cloud Run invocation IAM to the separate provider gate',
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
