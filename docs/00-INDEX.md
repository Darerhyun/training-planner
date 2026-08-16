# 00 — Documentation Index

> Read this first. It maps every knowledge file in the project so you know where to look before working on any feature.

## Mandatory operating files

- `../AGENTS.md` — always-loaded project brief and build sequence.
- `../WORKFLOW_HARNESS.md` — mandatory Sol → Luna → Terra delivery gates.
- `../SOL_RULES.md` — mandatory planning, architecture, work-order, and acceptance contract for Sol.
- `../LUNA_RULES.md` — mandatory pre-edit, implementation, escalation, and release contract for Luna.
- `../TERRA_RULES.md` — mandatory independent review and post-deployment verification contract for Terra.

## How the knowledge base is organised

```
../AGENTS.md                       ← project brief and mandatory role entry point
../WORKFLOW_HARNESS.md              ← Sol → Luna → Terra delivery harness
../SOL_RULES.md                    ← Sol operating contract
../LUNA_RULES.md                   ← Luna operating contract
../TERRA_RULES.md                  ← Terra operating contract
../infra/
├── cost-guardrails.json           ← locked cost and scaling limits
├── gcs-lifecycle.json             ← seven-day upload deletion policy
└── gcs-cors.example.json          ← placeholder-only upload CORS example
docs/
├── 00-INDEX.md                     ← you are here
├── 01-product/
│   └── planning-workflow-roadmap.md ← approved Course Planning vs Sessions workflow and ownership contract
├── SETUP.md                        ← local setup and authorized infrastructure-recovery guide
└── 02-domain/                      ← the domain model: what the business actually is
    ├── courses.md                  ← courses, programmes, modules, fees, durations
    ├── courses_catalog.csv         ← seed data: 142 original courses/modules
    ├── courses_fulltime_2026.csv   ← seed data: 35 full-time restructure courses
    ├── new_courses_2026H2.csv      ← seed data: 9 H2 ASK courses + 3 operational entries
    ├── course_aliases_ft_2026.csv  ← seed data: 60 full-time TMS code aliases
    ├── obsolete_programmes_2026.csv← supersession map for 6 obsolete programmes
    ├── planning-rules.md           ← planning rulebook: cadence, capacity, exemptions, FT history usage
    ├── course_planning_profiles.csv← planning profiles: cadence, confirm rates, gap stats by course × venue
    ├── course_monthly_profiles.csv ← monthly planning profiles: seasonality, strong/weak months by course × venue
    ├── ft_history_mapping.csv      ← maps new FT courses to historical planning-profile proxies
    ├── trainers.md                 ← trainer roster, skills, SME, exclusions
    ├── trainers.csv                ← seed data: 113 trainers
    ├── trainers_new_2026.csv       ← seed data: 2 new in-house trainers
    ├── trainer_aliases_2026aug.csv ← seed data: 6 August schedule-name aliases
    ├── trainer_courses.csv         ← seed data: 929 trainer→course skill links
    ├── venues-rooms.md             ← venues and rooms model
    ├── venues.csv                  ← seed data: 9 venues
    ├── rooms.csv                   ← seed data: 15 rooms
    ├── trainer-rates.md            ← pricing model, tiers, viability badges, session economics
    ├── programme_categories.csv    ← seed data: 5 pricing categories
    ├── trainer_rate_tiers.csv      ← NOT in repo — schema only; real rates live in the protected production database, outside GitHub
    └── trainer_tier_assignments.csv← seed data: which trainer is in which tier
```

## Reading order for a new agent

1. **`../AGENTS.md`** — the project brief
2. **`../WORKFLOW_HARNESS.md`** — mandatory delivery gates
3. **The applicable rolebook** — `../SOL_RULES.md`, `../LUNA_RULES.md`, or `../TERRA_RULES.md`
4. **This index**
5. The specific domain doc for the work

## Which doc to read for which task

| If you are working on... | Read these |
|---|---|
| Delivery workflow, review, acceptance, merge, or deployment | `../WORKFLOW_HARNESS.md` and the applicable rolebooks |
| Infrastructure recovery, cost controls, GCS lifecycle, or CORS | `SETUP.md`, `../infra/cost-guardrails.json`, `../infra/gcs-lifecycle.json`, `../infra/gcs-cors.example.json` |
| Course Planning / Sessions workflow, Excel/app/TMS ownership, Admin Area decisions, PR3E–PR3J scope | `01-product/planning-workflow-roadmap.md` |
| Database schema, seed data | All four domain `.md` files + every `.csv` |
| Parsing the master schedule Excel | `courses.md` (to match course codes), `trainers.md` (trainer name aliasing), `venues-rooms.md` (venue codes) |
| Sessions list / planning grid | `courses.md`, `venues-rooms.md` |
| Planning rules / cadence / capacity | `planning-rules.md`, `course_planning_profiles.csv`, `course_monthly_profiles.csv`, `ft_history_mapping.csv` |
| Trainer picker / assignment suggestions | `trainers.md` (skills, SME, exclusions), `trainer-rates.md` (tier/cost awareness) |
| Viability badges / revenue / breakeven | `trainer-rates.md` (the whole economics + badge model) |
| Room overview / capacity warnings | `venues-rooms.md` |
| AI assistant features | All domain docs — the assistant needs full context |

## The six domain entities (status)

| # | Entity | Docs | Status |
|---|---|---|---|
| 1 | Courses + programmes | `courses.md`, `courses_catalog.csv`, `courses_fulltime_2026.csv`, `new_courses_2026H2.csv`, `course_aliases_ft_2026.csv`, `obsolete_programmes_2026.csv` | Complete |
| 2 | Course rates | folded into courses (fee_with_gst column) | Complete |
| 3 | Trainers + skills + SME | `trainers.md`, `trainers.csv`, `trainers_new_2026.csv`, `trainer_courses.csv`, `trainer_aliases_2026aug.csv` | Complete |
| 4 | Trainer rates + tiers | `trainer-rates.md`, `programme_categories.csv`, `trainer_rate_tiers.csv`, `trainer_tier_assignments.csv` | Complete; actual rates live in the protected production database, outside GitHub |
| 5 | Venues + rooms | `venues-rooms.md`, `venues.csv`, `rooms.csv` | Complete |
| 6 | Training assistants | — | NOT yet modelled |

## Important cross-cutting facts

- **Codes use the company's internal vocabulary**, not SSG's official names. Active programme codes: `FTDM`, `FTIIO`, `DGAI`, and `ASK`; obsolete programme codes retained for historical sessions: `ACDM`, `DDM`, `SDDM`, `CIIO`, `ACIIO`, `DIIO`.
- **Course reference data currently totals 189 rows**: 142 original catalog rows, 35 full-time restructure rows, and 12 H2 rows. The active planning set is 147 rows because obsolete-programme courses are excluded from new planning flows.
- **All fees include 9% GST.** No funding/subsidy math in this tool — that's TMS's job.
- **No SSG/TGS codes stored.** Those are TMS data, not planning data.
- **Sessions are dynamic** (from Excel upload); **catalog is static** (rarely changes). The catalog must be solid so the parser has something reliable to match against.
- **Trainer fees are sensitive.** The repo has the rate *model* and *tier groupings*; the actual dollar rates live only in the protected production database, outside GitHub, and are surfaced to users only as viability badges (except for finance/admin roles).

## Known gaps / to-do (documented in the domain files)

- PR3 polish: surface API authentication/authorization failures in the UI (for example, "Your account isn't authorised — contact admin") instead of reporting them only in the browser console.
- 10 catalog courses have no trainer assignments yet (4 capstones + 2 new AI courses + 4 name-variant mismatches) — see `trainers.md`.
- Trainer name aliasing needed: the rate Excel uses short names ("Winnie", "Philip") that differ from the roster ("Winnie Liu", "Philip Gan") — see `trainer-rates.md`. A `trainer_aliases` table is the planned fix.
- 11 JTC rooms have no capacity captured yet — see `venues-rooms.md`.
- Leadership / personal-development courses (~50 ASK courses) have no tier-based rates in the fee sheet — see `trainer-rates.md` open questions.
- Training Assistants entity (#6) not yet modelled.
