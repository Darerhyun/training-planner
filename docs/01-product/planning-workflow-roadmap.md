# Training Planner — Planning and Sessions Roadmap

Status: Approved product direction; PR3J is complete and deployed; the Sync repair contract is approved; PR3K implementation is paused behind Sync repair
Last updated: 9 September 2026

Repository `main` source baseline: `d786d19452f069e26569bb35115cea341acb21fa`
(verified read-only for this documentation change). Deployed application
baseline: `645ea70b816a82fae3482dd862d8602c92035106` (last-verified evidence;
not independently reverified in this change). These baselines are distinct.

## 1. Purpose

This document defines the distinction between future course planning, individual
class sessions, trainer assignment, Excel ingestion, trainer-rate reconciliation,
and the Admin Area.

It extends the existing roadmap. It does not replace or renumber completed PR1,
PR2, or PR3 work.

## 1a. Planning rulebook versus audit backlog

The numbered rules in `docs/02-domain/planning-rules.md` are the product
planning rulebook: its R1–R12 IDs describe scheduling constraints and planning
heuristics. The R1–R15 IDs in
[`maintenance-backlog.md`](maintenance-backlog.md) are a separate set of audit
recommendations about repository maintenance. Identical numbers across those
two documents do not refer to the same work, and no audit recommendation changes
the planning rulebook unless a future product decision explicitly says so.

## 2. Source-of-truth decision

- Excel is an **import source only**. It supplies historical and existing schedule
  data that cannot yet be obtained from another source.
- The Training Planner website is the authoritative source for **internal planning
  changes made after import**, including trainer assignments.
- A trainer-rate workbook is also an **import source only**. After an approved atomic
  apply, the application is authoritative for trainer identities, permanent aliases,
  rate categories, deduplicated profiles, effective-dated assignments, and audit
  history.
- Canonical course-to-rate-category mapping is a separate Admin-controlled
  authority. It is keyed by the exact canonical course code, has at most one
  category per course, and is required before any course economics can use a
  trainer rate. No workbook text or reconciliation decision populates it.
- A later schedule or rate workbook is a proposed change set and must never silently
  replace application-managed records.
- The website does not need to write changes back to an Excel workbook or generate
  an updated master workbook.
- The TMS remains the official record for funding, SSG codes, claims, and other
  regulated data.
- A later Excel upload must never silently overwrite a session already managed in
  the website. The Sync preview must identify the conflict and require an explicit
  resolution.
- The staged Sync/reference-data repair contract is the prerequisite for further
  operational schedule imports. Every future batch stops at Preview, requires
  server acknowledgement of that exact preview, blocks unsafe interpretations,
  and uses Re-check after any relevant change. Existing-session repair is a
  separate explicit workflow; no alias or reference-data change silently rewrites
  historical sessions.

Data direction:

```text
Excel import -> Training Planner -> Internal course planning and session management
```

There is no automatic Training Planner -> Excel workflow.

## 3. Product terminology

### Course Planning

Course Planning answers: **What courses should we run in future months?**

It works at course × venue × month level and includes:

- programme and course;
- planning month;
- venue;
- proposed number of runs;
- historical confirmation rate and cadence;
- strong and weak months;
- planning notes and plan status.

It does not assign trainers. It does not claim that a session span represents
individual training days.

### Sessions

Sessions answers: **What are the actual classes, and who will teach them?**

A session is one individual class delivery and includes:

- course;
- session span and, when available in a future data model, authoritative training
  dates;
- trainer;
- venue and room;
- pax;
- status;
- import/application ownership and change history.

Trainer assignment and trainer replacement happen in Sessions. A class created
from Course Planning appears in Sessions as a draft.

### Sync

Sync imports an Excel schedule, previews changes, and reconciles incoming rows with
sessions already in the website.

Sync must distinguish:

- new imported sessions;
- unchanged imported sessions;
- safe updates to sessions not yet managed in the website;
- conflicts where an upload differs from a website-managed session.

Conflicting uploads must not silently overwrite website-managed values. The
approved staged repair contract in
[`sync-reference-repair.md`](sync-reference-repair.md) additionally requires:

- no auto-apply, regardless of batch size;
- exact-preview acknowledgement and server-side freshness validation;
- blocking non-empty unmatched, ambiguous or malformed values;
- separate visible warnings for blank operational fields and the pending `Hotel`
  delivery category;
- per-batch skip reasons with cancellation correspondence protection;
- accessible presentation of every issue and exact mutually exclusive row counts;
- Admin-managed sibling course, trainer, venue and venue-scoped room aliases;
- a separate, audited, versioned and all-or-nothing existing-session repair flow;
  and
- preservation of the greater-than-50% explicit-cancellation hard block. Any
  cancellation override remains proposed and not approved.

Production schedule Sync should not be used operationally until the preventive
repair is implemented, reviewed, accepted and deployed.

## 4. Navigation and information architecture

Target primary navigation:

1. **Course Planning** — future-month planning.
2. **Sessions** — individual classes, trainers, venues, pax, and status.
3. **Sync** — Excel import and reconciliation.
4. **Admin** — Admin-only User Access, Trainer Directory, and confidential Trainer
   Rate Reconciliation management.

The existing rich Planning dashboard should become the enhanced Sessions
experience. The old basic Sessions page must remain until the enhanced replacement
has functional parity and acceptance tests. It may then be removed in a separate,
reviewable change.

## 5. Roles

| Role | Course plans | Sessions | Trainer assignment | Sync | Admin Area |
|---|---|---|---|---|---|
| Admin | Create/edit/approve | Create/edit | Assign/change/unassign | Full | Full |
| Ops | Create/edit/approve | Create/edit | Assign/change/unassign | Full | No access |
| Finance | Read-only | Read-only | Read-only | No write access | No access |
| Viewer | Read-only | Read-only | Read-only | No write access | No access |
| Pending/Rejected | No access | No access | No access | No access | No access |

No trainer fee values may be returned to Viewer or Ops. Trainer fee values remain
outside GitHub. Uploading, resolving, previewing, and applying a trainer-rate
workbook are Admin-only operations; Finance retains read-only economics visibility
but cannot run reconciliation.

## 6. Admin Area

Approved Admin Area option 3 uses one Admin navigation area with four separate
sections and implementation PRs. The section tablist order is **User Access |
Trainer Directory | Rate categories | Rate Reconciliation**: Rate categories
is the third subtab and Rate Reconciliation is the fourth. Only active Admin
users may access or modify any section. Confidential rate values are available
only inside the protected Trainer Rate Reconciliation workflow.

### User Access

- Invite a colleague by email and choose the intended application role.
- Approve or reject pending accounts.
- Change an active user's role.
- Deactivate or reactivate application access.
- The colleague signs in through Firebase magic link; an Admin never creates or
  knows the colleague's password.

### Trainer Directory

- Register and edit trainer records.
- Activate or deactivate trainers without deleting their historical assignments.
- Manage trainer-to-course links and module exclusions.
- Complete **Needs eligibility setup** handoffs for trainers created by rate
  reconciliation; require active status, at least one explicitly approved course
  link, applicable exclusions, and Admin confirmation before scheduling readiness.
- Keep trainer fee values outside these workflows and outside GitHub.

### Trainer Rate Reconciliation

- Allow active Admin users only to upload a protected trainer-rate workbook.
- Reconcile exact names, permanent aliases, and explicitly confirmed new trainers.
- Put each newly created trainer into **Needs eligibility setup**, keep them unavailable
  to Trainer Picker, and provide a direct handoff to their Trainer Directory record.
- Map all eight controlled categories (`IIO`, `DM`, `IT-Normal`, `IT-WSQ`, `IT-Special`, `WSQ-Writing`, `AI`, `Video`); `Sheet1` is ignored and AI
  column B is ignored for calculations, profile fingerprints, deduplication, and
  assignments. Video is never merged into IT-Special.
- Run only after the first PR3K sub-workstream, the Admin-only **Rate categories**
  screen, establishes explicit canonical course mappings. A mapped course may
  use the relevant rate; an unmapped course cannot. An ambiguous mapping is a
  preflight conflict for that course only. Reconciliation always applies the
  rate assignment itself and never seeds or infers a mapping. Every category
  row displays the same configuration status so a missing badge cannot be read
  as implicit approval.
- Resolve one identity per normalized source name across the batch, while
  excluding category rows individually with a required reason. Opt-in
  cross-hash carry-forward is allowed only after full server revalidation and
  only when normalized name, category, and server-only row/profile fingerprints
  match.
- Keep temporary workbook files only through parsing; remove them afterward.
  No batch may reopen or download the workbook. `rejected`, `failed`, `discarded`, `applied` are distinct terminal states with lock release;
  upload Cancel is pre-record only, while audited Discard is post-record.

### Rate categories

- Provide the first bounded PR3K sub-workstream: an Admin-only course mapping
  screen over exact canonical active courses grouped by programme.
- Maintain an authoritative one-row-per-course table with at most one category.
  Display **Not mapped** and provide a filter plus an explicit mapping action.
  Display **Ambiguous** only for a legacy/preflight conflict; never auto-resolve
  it.
- Save one course at a time through the combobox of all eight category codes.
  Every mapping or removal requires a 1–500 character audit note and the current
  `expectedVersion`; stale writes return typed 409 and history is append-only
  with actor, time, previous category, and new category.
- Never show a rate or create trainer eligibility, exclusions, recommendations,
  or seed data. The screen is the only mapping authority used by reconciliation.

The detailed reconciliation contract is in `trainer-rate-reconciliation.md`. The UI/IX
contract is in `docs/03-design/admin-pr3k-rate-reconciliation/README.md`. User Access,
Trainer Directory, Rate categories, and Rate Reconciliation remain separate
implementation PRs so authentication risk, trainer-reference-data changes,
mapping authority, confidential economics, and rollback are independently
reviewable.

## 7. Session amendment workflow

For an Admin or Ops user:

1. Open a session.
2. Select **Assign trainer**, **Change trainer**, or **Unassign trainer**.
3. Review the current and proposed assignment.
4. Save with optimistic concurrency protection.
5. Record the actor, timestamp, previous trainer, new trainer, and an optional note
   in session history.
6. Mark the session as managed by the application so later Excel imports cannot
   silently overwrite it.

If another user changed the session after it was opened, reject the stale save and
ask the user to reload. Do not use last-write-wins behaviour.

Accurate trainer date-conflict detection remains deferred until authoritative
individual training dates exist. Session start/end spans must not be expanded into
assumed consecutive training days.

## 8. UI/UX direction

The interface should use plain operational language and progressive disclosure.
Avoid solver terminology, dense configuration screens, and drag-and-drop in the
first editable release.

### ASK visual foundation

- Use a light operational workspace with white surfaces, dark text near `#212529`,
  neutral canvas and borders, and ASK red `#E02B20` for brand identity and primary
  actions.
- Use a darker red for hover and focus treatment. Keep success, warning,
  informational, and destructive states semantically distinct from brand red.
- Reuse the existing system-font stack, React components, and Lucide icons. Do not
  add external fonts, image/logo assets, component frameworks, or runtime requests
  solely for presentation.
- Apply consistent visual tokens, metric hierarchy, programme/status/issue pills,
  segmented date controls, filter grouping, readable sticky table headers,
  selected-row treatment, polished detail panels, and clear Sync/conflict states.
- Keep ordinary supporting text at least 12px, use visible 1px boundaries where
  needed, preserve keyboard focus, and remain usable from 320px through desktop.
- Keep the legacy Sessions view present and functional until the existing manual
  parity acceptance is complete; present it as a secondary parity reference.

### Course Planning page

- Month selector as the primary control.
- Programme, course, venue, and history filters.
- Summary cards: planned runs, historical target, unscheduled runs, and low-history
  courses.
- Course rows grouped by programme, showing target cadence, planned count,
  confirmation history, and seasonality.
- A clear **Add planned run** or **Schedule class** action.
- Neutral explanations for no-history and low-historical-confirmation courses.

### Sessions page

- Upcoming sessions by default, with explicit filters for past and cancelled.
- Dense table for dates, course, trainer, venue/room, pax, status, and issues.
- Selecting a row opens a detail drawer.
- Admin/Ops see a single clear trainer action. Finance/Viewer see the same detail
  without edit controls.
- Before save, show a compact current -> proposed change preview.
- After save, show success in context and add the entry to session history.
- Provide clear empty, loading, validation, authorization, stale-edit, and import-
  conflict states.

### Accessibility and responsive behaviour

- Do not rely on colour alone for statuses or warnings.
- All controls need visible labels, keyboard access, and focus states.
- Desktop uses the table plus side drawer.
- Mobile uses a reduced table/list and a full-screen detail panel.
- Destructive actions such as cancellation require explicit confirmation.

## 9. Design references

This workflow adapts established academic scheduling patterns without copying their
complexity:

- Cal Poly describes a scheduling flow covering input, editing, validation,
  approval, and updating course offerings:
  https://registrar.calpoly.edu/academic-scheduling
- UniTime separates assigned and unassigned work, detail views, changes/history,
  and committed assignments:
  https://help.unitime.org/university-timetabling-application
  https://help.unitime.org/manuals/instructor-scheduling

The Training Planner should retain these useful separations while presenting a
simpler workflow for non-technical Operations users.

The external Lovable project export is an approved **presentation reference only**
for PR3G-V and later page styling. Feasible references include its application
shell, cards, hierarchy, pills, segmented controls, tables, drawers, responsive
patterns, and feedback states. Its old business logic and architecture are not
authoritative. Do not import its Supabase integration, direct database access,
TanStack routing/query logic, Tailwind/Radix component stack, realtime features,
AI functions, migrations, environment files, or future-feature routes.

## 10. Incremental PR plan

Historical PRs remain unchanged. Continue with PR3 sub-parts so the existing PR4
Trainer Picker milestone keeps its original identity.

The PR3G-V white/red foundation and approved V4 Sessions revision were followed
by completed PR3H, PR3I and PR3J implementations. All retain their historical
identities; the PR3G-V revision and PR3J are included in the last-verified
deployed application baseline `645ea70b816a82fae3482dd862d8602c92035106`.
Repository `main` is `d786d19452f069e26569bb35115cea341acb21fa`. These distinct
baselines do not renumber or reopen historical PRs.

The next bounded sequence is: this Sync repair contract → SYNC-SAFE-1 →
REFERENCE-DATA-1 → SYNC-RESOLUTION-1 → read-only production inventory →
SESSION-REPAIR-1 → separately approved cleanup, followed by resumed PR3K work.
The inventory must reverify venue/room categories and overlap and investigate the
six FT-/NFT- source-row semantics before any permanent-ignore proposal; it is
read-only and authorizes no cleanup or writes. None of those implementation,
inventory, cleanup or PR3K steps is started by this documentation change.

### PR3E — Product and data-ownership contract (completed)

- Commit this roadmap and update the documentation index.
- Amend AGENTS.md only where needed to state that Excel is import-only and the app
  is authoritative for internal planning after import.
- Preserve the statement that TMS is the official regulated record.
- No runtime, schema, database, or deployment changes.

### PR3F — Session write safety and audit foundation (completed)

- Added application-managed/import-managed session ownership.
- Added optimistic concurrency/versioning.
- Added session change history with actor and timestamp.
- Added an Admin/Ops-only trainer assignment endpoint.
- Kept Finance/Viewer read-only.
- Changed Sync so incoming Excel differences cannot silently overwrite an
  application-managed session; conflicts are explicitly reported.
- Delivered backend and focused tests without a UI redesign.

### PR3G — Sessions UX and navigation consolidation (completed; merged and deployed)

- Turned the rich Planning dashboard into the enhanced Sessions page.
- Added read-only detail/history for all active roles and trainer amendment for
  Admin/Ops.
- Added upcoming, past, and custom date modes, stale-edit handling, and protected
  import-conflict presentation.
- Retained the old basic Sessions implementation because full local/mocked role,
  mobile, stale-edit, and conflict parity acceptance remains outstanding.
- Merged at `2d061c990d4fd5bdb1aba062881cffb174870fd0`. Any Cloud Run revision or
  Firebase Hosting release associated with that historical milestone is
  last-verified evidence only; the current deployed application baseline recorded
  above is the distinct `645ea70b816a82fae3482dd862d8602c92035106`.
- Trainer recommendations remain deferred to PR4.

### PR3G-V — ASK UX Visual Foundation (completed; merged and deployed)

- The white/red presentation tokens and branded shell merged at
  `ae9ef2018aeb2ea2086a98b3621876c242de721d` before PR3H.
- The approved V4 Sessions frontend-only visual/interaction revision is
  completed, merged, and included in deployed baseline
  `645ea70b816a82fae3482dd862d8602c92035106`.
- The historical PR identity and immutable V4 design inputs archived under
  `docs/03-design/` were retained; the work was not reopened or renumbered.
- The completed V4 revision preserved current Sessions, Sync, Legacy Sessions,
  role, history, trainer amendment, stale-write, conflict, pagination, and
  date-window behavior; its implementation made no API, auth, backend, database,
  infrastructure, provider, dependency, or deployment change.
- The V4 revision followed revised R12's structural-only extraction. Its
  design-input documentation recorded the approval and assets only; it did not
  implement runtime changes.

### PR3H — Future Course Planning (completed; merged)

- Add a month-based course planning model and page.
- Use the committed planning profiles and monthly profiles as read-only evidence.
- Allow Admin/Ops to create and approve proposed course runs.
- Allow an approved planned run to create a draft Session through an explicit user
  action.
- Do not automatically assign a trainer or generate dates.
- Do not introduce AI recommendations.
- Merged at `2c6a59895df2000a30e21f2c0056abb81363cccc`.

### PR3I — Admin Panel: User Access (completed; merged)

- Add an Admin-only User Access section.
- Invite colleagues by email with an intended role.
- Approve or reject pending accounts and assign roles.
- Deactivate or reactivate access without deleting user history.
- Keep Firebase magic-link sign-in; Admins never create or know user passwords.
- Do not include Trainer Directory changes in this PR.
- Merged at `749908290131882505efb011300d446ee9926c74`.

### PR3J — Admin Panel: Trainer Directory

- **Completed, merged and deployed** at
  `645ea70b816a82fae3482dd862d8602c92035106`.
- Delivered an Admin-only Trainer Directory section, trainer registration and
  editing, activation/deactivation without deleting historical assignments,
  eligible course links, module exclusions, readiness confirmation and audited
  alias removal.
- Trainer fee values and User Access changes remain outside this PR.

### Schedule Sync and reference-data repair

This is the approved prerequisite repair stream, documented in
[`sync-reference-repair.md`](sync-reference-repair.md). It is documentation-only
at this checkpoint and must be delivered in separately reviewable implementation
PRs before PR3K resumes:

- **SYNC-SAFE-1** — remove automatic apply, require exact-preview acknowledgement,
  enforce blocker states on the server, expose every issue, preserve blank/Hotel
  operational states, and retain the hard greater-than-50% cancellation block.
- **REFERENCE-DATA-1** — Admin-only canonical course, venue and room records with
  sibling aliases, venue-scoped room aliases, shared validation, concurrency and
  immutable audit.
- **SYNC-RESOLUTION-1** — per-batch skip reasons, explicit Re-check, complete
  freshness digest, cancellation correspondence and atomic idempotent apply.
- **Read-only production inventory** — reverify the reported venue/room categories,
  counts and overlap, and investigate the six FT-/NFT- source-row semantics before
  any permanent-ignore proposal. It may run after this documentation order but
  authorizes no cleanup, repair or write.
- **SESSION-REPAIR-1** — explicit versioned repair of selected existing sessions,
  preserved raw evidence and all-or-nothing stale handling, issued only after the
  inventory findings and exact affected categories are accepted.
- **Production cleanup** — a separate dry-run and approval after the preventive
  release. No permanent ignore rule, six-code assumption or production cleanup is
  approved by this roadmap state.

The full contract records the unapproved permanent-ignore and cancellation-
override proposals, current no-absence-cancellation behavior, and all explicit
exclusions. Production Sync should not be used operationally until the preventive
repair is deployed and post-deployment verification passes.

### PR3K — Admin Panel: Trainer Rate Reconciliation

PR3K is an Admin-only milestone with two separately reviewable bounded
sub-workstreams. The first is the canonical course-to-rate-category mapping
screen (**Rate categories**, the third Administration subtab); the second is
**Rate Reconciliation**, the fourth. The exact tablist is **User Access |
Trainer Directory | Rate categories | Rate Reconciliation**. Finance keeps
its existing read-only economics view elsewhere; Ops and Viewer receive no
PR3K tab, route, data, or fee values.

PR3K's contract is approved, but implementation is paused behind the Sync and
reference-data repair sequence above. No PR3K code, schema, API, UI, mapping
seed, production economics change or deployment is authorised by this roadmap
state.

Rate categories mapping (sub-workstream 1):

- List active canonical courses, grouped by programme and keyed by the exact
  canonical course code.
- Keep an authoritative one-row-per-course table with at most one category.
  **Not mapped** is a valid visible state with a filter and an explicit
  per-course mapping action. **Ambiguous** is a legacy/preflight conflict
  only; it is never auto-resolved.
- Save one course at a time through a combobox of all eight category codes.
  Every mapping or removal requires a 1–500 character audit note, the current
  `expectedVersion`, and an append-only history event with actor,
  time, previous category, and new category. A stale write returns typed 409.
- Never display a rate, infer a mapping from workbook text, create trainer
  eligibility/exclusions/recommendations, or seed mapping data.

Rate Reconciliation:

- Provide the protected workbook upload, server-driven preview, identity
  resolution, effective dates, immutable audit, and atomic apply described in
  `trainer-rate-reconciliation.md`.
- Parse eight independent template-v3 categories (`IIO`, `DM`, `IT-Normal`, `IT-WSQ`, `IT-Special`, `WSQ-Writing`, `AI`, `Video`); ignore `Sheet1`.
  AI column B has no calculation, fingerprint, deduplication, or assignment
  effect, and Video is never merged into IT-Special.
- Read the mapping table only to compute per-course economics eligibility.
  Every canonical course must be explicitly mapped before economics can use a
  rate. Mapping gates economics per course for all eight categories: mapped
  courses may use the matching rate assignment, unmapped courses cannot, and an
  ambiguous course blocks only itself. The rate assignment is still applied by
  reconciliation; no mapping is inferred and current economics behavior does
  not change without a separately approved cutover.
- Resolve one identity per normalized source name across the batch, with
  individual category-row exclusions and required reasons. Cross-hash carry-
  forward is opt-in after full server revalidation and can carry an exclusion
  only when normalized name, category, and server-only row/profile fingerprints
  match.
- Use eight distinct lifecycle states: `uploaded`, `parsed`, `needs_resolution`,
  `ready`, `applied`, `rejected`, `failed`, and `discarded`. Only `applied`,
  `rejected`, `failed`, and `discarded` are terminal; each terminal state is
  read-only and releases the open-batch lock. Upload Cancel exists only
  before the `uploaded` record; after that, audited Discard is the
  only pre-apply exit. Rejected offers only **Start a new batch**. Failed
  retains no workbook object and requires re-upload. Carry-forward is always
  opt-in and fully revalidated: same-hash uploads may carry still-valid identity
  decisions and exclusions; different-hash corrected uploads may carry
  still-valid identity decisions, while exclusions carry only when normalized
  name, category, and server-only row/profile fingerprints match. Temporary
  workbook files are removed after parsing, and no batch can reopen or download
  the workbook.
- Keep real workbooks, names, and fees outside GitHub. Fixtures and design
  inputs use only synthetic Demo Admin and Demo Trainer 1–18 identities and
  fabricated values.

This documentation change records the approved contract only. Schema, backend,
API, UI, migration, seed, dependency, provider, deployment, and current
economics cutover work require separately approved implementation work orders.

### PR4 — Trainer Picker

- Keep the existing PR4 milestone.
- Add rules-based trainer suggestions to the trainer action in Sessions.
- Respect skills, SME boost, exclusions, role-based economics visibility, and the
  absence of authoritative individual training dates.

PR5 and PR6 remain AI assistant and Calendar/Gantt/Activity work respectively.
Their identities and numbering are unchanged.

## 11. Non-goals for PR3E–PR3K

- Writing back to Excel or generating a replacement Excel workbook.
- Treating Excel as authoritative after import.
- AI-generated schedules or automatic trainer assignment.
- Trainer or room conflict claims based on every date inside a session span.
- Trainer fee values in GitHub or unrestricted API/frontend responses.
- Drag-and-drop scheduling.
- Combining User Access, Trainer Directory, or Trainer Rate Reconciliation into one
  implementation PR.
- Storing confidential rate values or real rate workbooks in GitHub.
- Letting Ops or Viewer access rate values or reconciliation actions.
- Automatically accepting fuzzy name matches, inferring trainer-course eligibility,
  or deleting records that are missing from a later workbook.
- Using schedule Sync operationally before the preventive repair contract is
  implemented, reviewed, accepted and deployed.
- Applying a batch without exact-preview acknowledgement, silently treating an
  unmatched value as resolved, or silently rewriting an existing session after a
  reference-data change.
- Treating literal `Hotel` as a physical venue, or treating blank trainer, venue
  or owned-venue room values as the same state as a non-empty unresolved value.
- Assuming the six FT-/NFT- codes are non-session rows, adding permanent ignore
  rules without evidence, or allowing an unapproved cancellation override.
- Repairing existing sessions through a later upload or alias change without an
  explicit, versioned, audited repair Preview.
- Seeding course-to-rate-category mappings, importing real workbook rows, or
  changing current session-economics behavior.
- Treating Video as one aggregate economics gate rather than gating each
  canonical course independently, or auto-resolving an Ambiguous mapping.
- Carrying an exclusion across hashes without full revalidation and matching
  normalized-name, category, and server-only row/profile fingerprints.
- Retaining a workbook object after parsing, reopening it from a batch, or
  bypassing the required mapping audit note, expected-version check, or history.
- Removing historical PR documentation or renumbering completed work.
- Importing the Lovable export's application logic, authentication, direct database
  operations, infrastructure, dependencies, migrations, environment values, AI,
  trainer recommendations, calendar, rooms, notes/wiki, or unreleased routes.

## 12. Acceptance checkpoints

Each PR must stop after implementation, tests, and a report. Deployment and database
migration require their own explicit approval/checkpoint.

Before PR4 begins, confirm that:

- Course Planning and Sessions have distinct purposes in navigation and copy;
- Admin/Ops can safely amend a trainer with audit history;
- Finance/Viewer remain read-only;
- stale writes are rejected;
- Excel re-import cannot silently replace application-managed changes;
- the existing session and sync behaviours remain covered by regression tests;
- the Sync repair contract has been implemented before further operational
  imports: no batch auto-applies, exact-preview acknowledgement is enforced on
  the server, Re-check invalidates stale previews, and every issue is accessible;
- unmatched, ambiguous and malformed values block, while blank operational
  values and Hotel-pending delivery remain distinct visible Needs-attention
  states;
- skipped rows require reasons and cannot create unsafe cancellation proposals;
  absent workbook rows remain non-cancelling;
- the greater-than-50% explicit-cancellation safeguard remains a hard block;
- reference changes participate in preview freshness, aliases are venue-scoped
  for rooms, and alias changes never silently rewrite existing sessions;
- existing-session repair is explicit, versioned, audited and all-or-nothing if
  any selected session is stale;
- the ASK visual foundation is accepted without changing those behaviours, and
  future product pages reuse its approved presentation tokens and patterns;
- no individual training dates have been inferred from session spans;
- the Admin Area has separate User Access, Trainer Directory, and Trainer Rate
  Reconciliation sections;
- only Admin users can manage user access, trainer reference records, or rate
  reconciliation;
- AI column B cannot affect calculations or profile decisions;
- rate reconciliation requires an effective-dated preview, immutable audit, stale-
  preview protection, and full transactional rollback;
- new trainers created during reconciliation receive no automatic course eligibility;
- every newly created trainer remains unavailable to Trainer Picker until the Admin
  completes the audited Trainer Directory eligibility setup and explicitly marks
  the trainer ready for scheduling.
- the Administration section tabs are ordered User Access, Trainer Directory,
  Rate categories, Rate Reconciliation, with the last two absent for non-Admins;
- Rate categories is the first PR3K sub-workstream, uses exact canonical courses,
  keeps one authoritative row per course, exposes Not mapped and Ambiguous
  preflight states, and has required notes, expected-version typed 409 handling,
  and append-only history for every mapping/removal;
- all eight template-v3 categories are explicit, Sheet1 is ignored, AI column B
  has no effect, and Video is never merged into IT-Special;
- every canonical course mapping is explicit before economics; all eight
  categories show configuration status and are gated per course while the rate
  assignment itself is always applied, and no current economics behavior
  changes;
- identity is resolved once per normalized source name, with independent
  category-row exclusions and reasons, including automatically matched rows;
- cross-hash carry-forward is opt-in after full revalidation and exclusions
  carry only when normalized name, category, and server-only row/profile
  fingerprints match;
- uploaded workbook objects are removed after parsing and cannot be reopened or
  downloaded; rejected, failed, discarded, and applied terminal states are
  distinct and release the open-batch lock;
- upload Cancel is available only before an uploaded batch exists; Discard is
  audited after it exists; rejected offers only Start a new batch; failed
  requires a re-upload, with opt-in revalidated identity carry-forward across a
  corrected hash and exclusion carry-forward only on the stricter server match;
- no mapping seed, real workbook, real name, real fee, migration, or deployment
  is included in the PR3K documentation work.
