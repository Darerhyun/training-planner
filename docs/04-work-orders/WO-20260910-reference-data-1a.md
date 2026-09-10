# Work order — REFERENCE-DATA-1A

Status: approved for implementation; schema/API/resolver foundation only

## 1. Identity and sequence

- Branch: `feat/reference-data-1a`
- Expected base: `6007159630f567f9d4e0fa3deee4922354243ec9`
- PR: draft only after local and disposable PostgreSQL 16 validation
- Sequence: SYNC-SAFE-1 (merged) → REFERENCE-DATA-1A → later
  SYNC-RESOLUTION-1; REFERENCE-DATA-1B is the later Admin UI workstream.

This order implements the Admin reference-data authority needed by the approved
Sync repair contract. It does not make a production migration, seed production,
change session economics, repair existing sessions, or resume PR3K.

## 2. Required reading and repository constraints

Read `AGENTS.md`, `WORKFLOW_HARNESS.md`, `LUNA_RULES.md`, `docs/00-INDEX.md`,
`docs/01-product/sync-reference-repair.md`,
`docs/01-product/planning-workflow-roadmap.md`,
`docs/02-domain/courses.md`, and `docs/02-domain/venues-rooms.md` before edit.

Preserve existing legacy matching, pagination, session-span semantics, Sync
preview/apply behavior from SYNC-SAFE-1, trainer APIs, authentication and the
ownership model. Do not expose fees or trainer economics.

## 3. Approved contract

### Database

1. Add additive, idempotent lifecycle fields to `courses`, `venues`, `rooms`,
   and `course_aliases`: `is_active`, positive `version`, `created_at`, and
   `updated_at`. Preserve all existing rows active at version 1; fabricate no
   history.
2. Add `raw_room_text` to `sessions` so future imports preserve source evidence.
3. Add sibling `venue_aliases` and venue-scoped `room_aliases`. Room aliases
   resolve only inside the canonical venue namespace and use
   `(venue_code, normalized_alias)` uniqueness.
4. Add normalized identity uniqueness, namespace revision counters, and an
   append-only `reference_data_change_events` table. Canonical course codes,
   venue codes, room IDs/scopes, and alias identities are immutable. No hard
   delete; deactivate/reactivate instead.
5. Enforce preflight duplicate normalized identities and invalid room ownership
   before any migration DDL/DML. Enforce active-owned-venue requirements for
   active rooms and prevent owned venue type changes while rooms remain.

### API and authorization

1. Add an Admin-only `/admin/reference-data` route family for list/search with
   pagination, detail/history, canonical create/edit/deactivate/reactivate, and
   alias create/retarget/deactivate/reactivate for courses, venues and rooms.
2. Use server-side authentication and active Admin authorization before SQL.
   Return typed 400/401/403/404/409 errors. Every optimistic write requires
   `expectedVersion`; stale writes return 409 with the current version.
3. Each successful mutation is one transaction containing the record update,
   one namespace-revision increment and exactly one immutable audit event.
   Sensitive alias and lifecycle operations require a 1–500 character note;
   ordinary canonical create/edit notes are optional.
4. Alias text and scope are immutable. Retargeting an active alias requires a
   note. A room alias cannot cross venue boundaries. Aliases affect future
   parsing and Re-check only; they never rewrite existing sessions.
5. Course responses and all reference-data responses exclude `fee_with_gst`,
   trainer rates, economics and protected rate data.

### Resolver and parser

- Resolve only active canonical records and active aliases.
- Resolve a room alias only after resolving the canonical venue.
- Preserve the literal `Hotel` pending category, blank operational warnings,
  non-empty unmatched blockers, legacy matching and raw room text.
- Do not implement Re-check, row decisions, permanent ignore rules, existing
  session repair, cancellation overrides or production cleanup in this order.

## 4. Exact implementation scope

Only these 21 files may change:

1. `docs/04-work-orders/WO-20260910-reference-data-1a.md`
2. `infra/baselines.json`
3. `docs/01-product/decision-log.md`
4. `docs/00-INDEX.md`
5. `docs/01-product/sync-reference-repair.md`
6. `docs/01-product/planning-workflow-roadmap.md`
7. `docs/01-product/trainer-rate-reconciliation.md`
8. `docs/02-domain/courses.md`
9. `docs/02-domain/venues-rooms.md`
10. `docs/03-design/design-brief.md`
11. `docs/03-design/admin-pr3k-rate-reconciliation/README.md`
12. `db/schema.sql`
13. `db/migrations/2026-09-10_reference_data.sql`
14. `services/core-api/src/index.ts`
15. `services/core-api/src/routes/admin-reference-data.ts`
16. `services/core-api/src/routes/admin-reference-data.test.ts`
17. `services/core-api/src/ingest/reference-data.ts`
18. `services/core-api/src/ingest/reference-data.test.ts`
19. `services/core-api/src/ingest/master-schedule-mapping.ts`
20. `services/core-api/src/ingest/parse-schedule.ts`
21. `services/core-api/src/ingest/parse-schedule.test.ts`

No other file, dependency, package, auth configuration or infrastructure
setting may change without a new change notice and Sol approval.

## 5. Validation and review

Run `npm ci`, `npm run check:infra`, `npm run typecheck`, `npm test`,
`npm run build`, and `git diff --check`. Run the checksum-verified disposable
native `postgres:16-alpine` validation for fresh schema, exact-base upgrade,
replay, trigger/constraint/namespace checks, duplicate and invalid-room
preflight atomicity, and transaction rollback. Use only synthetic fixtures and
the preserved validation SQL; do not connect to a provider.

After validation, report the exact commit/tree, file list, commands/results,
fixes and escalations. Preserve the commit and create a git bundle immediately.
Sol High independently reviews the exact diff and evidence. Because this is a
schema/authorization high-risk change, Claude reviews the same exact head in
parallel when available. No publication occurs before the disposable
PostgreSQL 16 evidence is returned and accepted.

## 6. Exclusions, rollback and stop conditions

Excluded: UI, production queries/writes/migrations/seeds, provider access,
session repair, permanent ignore rules, cancellation overrides, Re-check,
SYNC-RESOLUTION-1, rate reconciliation, PR3K, economics changes, deployment,
merge, direct push, real identities/fees/workbooks and new dependencies.

Rollback is a single local commit revert; the additive migration is not applied
by this order. Stop and escalate if the base/head/tree changes, an extra file is
needed, preserved schema/migration bytes differ from the validated package, a
schema or authorization conflict appears, any validation fails, or production
access is required.
