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
