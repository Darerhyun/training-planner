# Maintenance backlog — audit recommendations R1–R15

Status: shared audit register; implementation remains separately gated
Last updated: 3 September 2026

This register records the repository audit recommendations, not product
planning rules. The planning rulebook is
[`docs/02-domain/planning-rules.md`](../02-domain/planning-rules.md), whose
R1–R12 IDs describe scheduling constraints and heuristics. The IDs in this
document intentionally use a separate audit namespace; an audit item does not
change or implement a planning rule.

## Status register

| ID | Audit recommendation and proposed form | Status |
|---|---|---|
| R1 | **Unify HTTP error handling in core-api (revised).** Consolidate the route-specific `HttpError` classes and Admin error mapping into one typed error/body and one consistent catch path, with no API contract drift. | **Upcoming (revised)** |
| R2 | **Make `apiFetch` strict and recover only validated blocked parse responses.** Transport errors now retain status/code/version/payload, and the blocked Sync 409 exception is validated at its one call site. | **Complete** — merged through PR #17 at `53bffa55daaf1f22c34e2d921b08db08a5463431` |
| R3 | **Standardise the route-factory dependency shape.** Introduce one injectable route dependency contract and shared defaults. | **Not delegated — proposed form only** |
| R4 | **Use TypeScript project references instead of rebuilding `shared` in every script.** Align the root/workspace build and typecheck scripts and keep build tools in development dependencies. | **Maintenance backlog** |
| R5 | **Remove the dead invitation lookup from first sign-in (revised).** Drop the unused invitation argument and per-sign-in lookup while preserving the existing Admin invitation and pending-user contracts. | **Upcoming (revised)** |
| R6 | **Extract duplicated seed loops in `reference-data.ts`.** Share course, alias, trainer-alias, and trainer-course seed helpers without changing seeded data. | **Maintenance backlog** |
| R7 | **Use one CSV reader and one docs-root resolver.** Consolidate quote-aware parsing and the supported docs-root resolution without changing domain data. | **Maintenance backlog** |
| R8 | **Classify schedule rows once and apply with one existing-session query.** The Sync implementation now shares classification, bulk locking, and transactional apply behavior. | **Complete** — merged through PR #16 at `29844f934351a2e88b2f49fe42d3e2d4d7113372` |
| R9 | **De-duplicate planned-run row types and remove `NULL::text` padding.** Express the joined/locked row shape once and reuse the existing planning-month assertion. | **Maintenance backlog** |
| R10 | **Parallelise independent `/planning/sessions` queries.** Use one bounded `Promise.all` without changing the response contract. | **Not delegated — proposed form only** |
| R11 | **Use `checkDbConnection` in `/health` and prune unused shared exports.** Reuse the health helper, converge shared action/type exports, and reduce accidental public surface. | **Maintenance backlog** |
| R12 | **Split `App.tsx` by page (revised, structural-only).** Incrementally extract page and formatting modules with no styling, interaction, route, API, or behavior change. | **Upcoming (revised)** |
| R13 | **Collapse the three `/me` response shapes and drop redundant `deactivated`.** Return one profile shape with role-specific fields and keep the existing client contract deliberate. | **Not delegated — proposed form only** |
| R14 | **Share small utilities across core-api routes.** Consolidate date parsing, storage construction, and typed upload-batch lookup. | **Maintenance backlog** |
| R15 | **Conditionally retire Legacy Sessions after parity acceptance.** Keep the legacy path until the roadmap's acceptance gate is recorded, then remove it in one separately reviewed change. | **Not delegated — proposed form only** |

## Delivery boundaries

- R1, R5, and R12 are upcoming revised recommendations; this documentation PR
  does not begin any of them.
- R4, R6, R7, R9, R11, and R14 remain maintenance backlog items; no work order
  or implementation is delegated by this register.
- R3, R10, R13, and R15 are recorded in their proposed forms only and are not
  delegated. R15 remains conditional on explicit Legacy Sessions parity
  acceptance.
- R2 and R8 are recorded as complete from their merged repository history;
  their completion does not authorize any new maintenance item.
- No recommendation authorizes application/API, database/schema, infrastructure,
  production, IAM, secrets, variables, workflow, dependency, or deployment
  changes without a new bounded work order and explicit authorization.
