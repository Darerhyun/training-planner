# Setup

This guide covers the PR1 foundation: Neon Postgres schema, shared service utilities, the Hono core API, Firebase Auth admin verification, and Cloud Run deployment.

PR1 does not include file upload, Excel parsing, or planning UI work.

## Prerequisites

- Node.js 22+
- npm 10+
- A Neon Postgres database
- A Firebase project with Authentication enabled
- Google Cloud SDK for Cloud Run deployment

On Windows PowerShell, use `npm.cmd` if your execution policy blocks the `npm` shim.

## Install Dependencies

From the repository root:

```powershell
npm.cmd install
```

## Environment Variables

Copy [.env.example](../.env.example) to `.env` for local development and fill in real values.

Required for the API:

```text
DATABASE_URL=postgresql://...
ADMIN_EMAILS=owner@example.com,admin@example.com
PORT=8080
ALLOWED_ORIGINS=http://localhost:5173
```

Firebase Admin credentials use one of two paths:

- Local explicit credentials: set `FIREBASE_SERVICE_ACCOUNT` to a one-line Firebase service account JSON string.
- Application Default Credentials: leave `FIREBASE_SERVICE_ACCOUNT` unset and run `gcloud auth application-default login` locally, or use the Cloud Run runtime service account in production.

The `VITE_FIREBASE_*` and `VITE_API_BASE_URL` variables are reserved for the future Vite SPA. They are documented now so the auth shell has a clear contract, but PR1 only runs the API.

## Database Setup

Apply the approved schema to Neon:

```powershell
psql "$env:DATABASE_URL" -f db/schema.sql
```

The schema file is [db/schema.sql](../db/schema.sql). Do not edit it unless a schema change has been explicitly requested and reviewed.

Seed data lives under [docs/02-domain](02-domain). The repo-safe CSVs currently present are:

- [courses_catalog.csv](02-domain/courses_catalog.csv)
- [trainers.csv](02-domain/trainers.csv)
- [trainer_courses.csv](02-domain/trainer_courses.csv)
- [venues.csv](02-domain/venues.csv)
- [rooms.csv](02-domain/rooms.csv)
- [programme_categories.csv](02-domain/programme_categories.csv)
- [trainer_tier_assignments.csv](02-domain/trainer_tier_assignments.csv)

Actual trainer rate dollar values are not committed. `trainer_rate_tiers.csv` is intentionally absent; those values live only in Neon.

## Firebase Auth Setup

In Firebase Console:

1. Create or select the project used by this app.
2. Enable Authentication.
3. Enable the Email/Password provider and turn on email link sign-in.
4. Add local and hosted domains to the authorized domains list as needed.
5. Create a service account key for local API development, or grant the Cloud Run runtime service account permission to use Firebase Admin in production.

New Firebase users are mirrored into the `users` table on their first authenticated `/me` request.

- Emails listed in `ADMIN_EMAILS` become `admin`.
- All other new users become `pending`.
- Admin approval workflow is implemented in later PRs.

## Run Locally

Build and typecheck everything:

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Start the API in development mode:

```powershell
npm.cmd run dev
```

The API listens on `http://localhost:8080` by default.

Public health check:

```powershell
Invoke-RestMethod http://localhost:8080/health
```

Authenticated profile endpoint:

```powershell
Invoke-RestMethod `
  -Uri http://localhost:8080/me `
  -Headers @{ Authorization = "Bearer <firebase-id-token>" }
```

## API Structure

- [services/shared](../services/shared) contains shared DB, Firebase, auth middleware, and TypeScript types.
- [services/core-api](../services/core-api) contains the Hono server, route registration, and Cloud Run Dockerfile.
- `/health` is public and checks database connectivity.
- `/me` requires a Firebase ID token and creates or returns the corresponding application user.

## Deploy To Cloud Run

Set these shell variables for your project:

```powershell
$PROJECT_ID="your-gcp-project-id"
$REGION="asia-southeast1"
$REPOSITORY="training-planner"
$IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/core-api:latest"
```

Create an Artifact Registry repository once:

```powershell
gcloud artifacts repositories create $REPOSITORY `
  --repository-format=docker `
  --location=$REGION `
  --project=$PROJECT_ID
```

Build and push the container from the repository root. The build context must be the root because the Dockerfile copies both workspaces.

```powershell
gcloud builds submit . `
  --project=$PROJECT_ID `
  --tag=$IMAGE `
  --file=services/core-api/Dockerfile
```

Deploy to Cloud Run:

```powershell
gcloud run deploy core-api `
  --project=$PROJECT_ID `
  --region=$REGION `
  --image=$IMAGE `
  --platform=managed `
  --allow-unauthenticated `
  --set-env-vars="NODE_ENV=production,PORT=8080,ALLOWED_ORIGINS=https://your-app.web.app,ADMIN_EMAILS=owner@example.com" `
  --set-secrets="DATABASE_URL=DATABASE_URL:latest"
```

Store sensitive values such as `DATABASE_URL` and `FIREBASE_SERVICE_ACCOUNT` in Secret Manager rather than passing them as plain environment variables.

After deployment, verify:

```powershell
Invoke-RestMethod https://<cloud-run-url>/health
```

## PR1 Completion Checklist

- [x] Approved Postgres schema in [db/schema.sql](../db/schema.sql)
- [x] Shared service package in [services/shared](../services/shared)
- [x] Core API package in [services/core-api](../services/core-api)
- [x] `/health` endpoint
- [x] `/me` endpoint with Firebase token verification
- [x] `ADMIN_EMAILS` first-admin allowlist
- [x] Root [.env.example](../.env.example)
- [x] Cloud Run Dockerfile
- [x] Local setup and deploy documentation
