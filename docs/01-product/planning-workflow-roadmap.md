# Training Planner — Planning and Sessions Roadmap

Status: Approved product direction; PR3E–PR3F complete, PR3F historically deployed; no live deployment currently exists; PR3G onward pending
Last updated: 16 August 2026

## 1. Purpose

This document defines the distinction between future course planning, individual
class sessions, trainer assignment, Excel ingestion, and the Admin Area.

It extends the existing roadmap. It does not replace or renumber completed PR1,
PR2, or PR3 work.

## 2. Source-of-truth decision

- Excel is an **import source only**. It supplies historical and existing schedule
  data that cannot yet be obtained from another source.
- The Training Planner website is the authoritative source for **internal planning
  changes made after import**, including trainer assignments.
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
4. **Admin** — Admin-only User Access and Trainer Directory management.

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
outside GitHub.

## 6. Admin Area

Approved Admin Area option 3 uses one Admin navigation area with two separate
sections and implementation PRs. Only active Admin users may access or modify
either section.

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
- Keep trainer fee values outside these workflows and outside GitHub.

User Access and Trainer Directory must remain separate PRs so authentication risk,
trainer-reference-data changes, and rollback are independently reviewable.

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

## 10. Incremental PR plan

Historical PRs remain unchanged. Continue with PR3 sub-parts so the existing PR4
Trainer Picker milestone keeps its original identity.

The next product feature is PR3G — Sessions UX. It may begin only after this
workflow documentation is merged and a separate, approved infrastructure-recovery
prerequisite has established a safe development and deployment environment.
Infrastructure recovery and PR3G must remain separate work orders and PRs.

### PR3E — Product and data-ownership contract (completed)

- Commit this roadmap and update the documentation index.
- Amend AGENTS.md only where needed to state that Excel is import-only and the app
  is authoritative for internal planning after import.
- Preserve the statement that TMS is the official regulated record.
- No runtime, schema, database, or deployment changes.

### PR3F — Session write safety and audit foundation (completed; historically deployed)

- Added application-managed/import-managed session ownership.
- Added optimistic concurrency/versioning.
- Added session change history with actor and timestamp.
- Added an Admin/Ops-only trainer assignment endpoint.
- Kept Finance/Viewer read-only.
- Changed Sync so incoming Excel differences cannot silently overwrite an
  application-managed session; conflicts are explicitly reported.
- Delivered backend and focused tests without a UI redesign.
- The historical Google deployment was deleted; no live deployment currently
  exists. This status does not reopen or undo PR3F's completed implementation.

### PR3G — Sessions UX and navigation consolidation

- Turn the current rich Planning dashboard into the enhanced Sessions page.
- Add the read-only detail/history view for all active roles.
- Add trainer assignment/change/unassign controls for Admin/Ops.
- Add stale-edit and import-conflict messages.
- Retain the old basic Sessions implementation until parity is verified, then
  remove it within this PR only if tests and manual acceptance pass.
- Do not add trainer recommendations yet.

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

### PR4 — Trainer Picker

- Keep the existing PR4 milestone.
- Add rules-based trainer suggestions to the trainer action in Sessions.
- Respect skills, SME boost, exclusions, role-based economics visibility, and the
  absence of authoritative individual training dates.

PR5 and PR6 remain AI assistant and Calendar/Gantt/Activity work respectively.
Their identities and numbering are unchanged.

## 11. Non-goals for PR3E–PR3J

- Writing back to Excel or generating a replacement Excel workbook.
- Treating Excel as authoritative after import.
- AI-generated schedules or automatic trainer assignment.
- Trainer or room conflict claims based on every date inside a session span.
- Trainer fee values in GitHub or unrestricted API/frontend responses.
- Drag-and-drop scheduling.
- Combining User Access and Trainer Directory into one implementation PR.
- Removing historical PR documentation or renumbering completed work.

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
- no individual training dates have been inferred from session spans;
- the Admin Area has separate User Access and Trainer Directory sections;
- only Admin users can manage user access or trainer reference records.
