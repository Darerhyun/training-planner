# Training Planner — Trainer Rate Reconciliation

Status: Approved product requirements; documentation only; implementation pending  
Last updated: 18 August 2026

## 1. Purpose

This document defines the controlled workflow for importing and reconciling trainer-rate workbooks. The feature replaces one-off local scripts with a repeatable, Admin-only process that can safely handle new trainers, name variations, new rate categories, and later workbook revisions.

This document does not authorize application code, schema changes, database writes, provider configuration, secret changes, workflow dispatch, deployment, or import of the current confidential workbook.

## 2. Ownership and authority

- The trainer-rate workbook is an **import source only**.
- The Training Planner database becomes authoritative for accepted trainer identities, permanent aliases, rate categories, deduplicated rate profiles, effective-dated assignments, and reconciliation history after an atomic apply.
- A later workbook is a proposed change set. It must not silently replace accepted records.
- The TMS remains the official record for regulated funding, SSG codes, claims, and other regulated data.
- Actual fee values remain sensitive and must never be committed to GitHub.

## 3. Authorization and visibility

Only an active **Admin** may upload, preview, resolve, confirm, or apply a trainer-rate reconciliation batch.

- Ops and Viewer must not receive fee values through pages, APIs, logs, exports, or unrestricted upload metadata.
- Finance may retain the existing read-only economics visibility defined elsewhere, but cannot upload, reconcile, or apply rate workbooks.
- Pending, rejected, inactive, or unauthenticated users have no access.
- The rate workflow must be a separate Admin section from User Access and Trainer Directory because it handles confidential values and transactional changes.
- Server-side authorization is mandatory on every endpoint. Hiding controls in the browser is not sufficient.

## 4. Workbook contract

The parser must use an explicit versioned template contract. It must never infer a category solely from arbitrary sheet position or formatting.

| Sheet/section | Trainer name | Rate values | Rate category | Special rule |
|---|---|---|---|---|
| IIO | Column A | Pax 3–20 columns | `IIO` | Normal category import |
| DM | Column A | Pax 3–20 columns | `DM` | Include newly added valid rows |
| IT — Normal | Column A | Pax 3–20 columns | `IT-Normal` | Section header must be recognized |
| IT — WSQ | Column A | Pax 3–20 columns | `IT-WSQ` | Section header must be recognized |
| IT — Special | Column A | Pax 3–20 columns | `IT-Special` | Section header must be recognized |
| IT — WSQ Writing | Column A | Pax 3–20 columns | `WSQ-Writing` | Separate category for the two writing-course trainers |
| AI | Column A | Pax 3–20 columns beginning after column B | `AI` | **Column B is ignored for every calculation and profile decision** |
| Sheet1 | — | — | — | Ignored completely |

For AI rows, column B may be retained as non-authoritative source metadata for audit/debugging only. It must not select a tier, change a rate, form part of a profile fingerprint, affect deduplication, or influence any calculation.

Target rate cells must contain literal numeric values for every supported pax count from 3 through 20. Blank, text, formula, negative, malformed, or over-precision values are blocking validation errors. Ignored sheets are not parsed. Unknown target sheets, sections, or column layouts require an explicit template update; they must not be guessed.

The uploaded file receives a cryptographic source hash. The same successfully applied hash is idempotent: a repeat upload must be reported as already applied rather than creating duplicate records.

## 5. Batch lifecycle

A reconciliation batch follows these states:

1. **Uploaded** — a private object exists and its hash and basic metadata are recorded.
2. **Parsed** — the workbook contract and all target rows pass structural and numeric validation.
3. **Needs resolution** — at least one trainer identity, category, effective date, or conflict requires an Admin decision.
4. **Ready** — all rows have deterministic identities, category mappings, rate profiles, and effective dates; there are zero unresolved blocking items.
5. **Applied** — the complete reviewed change set commits in one transaction.
6. **Rejected or failed** — the batch is not applied; the reason is recorded without exposing fee values.

An upload never applies automatically. A parsed batch may be discarded without changing trainer, alias, profile, assignment, user, or session data.

## 6. Trainer-name reconciliation

Normalize source names only for comparison: trim surrounding whitespace, collapse repeated spaces, and compare case-insensitively. The stored source value and canonical display name remain available for audit.

Resolution order:

1. exact canonical trainer-name match;
2. exact permanent alias match;
3. deterministic suggestions for Admin review;
4. explicit Admin choice to map to an existing trainer and create a permanent alias;
5. explicit Admin choice to create a genuine new trainer.

Fuzzy or similarity-based suggestions must never auto-apply. Ambiguous candidates, duplicate canonical names, alias collisions, and an alias that already points to another trainer are blocking conflicts.

Every valid source row must be resolved before apply. If a row is intentionally excluded, the Admin must mark it explicitly with a reason; an excluded row is visible in preview and audit and is never a silent skip.

### Permanent aliases

When an Admin maps a new workbook spelling to an existing trainer, the workflow may create a permanent alias in the same atomic apply. Future imports should resolve the exact normalized alias automatically. Alias creation must preserve uniqueness and history; aliases are not silently reassigned.

### New trainers

A genuinely new trainer can be created from the reconciliation workflow after explicit Admin confirmation. The preview must distinguish this from an alias decision and show the proposed canonical name.

Creating a trainer from a rate workbook:

- creates no user account;
- grants no application access;
- creates no trainer-to-course eligibility or module-exclusion record;
- does not assign the trainer to a session;
- does not infer skills from the rate category;
- places the trainer in the product state **Needs eligibility setup**.

**Needs eligibility setup** is a scheduling-safety state, not evidence that the trainer record or rate assignment failed. The implementation may store or derive the state, but its behavior is mandatory: the trainer is unavailable in Trainer Picker and cannot be assigned to a session until an Admin completes the eligibility handoff.

### Eligibility setup handoff

After an atomic rate apply creates a trainer, the result page must list the trainer under **Needs eligibility setup** and provide a direct **Configure course eligibility** action. The action opens that trainer in Admin > Trainer Directory.

The Admin must then:

1. review the canonical trainer identity and active status;
2. select each eligible course explicitly;
3. record any applicable module exclusions;
4. save the eligibility changes with the Trainer Directory audit/concurrency controls;
5. explicitly mark the trainer ready for scheduling.

A trainer becomes **Ready for scheduling** only when the trainer is active, at least one approved trainer-to-course link exists, and the eligibility setup has been explicitly completed. Until then, all session-assignment and suggestion flows must treat the trainer as ineligible.

Rate categories may help the Admin filter the course list, but they must not preselect, infer, or automatically create course links. A later rate reconciliation must not reset or expand previously approved eligibility. Mapping a source name to an existing trainer or permanent alias must also leave that trainer's activation and course eligibility unchanged.

Eligibility setup is a separate audited Admin action. Rate reconciliation audit identifies that follow-up is required; Trainer Directory audit records the courses, exclusions, actor, timestamp, and readiness transition.

## 7. Category mapping

The controlled category vocabulary for this template is:

- `IIO`
- `DM`
- `IT-Normal`
- `IT-WSQ`
- `IT-Special`
- `WSQ-Writing`
- `AI`

The parser maps recognized sheet sections to these stable codes. An unknown category, renamed section, or conflicting mapping blocks readiness until an Admin selects an approved category or the template contract is updated.

A rate category is not trainer-course eligibility. Course-to-category mapping is a separate business rule needed before session economics or recommendation logic can use a profile. No course relationship may be inferred merely because a trainer appears in a category section.

## 8. Rate-profile deduplication

A rate profile is defined by:

- one stable category code; and
- the normalized decimal values for pax 3 through 20.

The system computes a deterministic profile fingerprint from those fields. AI column B and other presentation labels are excluded.

- An exact category-and-values match reuses the existing profile.
- Identical values in different categories remain separate profiles.
- A changed value creates a new profile version; it must not overwrite historical values.
- Duplicate rows for the same trainer, category, and effective period must resolve to the same profile or block apply.
- Profiles are not deleted merely because they are absent from a later workbook.

The preview must report reused profiles, new profiles, duplicate source rows, and conflicting profiles without exposing values to unauthorized roles.

## 9. Effective dating

Every trainer-to-rate-profile assignment requires an Admin-confirmed `effective_from` date. An optional `effective_to` date may close a previous assignment.

For a trainer and category:

- effective periods must not overlap;
- a future assignment must not rewrite historical assignments;
- closing the current period and starting the replacement must happen in the same transaction;
- backdating that would change already-used session economics requires an explicit warning and confirmation;
- omission from a workbook never automatically ends, deletes, or deactivates an existing assignment.

The preview must show the current period, proposed period, and whether the change is new, unchanged, future-dated, or backdated.

## 10. Preview and resolution

Before confirmation, the Admin receives a protected preview containing:

- source filename, template version, file hash, upload time, and uploader;
- parsed and excluded row totals by sheet/section and category;
- exact canonical matches, alias matches, suggestions, permanent aliases to create, new trainers to create, and the resulting **Needs eligibility setup** count;
- reused, new, unchanged, and conflicting rate profiles;
- effective-date changes and overlap/backdating warnings;
- current versus proposed assignment counts;
- all blocking validation, identity, category, duplicate, and concurrency issues;
- a final apply summary.

The apply control stays disabled until the batch has zero unresolved blocking items. The confirmation screen must clearly state that all approved changes will commit together and that any failure rolls back the complete batch.

Sensitive values may appear only in the protected Admin preview and must be excluded from URLs, analytics, client error reporting, general API payloads, and server logs.

## 11. Atomic apply, idempotency, and concurrency

Apply must use one database transaction with stop-on-error behavior.

Within the transaction, the server must:

1. re-authorize the active Admin;
2. lock or version-check the batch;
3. re-check the source hash, template version, resolution version, and expected current records;
4. reject an already-applied hash;
5. create approved trainers and permanent aliases;
6. reuse or create deduplicated rate profiles;
7. close and create effective-dated assignments;
8. write the audit record and final counts;
9. verify expected post-apply counts before commit.

Any validation error, uniqueness conflict, stale preview, unexpected existing record, count mismatch, or audit failure rolls back every change. Last-write-wins behavior is prohibited. The Admin must reload and regenerate the preview after a concurrency failure.

A successfully created trainer remains **Needs eligibility setup** after the rate transaction. Course links and scheduling readiness are not added inside the rate transaction; they are completed through the separately audited Trainer Directory handoff.

Missing workbook rows never cause automatic deletion, deactivation, or expiry. There is no partial apply.

## 12. Audit requirements

The immutable audit record must capture:

- actor and authorization context;
- upload and apply timestamps;
- source hash and template version;
- batch and resolution version;
- accepted and excluded row counts with exclusion reasons;
- canonical matches and alias matches;
- aliases and trainers created;
- categories selected;
- profiles reused or created;
- assignment periods closed or created;
- previous and proposed state identifiers;
- final verification counts;
- rejection, rollback, or failure reason.

Routine logs must use identifiers and counts, not confidential rate values or database connection details.

## 13. Storage and privacy

- Uploads use private object storage and signed access with short expiry.
- Workbook contents and fee values are never committed to GitHub.
- Confidential values are not stored inside unrestricted parse-result JSON or returned by general schedule-upload endpoints.
- Temporary files are removed after parsing; object retention is governed by the approved private-upload policy.
- Implementation tests use fabricated fixtures only.
- No service-account key is introduced; provider authentication follows the repository's approved identity model.

## 14. Errors and recovery

The UI must provide clear, non-sensitive messages for unsupported templates, invalid cells, unmatched trainers, alias conflicts, unknown categories, overlapping effective periods, stale previews, duplicate applied hashes, authorization failures, and transaction rollbacks.

A failed or rejected batch changes no authoritative trainer or rate data. Recovery is to correct the source or resolutions, generate a new preview, and explicitly confirm again. There is no automatic retry of an apply operation.

## 15. Implementation boundaries

This specification is the documentation amendment for the future PR3K milestone. Follow-on implementation must use separately approved, reviewable work orders for any schema/backend foundation and Admin UI work. Migration, deployment, provider configuration, secret changes, database import, and application of the current fee workbook each require their own explicit checkpoint.

The first confidential workbook should ultimately pass through this same product workflow rather than a special manual SQL path.

## 16. Acceptance criteria

The implementation is acceptable only when:

- only active Admin users can upload, resolve, preview, and apply;
- Ops and Viewer cannot obtain fee values;
- supported categories include `AI` and `WSQ-Writing`;
- AI column B has no effect on calculations, fingerprints, deduplication, or assignments;
- exact canonical and permanent alias matches are deterministic;
- fuzzy suggestions never auto-apply;
- an Admin can permanently alias a source name or explicitly create a new trainer;
- new trainers receive no automatic course eligibility, user account, or session assignment;
- every trainer created by reconciliation enters **Needs eligibility setup** and is unavailable to Trainer Picker;
- the apply result provides an Admin handoff to Trainer Directory;
- a trainer becomes ready for scheduling only after explicit course selection, required exclusions, active status, and completion confirmation;
- rate profiles deduplicate by category plus pax 3–20 values;
- assignments are effective-dated and non-overlapping;
- missing rows do not remove existing data;
- the preview exposes all changes and has zero unresolved blockers before confirmation;
- duplicate source hashes are idempotent;
- stale previews are rejected;
- one atomic transaction applies trainers, aliases, profiles, assignments, and audit together;
- every error or count mismatch rolls back the complete batch;
- confidential values stay outside GitHub and routine logs.
