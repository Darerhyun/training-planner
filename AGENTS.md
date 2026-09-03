# AGENTS.md — Training Schedule Planner

> This file is the always-loaded project brief. Keep it short. Detailed reference material lives in `docs/` and should be read on demand, not pasted here.

## Mandatory delivery workflow

- Read and follow `WORKFLOW_HARNESS.md` for every change to application code, infrastructure, database schema, GitHub state, or deployment.
- Sol must read `SOL_RULES.md` before planning, architecture, work orders, or acceptance.
- Luna must read `LUNA_RULES.md`, perform read-only inspection, send a pre-edit notice, and wait for `APPROVED_TO_EDIT` before editing.
- Terra must read `TERRA_RULES.md` and independently review the actual diff and evidence without editing.
- Sol must not record implementation acceptance before Terra approves.
- Only Luna may merge or deploy, and only after Terra approval plus separate Sol acceptance and express merge/deployment authorization.
- Any scope or repository-state deviation returns to Sol.
- If a rolebook or the harness conflicts with this file, stop and escalate.

## What we are building

An internal **training schedule planning tool** for an adult-education company in Singapore (ASK Training). The Operations team runs roughly 100-150 training sessions per month across several programme families. Today they plan this in a master Excel workbook. We are replacing that with a web app that:

1. **Ingests** the master schedule Excel (uploaded periodically) and parses it into structured sessions.
2. **Displays** a planning view (calendar / list / room overview) so Ops can see what is scheduled where, with which trainer.
3. **Assists** the planner in assigning trainers and rooms to sessions, using business rules and an AI assistant.
4. **Computes** per-session economics — revenue vs trainer cost — and surfaces a viability badge so the planner knows which sessions are profitable, without exposing sensitive trainer fees to non-finance users.

Excel is an import source only. After import, the Training Planner app is authoritative for internal planning changes such as trainer assignments and session amendments. This app is still NOT the regulated system of record: the company's TMS (Training Management System) remains the official record for funding claims, SSG codes, and other regulated data.

## Who uses it

- **Ops** (primary users) — plan sessions, assign trainers/rooms. See viability badges, not dollar figures.
- **Finance** — see full economics including trainer fees.
- **Admin** — full access; manage User Access and the Trainer Directory.
- **Viewer** — read-only.

Multi-user from day one. Roles live on `users.role` (enum: `admin | ops | finance | viewer | pending | rejected`). New signups land as `pending` until an admin approves.

## Architecture and deployment evidence

The application uses the approved PostgreSQL, Cloud Run, Firebase Hosting,
Firebase Auth, and GCS contracts. The repository `main` source baseline for the
current documentation work is `130b1e61b2822d572f29f677ad4a9f2a786d98ce`,
verified read-only before branching. The deployed application baseline is
`749908290131882505efb011300d446ee9926c74`, recorded as last-verified evidence.
These are distinct baselines; repository `main` may contain changes that have
not been deployed.

Production and provider details are evidence records, not current-state
guarantees, unless independently reverified read-only. This record does not
authorise another deployment or provider change; those actions remain separately
gated by `WORKFLOW_HARNESS.md`.

Do not recreate Cloud SQL without a new, explicit user-approved cost exception. Cloud SQL, Compute Engine, GKE, minimum Cloud Run instances, instance-based Cloud Run billing, Serverless VPC Access connectors, and Cloud NAT all require an explicit user-approved cost estimate, ceiling, monitoring, and rollback plan.

Do not introduce Vertex AI, Firestore, or Cloudflare without a separately approved architecture change.

## How to read this project

The product workflow and domain knowledge are captured in `docs/`. **Read the relevant doc before writing code that touches that product or domain area.** Start with `docs/00-INDEX.md`, which maps every file. Sol, Luna, and Terra must read `WORKFLOW_HARNESS.md` and their root rolebook. For Course Planning vs Sessions workflow, Excel/app/TMS ownership, Admin Area decisions, and PR3E–PR3J scope, read `docs/01-product/planning-workflow-roadmap.md`.

The data model is driven by the CSVs in `docs/` — they are the seed data. The markdown files explain the model and the business rules.

## Ground rules for agents working in this repo

1. **Read `docs/00-INDEX.md` first**, then the specific domain doc relevant to your task. Do not guess at the domain model — it is documented.
2. **Work in small, reviewable batches.** One PR's worth of scope at a time. Validate each batch (it builds, it runs) before moving on.
3. **Ask before deleting** files or making destructive schema changes.
4. **Report honestly.** If something failed, say so. Do not silently retry or paper over errors.
5. **Sensitive data stays out of the repo.** Real trainer fees are never committed. They live only in the protected production database, outside GitHub. The repo contains the rate *model* and *tier groupings*, never the dollar amounts. See `docs/02-domain/trainer-rates.md`.
6. **Honour the standardised conventions** (below) so the codebase stays consistent.

## Naming & layout conventions (locked)

- Schema file: `db/schema.sql` (not `database/`)
- Shared service code: `services/shared` (not `_shared`)
- Health endpoint: `/health` (not `/healthz`)
- Setup docs: single `docs/SETUP.md`, not scattered guides
- No screenshots committed to docs

## Build sequence (PRs)

Build in this order. Each PR is independently reviewable. Do not jump ahead.

1. **PR1 — Foundation.** Postgres schema + Firebase Auth shell + Cloud Run scaffold (`services/shared` + `services/core-api` with `/health` and `/me`) + admin allowlist + `.env.example`. **Mandatory checkpoint: stop after the schema is written and get it reviewed before writing application code.**
2. **PR2 — Ingest.** GCS signed uploads + `parse-schedule` function + Sync page UI + Sessions list page. Tiered confirm: auto-apply when fewer than 10 changes and no cancellations, otherwise require explicit confirm. Defensive guard if a parse would cancel more than 50% of existing sessions.
3. **PR3 — Planning dashboard and session workflow.** Preserve completed PR3 history while extending PR3 before PR4:
	- **PR3A — Room/reference polish.** Completed: generic owned-room label resolution for the observed August workbook labels (`ip-class1`, `ip-class2`, `ip-classroom`, `jtc-classroom`) without adding unobserved JTC class variants.
	- **PR3B — Read-only Planning Dashboard API.** Completed: `/planning/sessions` span-overlap API with filters, pagination, summaries, role access, and deferred training-day conflict detection.
	- **PR3C — Planning Dashboard frontend.** Completed: default authenticated Planning view with read-only session table, filters, summaries, and detail panel.
	- **PR3D — Planning Profile annotations.** Completed: read-only CSV-backed planning profile annotations for direct history, FT proxy history, no-history courses, and unavailable profiles.
	- **PR3E — Product and data-ownership contract.** Completed: approved Course Planning vs Sessions workflow and ownership roadmap committed as documentation.
	- **PR3F — Session write safety and audit foundation.** Completed: ownership, optimistic concurrency, session history, Admin/Ops trainer assignment endpoint, and Sync conflict protection.
	- **PR3G — Sessions UX and navigation consolidation.** Completed and merged: enhanced Sessions navigation, date modes, role-appropriate trainer amendment, history/detail states, stale-write handling, and protected Sync conflict presentation. Any deployment details for this historical milestone are evidence only.
	- **PR3G-V — ASK UX Visual Foundation.** Historical white/red presentation foundation completed before PR3H; the approved V4 Sessions frontend-only revision is upcoming after revised R12. Its V4 design inputs are archived under `docs/03-design/`; no V4 implementation is part of this work.
	- **PR3H — Future Course Planning.** Completed: month-based Course Planning using planning profiles as evidence, with explicit creation of draft Sessions from approved planned runs.
	- **PR3I — Admin Panel: User Access.** Completed: Admin-only workflow to invite, approve, reject, assign roles, deactivate, and reactivate application users.
	- **PR3J — Admin Panel: Trainer Directory.** Add the Admin-only workflow to register and edit trainers, activate/deactivate records, and manage course links and module exclusions.
4. **PR4 — Trainer picker drawer** with rules-based suggestions (skills, SME boost, exclusions, tier/cost awareness).
5. **PR5 — AI assistant chat** (propose → confirm → execute pattern).
6. **PR6 — Gantt trainers view, Calendar view, Activity page.**

The historical PR3G-V white/red foundation, PR3H, and PR3I retain their
historical identities and are complete in the repository history. The approved
PR3G-V V4 Sessions revision remains upcoming after revised R12; PR3J remains
separate and pending. PR4–PR6 retain their historical identities and numbering.
Audit recommendations R1–R15 are tracked separately in
`docs/01-product/maintenance-backlog.md`; they must not be confused with the
planning rulebook R1–R12 in `docs/02-domain/planning-rules.md`.

## Key domain concepts (one-liners — details in docs/)

- **Course / module** — a thing that can be taught. Standalone (ASK courses) or part of a programme (ACDM, DDM, SDDM, CIIO, ACIIO, DIIO). See `docs/02-domain/courses.md`.
- **Course Planning** — future-month course × venue planning. It decides what should be run, not who teaches it.
- **Session** — one delivery of one course on specific dates at a venue/room, for a cohort. Imported from Excel or created from approved Course Planning. Trainer assignment and session amendments happen here.
- **Trainer** — someone who can teach courses. Skill matrix + SME flags + exclusions. See `docs/02-domain/trainers.md`.
- **Venue / Room** — where sessions happen. Owned venues (IP, JTC) have rooms with capacities; external (hotels) and virtual (HBL) do not. See `docs/02-domain/venues-rooms.md`.
- **Trainer rate / tier** — what a trainer costs, by programme category and pax band. Sensitive. See `docs/02-domain/trainer-rates.md`.
- **Session economics** — revenue (course fee × pax) minus trainer cost, surfaced as a viability badge. See `docs/02-domain/trainer-rates.md`.

## What is NOT in scope for v1

- Email / push notifications (in-app only)
- Custom domain (defer)
- Per-department visibility scoping (schema-ready, no logic)
- Half-day room slots (assume one session per room per day)
- Meeting transcription (deferred post-MVP)
- Training Assistants entity (not yet modelled — coming later)
