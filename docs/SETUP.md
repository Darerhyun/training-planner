# Setup and Infrastructure Recovery

This is the single authoritative guide for local development and the gated
Training Planner infrastructure recovery. The former Google project was
deleted. A replacement project and selected identity/database foundations now
exist, but there is still no deployed Training Planner environment. This
repository change does not provision, restore, migrate, grant access, create
secrets, dispatch a workflow, or deploy anything.

All provider commands below are examples for a later, separately authorized
recovery run. Replace placeholders only at that checkpoint and never commit the
resulting identifiers, endpoints, emails, bucket names, or credentials.

## Locked recovery architecture

| Layer | Approved recovery target |
|---|---|
| Database | Neon PostgreSQL in Singapore; pooled TLS URL for runtime |
| API | Cloud Run in `asia-southeast1`, request-based billing |
| Frontend | Firebase Hosting |
| Authentication | Firebase Auth email/password and email link plus application role checks |
| Uploads | Temporary GCS signed uploads with one-day retention |

The machine-readable contract is
[`infra/cost-guardrails.json`](../infra/cost-guardrails.json):

- Monthly target: USD 15.
- Emergency ceiling: USD 25.
- Billing alerts: USD 5, USD 10, and USD 15.
- Alerts provide monitoring; they are not hard spending caps.
- Cloud Run: minimum 0, maximum 2, 1 CPU, 1 GiB memory, concurrency
  20, request-based billing.
- Database pool: 3 connections per instance, at most 6 documented runtime
  connections across two instances.
- Neon: Singapore, pooled TLS required, five-minute autosuspend, target
  consumption ceiling USD 10 where the provider supports enforcement.
- Signed upload URL: 15 minutes.
- Uploaded workbook retention: 1 day.
- Container artifact retention: 30 days.

Without a new user-approved cost exception, do not create Cloud SQL, Compute
Engine, GKE, Cloud Run minimum instances above zero, instance-based Cloud Run
billing, Serverless VPC Access, Cloud NAT, GPUs, or indefinite upload retention.

## Recovery state

The following foundations were created manually and have been verified without
committing their live identifiers:

- a replacement Firebase/Google Cloud project and registered Firebase Hosting
  web app;
- Firebase Authentication with email/password and passwordless email-link
  sign-in enabled;
- the Secret Manager API;
- separate runtime and deployment service accounts, both with no user-managed
  keys;
- a GitHub Actions Workload Identity Federation pool, OIDC provider, and
  repository-scoped deployer binding;
- a Neon PostgreSQL 17 project on AWS in Singapore, with the live production
  compute limited to 0.25-0.5 CU and Free-plan autosuspend.

The following resources or controls are still absent or have not been verified:

- restored database schema and data, restricted runtime roles, and recovery
  reconciliation evidence;
- Secret Manager secrets for the pooled database URL and bootstrap admin
  allowlist;
- the temporary upload bucket, its one-day lifecycle, restricted CORS, and
  signed-URL service-account capability;
- the Artifact Registry repository and its 30-day cleanup policy;
- the Cloud Run service and Firebase Hosting release;
- exact least-privilege IAM grants for the deployment and runtime identities.

The project-wide default Neon compute range may remain higher on the Free plan;
only the verified live production compute is approved. Do not create another
branch, endpoint, or compute without a new review.

## Recovery blockers

Do not continue provider work or run the recovery deployment workflow until all
of these are available, verified, and separately authorized:

- the last confirmed source workbook;
- the secure source containing real trainer rates;
- the approved Firebase web and Admin configuration;
- Neon pooled and direct database credentials transferred only through approved
  secret-handling paths;
- accepted database restoration, runtime-role, reconciliation, dump, and restore
  evidence;
- project budget controls and the exact least-privilege IAM grants;
- the approved upload bucket, lifecycle, CORS, and Secret Manager resources;
- the Artifact Registry cleanup policy and a recorded rollback baseline.

Credentials, real trainer rates, personal emails, provider identifiers, and live
endpoints must remain outside GitHub.

## Phase 1 — Local development

Prerequisites:

- Node.js 22 or later;
- npm 10 or later;
- PostgreSQL client tools;
- a local PostgreSQL database;
- Firebase configuration for an approved local development project.

Install dependencies from the repository root:

```powershell
npm.cmd ci
```

Copy [`.env.example`](../.env.example) to an uncommitted `.env`. Use a normal
local PostgreSQL URL:

```text
DATABASE_URL=postgresql://user:password@localhost:5432/training_planner
```

Local Firebase Admin development may use a service-account JSON value only in
the uncommitted environment file. Never commit the JSON or paste it into a
command. A future Cloud Run service must use Application Default Credentials
through its runtime service identity.

Apply [`db/schema.sql`](../db/schema.sql) only to a new, empty local database:

```powershell
psql "$env:DATABASE_URL" -f db/schema.sql
```

Start the API and web app:

```powershell
npm.cmd run dev
npm.cmd run dev:web
```

The default local API and SPA addresses are `http://localhost:8080` and
`http://localhost:5173`.

## Phase 2 — Repository validation

Run the checks in this order:

```powershell
npm.cmd ci
npm.cmd run check:infra
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
```

The CI workflow repeats `check:infra`, typecheck, tests, and build on pull
requests to `main` and pushes to `main`.

## Phase 3 — Remaining provider preparation

The manually created foundations listed above are not authorization to continue.
Every remaining provider action stays blocked until a separate work order names
the resource, IAM impact, cost impact, validation, and rollback.

### Neon

The approved PostgreSQL 17 project already exists in Singapore. Retain the live
0.25-0.5 CU compute range and Free-plan autosuspend. Do not create another
project, branch, endpoint, or compute as part of deployment readiness.

Neon provides two connection types:

- **Pooled runtime URL** — used by the API through `DATABASE_URL`; it must
  include `sslmode=require`.
- **Direct administrative URL** — used only for approved schema application,
  `pg_dump`, and restore verification.

Create restricted application roles through separately authorized SQL, restore
and reconcile the database, then store the pooled runtime URL in Secret Manager
during authorized provisioning. Do not commit either URL.

### Firebase

The recovery project, Hosting web app, and email/password plus email-link sign-in
already exist. Add only approved local and hosted domains, and do not enable
additional sign-in providers without a separate authorization decision.

Cloud Run must be configured separately with public invocation so browser
requests can reach the API. Before dispatch, the separate manual provider/IAM gate
must establish and record an unconditional `roles/run.invoker` binding
containing `allUsers` with no condition for `core-api`. The deployment workflow
performs only a read-only
`gcloud run services get-iam-policy` preflight for that prerequisite and cannot
change IAM. Public platform invocation does not make protected application routes
public: Firebase token verification and server-side role authorization remain
mandatory.

### Temporary uploads

Create a placeholder-named bucket only during authorized provisioning. Before
enabling browser uploads:

1. Replace the placeholder origin in
   [`infra/gcs-cors.example.json`](../infra/gcs-cors.example.json) with the
   actual Firebase Hosting origin in a temporary, uncommitted copy.
2. Apply [`infra/gcs-lifecycle.json`](../infra/gcs-lifecycle.json), which
   deletes current objects after one day.
3. Apply the temporary CORS file. It must allow only `PUT` with
   `Content-Type`; wildcard origins are forbidden.
4. Confirm signed upload URLs expire after 15 minutes.

Example commands for the later authorized checkpoint:

```powershell
gcloud storage buckets update gs://YOUR_UPLOAD_BUCKET --lifecycle-file=infra/gcs-lifecycle.json
gcloud storage buckets update gs://YOUR_UPLOAD_BUCKET --cors-file=path/to/uncommitted-gcs-cors.json
```

Configure Artifact Registry cleanup to remove container artifacts after 30 days.

### GitHub repository configuration

For the private GitHub Free initial phase, the manual recovery workflow reads
these 11 approved non-secret values from repository-level Actions variables
under the repository's Actions Variables settings. They are repository-level
variables, not environment variables, and their values must be supplied and
validated through a separately authorized configuration step.

| Variable | Purpose |
|---|---|
| `GCP_PROJECT_ID` | Target recovery project selected by the manual confirmation gate. |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full Workload Identity provider resource used for keyless GitHub OIDC. |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | Deployer service-account email impersonated through Workload Identity Federation. |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | Runtime service-account email attached to the Cloud Run service. |
| `GCP_ARTIFACT_REPOSITORY` | Name of the pre-approved regional container repository. |
| `GCP_DATABASE_SECRET` | Secret Manager secret name containing the pooled TLS database URL. |
| `GCP_ADMIN_EMAILS_SECRET` | Secret Manager secret name containing the bootstrap admin allowlist. |
| `GCS_UPLOAD_BUCKET` | Approved temporary-upload bucket name. |
| `FIREBASE_HOSTING_ORIGIN` | Exact approved Hosting origin used by API CORS. |
| `FIREBASE_API_KEY` | Firebase web API key for the registered web app. |
| `FIREBASE_AUTH_DOMAIN` | Firebase Auth domain for the registered web app. |

Do not place passwords, connection strings, admin email allowlists,
service-account keys, or secret values in these variables. Secret-name variables
identify Secret Manager resources; the corresponding secret values remain only
in Secret Manager.

For this private repository on GitHub Free, required environment reviewers and
environment-scoped variables/secrets are unavailable. No `production` GitHub
environment is created or referenced for this design. Repository-level variables
and the workflow's mechanical checks therefore cannot provide true independent
GitHub-native approval.

The residual risk is single-owner control: `Darerhyun` is the sole nominated
actor and repository owner, so the same owner can ultimately dispatch the manual
workflow. This compensating control reduces accidental deployment and scope
drift, but it is not equivalent to independent GitHub-native approval.

The four required workflow inputs and their exact gates are:

1. `confirmation` must equal `DEPLOY TRAINING PLANNER`.
2. `target_project_id` must be non-empty through the existing exact comparison
   with `GCP_PROJECT_ID`.
3. `expected_commit_sha` must be non-empty and exactly equal to
   `github.sha`.
4. `cost_acknowledgement` must equal `I ACKNOWLEDGE LOW-COST LIMITS`.

Before checkout and before cloud authentication, the manual/configuration
verification step also requires `github.actor` exactly `Darerhyun`,
`github.ref` exactly `refs/heads/main`, and all 11 repository variables to be
non-empty.

### Numeric Secret Manager pins and rotation

The workflow pins the Cloud Run secret mappings to verified numeric versions:
`DATABASE_URL=${GCP_DATABASE_SECRET}:3` and
`ADMIN_EMAILS=${GCP_ADMIN_EMAILS_SECRET}:2`. It never uses `:latest`, so the
deployed revision cannot silently follow an unreviewed secret rotation. Version
3 of the approved database secret and version 2 of the approved admin-email
secret must exist and be verified before an authorized dispatch.

This initial recovery PR starts from a base whose workflow used
`:latest`. Reverting this PR therefore restores floating pins, so dispatch must
remain prohibited until a separately reviewed numeric-pin change is accepted.

For a future rotation, use the separately authorized provider procedure to create
and validate a new numeric version, then use a reviewed numeric-pin PR to select
a previously verified enabled version for rollback or rollout. Any provider
secret-version state change remains separately authorized; do not commit secret
values or mutate provider state as part of this PR.

### Separate public-invocation provider gate

Public invocation is a manual provider/IAM prerequisite, not a workflow action.
The provider gate must verify that `core-api` has an unconditional
`roles/run.invoker` binding containing `allUsers` with no condition before
dispatch. The workflow only reads the IAM policy after Workload Identity
Federation authentication and fails closed when the prerequisite is absent. It
cannot grant, remove, or otherwise mutate IAM; no `roles/run.invoker` binding
is created by this PR.

#### Separate user/Sol/Terra process gate

Before every dispatch, the user must provide fresh explicit authorization for
the exact accepted commit and target. Sol performs preflight against the
recorded repository-variable names and deployment contract, and Terra performs
an independent read-only verification of the accepted commit, configuration
evidence, and preflight evidence. This process gate is a compensating control,
not independent GitHub-native approval, and it does not authorize merge,
deployment, provider changes, or workflow dispatch by itself.
### Least-privilege IAM plan

Do not grant these roles merely because they are documented. IAM remains frozen
until this pull request is approved and a separate provider work order confirms
the exact resource scopes.

The deployer identity requires only:

- Artifact Registry Writer on the single approved repository;
- Cloud Run Developer (`roles/run.developer`) on the target project or
  service scope required for the first `core-api` revision;
- Firebase Hosting Admin;
- Service Usage Consumer only if the Firebase CLI verification proves it is
  required;
- Service Account User only on the Training Planner runtime service account.

The existing Workload Identity User binding remains outside committed
configuration and scoped to the repository's stable numeric identity. Do not
commit that numeric repository or owner identity.

The runtime identity requires only:

- Secret Manager Secret Accessor on the two named application secrets;
- Storage Object Creator and Storage Object Viewer on the single temporary
  upload bucket;
- Service Account Token Creator on itself only if a controlled signed-URL test
  proves it is required for V4 signing.

Do not grant project-wide storage access, secret access to any other secret,
service-account keys, owner/editor roles, database administration, role
creation, or unrelated API permissions.

## Phase 4 — Fresh database restoration

Use a fresh empty Neon database. Restoration order is mandatory:

1. Connect with the direct administrative URL.
2. Apply `db/schema.sql` exactly once.
3. **Do not replay files under `db/migrations/`.** The current schema already
   contains those historical changes.
4. Run `npm.cmd run seed-reference-data`.
5. Restore real trainer rates from the approved secure source.
6. Reimport the last confirmed workbook through the existing Sync workflow.
7. Recreate Firebase access: bootstrap the authorized first admin, then allow
   other users to enter as `pending` for later approval.
8. Reconcile course, trainer, venue, room, session, user, and rate-tier counts
   against the last accepted evidence.
9. Create an encrypted `pg_dump` using the direct URL.
10. Restore that dump into a separate empty verification database and run the
    health and count checks.

No production rate values, workbook contents, database dump, or credentials may
be added to GitHub.

## Phase 5 — Gated deployment readiness

Deployment remains frozen. Merging the recovery workflow, configuring the
repository-level Actions variables, changing provider resources, and dispatching
the workflow each require their own express authorization. The workflow is
manual-only and requires all four inputs: the literal confirmation
`DEPLOY TRAINING PLANNER`, the target project ID to match the configured
`GCP_PROJECT_ID` variable, a non-empty `expected_commit_sha` exactly matching
`github.sha`, and the exact cost acknowledgement
`I ACKNOWLEDGE LOW-COST LIMITS` before checkout or cloud authentication.

The earlier `npm run build` remains before cloud authentication as
repository validation; it is not container image publication. After Workload
Identity Federation and `setup-gcloud`, the workflow performs a read-only check
that the manually established unconditional `allUsers` /
`roles/run.invoker` prerequisite exists with no condition. That preflight runs
before container image build/push and before Cloud Run deployment. The workflow
captures the existing sole 100% Cloud Run revision as the rollback target,
builds and resolves one immutable Artifact Registry image digest, and deploys a
candidate `core-api` revision with `--no-traffic`. Revision and temporary tag
names include the bounded workflow run ID and attempt, so repeated dispatches
cannot reuse the prior candidate identity. The workflow confirms that the
candidate is ready, that its tag points to that exact revision, and that the
revision image digest matches the pushed digest. It records the candidate
revision, digest, tag, zero-traffic state and rollback revision without secrets.
Its tagged JSON `/health` response must report `status: ok`, `service:
core-api`, and `database: connected`; checking only the general service URL is
insufficient because that URL may still serve the prior revision. The candidate
tag is used only for this health check. The workflow captures the stable Cloud
Run service `status.url` before activation, builds the web app against that
stable service URL after candidate health passes, and only then attempts to
assign 100% traffic to the exact candidate revision name. It verifies the
exact final allocation and base URL health before deploying Firebase Hosting
only. The activation attempt is marked before the traffic command, so command
or control-plane uncertainty invokes bounded rollback. Any failure after that
point restores the captured rollback revision, asserts it is the sole 100%
target, checks its base URL JSON health for the same connected core-api
response, and overwrites the final traffic revision, percentage and status
evidence. The workflow does not provision resources, apply SQL, create
secrets, assign IAM, use `--to-latest` or `LATEST=`, or deploy any other
Firebase product.

The committed `apps/web/.env.production` deliberately retains a `.invalid`
endpoint. The actual API URL and Firebase web configuration are injected only
into the authorized deployment build.

The remaining recovery work is split into independent gates. Approval at one
gate does not imply approval for any later gate:

1. **Merge gate** — Terra must approve the actual recovery diff and validation
   evidence, then Sol must separately accept the implementation and expressly
   authorize the merge.
2. **Repository configuration gate** — configure and verify the 11
   repository-level Actions variable names and record the external
   authorization and preflight evidence under a separate work order. GitHub
   Free does not provide independent environment reviewers or environment-scoped
   variables/secrets for this private repository.
3. **IAM and provider gate** — grant the reviewed least-privilege IAM roles and
   verify every already-created provider resource under a separate work order;
   this workflow does not create resources, secrets, IAM bindings, or database
   objects.
4. **Dispatch gate** — Sol and the user must expressly authorize the exact
   accepted commit and target before Luna may enter the two manual confirmation
   values and dispatch the workflow.

The workflow also verifies that the approved Artifact Registry repository and
`core-api` Cloud Run service already exist before it pushes an image or changes
a service revision. A missing target stops the run; the workflow does not create
the missing resource.

### First-deployment preflight evidence

Record and independently review all of the following before dispatch:

- the accepted commit SHA, approved workflow ref, repository-level Actions
  variable names, and recorded external authorization/preflight evidence;
- the replacement project, regional provider resources, keyless Workload
  Identity binding, and confirmation that both service accounts still have no
  user-managed keys;
- exact IAM policy evidence matching the least-privilege plan above;
- budget alerts, applicable spend controls, locked Cloud Run limits, Neon live
  compute range and autosuspend, and the expected first-month cost;
- successful schema application, reference-data seed, secure trainer-rate
  restoration, workbook reimport, row-count reconciliation, restricted runtime
  role test, encrypted dump, and restore-verification evidence;
- both Secret Manager resources, the pooled TLS database connection test, and
  confirmation that no secret value entered GitHub or command output;
- upload bucket lifecycle, restricted CORS, 15-minute signed-URL test, and
  runtime bucket permissions;
- regional Artifact Registry repository and 30-day cleanup policy;
- all 11 required repository-level Actions variable names populated, without
  printing their values;
- an absent-state or prior-state capture for Cloud Run traffic and Firebase
  Hosting releases, plus the rollback evidence below.

After deployment, verify the public health endpoint, authenticated
role-protected routes, Firebase Hosting authentication, database connection
count, billing telemetry, GCS lifecycle/CORS, signed URL expiry, and artifact
cleanup before users upload a workbook.

## Recovery execution safety checklist

- Verify the remote repository, intended branch, exact base SHA, and
  clean-equivalent remote tree before edits begin.
- Enforce the exact three-file allowlist after every edit group:
  `.github/workflows/deploy-recovery.yml`, `docs/SETUP.md`, and
  `scripts/check-infra-guardrails.mjs`; stop for a revised Sol decision before
  touching a fourth file.
- Run validation as separately reported stages, each with an explicit timeout
  and captured command result.
- Never claim a command is running without an active command or session and
  recent output that proves it is still running.
- Stop and report lost execution state or missing output instead of silently
  retrying or leaving a misleading progress message.
- After validation and separate publication authorization, create a durable
  branch commit and draft pull request promptly so accepted work is not held
  only in a temporary workspace.
- Preserve stalled drafts and compare them with the verified remote tree and
  blobs; never publish synthetic-baseline diffs or final-newline-only artifacts.

## Rollback

Before deployment:

- for this initial recovery PR, reverting the commit restores the old floating
  `:latest` workflow; dispatch must remain prohibited until a reviewed
  numeric-pin change is accepted;
- for future rotations, rollback requires a reviewed numeric-pin PR selecting a
  previously verified enabled version; any provider secret-version state change
  remains separately authorized;
- delete no provider resource, secret version, or IAM binding without a
  separately approved cleanup plan.

The first-deployment approval packet must preserve:

- the exact accepted commit and container image digest;
- the pre-deployment Cloud Run revision/traffic state, including evidence when
  no prior service exists;
- the pre-deployment Firebase Hosting release state, including evidence when no
  prior release exists;
- a verified encrypted PostgreSQL dump and the separate restore-verification
  result;
- the current database secret version identifier without its value;
- the person authorized to stop rollout and the post-rollback verification
  checklist.

After an authorized deployment:

1. preserve the exact candidate image digest, run/attempt-derived tag, revision,
   zero/100% traffic evidence and recorded rollback revision;
2. if activation or a later control-plane check fails, route Cloud Run back to
   the recorded prior revision, assert that it alone receives 100% traffic, and
   verify its base URL JSON health (`status: ok`, `service: core-api`,
   `database: connected`) before any further action;
3. record the exact final traffic revision, percentage and ready status; after
   rollback, overwrite those fields with the restored revision’s evidence;
4. route the frontend back to the previously accepted API revision if required;
5. restore the verified encrypted PostgreSQL dump into a separate database;
6. update the database secret only after restore validation;
7. verify authentication, health, row counts, and Sync behaviour;
8. record the incident and provider cost impact.

For a first deployment with no prior API revision or Hosting release, stop the
rollout and require a new bounded recovery decision; do not improvise cleanup or
resource deletion. Never overwrite the only database or dump during rollback.
