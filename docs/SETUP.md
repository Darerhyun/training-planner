# Setup and Infrastructure Recovery

This is the single authoritative guide for local development and the future
Training Planner infrastructure recovery. No live environment currently exists.
The former Google project was deleted, and this repository change does not
provision, restore, migrate, or deploy anything.

All provider commands below are examples for a later, separately authorized
recovery run. Replace placeholders only at that checkpoint and never commit the
resulting identifiers, endpoints, emails, bucket names, or credentials.

## Locked recovery architecture

| Layer | Approved recovery target |
|---|---|
| Database | Neon PostgreSQL in Singapore; pooled TLS URL for runtime |
| API | Cloud Run in `asia-southeast1`, request-based billing |
| Frontend | Firebase Hosting |
| Authentication | Firebase Auth email link plus application role checks |
| Uploads | Temporary GCS signed uploads with seven-day retention |

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
- Uploaded workbook retention: 7 days.
- Container artifact retention: 30 days.

Without a new user-approved cost exception, do not create Cloud SQL, Compute
Engine, GKE, Cloud Run minimum instances above zero, instance-based Cloud Run
billing, Serverless VPC Access, Cloud NAT, GPUs, or indefinite upload retention.

## Recovery blockers

Do not start provider work until all of these are available and authorized:

- the last confirmed source workbook;
- the secure source containing real trainer rates;
- the approved Firebase web and Admin configuration;
- Neon pooled and direct database credentials;
- the GCP billing account and authorized service identity;
- the approved upload bucket and Secret Manager access.

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

## Phase 3 — Future provider provisioning

This phase remains blocked until a separate work order authorizes provider
actions.

### Neon

Create one PostgreSQL project in Singapore. Configure five-minute autosuspend and
a USD 10 target consumption ceiling where supported.

Neon provides two connection types:

- **Pooled runtime URL** — used by the API through `DATABASE_URL`; it must
  include `sslmode=require`.
- **Direct administrative URL** — used only for approved schema application,
  `pg_dump`, and restore verification.

Store the pooled runtime URL in Secret Manager during authorized provisioning.
Do not commit either URL.

### Firebase

Create or select the authorized recovery project, enable Authentication, and
enable email-link sign-in. Add only approved local and hosted domains.

Cloud Run may be configured with platform-level `--allow-unauthenticated` so
browser requests can reach the API. That setting does not make protected
application routes public: Firebase token verification and server-side role
authorization remain mandatory.

### Temporary uploads

Create a placeholder-named bucket only during authorized provisioning. Before
enabling browser uploads:

1. Replace the placeholder origin in
   [`infra/gcs-cors.example.json`](../infra/gcs-cors.example.json) with the
   actual Firebase Hosting origin in a temporary, uncommitted copy.
2. Apply [`infra/gcs-lifecycle.json`](../infra/gcs-lifecycle.json), which
   deletes current objects after seven days.
3. Apply the temporary CORS file. It must allow only `PUT` with
   `Content-Type`; wildcard origins are forbidden.
4. Confirm signed upload URLs expire after 15 minutes.

Example commands for the later authorized checkpoint:

```powershell
gcloud storage buckets update gs://YOUR_UPLOAD_BUCKET --lifecycle-file=infra/gcs-lifecycle.json
gcloud storage buckets update gs://YOUR_UPLOAD_BUCKET --cors-file=path/to/uncommitted-gcs-cors.json
```

Configure Artifact Registry cleanup to remove container artifacts after 30 days.

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

## Phase 5 — Future authorized deployment

Deployment remains frozen until restoration is accepted and a separate
deployment plan identifies the target commit, provider resources, secrets,
validation, monitoring, rollback, and cost estimate.

The Cloud Run deployment must retain the locked limits. Example only:

```powershell
gcloud run deploy core-api --project=YOUR_PROJECT_ID --region=asia-southeast1 --image=YOUR_IMAGE_REFERENCE --platform=managed --allow-unauthenticated --cpu=1 --memory=1Gi --concurrency=20 --min-instances=0 --max-instances=2 --set-secrets=DATABASE_URL=YOUR_DATABASE_SECRET:latest
```

Use request-based billing. Inject the actual Firebase Hosting origin, bootstrap
admin email, upload bucket, API endpoint, and Firebase web configuration only at
the authorized deployment checkpoint. The committed
`apps/web/.env.production` deliberately uses a `.invalid` endpoint so an
unconfigured build cannot silently target a deleted service.

Verify the public health endpoint and authenticated role-protected routes.
Confirm billing alerts, Neon consumption controls, GCS lifecycle, CORS, signed
URL expiry, and artifact cleanup before users upload a workbook.

## Rollback

Before deployment:

- discard or revert the recovery branch;
- delete no provider resource without a separately approved cleanup plan.

After an authorized deployment:

1. route the frontend back to the previously accepted API revision;
2. roll Cloud Run back to the recorded prior revision;
3. restore the verified encrypted PostgreSQL dump into a separate database;
4. update the database secret only after restore validation;
5. verify authentication, health, row counts, and Sync behaviour;
6. record the incident and provider cost impact.

Never overwrite the only database or dump during rollback.
