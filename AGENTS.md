# AGENTS.md — Training Schedule Planner

> This file is the always-loaded project brief. Keep it short. Detailed reference material lives in `docs/` and should be read on demand, not pasted here.

## What we are building

An internal **training schedule planning tool** for an adult-education company in Singapore (ASK Training). The Operations team runs roughly 100-150 training sessions per month across several programme families. Today they plan this in a master Excel workbook. We are replacing that with a web app that:

1. **Ingests** the master schedule Excel (uploaded periodically) and parses it into structured sessions.
2. **Displays** a planning view (calendar / list / room overview) so Ops can see what is scheduled where, with which trainer.
3. **Assists** the planner in assigning trainers and rooms to sessions, using business rules and an AI assistant.
4. **Computes** per-session economics — revenue vs trainer cost — and surfaces a viability badge so the planner knows which sessions are profitable, without exposing sensitive trainer fees to non-finance users.

This is a planning aid, NOT the system of record. The company's TMS (Training Management System) remains the official record for funding claims, SSG codes, etc. This tool is for internal operational planning only.

## Who uses it

- **Ops** (primary users) — plan sessions, assign trainers/rooms. See viability badges, not dollar figures.
- **Finance** — see full economics including trainer fees.
- **Admin** — full access, manage users.
- **Viewer** — read-only.

Multi-user from day one. Roles live on `users.role` (enum: `admin | ops | finance | viewer | pending | rejected`). New signups land as `pending` until an admin approves.

## Architecture (target)

Cost target: **$0/month** on free tiers where possible.

| Layer | Choice | Notes |
|---|---|---|
| Database | **Neon Postgres** (free tier) | Single schema. No Firestore. |
| API | **Cloud Run** — Node 22 + TypeScript + Hono | `services/shared` + `services/core-api` |
| Frontend | **Vite SPA** on **Firebase Hosting** | Dark navy/indigo glass-morphism aesthetic preferred |
| Auth | **Firebase Auth** — email magic link | `ADMIN_EMAILS` env allowlist for first admins |
| File upload | **GCS signed-URL uploads** | For the master schedule Excel |
| AI | **Google AI Studio — Gemini direct** | NOT Vertex AI. NOT a gateway. Direct API. |

Do not introduce Vertex AI, Firestore, or Cloudflare — they are explicitly out of scope.

## How to read this project

The domain knowledge — what courses exist, who can teach what, what rooms exist, how pricing works — is captured in `docs/`. **Read the relevant doc before writing code that touches that domain.** Start with `docs/00-INDEX.md`, which maps every file.

The data model is driven by the CSVs in `docs/` — they are the seed data. The markdown files explain the model and the business rules.

## Ground rules for agents working in this repo

1. **Read `docs/00-INDEX.md` first**, then the specific domain doc relevant to your task. Do not guess at the domain model — it is documented.
2. **Work in small, reviewable batches.** One PR's worth of scope at a time. Validate each batch (it builds, it runs) before moving on.
3. **Ask before deleting** files or making destructive schema changes.
4. **Report honestly.** If something failed, say so. Do not silently retry or paper over errors.
5. **Sensitive data stays out of the repo.** Real trainer fees are never committed. They live only in the Neon database. The repo contains the rate *model* and *tier groupings*, never the dollar amounts. See `docs/02-domain/trainer-rates.md`.
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
3. **PR3 — Planning dashboard.**
4. **PR4 — Trainer picker drawer** with rules-based suggestions (skills, SME boost, exclusions, tier/cost awareness).
5. **PR5 — AI assistant chat** (propose → confirm → execute pattern).
6. **PR6 — Gantt trainers view, Calendar view, Activity page.**

## Key domain concepts (one-liners — details in docs/)

- **Course / module** — a thing that can be taught. Standalone (ASK courses) or part of a programme (ACDM, DDM, SDDM, CIIO, ACIIO, DIIO). See `docs/02-domain/courses.md`.
- **Session** — one delivery of one course on specific dates at a venue/room, for a cohort. Comes from the Excel upload. This is the planning unit.
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
