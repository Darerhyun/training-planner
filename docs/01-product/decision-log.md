# Product decision log

One dated line per product decision taken by Owen, appended in the PR that first
depends on it (`SOL_RULES.md` section 2). Lines are never edited; a reversal is a
new line that cites the one it supersedes. Decisions before 9 September 2026 are
recorded in `planning-workflow-roadmap.md` and are not back-filled here.

| Date | ID | Decision | Recorded in |
|---|---|---|---|
| 2026-09-09 | D1 | Unknown course codes in Sync never auto-create courses; a row is held until an Admin maps it (saved alias), adds a new course, or skips it with a reason. | `sync-reference-repair.md` §5 |
| 2026-09-09 | D2 | Course, venue and room aliases are managed in an Admin-only Reference data section on the PR3J alias pattern; Sync warnings link into it. | `sync-reference-repair.md` §3, §8 |
| 2026-09-09 | D3 | Sync apply requires a dialog restating counts with a required acknowledgement, and is blocked while any row is unresolved. | `sync-reference-repair.md` §4 |
| 2026-09-09 | D4 | The Legacy sessions page stays but is visible to the Admin role only. | pending UI work order |
| 2026-09-09 | D5 | Unmatched trainer text on a session renders as muted "Unmatched: [text]" with a link to map it; never styled as an assignment. | pending UI work order |
| 2026-09-09 | D6 | Course Planning collapses programme groups by default, one open at a time, with real headings. | pending UI work order |
| 2026-09-09 | D7 | The Sessions programme filter lists every programme with an option to hide retired ones. | pending UI work order |
| 2026-09-09 | D8 | The six placeholder FT-/NFT- courses and their sessions created by the 9 Sep upload are removed by a separate, gated cleanup after prevention is deployed. | `sync-reference-repair.md` §10 step 7 |
| 2026-09-09 | D9 | Sequence: Sync repair first (with Reference data), then Course Planning and User Access UI/IX pass; PR3K paused behind Sync repair. | `sync-reference-repair.md` §10 |
| 2026-09-10 | D10 | Claude reviews high-risk PRs (schema, authorization, Sync apply, deployment, cost) in parallel with Sol High on the same head. | `WORKFLOW_HARNESS.md` §2 |
| 2026-09-10 | D11 | Baselines live only in `infra/baselines.json`; work orders are committed under `docs/04-work-orders/`; every PR uses the template. | this PR |
| 2026-09-14 | D12 | Astra XHigh (`gpt-6-astra` with `reasoning_effort: xhigh`) replaces Astra Low/Light for bounded implementation/execution under Luna Max as a standing role decision. Scope, review, release, merge and deployment authority remain unchanged. | `WORKFLOW_HARNESS.md` §2, `LUNA_RULES.md` §1 |
| 2026-09-10 | D13 | REFERENCE-DATA-1A is the Admin-only schema/API/resolver foundation: sibling aliases remain separate, canonical identities are immutable and deactivated rather than deleted, venue-scoped room aliases cannot cross venues, dependent deactivation is blocked until dependents are separately inactive, and all mutations use optimistic concurrency plus append-only audit. | `WO-20260910-reference-data-1a.md`, `sync-reference-repair.md` §§7–9 |
| 2026-09-17 | D14 | Trainer scheduling readiness resets only on the approved eligibility reset triggers; eligible course links and independent exclusions remain separate, and an exclusion wins when both exist. | `03-design/admin-pr3j/README.md` and PR #27 |
| 2026-09-17 | D15 | Trainer IDs are server-generated immutable metadata; Admins may display, search, and add aliases and may remove an alias only after confirmation with optimistic concurrency, a required audit note, and one immutable `alias_removed` event. The primary name is not removable through that flow. | `03-design/admin-pr3j/README.md` and PR #27 |
| 2026-09-17 | D16 | Rate reconciliation makes one identity decision per normalized source name while category-row exclusions remain separate decisions. | `01-product/trainer-rate-reconciliation.md` |
| 2026-09-17 | D17 | Template v3 has eight independent rate categories, including `Video`; `Sheet1` is ignored and `Video` is never folded into `IT-Special`. | `01-product/trainer-rate-reconciliation.md` |
| 2026-09-17 | D18 | PR3K includes a general Admin Rate categories screen for all eight categories, and no category rate may affect session economics until the exact canonical course has an explicit category mapping. Production mappings and economics changes require separate approval. | `01-product/trainer-rate-reconciliation.md`, `03-design/admin-pr3k-rate-reconciliation/README.md` |
| 2026-09-17 | D19 | Carry-forward of rate-import identity decisions across a corrected workbook is opt-in and fully revalidated. An exclusion carries only when the server verifies the same normalized name, category, and row/profile fingerprint. | `01-product/trainer-rate-reconciliation.md` |
| 2026-09-17 | D20 | In Sync, `Hotel` is a known venue-pending state that does not block intake but remains in Needs attention and HOTEL planning without implying a physical venue, room capacity, or conflict result. | `sync-reference-repair.md` |
| 2026-09-17 | D21 | Blank trainer, venue, or owned-venue room values are operational warnings and import unassigned; non-empty unmatched supplied values are blockers and must never be guessed. | `sync-reference-repair.md` |
| 2026-09-17 | D22 | Sync skips are per batch with a required reason and must retain source presence so they cannot cancel an existing session. No permanent-ignore rule or cancellation-threshold override is approved. | `sync-reference-repair.md` |
