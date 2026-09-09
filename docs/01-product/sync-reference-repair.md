# Training Planner — Sync and Reference-Data Repair Contract

Status: Approved staged repair contract; documentation only; implementation pending
Last updated: 9 September 2026

Repository `main` baseline for this contract:
`d786d19452f069e26569bb35115cea341acb21fa`

Deployed application baseline:
`645ea70b816a82fae3482dd862d8602c92035106`

These are distinct baselines. The first is the repository source state inspected
for this contract; the second is the last-deployed application evidence. This
document does not query or change production.

## 1. Purpose and boundary

This contract defines the staged repair required before the next operational use
of schedule Sync. It makes the parser honest about what it can resolve, prevents
unreviewed writes, provides a safe reference-data correction path, and separates
repair of existing sessions from future import resolution.

It is a contract only. It authorises no application code, schema or migration,
database read or write, reference-data seed, production cleanup, economics
change, dependency, infrastructure, provider action, commit, push, PR, merge or
deployment. PR3K remains paused until the preventive Sync repair is implemented,
reviewed, accepted and deployed through its own gates.

Excel remains an import source only. After import, the Training Planner remains
authoritative for internal planning changes. The TMS remains the official record
for regulated funding, claims and related data.

## 2. Observed starting point

The current repository implementation was inspected read-only at the baseline
above. These facts describe the behavior to be corrected or preserved:

- A schedule parse can auto-apply when it has fewer than ten changes and no
  cancellation or conflict trigger.
- Unknown course, trainer, venue and room values are reported as alerts but do
  not reliably prevent application.
- The current browser view limits the visible alert list instead of making every
  issue available to the reviewer.
- There is no explicit Re-check operation or server preview digest covering
  workbook, reference data and affected-session versions.
- Cancellation counting currently concerns explicit cancelled workbook rows; an
  absent row is not currently an absence-based cancellation. That behavior must
  remain a regression invariant.
- A supplied unmatched trainer is not distinguished clearly enough from a
  deliberately blank trainer in all operational presentation.
- Trainer and venue source text are persisted, but the parser currently drops
  raw room text before session persistence.
- Trainer and course aliases exist. Venue and room alias tables and the Admin
  reference-data management surface do not yet exist.
- The current room resolver scopes candidates to the resolved canonical venue;
  the future room-alias model must preserve that boundary.

These observations are not permission to reproduce the behavior in a new
implementation. Later work must satisfy the target contract below.

## 3. Ownership and permissions

| Role | Sync preview/apply | See issues | Manage reference data | Repair existing sessions |
|---|---|---|---|---|
| Admin | Yes | Yes | Yes | Yes |
| Ops | Yes, subject to server gates | Yes | No | Only where a later repair order explicitly permits |
| Finance | No write access | No Sync write access | No | Read-only |
| Viewer | No write access | No Sync write access | No | Read-only |

All authorization is enforced on the server. Browser visibility is not an
authorization control. Admin reference changes must never be exposed as rate
data or trainer economics.

Ops can inspect blockers and retain the current Sync batch context. Ops never
enters or returns to Admin Reference data. An Admin performs the required
reference-data edit; Ops then returns to the Sync batch and runs Re-check. Ops
cannot create, change or disable a canonical course, venue, room, alias or
permanent source rule.

## 4. Target Sync lifecycle

Every schedule batch follows this shape:

```text
Upload → Parse → Preview → resolve/review → Re-check → acknowledge exact preview → Apply
```

The later implementation must enforce these invariants:

1. Every batch stops at Preview. The existing `<10 changes` auto-apply path is
   removed.
2. Every write requires an explicit acknowledgement of the exact current
   preview. A low-impact label may help the reviewer but never authorises an
   automatic write.
3. Any change to the workbook, parser contract, reference data, row decision,
   skip reason, conflict, cancellation scope or affected session invalidates
   the acknowledgement.
4. Re-check regenerates the preview from the current server state. Apply is
   allowed only after the regenerated preview is explicitly acknowledged.
5. The server, not only the UI, enforces the preview freshness and acknowledgement
   rules.
6. Apply is one atomic transaction. A failed transaction writes no partial
   session, reference, cancellation or audit result.
7. Retrying the same already-applied batch is idempotent and returns its committed
   result; a failed or stale attempt never silently retries or applies a changed
   result.

### 4.1 Preview identity and freshness

The server-generated preview identity covers, at minimum:

- uploaded workbook hash;
- parser-contract/version identifier;
- canonical course, trainer, venue and room reference revisions;
- alias revisions, including venue and room aliases;
- active permanent source-rule revision, if that future capability is approved;
- exact affected session IDs and their versions;
- row classifications, resolutions, exclusions and skip reasons;
- explicit cancellation scope and counts; and
- the resulting preview digest.

The acknowledgement carries the preview digest and the acting Admin/Ops user.
The apply endpoint recomputes or validates every freshness input while holding
the required locks. A typed stale response (HTTP 409) contains no write result
and directs the user to Re-check. There is no last-write-wins behavior.

## 5. Row classification and blocker matrix

Each input row has exactly one primary Preview outcome. The primary outcomes are
mutually exclusive and must reconcile exactly:

```text
total rows = apply rows + explicitly skipped rows + blocked rows
```

`apply rows` may contain new, updated, unchanged or explicit-cancellation
subcounts, but each row appears in only one of those subcounts. Warning counts
are annotations and may overlap; the UI must label them as non-additive. A row
that is blocked cannot also be counted as skipped or ready to apply.

| Condition | Target outcome |
|---|---|
| Exact or approved alias match for a canonical course, trainer, venue or room | Apply candidate, subject to all other checks |
| Non-empty unmatched course | Block until resolved or explicitly skipped with a reason |
| Ambiguous course | Block until one canonical choice is explicitly resolved or the row is skipped |
| Non-empty unmatched trainer | Block until resolved or explicitly skipped with a reason |
| Blank trainer | Import candidate; show **Trainer not supplied** in Needs attention |
| Non-empty unmatched venue | Block until resolved or explicitly skipped with a reason |
| Blank venue | Import candidate; show **Venue not supplied** in Needs attention |
| Literal `Hotel` | Recognised pending delivery category; see Section 6 |
| Non-empty unmatched room at a resolved owned venue | Block until an alias/reference is added, the value is corrected, or the row is skipped |
| Blank room at a resolved owned venue | Import candidate; show **Missing room** in Needs attention |
| External or virtual delivery with no room | Import candidate; room is not applicable |
| Malformed date, pax or status | Block; never silently default or convert to a valid row |
| Application-managed conflict | Block until explicitly resolved or skipped |
| Row explicitly skipped | No write for that row; required reason and cancellation-safety proof |

Blank operational fields are not silently treated as resolved. They remain
visible issue states and must feed the existing Needs attention filters and
planning calculations correctly.

Unknown trainer names and blank trainers are different states. A blank trainer
is a legitimate unassigned session; a supplied name that cannot be resolved is
an unsafe interpretation and blocks application.

## 6. Hotel and pending delivery category

The literal source value `Hotel` is a delivery category, not a canonical venue.
It must not be represented as a fake physical venue or as an automatic choice
of Furama, Holiday Inn or Scotts.

A Hotel row:

- is not an import blocker by itself;
- remains visible in Needs attention as **Venue to be confirmed**;
- contributes to the HOTEL planning category;
- preserves its raw source value;
- does not imply a physical venue, room, room capacity or physical-venue conflict;
- does not become resolved merely because it was accepted for import; and
- receives a real canonical hotel venue only through a later explicit planning or
  session action.

Any logic that currently treats every null venue ID as an unmatched-venue issue
must be changed in a later implementation so `Hotel`, blank venue and truly
unmatched non-empty venue remain distinct states.

## 7. Skips, cancellation correspondence and permanent rules

### 7.1 Per-batch skips

Skipping is a batch decision, not a remembered rule. Every skipped row requires
a reason visible in the Preview, audit result and later batch history.

A skipped row must retain source presence for reconciliation. Before apply, the
server must establish the row's exact correspondence to any existing session
that could otherwise enter the cancellation proposal. If correspondence cannot
be proved safely, the Preview is blocked. Retaining a raw row by itself is not
enough protection.

The current importer does not cancel sessions merely because they are absent
from a workbook. That behavior is preserved as a regression test. Any future
absence-based reconciliation must treat a skipped or ignored source row as
present, or block the affected cancellation proposal.

### 7.2 Permanent ignore capability — proposed, not approved

Permanent source rules are not part of the approved implementation scope. In
particular, the six FT-/NFT- codes are not assumed to be headings, summaries or
non-session rows. They may represent structural rows, genuine training sessions
or components represented elsewhere; a read-only evidence review must establish
which before any rule is proposed for production.

No permanent rule or seed may be created by this contract. A future rule must:

- match an exact normalized source value plus any separately verified structural
  predicates;
- show representative rows and affected counts before confirmation;
- prove that no genuine session is hidden;
- require Admin confirmation and a reason;
- carry version and immutable audit history;
- participate in Preview freshness and invalidate affected previews when added,
  changed or disabled;
- be visible in every applicable Preview and its row arithmetic; and
- remain a source rule, never a course alias to a fake canonical course.

If exact cancellation correspondence or session meaning cannot be established,
the row blocks rather than being permanently ignored.

### 7.3 Cancellation safeguard

The existing greater-than-50% explicit-cancellation safeguard remains a hard
block for now. The proposal to allow an Admin-only override with a required
reason and immutable audit is **not approved** by this contract and must not be
implemented or carried forward from the current `manualOverride` behavior.

The later implementation must show the exact cancellation numerator, denominator
and affected session IDs. No acknowledgement can bypass the hard block until a
separate product decision authorizes an override.

## 8. Reference data and aliases

Reference data is an Admin-managed authority. It includes canonical courses,
venues and rooms and their approved aliases. It does not include rate values.

Sibling alias tables remain separate and share normalization, validation,
authorization and audit logic:

- course aliases resolve canonical course codes;
- trainer aliases resolve trainer identities;
- venue aliases resolve canonical venue values; and
- room aliases resolve a room only within its canonical venue namespace, using
  `(venue_code, normalized_alias)` as the uniqueness boundary.

An alias correction affects future parsing and Re-check only. It never silently
rewrites, reassigns or deletes an existing session. Existing sessions require
the separate repair flow in Section 9.

Reference writes use optimistic concurrency and append-only audit. Stale writes
return typed HTTP 409. No production alias, venue, room or course mapping is
seeded by this documentation work.

## 9. Existing-session repair — separate workstream

The intake matrix prevents future bad imports; it does not re-evaluate existing
sessions. The reported counts of 27 unresolved-venue results and 21 missing-room
results are last-reported observations, may overlap, and must be reverified by a
separate read-only inventory. No production query is performed by this contract.

The inventory must distinguish at minimum:

- Hotel pending-location rows;
- blank venues;
- non-empty unmatched venues;
- blank rooms at owned venues;
- non-empty unmatched rooms;
- rows with recoverable persisted raw source text; and
- rows where original room text is unavailable.

It must also reverify the reported venue/room counts and their overlap, and
investigate the six FT-/NFT- source-row semantics. The review must establish
whether those rows are structural headings, genuine sessions or components
represented elsewhere before any permanent-ignore proposal is made. This
inventory may run after SYNC-REPAIR-DOCS-1, but it remains read-only and does
not authorize cleanup, session repair, alias changes or writes.

The inventory is a prerequisite for SESSION-REPAIR-1. Its findings and exact
affected categories must be accepted before an existing-session repair order is
issued.

The repair workstream must:

1. show a preview with exact selected session IDs, current versions, raw values,
   proposed canonical assignment or reclassification, and reason;
2. require explicit Admin/Ops authorization according to the separately approved
   repair order and an audit note;
3. apply only the explicitly selected sessions;
4. preserve all existing raw evidence and show **Original room text unavailable**
   when the source was never persisted;
5. never fabricate or infer missing historical room text;
6. use optimistic concurrency for every selected session; and
7. apply none of the selection if any selected session is stale, returning a
   typed 409 and requiring a regenerated repair Preview.

Adding an alias may improve future Sync resolution, but it does not repair an
existing session automatically. Existing-session repair must be auditable and
explicit. Prospective implementation must persist raw room text for future
imports.

## 10. Staged implementation sequence

The following sequence is approved as planning, not implementation authorization:

1. **SYNC-REPAIR-DOCS-1** — this authoritative contract and cross-reference
   corrections.
2. **SYNC-SAFE-1** — remove auto-apply; enforce server-side acknowledgement,
   blocker handling, accessible all-issue presentation and the hard cancellation
   safeguard.
3. **REFERENCE-DATA-1** — Admin-only course, venue and room reference records,
   sibling aliases, venue-scoped room aliases, shared validation and audit.
4. **SYNC-RESOLUTION-1** — per-batch decisions/reasons, explicit Re-check,
   freshness digest, cancellation correspondence and atomic idempotent apply.
5. **Read-only production inventory** — reverify the reported venue/room counts,
   categories and overlap, and investigate the six FT-/NFT- source-row semantics
   before any permanent-ignore proposal. It may run after this documentation
   order, but authorizes no cleanup, repair or write.
6. **SESSION-REPAIR-1** — explicit existing-session repair with version checks,
   preserved evidence and all-or-nothing selection behavior, issued only after
   the inventory has been completed and its findings accepted.
7. **Separate cleanup order** — only after prevention is deployed, with a dry-run
   manifest, exact IDs/counts, backup/rollback evidence and separate approval.
8. **Resume PR3K** — only after the preventive repair has passed its own review,
   acceptance, deployment and post-deployment verification gates.

The repair sequence does not authorize production economics changes, rate
reconciliation, course-category mapping seeds or any PR3K implementation.

## 11. Acceptance criteria for later implementation

The repair is not accepted until later implementation work demonstrates:

- no automatic apply for any batch size;
- server-side acknowledgement of the exact current Preview;
- typed stale responses with no writes and a working Re-check path;
- all issues accessible without truncation and exact mutually exclusive row
  arithmetic;
- correct distinction between unmatched, blank, Hotel-pending and
  external/virtual roomless states;
- non-empty unresolved or ambiguous values and malformed fields block apply;
- every skip has a reason and cannot create an unsafe cancellation;
- absent workbook rows do not cancel sessions;
- the greater-than-50% explicit-cancellation hard block remains enforced;
- reference revisions and future source rules invalidate affected previews;
- room aliases cannot cross venue boundaries;
- alias changes never silently rewrite existing sessions;
- raw room text is persisted prospectively;
- existing repair is selected, versioned, audited and all-or-nothing on staleness;
- atomic apply rolls back fully on failure and retries idempotently; and
- Admin/Ops permissions match Section 3 on the server.

## 12. Explicit exclusions and stop conditions

This contract excludes and does not authorize:

- PR3K implementation or any Rate categories/Rate Reconciliation runtime work;
- trainer-rate, rate-category, session-economics or reconciliation changes;
- permanent ignore rules or seeds, including assumptions about FT-/NFT- codes;
- cancellation overrides;
- production queries, writes, session repair, alias changes or cleanup;
- database schema, migrations, API routes, UI components or tests;
- new dependencies, infrastructure or provider actions;
- real workbooks, real trainer identities, real fees or production mappings;
- deployment, rollback, branch creation, commit, push, PR creation or merge; and
- automatic rewriting of existing sessions after a reference-data change.

Later work must stop and return to Sol if the base/head/tree changes, another
file is needed, a requirement conflicts with the existing ownership or
authorization model, cancellation correspondence cannot be proven, a permanent
rule would hide a genuine session, or production/provider access is required.

The documentation-only rollback is a single commit revert. No data rollback is
required for this contract.
