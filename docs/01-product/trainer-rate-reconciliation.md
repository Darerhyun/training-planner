# Training Planner — Trainer Rate Reconciliation

Status: Approved product requirements; documentation only; implementation pending  
Last updated: 9 September 2026

## 1. Purpose and boundary

This document defines PR3K's controlled, Admin-only workflow for canonical
course-to-rate-category mapping and trainer-rate workbook reconciliation. It
replaces one-off local scripts with a repeatable process that can handle new
trainers, name variations, eight independent rate categories, later workbook
revisions, effective dating, and complete audit history.

PR3K has two separately reviewable bounded sub-workstreams, in this order:

1. **Rate categories** — the authoritative canonical course-to-rate-category
   mapping foundation and Admin screen.
2. **Rate Reconciliation** — protected workbook upload, validation, identity and
   row resolution, preview, effective dating, and atomic apply.

This documentation changes no current production economics behavior and does
not authorize application code, schema or API work, a migration, mapping seed,
cutover, database write, provider change, deployment, or import of a real
workbook. Real trainer names, mappings, and fee values remain outside GitHub.

## 2. Ownership, authorization, and visibility

- The trainer-rate workbook is an **import source only**.
- After an atomic apply, the application is authoritative for accepted trainer
  identities, permanent aliases, category-specific profiles, effective-dated
  assignments, and reconciliation history.
- The course-to-rate-category mapping is separate Admin-controlled application
  data. Workbook text and reconciliation decisions never populate it.
- The TMS remains authoritative for regulated funding, SSG codes, claims, and
  other regulated data.
- A later workbook is a proposed change set; it never silently replaces accepted
  records.

Only an active **Admin** may view or change Rate categories or upload, resolve,
preview, discard, confirm, or apply a reconciliation batch. Administration uses
this exact subtab order: **User Access | Trainer Directory | Rate categories |
Rate Reconciliation**. Rate categories is third and Rate Reconciliation fourth.

- Finance retains its existing read-only economics visibility elsewhere, but
  receives no PR3K tab, route, or reconciliation action.
- Ops and Viewer receive no rate value through pages, APIs, logs, exports, or
  unrestricted metadata.
- Pending, rejected, inactive, and unauthenticated users have no access.
- Server-side authorization is mandatory on every route; browser visibility is
  not an authorization control.

## 3. Canonical course-to-rate-category mapping

Rate categories is PR3K sub-workstream 1 and must be complete before the
reconciliation sub-workstream can be implemented. It is a general Admin screen,
not a Video-only screen.

### 3.1 Authoritative mapping contract

- Each active canonical course is addressed by its exact `courses.code`.
- The authoritative model has exactly one row per mapped canonical course and
  allows at most one of the eight controlled categories on that row.
- A missing row is displayed as **Not mapped** and has an explicit per-course
  mapping action; the screen provides a **Not mapped** filter.
- **Ambiguous** is not a normal stored state. It can appear only when migration
  or preflight inspection finds legacy data assigning more than one category to
  the same course. The Admin must resolve that course explicitly; the system
  never guesses or auto-resolves it.
- Courses are listed from canonical application records, grouped by programme,
  with filters for **Not mapped** and **Ambiguous**.
- The mapping combobox contains all eight controlled category codes. Save and
  removal operate on one course at a time.

Every mapping or removal requires:

- a 1–500 character audit note;
- the current `expectedVersion` on the write;
- a typed HTTP 409 response when `expectedVersion` is stale; and
- one append-only event containing actor, time, previous category, new category,
  note, and resulting version.

The screen never reads or displays a fee value. It creates no trainer-course
eligibility, module exclusion, recommendation, or rate assignment; it does not
infer a mapping from programme names, course titles, workbook sections, or
trainer eligibility. No mapping seed or real mapping is part of this contract.

### 3.2 Economics gate

Every category uses the same per-course gate: a trainer's category assignment
may participate in a canonical course's economics only when that exact course is
explicitly mapped to that category.

- A mapped course may use the matching trainer rate.
- A **Not mapped** course cannot use a trainer rate.
- An **Ambiguous** course is blocked on its own until resolved; it does not block
  correctly mapped courses.
- A trainer-rate assignment is still valid and may be applied even when one or
  more courses are not configured to use it.

`Video` follows this general rule and is never merged into `IT-Special`. Each
applicable canonical course in the Video Editing and Video Marketing groupings
must be mapped independently. Video rows show an aggregate status —
**Configured (N of N)**, **Partially configured (n of N courses mapped)**,
**Not configured (0 of N)**, or **n of N mapped · k ambiguous** — plus an
expanded per-course list. The aggregate is explanatory only; gating remains per
course.

The mapping table is not used by current production economics until a separately
approved implementation and cutover. This documentation preserves all current
economics behavior.

## 4. Workbook contract

The parser uses an explicit, versioned template-v3 contract. It never infers a
category from arbitrary sheet position or formatting.

| Sheet or section | Trainer name | Rate values | Category | Special rule |
|---|---|---|---|---|
| IIO | Column A | Pax 3–20 columns | `IIO` | Independent category |
| DM | Column A | Pax 3–20 columns | `DM` | Include newly added valid rows |
| IT — Normal | Column A | Pax 3–20 columns | `IT-Normal` | Recognize explicit section header |
| IT — WSQ | Column A | Pax 3–20 columns | `IT-WSQ` | Recognize explicit section header |
| IT — Special | Column A | Pax 3–20 columns | `IT-Special` | Independent from Video |
| IT — WSQ Writing | Column A | Pax 3–20 columns | `WSQ-Writing` | Independent writing category |
| AI | Column A | Pax 3–20 columns after B | `AI` | Ignore column B completely for all decisions and calculations |
| Video | Column A | Pax 3–20 columns | `Video` | Independent category; never merge into `IT-Special` |
| Sheet1 | — | — | — | Ignore completely |

The controlled vocabulary is therefore `IIO`, `DM`, `IT-Normal`, `IT-WSQ`,
`IT-Special`, `WSQ-Writing`, `AI`, and `Video`.

AI column B is non-authoritative metadata at most. It never selects a category
or tier, changes a rate, forms part of a row or profile fingerprint, affects
deduplication, or influences any calculation. `Sheet1` is not parsed.

Target cells for pax 3 through 20 must be literal valid numeric values. Blank,
text, formula, negative, malformed, or over-precision values are blocking
validation errors. Unknown target sheets, sections, layouts, or renamed
categories require an explicit template update and are never guessed.

The server computes a cryptographic source hash. An already-applied hash is
idempotent and creates no duplicate batch or records.

## 5. Server-driven batch lifecycle

Exactly one reconciliation batch may be open system-wide. Any active Admin may
resume it or discard it. The current wizard step comes from server state, never
client memory.

Open states are:

1. `uploaded` — the server has created the batch and recorded basic metadata.
2. `parsed` — template structure and target values passed validation.
3. `needs_resolution` — at least one identity, row, date, mapping-status review,
   or conflict needs attention.
4. `ready` — every included row is deterministic and no blocker remains.

Terminal states are:

- `applied` — the complete transaction committed;
- `rejected` — pre-decision validation refused the workbook, including an
  unsupported template or blocking structural/numeric failure;
- `failed` — apply began and the complete transaction rolled back; and
- `discarded` — an active Admin ended an open batch before apply through the
  audited discard action.

Every terminal state is read-only, releases the one-open-batch lock immediately,
shows state, actor, time, reason, and non-sensitive counts, and offers **Start a
new batch**. It never exposes values.

### Cancel, reject, discard, and fail

- **Cancel** exists only while a signed upload is in flight and before an
  `uploaded` record exists. It aborts the transfer, removes any partial object,
  creates no batch or audit event, returns to Upload, and restores focus to
  **Choose workbook**.
- After the `uploaded` record exists, Cancel is absent. **Discard batch** is the
  only voluntary pre-apply exit. It is available at every open step to any
  active Admin, requires confirmation, accepts an optional note up to 500
  characters, writes one immutable audit event with actor, time, prior state,
  counts, and reason, removes protected parsed values, changes no authoritative
  trainer or rate data, marks `discarded`, and releases the lock.
- `rejected` records its non-sensitive reason, changes no authoritative data,
  releases the lock, and offers only **Start a new batch**; it never offers
  Discard because it is already terminal.
- `failed` means all authoritative writes rolled back. The failed batch cannot be
  retried or re-applied. The Admin must start a new batch and re-upload.

An already-applied source hash is handled before a new batch is created: the
server returns the existing applied batch reference and creates no duplicate
batch, audit event, profile, or assignment.

### Storage contract

Uploads use private storage and short-lived signed access. The original workbook
object and every temporary local workbook file are removed immediately after
parsing. The open batch retains only its source hash, template version,
non-sensitive parsed structure, and protected parsed values needed for the open
workflow. No open or terminal batch can reopen or download the workbook.

Terminal states never retain protected parsed values. This contract introduces
no new retention policy. Workbook contents and values never enter GitHub,
unrestricted parse-result JSON, or a general schedule-upload response.

## 6. Identity resolution and category-row exclusion

Normalize source names only for comparison: trim surrounding whitespace,
collapse repeated spaces, and compare case-insensitively. Preserve the original
source spelling and canonical display name for audit.

Identity is resolved exactly once per distinct normalized source name across the
whole batch, not once per workbook row. One identity card lists every category
row for that name. Its single decision applies to all included occurrences.

Resolution order is:

1. exact canonical trainer-name match;
2. exact permanent-alias match;
3. deterministic suggestions for Admin review;
4. explicit map to an existing active trainer, creating a permanent alias only
   when the spelling differs; or
5. explicit creation of one genuine new trainer.

Suggestions are never selected or applied automatically and show a reason, not a
similarity score. A normalized name with at least one included category row must
have one deterministic identity before readiness. The server rejects an attempt
to map the same normalized name to two trainers in one batch with typed HTTP 409
`conflicting_identity_resolution`.

Exclusion is a category-row decision. Every category row, including a row under
an automatically matched identity, provides **Exclude row** and **Restore**.
Exclusion requires a 1–500 character reason stored in audit. Excluding one row
does not affect the name's other rows. When every row for a name is excluded, no
identity decision, alias, trainer, profile, or assignment is created. Restoring
any row makes identity resolution required again.

Alias collisions, duplicate canonical names, two distinct source spellings
resolving to the same trainer and category, and conflicting duplicate profiles
are blockers. Nothing is silently skipped.

### Permanent aliases and new trainers

An approved new spelling may become a permanent alias in the same atomic apply.
Aliases remain unique and append-only history records their creation; they are
never silently reassigned.

A genuine new trainer:

- creates no user account, course eligibility, module exclusion, recommendation,
  or session assignment;
- does not infer skills from a rate category;
- enters the PR3J product state **Needs setup**; and
- remains unavailable to Trainer Picker and session assignment.

The apply result says **Needs eligibility setup in Trainer Directory** and offers
**Configure course eligibility** for each created trainer. The separate Trainer
Directory workflow must confirm active status, explicit course links, applicable
exclusions, and readiness before the trainer becomes available. Later rate
reconciliation never resets or expands approved eligibility.

## 7. Safe carry-forward and concurrency

Every saved identity decision and category-row exclusion is versioned. Every
preview contains `resolutionVersion` and a server fingerprint of the trainer,
alias, profile, and assignment state on which it was built. Apply submits both.
A stale write or preview returns typed HTTP 409; stale preview uses
`stale_reconciliation_preview` and requires regeneration.

Regeneration fully revalidates identities against live canonical trainers,
aliases, active status, and uniqueness. It preserves only still-valid decisions
and reopens invalid ones. Row exclusions are revalidated independently so an
identity decision can remain valid when only a row decision must reopen.

Carry-forward is never automatic:

- A new upload with the server-verified same hash as a `failed` batch may offer
  an unchecked **Carry forward decisions** option after re-upload. The original
  workbook is not reused.
- An Admin may opt into identity-decision carry-forward across a different source
  hash only after the server performs the same full live-record revalidation.
  Invalid or absent names reopen and no new identity is inferred.
- A category-row exclusion may carry across hashes only when the server verifies
  an exact match on normalized source name, category, and server-side row/profile
  fingerprint. Client-provided labels, row positions, or values cannot establish
  the match. Anything else reopens with the previous reason available only as
  non-authoritative draft text.

The new batch records the predecessor relationship without mutating the earlier
audit trail. A different hash never carries an exclusion merely because a name
or category looks similar.

## 8. Rate profiles and effective dates

A profile consists of one stable category code plus normalized decimal values for
pax 3 through 20. The server derives a deterministic fingerprint from exactly
those fields. AI column B and presentation labels are excluded.

- Exact category-and-values matches reuse a profile.
- Identical values in different categories remain separate profiles.
- A changed value creates a new profile version; historical values are not
  overwritten.
- Duplicate rows for one trainer, category, and effective period must resolve to
  the same profile or block apply.
- Absence from a later workbook never deletes a profile or ends an assignment.

Every assignment has an Admin-confirmed `effective_from`; `effective_to` may
close the previous period. The batch date is required, has no default, and uses
an Asia/Singapore calendar date. A row may have an exceptional override with a
required 1–200 character reason.

Periods for a trainer and category must not overlap. Closing a current period and
opening its replacement occurs in the same transaction. Backdating requires a
server-computed affected-session count and explicit acknowledgement; if impact
cannot be computed, backdating is blocked. Historical overlap is never adjusted
silently. Missing workbook rows never expire, delete, or deactivate an
assignment.

## 9. Six-step Admin workflow

Routes use an opaque batch identifier only. No step, name, row, date, category,
or value appears in the URL. A server-driven accessible stepper shows **Upload |
Validate | Resolve | Review | Effective dates | Confirm**.

1. **Upload** — `.xlsx` template-v3 file, private signed upload, no browser
   parsing, stated size limit, progress and pre-record Cancel.
2. **Validate** — report eight recognized sections, `Sheet1` ignored, row/name
   counts, or blocking sheet/cell/rule errors without echoing the bad value.
3. **Resolve** — one card per normalized source name; groups for automatic
   matches, decisions, fully excluded names, and conflicts; per-category-row
   exclusion with reason.
4. **Review** — separate identity outcomes, included trainer × category
   assignments, and excluded category rows. Summary filters are Identity
   decisions, New trainers, Changed, Unchanged, Excluded rows, and Conflicts.
   Expanded rows compare pax 3–20 values without percentages or derived totals.
5. **Effective dates** — required batch date, visible exceptions, overlap blocks,
   and backdating warning/acknowledgement.
6. **Confirm** — non-sensitive summary, required atomic-apply acknowledgement,
   zero blockers, then a locked non-optimistic apply action.

Values are visible by default only inside protected Admin preview responses. A
page-level **Hide values** toggle is optional convenience, not authorization.
The result page contains counts and follow-up actions but no values.

Every category-assignment row and the Confirm summary show an aggregate mapping
status: **Configured (N of N)**, **Partially configured (n of N)**,
**Not configured (0 of N)**, or **n of N mapped · k ambiguous**. Expansion
lists each applicable canonical course as mapped, not mapped, or ambiguous.
This treatment applies consistently to all eight categories so the absence of a
badge never implies that configuration was skipped.

## 10. Atomic apply, idempotency, and audit

Apply uses one transaction with stop-on-error behavior. Within it, the server:

1. reauthorizes the active Admin;
2. locks or version-checks the batch;
3. rechecks source hash, template version, resolution version, mapping state, and
   expected live records;
4. rejects an already-applied hash;
5. creates approved trainers and aliases;
6. reuses or creates category-specific profiles;
7. closes and creates effective-dated assignments;
8. writes append-only reconciliation and row audit records; and
9. verifies post-apply counts before commit.

Any apply-time validation, uniqueness, mapping-preflight, stale-preview, count,
or audit failure rolls back every authoritative change and moves the batch to
`failed`. Pre-decision structural or numeric validation follows the `rejected`
path in section 5.
Last-write-wins and partial apply are prohibited.

The immutable audit captures actor and authorization context, upload/apply times,
hash and template version, batch/resolution versions, accepted and excluded rows
with reasons, identity and alias outcomes, trainers created, categories,
profiles, assignment periods, previous/proposed identifiers, mapping status,
final counts, and terminal reason. Routine logs contain identifiers and counts,
never fee values or database connection details.

## 11. Privacy, accessibility, and recovery

Value-bearing responses are Admin-only and use `Cache-Control: no-store`.
Values never appear in URLs, query strings, page titles, live announcements,
notifications, audit/history views, result pages, general API payloads, print
output, or client error reports. Values remain only in current-step memory and
are cleared on step change, apply, sign-out, 403, and terminal transition.

The UI supports keyboard operation, 44 × 44 minimum targets, ordered headings,
step and disclosure semantics, fieldset identity choices, count-only live
regions, focus restoration, AA contrast, reduced motion, and 1440/390/320
viewports. Only the pax comparison grid may scroll horizontally on mobile.

Errors identify the relevant sheet/cell, identity, category, course, or period
without echoing a rate. Recovery is explicit: fix and start a new upload,
regenerate a stale preview, resolve an individual conflict, or re-upload after a
failed apply. There is no automatic retry.

All fixtures, tests, examples, screenshots, and artboards use only **Demo Admin**
and **Demo Trainer 1–18**, synthetic course references clearly marked as such,
and fabricated values. They must contain no real workbook, trainer name, fee,
mapping, or production-derived row.

## 12. Acceptance criteria

PR3K implementation requires separate approved work orders and is acceptable
only when all of the following hold:

- Rate categories and Rate Reconciliation are the third and fourth Admin subtabs
  and are server-side Admin-only.
- Rate categories is implemented first as the authoritative general mapping
  surface over exact canonical courses.
- Each mapped course has one authoritative row and at most one category;
  **Not mapped** has a filter and action; **Ambiguous** exists only for a
  migration/preflight conflict and is never auto-resolved.
- Every mapping/removal has a required 1–500 character note, `expectedVersion`,
  typed 409 stale handling, and one append-only event.
- All eight template-v3 categories are independent; `Sheet1` is ignored; AI
  column B has no effect; Video is never merged into IT-Special.
- Every category is gated per exact canonical course before economics can use its
  rate; unmapped and ambiguous courses cannot, while other courses remain
  unaffected.
- Current production economics behavior remains unchanged until a separately
  approved cutover; there is no mapping seed or real mapping in PR3K docs.
- One identity is resolved per normalized source name, while exclusions are saved
  per category row with a required 1–500 character reason, including automatic
  matches.
- Suggestions never auto-apply; conflicting identity resolution returns typed
  409; new trainers enter Needs setup with no inferred eligibility.
- Carry-forward is opt-in and fully revalidated; cross-hash exclusions require an
  exact normalized-name, category, and server-only row/profile-fingerprint match.
- Profiles deduplicate by category plus pax 3–20 values; assignments are
  effective-dated and non-overlapping; missing rows change nothing.
- One open batch exists system-wide; wizard step is server-derived; an upload
  never auto-applies.
- Cancel before batch creation, audited Discard after creation, and distinct
  `applied`, `rejected`, `failed`, and `discarded` terminals follow section 5.
- Temporary and stored workbook objects are removed after parse; no batch can
  reopen or download one; terminal states retain no protected parsed values.
- Stale previews and writes return typed 409, and apply is one atomic transaction
  with full rollback and append-only audit.
- Values remain protected and all repository examples are synthetic only.

The detailed UI/IX contract is in
`../03-design/admin-pr3k-rate-reconciliation/README.md`.
