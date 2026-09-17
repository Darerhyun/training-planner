# Work order — SYNC-RESOLUTION-1

Status: approved for local implementation and validation; no publication or release

## 1. Identity and purpose

- Branch: `feat/sync-resolution-1`
- Exact base: use `infra/baselines.json` `sourceBaseline`
- Purpose: implement stage 4 of `docs/01-product/sync-reference-repair.md`:
  per-batch row skips, explicit Re-check, complete Preview freshness, safe
  cancellation correspondence, and atomic/idempotent Apply.

This order follows SYNC-SAFE-1 and REFERENCE-DATA-1A. It does not implement the
Admin Reference data UI, repair existing sessions, change production, or resume
rate reconciliation.

## 2. Contract

1. Admin and Ops may write Sync; Finance and Viewer cannot. Every upload stops
   at Preview and requires an explicit successful Re-check, review and
   acknowledgement of the exact current digest before Apply.
2. Re-check reuses the same uploaded object, re-parses it and resolves against
   current server state. It never applies. Changed output disarms acknowledgement.
   A failed Re-check retains the last stored Preview; an expired object requires
   Cancel and re-upload.
3. Freshness binds workbook SHA-256, parser version, all six reference namespace
   revisions, trainer identity/version state, affected external references and
   session identity/version/absence, row classifications, decisions, explicit
   cancellation evidence and the final digest. Confirm repeats this validation
   under deterministic locks and returns a typed 409 with no writes when stale.
4. A skip is per source row and batch, reversible before Apply, never bulk or
   permanent, and requires a trimmed 1–500 character reason. The server issues
   and validates stable source IDs. Skip is offered only when unresolved,
   ambiguous or application-managed conflict correspondence is provable.
5. Skipped rows retain source presence and never insert, update or explicitly
   cancel a session. Workbook absence still never cancels. Duplicate or
   ambiguous correspondence blocks.
6. Row arithmetic is mutually exclusive: total = apply + skipped + blocked;
   warnings are non-additive. Cancellation evidence exposes numerator source-row
   IDs separately from matched session IDs, retains every denominator session ID
   and version, and keeps the greater-than-50-percent hard block non-overridable.
7. Apply is one transaction. No partial session, batch or acknowledgement
   evidence may commit. Retrying the exact committed digest returns its stored
   result; another digest or changed decisions is rejected.
8. The applied batch retains the actor, acknowledged digest/time, final row
   decisions/reasons and result. No intermediate audit events are fabricated.
9. Alias changes affect only future parsing and Re-check. Hotel, blanks,
   unmatched values, `raw_room_text`, active-only resolution and venue-scoped
   room aliases remain unchanged.
10. The ASK white/red UI presents row issues and Skip/Restore, explicit Re-check,
    summary, current-Preview acknowledgement, result-panel live regions and
    keyboard behavior without linking Ops to inaccessible Admin controls.

## 3. Exact scope

Only these 12 files may change:

1. `docs/04-work-orders/WO-20260915-sync-resolution-1.md`
2. `infra/baselines.json`
3. `db/schema.sql`
4. `db/migrations/2026-09-15_sync_resolution.sql`
5. `services/core-api/src/routes/sync.ts`
6. `services/core-api/src/routes/sync.test.ts`
7. `services/core-api/src/ingest/parse-schedule.ts`
8. `services/core-api/src/ingest/parse-schedule.test.ts`
9. `apps/web/src/api.ts`
10. `apps/web/src/api.test.ts`
11. `apps/web/src/pages/sync-page.tsx`
12. `apps/web/src/styles.css`

## 4. Validation and review

Run `npm ci`, `npm run check:infra`, `npm run typecheck`, `npm test`,
`npm run build`, `git diff --check`, the exact 12-file scope check, rendered
synthetic checks at 1440/390/320, and checksum-verified disposable native
PostgreSQL 16 validation for fresh schema, exact-base upgrade, replay,
constraints and transaction rollback. Never connect to a provider.

Luna Max owns integration; Astra XHigh implements bounded slices; Sol High and
Claude review the same eventual high-risk head in parallel. No push, PR, merge,
migration or deployment is authorized by this order.

## 5. Rollback, exclusions and stop conditions

Before migration, rollback is one local commit revert. Excluded: REFERENCE-DATA-1B,
permanent ignore rules or seeds, cancellation override, absence-based
cancellation, production access, session repair, mappings, rates/economics,
PR3K, new dependencies/infrastructure/provider changes, real workbooks,
identities or fees, publication, migration and deployment.

Stop if the base changes, a thirteenth file is needed, correspondence cannot be
proved, schema/auth/ownership conflicts appear, validation needs real data or
provider access, or another product decision is required.
