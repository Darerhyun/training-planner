# Training Planner — Planning and Sessions Roadmap

Status: Approved product direction; PR3G merged and deployed; PR3G-V visual foundation precedes PR3H
Last updated: 26 August 2026

## 1. Purpose

This document defines the distinction between future course planning, individual
class sessions, trainer assignment, Excel ingestion, trainer-rate reconciliation,
and the Admin Area.

It extends the existing roadmap. It does not replace or renumber completed PR1,
PR2, or PR3 work.

## 2. Source-of-truth decision

- Excel is an **import source only**. It supplies historical and existing schedule
  data that cannot yet be obtained from another source.
- The Training Planner website is the authoritative source for **internal planning
  changes made after import**, including trainer assignments.
- A trainer-rate workbook is also an **import source only**. After an approved atomic
  apply, the application is authoritative for trainer identities, permanent aliases,
  rate categories, deduplicated profiles, effective-dated assignments, and audit
  history.
- A later schedule or rate workbook is a proposed change set and must never silently
  replace application-managed records.
- The website does not need to write changes back to an Excel workbook or generate
  an updated master workbook.
- The TMS remains the official record for funding, SSG codes, claims, and other
  regulated data.
- A later Excel upload must never silently overwrite a session already managed in
  the website. The Sync preview must identify the conflict and require an explicit
  resolution.

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

Conflicting uploads must not silently overwrite website-managed values.

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

Approved Admin Area option 3 uses one Admin navigation area with three separate
sections and implementation PRs. Only active Admin users may access or modify any
section. Confidential rate values are available only inside the protected Trainer
Rate Reconciliation workflow.

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
- Map controlled categories including `AI` and `WSQ-Writing`; AI column B is ignored
  for calculations, profile fingerprints, deduplication, and assignments.
- Deduplicate category-specific pax 3–20 profiles and create effective-dated,
  non-overlapping trainer assignments.
- Require a protected preview with zero unresolved blockers, immutable audit, stale-
  preview protection, and one atomic apply with full rollback on error or mismatch.
- Never infer course eligibility, delete missing records, or expose confidential
  values to Ops or Viewer.

The detailed contract is in `trainer-rate-reconciliation.md`. User Access, Trainer
Directory, and Trainer Rate Reconciliation must remain separate implementation PRs
so authentication risk, trainer-reference-data changes, confidential economics,
and rollback are independently reviewable.

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

PR3G is complete and deployed. PR3G-V is the presentation-only visual-foundation
extension immediately before PR3H. It does not renumber or reopen historical PRs.

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
- Merged at `2d061c990d4fd5bdb1aba062881cffb174870fd0` and deployed through
  Cloud Run revision `core-api-00003-lqk` with Firebase Hosting release `4634ed`.
- Trainer recommendations remain deferred to PR4.

### PR3G-V — ASK UX Visual Foundation

- Apply the ASK white/red presentation tokens and branded login/access/application
  shell to the existing PR3G frontend.
- Adopt only feasible presentation patterns from the external Lovable export:
  cards, metric hierarchy, pills, segmented date modes, filter organisation,
  sticky table headers, selected rows, detail panels, Sync/conflict states, and
  responsive hierarchy.
- Preserve all current Sessions, Sync, Legacy Sessions, role, history, trainer
  amendment, stale-write, conflict, pagination, and date-window behaviour.
- Add no routes or future features and make no API, auth, backend, database,
  infrastructure, provider, dependency, or deployment change.
- Validate rendered desktop and 320px states with local or mocked fixtures only;
  never use production application data.
- Complete and accept this visual foundation before PR3H so subsequent pages use
  one consistent component language.

### PR3H — Future Course Planning

- Add a month-based course planning model and page.
- Use the committed planning profiles and monthly profiles as read-only evidence.
- Allow Admin/Ops to create and approve proposed course runs.
- Allow an approved planned run to create a draft Session through an explicit user
  action.
- Do not automatically assign a trainer or generate dates.
- Do not introduce AI recommendations.

### PR3I — Admin Panel: User Access

- Add an Admin-only User Access section.
- Invite colleagues by email with an intended role.
- Approve or reject pending accounts and assign roles.
- Deactivate or reactivate access without deleting user history.
- Keep Firebase magic-link sign-in; Admins never create or know user passwords.
- Do not include Trainer Directory changes in this PR.

### PR3J — Admin Panel: Trainer Directory

- Add an Admin-only Trainer Directory section.
- Register and edit trainers.
- Activate or deactivate trainers without deleting historical assignments.
- Manage eligible course links and module exclusions.
- Do not expose trainer fees or mix User Access changes into this PR.

### PR3K — Admin Panel: Trainer Rate Reconciliation

- Add an Admin-only protected workbook upload, reconciliation preview, and atomic
  apply workflow specified in `trainer-rate-reconciliation.md`.
- Resolve canonical names and permanent aliases, and require explicit confirmation
  before creating a genuine new trainer.
- Give every newly created trainer **Needs eligibility setup** status and a direct
  Trainer Directory handoff. Keep the trainer unavailable for session assignment
  until an Admin explicitly approves course links, exclusions, active status, and
  scheduling readiness.
- Support `IIO`, `DM`, `IT-Normal`, `IT-WSQ`, `IT-Special`, `WSQ-Writing`, and `AI`.
- Ignore AI column B for all calculations and profile decisions.
- Deduplicate category plus pax 3–20 rate profiles and use non-overlapping effective
  dates rather than overwriting history.
- Audit every resolution and state change; reject stale previews and duplicate
  applied source hashes; roll back the complete batch on any error or count mismatch.
- Keep workbook values outside GitHub and unavailable to Ops or Viewer.
- Do not create trainer-course eligibility, user accounts, or session assignments
  when a new trainer is created through reconciliation.
- Any schema/backend and Admin UI implementation must remain separately reviewable
  within the PR3K milestone and require their own approved work orders.

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
