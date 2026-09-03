# Design inputs (V4)

Approval: Approved by Owen for PR3G-V V4 design inputs on 2026-09-03.

Source package: `designinputspr3gv (3).zip`

Source ZIP SHA-256:
`e8b5e74336eda35c33a62ff9d59b43ada8251cbd946b495633233425372ddb51`

Immutable review inputs for UI/IX PRs. Each subfolder holds the PNG exports of the approved Claude Design canvas for one PR; `design-brief.md` is the standing design brief (tokens, component vocabulary, rules, data-model and API-contract checks). Update by committing a new version; never edit PNGs in place.

Design baseline: `main` @ `53bffa55daaf1f22c34e2d921b08db08a5463431`.

Review model: Terra Max reviews technical correctness and Claude reviews UI/IX conformance in parallel against the same exact head; neither edits.

Every person, trainer, planner, session, reference and timestamp shown in these canvases is fictional and synthetic (Demo Planner, Demo Trainer 1–5). No production data was used. Course codes and names, programme codes, venues and room names are the canonical seeded records from `db/schema.sql` and `docs/02-domain/`. Every displayed value maps to a field in the current `PlanningSession` / `SessionHistoryEntry` client contract; nothing shown requires a backend change. Provenance is `managementSource` + `externalRef` only; trainer-history transitions use "Unassigned" for an empty side.

| Folder | PR | Contents | Status | Date |
|---|---|---|---|---|
| `sessions-pr3g-v/` | PR3G-V | desktop 1440 default · drawer open · drawer scrolled (trainer history + provenance) · phone 390 (existing top-level tabs kept as a scrollable row) | Approved by Owen | 2026-09-03 |
| `proposals/phone-bottom-nav/` | none | Phone bottom navigation — a separate UX proposal, explicitly NOT in PR3G-V scope (decision 2026-09-03). Its fixture text predates V3/V4 corrections and is illustrative only. | Proposal only; approved for archival inclusion, not implementation | 2026-09-03 |
