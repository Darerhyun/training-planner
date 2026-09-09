# Design inputs

Approval: Approved by Owen for PR3G-V V4 design inputs on 2026-09-03. PR3K
revision 4 UI/IX contract was approved for the architecture gate on
2026-09-09.

Source package: `designinputspr3gv (3).zip`

Source ZIP SHA-256:
`e8b5e74336eda35c33a62ff9d59b43ada8251cbd946b495633233425372ddb51`

PR3K revision 4 source-document SHA-256 values:

- advice: `9946075518a1760743dab9df5ac7c95ab9fa93016bd34284ef861cc6f8aadc57`
- exact-change summary: `802311a060ac4798f9848e8ee1eacb854cb4d2a5319f0992fb6e99d0ffd9d920`

Immutable review inputs for UI/IX PRs. Each subfolder holds the PNG exports of the approved Claude Design canvas for one PR; `design-brief.md` is the standing design brief (tokens, component vocabulary, rules, data-model and API-contract checks). Update by committing a new version; never edit PNGs in place.

Design baseline: `main` @ `53bffa55daaf1f22c34e2d921b08db08a5463431`.

PR3K's contract is deliberately text-only: no PNGs, real workbook fixtures,
production names, or real fee values belong in that package. Subfolders may
hold approved PNG exports or a text-only contract.

Review model: Sol High independently reviews technical correctness after implementation and cannot implement the same work item. Claude reviews UI/IX conformance against the same exact head; neither reviewer edits. Claude's recommendations pass Sol's architecture gate; Claude is not mandatory for non-UI work unless Owen requests it.

PR3K fixtures use only Demo Admin and Demo Trainer 1–18 with fabricated values.
The applicable canonical course records remain authoritative; any synthetic
course code or title in the PR3K contract is explicitly design-package-only.

Every person, trainer, planner, session, reference and timestamp shown in these canvases is fictional and synthetic (Demo Planner, Demo Trainer 1–5). No production data was used. Course codes and names, programme codes, venues and room names are the canonical seeded records from `db/schema.sql` and `docs/02-domain/`. Every displayed value maps to a field in the current `PlanningSession` / `SessionHistoryEntry` client contract; nothing shown requires a backend change. Provenance is `managementSource` + `externalRef` only; trainer-history transitions use "Unassigned" for an empty side.

| Folder | PR | Contents | Status | Date |
|---|---|---|---|---|
| `admin-pr3k-rate-reconciliation/` | PR3K | text-only revision 4 UI/IX contract · Rate categories mapping first, Rate Reconciliation second · 1440 / 390 / 320 acceptance · synthetic Demo Admin / Demo Trainer 1–18 fixtures | Approved for Sol architecture gate | 2026-09-09 |
| `sessions-pr3g-v/` | PR3G-V | desktop 1440 default · drawer open · drawer scrolled (trainer history + provenance) · phone 390 (existing top-level tabs kept as a scrollable row) | Approved by Owen | 2026-09-03 |
| `proposals/phone-bottom-nav/` | none | Phone bottom navigation — a separate UX proposal, explicitly NOT in PR3G-V scope (decision 2026-09-03). Its fixture text predates V3/V4 corrections and is illustrative only. | Proposal only; approved for archival inclusion, not implementation | 2026-09-03 |
