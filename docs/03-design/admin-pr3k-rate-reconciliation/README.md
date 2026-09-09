# PR3K Admin — Rate categories and Rate Reconciliation

Status: Approved text-only UI/IX and interaction contract; implementation pending

Revision: 4 with Sol architecture clarifications, 9 September 2026

Target baseline: `main` at `645ea70b816a82fae3482dd862d8602c92035106`

Source review documents:

- Claude revision 4 advice SHA-256:
  `9946075518a1760743dab9df5ac7c95ab9fa93016bd34284ef861cc6f8aadc57`
- Claude revision 4 change summary SHA-256:
  `802311a060ac4798f9848e8ee1eacb854cb4d2a5319f0992fb6e99d0ffd9d920`

This README is the single PR3K UI/IX reference. It incorporates Owen's product
decisions, Claude's UI/IX recommendations, and Sol's architecture gate. Where a
summary differs from this file, this file and
`../../01-product/trainer-rate-reconciliation.md` govern.

This documentation does not authorize application code, schema or API changes,
a migration, a course-category seed, an economics cutover, a confidential
workbook import, a merge, or a deployment. No real trainer identity, mapping, or
fee value belongs in the repository.

## 1. Scope and sequence

PR3K contains two independently reviewable sub-workstreams, delivered in order:

1. **Rate categories** — the Admin-only canonical course-to-rate-category
   mapping foundation and screen.
2. **Rate Reconciliation** — the Admin-only protected workbook workflow.

Rate categories must be implemented and accepted first. The mapping foundation
does not change current session economics until a separately approved mapping
dataset and cutover are reviewed, migrated, and deployed.

PR3K excludes trainer eligibility, session assignment, recommendations,
rankings, PR4 picker behavior, user-access changes, provider configuration,
production seed data, and application of the confidential workbook.

## 2. Administration navigation and authorization

Admin remains one primary navigation area headed **Administration**. Its section
tablist is ordered:

**User Access | Trainer Directory | Rate categories | Rate Reconciliation**

Rate categories is third and Rate Reconciliation fourth. Both tabs, every
`/admin/rate-categories/*` route, and every `/admin/rates/*` route require an
active Admin on the server. Finance retains its existing read-only economics
view elsewhere. Finance, Ops, Viewer, pending, rejected, inactive, and
unauthenticated users receive no PR3K tab, route, action, or protected value.

At mobile widths the section tablist scrolls horizontally as one keyboard-
operable tablist. It is not replaced by a new navigation pattern in PR3K.

## 3. Rate categories screen

### 3.1 List and filters

The screen lists active canonical course records grouped by canonical programme.
It reads the exact course code and title from the server and never derives a
category from the title, programme, eligibility, or workbook text.

The list provides:

- search by canonical course code or title;
- programme filter;
- category filter over all eight controlled codes;
- **Not mapped** filter; and
- **Ambiguous** preflight-conflict filter.

Desktop columns are **Course | Programme | Rate category | Version | Last
changed | Action**. The table fits inside the 1180 px content width without
document-level horizontal scrolling. Mobile renders the same information as
cards; code and title wrap and no action is removed.

Loading uses table/card skeletons that preserve layout. Empty search and filter
states retain the controls and explain how to clear the filter. A load failure
shows a retry action. A 403 replaces the page with the standard Admin-access
message and clears cached data. A 404 course refresh removes the stale row and
announces that the course is no longer available.

### 3.2 Authoritative mapping

The authoritative model has one row for each mapped canonical course and at
most one category on that row. A missing row is **Not mapped**. The category
control offers:

- `IIO`
- `DM`
- `IT-Normal`
- `IT-WSQ`
- `IT-Special`
- `WSQ-Writing`
- `AI`
- `Video`
- **Not mapped**

`Video` is independent and is never folded into `IT-Special`. It covers the
business groupings Video Editing and Video Marketing, but each exact canonical
course still requires its own explicit mapping.

**Ambiguous** is not a persisted value in the one-row-per-course mapping table.
It is a migration or preflight conflict showing that legacy inputs propose more
than one category for the course. It blocks only that course and must be
resolved explicitly; the system never selects a winner.

### 3.3 Edit interaction

Selecting **Change category** opens a dialog no wider than 520 px. It displays
the canonical course code and title, current category, proposed category,
current version, and the consequence that the mapping controls future session
economics only after the separately approved cutover.

Every mapping, change, or removal requires a 1–500 character audit note with a
live character count. Save remains disabled until a category choice and valid
note exist. The request contains the current `expectedVersion`; there is no
optimistic UI.

Success updates the row/card, version, status and history together, announces a
non-sensitive success message, and returns focus to **Change category**. A typed
409 stale response writes nothing, keeps the dialog state, shows **Reload
course**, and focuses it. Reload success commits the refreshed row before
focusing its heading; reload failure retains the stale warning and returns focus
to **Reload course**. Cancel or Escape closes the dialog and returns focus to its
opener.

One append-only event records actor, timestamp, previous category, new category
or Not mapped, note, expected version, and resulting version. Earlier events are
never changed or deleted. The screen never reads or displays a rate value and
creates no trainer eligibility, exclusion, rate assignment, or recommendation.

## 4. Per-course economics configuration

The mapping gate applies equally to all eight categories. A trainer's category
assignment can participate in a session's economics only when the session's
exact canonical course is explicitly mapped to that category.

- A mapped course may use the matching rate assignment.
- A Not mapped course cannot use a trainer rate.
- An ambiguous course is blocked on its own.
- Other correctly mapped courses remain unaffected.
- Applying a trainer-category assignment does not itself create a course
  mapping.

Every category-assignment row in Reconciliation Step 4 and every category line
in Step 6 shows an aggregate status: **Configured (N of N)**, **Partially
configured (n of N)**, **Not configured (0 of N)**, or **n of N mapped · k
ambiguous**. Expanding the row lists each applicable canonical course and its
individual state. The badge is explanatory; enforcement is always per course.

## 5. Rate Reconciliation wizard

The route uses an opaque batch ID only. Step, trainer, category, row, date, and
value never appear in the URL. A server-derived stepper shows:

1. **Upload**
2. **Validate**
3. **Resolve**
4. **Review**
5. **Effective dates**
6. **Confirm**

Exactly one batch may be open system-wide. Any active Admin can resume or
discard it. A second Admin sees the opener and age but never a protected value.
Completed steps are links; future steps are inert; focus moves to the step
heading after navigation.

### 5.1 Upload and validation

The browser uploads `.xlsx` through private signed access and never parses the
workbook. The UI states template v3 and the size limit.

Upload **Cancel** exists only before the server creates an `uploaded` batch. It
aborts transfer, removes a partial object, creates no batch or audit event, and
returns focus to **Choose workbook**. After a batch exists, Cancel is absent and
only the audited **Discard batch** flow can end it voluntarily.

Template v3 recognizes eight independent sections: `IIO`, `DM`, `IT-Normal`,
`IT-WSQ`, `IT-Special`, `WSQ-Writing`, `AI`, and `Video`. `Sheet1` is ignored.
AI column B cannot affect rates, categories, fingerprints, deduplication, or
assignments.

A validation error identifies sheet, cell, and rule without echoing the cell's
contents. Unsupported templates and blocking structural or numeric validation
move the batch to terminal `rejected`, release the open-batch lock, and offer
only **Start a new batch**. An already-applied source hash returns the existing
applied batch reference and creates no new batch.

The original workbook object and temporary parsing files are removed after
parse. An open batch retains only its hash, template version, non-sensitive
structure, and protected parsed values needed for the workflow. No batch can
reopen or download the workbook; terminal states retain no parsed values.

### 5.2 Resolve identities and exclude rows

The unit of identity work is one card per distinct normalized source name across
the batch. Normalization trims outer whitespace, collapses repeated spaces, and
compares case-insensitively while preserving the source spelling for audit.

Groups are **Matched automatically**, **Needs a decision**, **Fully excluded**,
and **Conflicts**. Each card lists every category occurrence and row count. One
identity decision applies to all included rows for that name:

- map to one existing active trainer, creating a permanent alias only when the
  spelling differs; or
- create one trainer in **Needs setup**.

Neither option is preselected. Deterministic suggestions show a reason and never
a score; they never auto-apply. Mapping one normalized source name to two
trainers returns typed 409 `conflicting_identity_resolution`.

Every category row, including automatically matched rows, has **Exclude row**
and **Restore**. Exclusion requires a 1–500 character reason. Excluding one row
does not alter the name's other rows. If every row is excluded, no identity,
alias, trainer, profile, or assignment is created.

A new trainer receives no account, eligibility link, exclusion, readiness,
session assignment, or recommendation. The apply result lists it as **Needs
setup** with **Configure course eligibility** linking to Trainer Directory.

### 5.3 Review and effective dates

Review separates identity outcomes, included trainer-category assignments, and
excluded rows. Six filter tiles are **Identity decisions | New trainers |
Changed | Unchanged | Excluded rows | Conflicts**. Rows are grouped by trainer;
unchanged rows remain collapsed.

Expanded assignment rows show Current and Proposed values across pax 3–20.
Values are visible by default only to Admin; **Hide values** is an optional
page-level toggle. Diff markers include text and do not rely on colour. The UI
shows no percentages, ratios, totals, recommendations, rankings, or derived
economics.

The batch effective date is required and initially empty. Per-row overrides are
labelled **Exception** and require a 1–200 character reason. Backdating shows a
server-computed upcoming/historical-session impact and requires acknowledgement;
if impact cannot be computed, confirmation is blocked. Period overlaps block
the affected row and are never silently adjusted. Missing workbook rows change
nothing.

### 5.4 Confirm and apply

Confirm lists identities, new trainers, aliases, profiles reused/created,
assignments closed/opened, exclusions, mapping states, exceptions, effective
dates, template version, hash prefix, uploader, and time. It contains no rate
values. A required acknowledgement states that all changes apply together or
none apply. Apply is disabled until the server reports zero blockers and there
is no optimistic UI.

Apply uses one transaction with authorization, version and fingerprint checks,
deduplication, effective-period checks, immutable audit, and expected-count
verification. Any apply-time failure rolls back every authoritative change and
moves the batch to terminal `failed`.

## 6. Terminal states, stale recovery, and carry-forward

`applied`, `rejected`, `failed`, and `discarded` are distinct read-only terminal
states and release the one-open-batch lock immediately.

- **Discarded** requires confirmation, displays the identity/exclusion counts
  that will be lost, accepts an optional reason up to 500 characters, writes one
  immutable audit event, deletes parsed protected values, and changes no trainer
  or rate data.
- **Rejected** records its validation reason and offers only **Start a new
  batch**.
- **Failed** records the rollback reason, cannot be retried, and requires a new
  upload.
- **Applied** shows non-sensitive counts and follow-up actions only.

Every saved identity decision and row exclusion is versioned. A stale preview
returns typed 409 `stale_reconciliation_preview`; **Regenerate preview** fully
revalidates live trainer, alias, mapping, profile, assignment, and exclusion
state before preserving anything.

Carry-forward from a failed predecessor is always opt-in and off by default:

- a still-valid identity decision may carry across the same or a corrected
  workbook hash by normalized source name after complete server revalidation;
- an exclusion may carry only when the server verifies the same normalized
  source name, category, and server-side row/profile fingerprint;
- row positions, client labels, and client-provided values never establish the
  match; and
- invalid, missing, changed, or ambiguous items reopen without modifying the
  predecessor's immutable audit.

The new batch records its predecessor. A previous exclusion reason may be shown
only as non-authoritative draft text when the exclusion cannot carry.

## 7. Confidentiality

Value-bearing responses require active Admin and set `Cache-Control: no-store`.
Protected values stay in current-step memory and are cleared on step change,
apply, sign-out, 403, and terminal transition. They never appear in:

- URLs, query strings, or page titles;
- status or alert announcements;
- notifications or analytics;
- general upload, Trainer Directory, list, result, or audit APIs;
- routine logs or client error reports;
- audit and Trainer Directory History views; or
- print output.

The print stylesheet masks value cells. Error messages identify a sheet, cell,
identity, category, course, or period without echoing the confidential value.

## 8. Responsive measurements and accessibility

At 1440 px the centered content width is 1180 px. Tables and wrappers satisfy
`scrollWidth === clientWidth`; only the expanded pax grid may scroll inside its
own container. Desktop dialogs are at most 520 px.

At 390 px use 12 px page gutters and 366 px panels/dialogs. At 320 px use 8 px
gutters and 304 px panels/dialogs. The document width always equals the viewport.
All controls have a minimum 44 × 44 target. Long names and canonical titles wrap;
nothing is hidden merely to make 320 px fit.

The six-step indicator collapses to **Step n of 6 · [name]** with its full list
behind a disclosure. Identity cards and course mapping rows become full-width
cards. Only the pax grid scrolls horizontally, with sticky Current/Proposed and
pax headers. Confirm uses a sticky bottom action bar with its acknowledgement
immediately above.

Semantic requirements:

- ordered `h1`–`h4` headings;
- `nav` and `aria-current="step"` for the wizard;
- tablist semantics for Administration sections;
- fieldset/legend identity choices;
- the established accessible combobox pattern;
- disclosure buttons with `aria-expanded`;
- count-only status regions and non-sensitive alerts;
- text carriers for every status and diff;
- trapped modal focus, Escape cancellation, and focus return to the opener;
- successful reload focuses committed refreshed content; failed reload focuses
  its retry action; and
- AA contrast and `prefers-reduced-motion` support.

## 9. Synthetic fixtures

Designs, tests, screenshots, and artboards use only **Demo Admin** and **Demo
Trainer 1–18**. Prices are fabricated and never copied from a real workbook.
Synthetic course references must be labelled design-only; implementation uses
only seeded canonical course records.

The fixture arithmetic must reconcile exactly:

- 73 distinct source names = 58 automatic + 13 identity decisions + 2 fully
  excluded;
- 101 category rows = 95 assignments + 6 exclusions; and
- 95 assignments = 31 changed + 50 unchanged + 14 new.

At least one identity fixture spans three categories and excludes only one row,
proving that one identity decision drives the remaining included assignments.
At least one mapping fixture is partially configured, proving that mapped
courses may use the matching rate while unmapped or ambiguous courses cannot.

## 10. Review criteria

Sol High and Claude review the same exact implementation head. The relevant
sub-workstream must demonstrate:

1. exact Administration tab order and server-side Admin authorization;
2. a general eight-category mapping screen implemented before reconciliation;
3. canonical course records only, one authoritative mapping per course, and no
   runtime inference;
4. Not mapped change/removal, Ambiguous preflight resolution, required note,
   expected-version 409, and immutable event behavior;
5. no rate value on the mapping screen and no eligibility, exclusion,
   recommendation, seed, or economics cutover;
6. configuration status on every category assignment and per-course enforcement;
7. eight template-v3 sections, `Sheet1` ignored, AI column B inert, and Video
   independent from IT-Special;
8. one identity decision per normalized source name and independently auditable
   category-row exclusions;
9. protected current/proposed comparison, values visible by default, and working
   Hide values control;
10. required effective date, explicit exceptions, overlap protection, and
    acknowledged server-computed backdating impact;
11. one open server-driven batch, no automatic apply, and atomic rollback;
12. distinct rejected, failed, discarded, and applied terminal behavior;
13. pre-record Cancel versus post-record audited Discard;
14. workbook deletion after parse and no batch reopen/download;
15. opt-in cross-hash identity carry-forward and strict exclusion matching;
16. confidentiality across routes, APIs, memory, logs, audit, errors, print, and
    fixtures;
17. loading, error, empty, stale, 401, 403, and 404 recovery states; and
18. 1440/390/320 measurements, keyboard operation, focus behavior, and synthetic
    fixture arithmetic.

Any deviation in authorization, category vocabulary, mapping authority,
economics gating, confidentiality, concurrency, audit, atomicity, storage, or
scope returns to Sol before implementation continues.
