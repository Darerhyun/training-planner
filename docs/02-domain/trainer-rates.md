# Trainer Rates & Session Economics

> Source: `Trainer_Fee.xlsx` (3 sheets: IIO, DM, IT). Compiled June 2026. **Real fee numbers are NOT in this repo.** Only the data model, tier groupings, and calculation rules.

## Why this entity is structured the way it is

Trainer pay is sensitive — actual dollar rates are not stored in the public repo or the markdown knowledge base. They live only in the `trainer_rate_tiers` table in Neon, which Owen populates directly.

What IS in the repo:
- The **data model** — what tables exist, what columns they have, how they relate
- The **tier groupings** — which trainers belong to which tier within each programme category (groupings reveal seniority structure, not individual dollar amounts)
- The **calculation rules** — how revenue, cost, margin, and breakeven are computed
- The **UI display rules** — how the website translates sensitive numbers into colour-coded badges

## Three key insights from the source data

These shape the entire model. Each was non-obvious before reading the Excel.

### Insight 1 — A trainer can have DIFFERENT rates per programme category

Same person, different rates depending on what they're teaching:

- **Frank Ho** charges different rates for IIO vs DM sessions
- **Philip** has separate rates for IIO, IT-Normal, IT-WSQ
- **Winnie** has separate rates for IT-Normal, IT-WSQ, IT-Special
- **Victor** appears in both IT-Normal and IT-WSQ at different rates
- **Richard Tin** appears in both IT-Normal and IT-WSQ

This is why the rate model is keyed on **(trainer × programme_category)**, not just trainer.

### Insight 2 — The IT category splits into three sub-bands

Microsoft and ASK IT courses don't all pay the same. Three sub-categories:

| Sub-category | Applies to | Example courses |
|---|---|---|
| `IT-Normal` | ASK-prefixed Microsoft Office (non-WSQ) | ASKMEB, ASKMEI, ASKMPA, ASKMWA, etc. |
| `IT-WSQ` | WSQ-funded Microsoft Office | ASQMEE, ASQMEI, ASQMEM, ASNMEA |
| `IT-Special` | Premium IT courses | ASKEDP, ASKPQ8, ASK7VB, ASKBB8, etc. (Power Query, Pivot, DAX, VBA, Big Data) |

When a session is created, the system must map its course to the correct sub-category to pick the right rate.

### Insight 3 — Rates step up across pax bands

Trainer fees aren't flat per day — they scale with class size. The Excel uses these bands:

| Pax band | Examples |
|---|---|
| 3-4 | Smallest viable class |
| 5-9 | Standard small class |
| 10-14 | Standard mid class |
| 15-19 | Large class |
| 20 | Maximum standard class |

Within each band, the rate is constant. The exact rate per band differs by tier.

## Data model

### Table 1 — `programme_categories` (5 rows, safe for repo)

```
category_code     IIO | DM | IT-Normal | IT-WSQ | IT-Special
description       Human-readable label
applies_to        Which programmes/course codes this category covers
```

File: [programme_categories.csv](./programme_categories.csv)

### Table 2 — `trainer_rate_tiers` (45 tiers, SCHEMA ONLY in repo)

```
tier_code              e.g. IIO-T1, DM-T7, IT-Normal-T3
programme_category     FK to programme_categories
description            e.g. "Mid-tier IIO trainer, 2 trainers in this band"
pax_3 .. pax_20        Daily rate (incl. GST) at each pax band
```

The repo contains [trainer_rate_tiers_TEMPLATE.csv](./trainer_rate_tiers_TEMPLATE.csv) — a schema-only version with all 45 tier rows but **no rate values**. Real rates are entered directly into Neon by Owen, never committed.

### Table 3 — `trainer_tier_assignments` (safe for repo)

```
trainer_id              FK to trainers
trainer_name            Cached display name
programme_category      FK to programme_categories
tier_code               FK to trainer_rate_tiers
```

File: [trainer_tier_assignments.csv](./trainer_tier_assignments.csv) — contains all assignments. Knowing that Philip is in tier IIO-T9 tells you his seniority level relative to other IIO trainers, but not his actual dollar rate.

A trainer can have multiple rows here — one per programme category they're qualified for. Frank Ho has 2 rows (IIO + DM). Philip has 3 (IIO + IT-Normal + IT-WSQ).

### Table 4 — `session_economics` (computed view, never exposes rates to non-admin)

This isn't a stored table — it's a view computed at query time per session:

```
session_id
revenue_with_gst       course.fee_with_gst × confirmed_pax (or realistic_pax)
trainer_fee_with_gst   from trainer_rate_tiers lookup (admin/finance only)
gross_margin           revenue - trainer_fee (admin/finance only)
margin_per_pax         gross_margin / pax (admin/finance only)
breakeven_pax          ceiling(trainer_fee / per_pax_revenue) — visible to all
viability_status       Strong | Healthy | Marginal | At Loss | TBD — visible to all
```

The view enforces row-level filtering: ops users get pax/badge columns, admin/finance get full numbers.

## Tier overview (groupings, not rates)

### IIO — 15 tiers across 19 trainers

| Tier | Trainer count | Trainers |
|---|---|---|
| IIO-T1 | 2 | Alan Fu, Jennifer Zhou |
| IIO-T2 | 1 | Gavin Chia |
| IIO-T3 | 1 | Weng Kam |
| IIO-T4 | 2 | Danny Soh, Johnson Yeo |
| IIO-T5 | 3 | Ken Goh, Nan Heng, Alex Yap |
| IIO-T6 | 1 | Say Toon |
| IIO-T7 | 1 | Rajpal |
| IIO-T8 | 1 | William Ho |
| IIO-T9 | 1 | Philip |
| IIO-T10 | 1 | Sarbojit |
| IIO-T11 | 1 | Frank Ho |
| IIO-T12 | 1 | Kelvin Lim |
| IIO-T13 | 1 | HK Fung |
| IIO-T14 | 1 | S A Lim |
| IIO-T15 | 1 | Kelvin Wu |

T1 is the lowest tier, T15 the highest. Higher tier = higher rate.

### DM — 17 tiers across 34 trainers

| Tier | Trainer count | Trainers |
|---|---|---|
| DM-T1 | 1 | Abby |
| DM-T2 | 4 | Deleon Lim, Foo Nyuk Wei, Lim Hui Ling, Marcus Chiam |
| DM-T3 | 1 | Jeffrey Loo |
| DM-T4 | 3 | Victor Pow, Allen Wong, Norman Lau |
| DM-T5 | 4 | Abelene Hu, Kala Rani, Klenton Foo, Martin Li |
| DM-T6 | 4 | Eric Heng, Kevin Chua, Lance Paul, Lim Jia He |
| DM-T7 | 1 | Rodney |
| DM-T8 | 1 | Raymond Teoh |
| DM-T9 | 1 | Elaine Teo |
| DM-T10 | 6 | Benjamin Song, David Boh, David Fong, Jocelyn Goh, Timothy Ng, Tylus Lim |
| DM-T11 | 1 | Frank Ho |
| DM-T12 | 1 | Melvyn |
| DM-T13 | 1 | Paul Lim |
| DM-T14 | 1 | Richard Wong |
| DM-T15 | 1 | Richard Ng |
| DM-T16 | 1 | David Chan |
| DM-T17 | 2 | Elizebath, Koh YS |

### IT-Normal — 5 tiers across 9 trainer entries

| Tier | Trainer count | Trainers |
|---|---|---|
| IT-Normal-T1 | 1 | Victor |
| IT-Normal-T2 | 1 | Richard Tin |
| IT-Normal-T3 | 4 | Winnie, Philip, Priscilla, Pauline |
| IT-Normal-T4 | 2 | Sherie Poh, Valene |
| IT-Normal-T5 | 1 | Stella |

### IT-WSQ — 5 tiers across 9 trainer entries

| Tier | Trainer count | Trainers |
|---|---|---|
| IT-WSQ-T1 | 1 | Felicia Lim |
| IT-WSQ-T2 | 1 | Victor |
| IT-WSQ-T3 | 2 | Kala, Richard Tin |
| IT-WSQ-T4 | 4 | Winnie, Philip, Priscilla, Pauline |
| IT-WSQ-T5 | 1 | Yan Xin |

### IT-Special — 3 tiers across 5 trainer entries

| Tier | Trainer count | Trainers |
|---|---|---|
| IT-Special-T1 | 3 | Winnie, Priscilla, Pauline |
| IT-Special-T2 | 1 | Valene |
| IT-Special-T3 | 1 | Stella |

## Revenue & cost calculation

### Revenue (always shown to all roles)

```
revenue = course.fee_with_gst × pax
```

Where `pax` depends on which view the user has selected (see below). Course fees include 9% GST per the earlier catalog decision.

### Trainer cost (admin/finance only)

```
1. Determine the session's programme_category from the course code:
   - Course code starts with CIIO/ACIIO/DIIO → IIO
   - Course code starts with ACDM/DDM/SDDM → DM
   - Course code starts with ASK + Microsoft Office family → IT-Normal
   - Course code matches ASQMEE/ASQMEI/ASQMEM/ASNMEA → IT-WSQ
   - Course code matches premium IT (ASKEDP/ASKPQ8/ASK7VB/ASKBB8/etc.) → IT-Special

2. Look up trainer's tier for that category in trainer_tier_assignments.
   If no row: trainer cannot teach this course (error).

3. Look up tier's daily rate for the appropriate pax band in trainer_rate_tiers.

4. Multiply by course.duration_days.
```

### Gross margin & per-pax margin (admin/finance only)

```
gross_margin    = revenue - trainer_cost
margin_per_pax  = gross_margin / pax
```

### Breakeven (visible to all)

```
revenue_per_pax = course.fee_with_gst
breakeven_pax   = ceil(trainer_cost / revenue_per_pax)
```

This is the pax count at which revenue exactly covers trainer cost. Shown as an integer to all users — no dollar amounts revealed.

There's an iterative wrinkle: trainer cost depends on the pax band, which depends on pax. The system computes breakeven by trying pax = 1, 2, 3... and finding the lowest count where revenue ≥ cost.

## Pax state model — handling absences

Owen's important point: confirmed pax ≠ pax who actually show up. The system tracks four pax fields:

| Field | When set | Used for |
|---|---|---|
| `expected_pax` | Initial planning estimate | Early viability check before registration opens |
| `confirmed_pax` | After registration closes | Optimistic viability calc |
| `realistic_pax` | Computed (see below) | **Default viability calc** |
| `actual_pax` | After session runs | Retrospective accuracy, improves attendance rate over time |

### Realistic pax computation

```
realistic_pax = round(confirmed_pax × historical_attendance_rate)
```

Default `historical_attendance_rate = 0.85` (15% no-show buffer). Configurable per:
- Global default (env var or admin setting)
- Per programme category (DM students may attend at different rates than IIO)
- Per cohort type (corporate-sponsored attendance > self-funded)

Over time, the system can compute actual attendance rates from `actual_pax / confirmed_pax` history and surface a "recommended rate" to the admin.

### Two views in the UI

The planner can toggle:

- **Confirmed view** — uses `confirmed_pax` (best case)
- **Realistic view** — uses `realistic_pax` (default, more honest)

Both views show the same badge logic, just with different inputs.

## Viability badge system (the UI layer)

The badge is the **ops-facing summary** of session economics. No dollar amounts. Just colour + short text.

### Five badge states

| Badge | Meaning | Rule |
|---|---|---|
| 🟢 **Strong** | Healthy profit, well above breakeven | `pax ≥ breakeven_pax + strong_buffer` AND `margin_per_pax ≥ strong_threshold` |
| 🟢 **Healthy** | Acceptable profit | `pax ≥ breakeven_pax + 2` (configurable) |
| 🟡 **Marginal** | Just covering costs | `pax ≥ breakeven_pax` but `pax < breakeven_pax + 2` |
| 🔴 **At Loss** | Running at a loss | `pax < breakeven_pax` |
| ⚪ **TBD** | Can't be computed | trainer not assigned, OR `confirmed_pax = 0`, OR course missing fee |

All thresholds (`strong_buffer`, `strong_threshold`, the "+2" healthy buffer) are configurable by admin. Defaults can be tuned after a few weeks of usage.

### What the planner sees on the grid

For each session, one badge + one short status line:

```
🟢 Strong — 7 confirmed, breakeven at 3 (need 3 more for next tier-up)
🟢 Healthy — 5 confirmed, breakeven at 3
🟡 Marginal — 4 confirmed, breakeven at 4 (at threshold)
🔴 At Loss — 2 confirmed, breakeven at 4 (need 2 more)
⚪ TBD — trainer not assigned
```

No dollar amounts. Pax numbers (`7`, `3`, `4`) are operationally meaningful and not sensitive.

### What admin / finance sees on click-through

A session detail drawer with full numbers:

```
Revenue (with GST):     $X,XXX
Trainer fee (with GST): $X,XXX
Gross margin:           $XXX
Margin per pax:         $XX
Breakeven pax:          3
```

Plus a tier indicator (e.g. "Trainer in DM-T10 tier") so finance can see the seniority context.

### Role-based access

| Role | Sees badge | Sees pax counts | Sees dollar amounts |
|---|---|---|---|
| `ops` | ✓ | ✓ | ✗ |
| `viewer` | ✓ | ✓ | ✗ |
| `finance` | ✓ | ✓ | ✓ |
| `admin` | ✓ | ✓ | ✓ |
| `pending` / `rejected` | ✗ | ✗ | ✗ |

Implemented via Postgres row-level security policies + API-layer field filtering. Roles are stored on the `users.role` enum (existing in the schema).

## Programme category resolution rules

The website needs to map each course code to its programme category. Logic:

```python
def get_category(course_code: str, programme_code: str | None) -> str:
    # 1. Programme-based categories
    if programme_code in ("CIIO", "ACIIO", "DIIO"):
        return "IIO"
    if programme_code in ("ACDM", "DDM", "SDDM"):
        return "DM"

    # 2. WSQ Excel standalone courses
    if course_code in ("ASQMEE", "ASQMEI", "ASQMEM", "ASNMEA"):
        return "IT-WSQ"

    # 3. Premium IT courses (manually maintained list)
    PREMIUM_IT_CODES = {
        "ASKEDP",   # Excel Dynamic Power Query + DAX
        "ASKPQ8",   # Excel Power Query / Data Model / Power Pivot / DAX
        "ASK7VB",   # VBA Fundamental
        "ASKBB8",   # Bridging Big Data Analytics
        "ASKDR8",   # Dashboard Reporting
        "ASKFF8",   # Advanced Formulas and Functions
        # ... add others as you confirm them
    }
    if course_code in PREMIUM_IT_CODES:
        return "IT-Special"

    # 4. ASK Microsoft Office family
    if course_code.startswith("ASKM") or course_code in ("ASKEP8", "ASKTH8", "ASKCP8", "ASKGV7"):
        return "IT-Normal"

    # 5. Everything else (leadership, personal dev, etc.) — these don't have
    # tier-based pricing in the Excel. Likely a separate flat-rate model.
    return None  # No category assigned; needs admin attention
```

**This list is a starting point and needs Owen's verification.** Some courses may belong to a different category than the heuristic suggests.

## Open questions / known gaps

1. **Courses not covered by any tier** — the Excel has rates for IIO, DM, and IT trainers only. The ASK leadership/personal development courses (Three Kingdoms, Brainpower, Personal Resilience etc.) are not in this rate sheet. How are their trainers paid? Flat rate? Different sheet? Need data.

2. **Name aliasing** — the rate Excel uses short names that don't always match the trainer roster:

   | Rate Excel name | Trainer roster name |
   |---|---|
   | Allen | Allen Wong |
   | Winnie | Winnie Liu |
   | Philip | Philip Gan |
   | Victor | Victor Pow |
   | Kala | Kala Rani |
   | Frank Ho | (appears in IIO + DM with different rates — same person) |

   The `trainer_tier_assignments.csv` uses the short forms as they appeared in the rate Excel. When mapping to the trainer roster, the system needs an aliasing layer. To be added in a `trainer_aliases` table.

3. **45 tiers is a lot.** Possible to consolidate:
   - Option A — Keep all 45 (faithful to the data, but lots of rows to maintain)
   - Option B — Round down to ~3-5 named tiers per category (Junior / Mid / Senior / Premium), losing fine-grained accuracy
   - Option C — Keep 45 in the table but UI labels them as broader bands (T1-T3 = Junior, T4-T8 = Mid, T9-T13 = Senior, T14+ = Premium) — gets best of both

   Recommend C for the UI, but the underlying table stays at 45 for accuracy.

4. **Trainers in roster but missing from rate sheet.** The trainer roster has 113 active trainers. The rate sheet has rates for about 60-65 distinct people across all categories. The rest may be:
   - Inactive at this rate sheet date
   - On flat ad-hoc rates (not tiered)
   - Trainers for courses outside IIO/DM/IT (leadership, personal dev)

   The website needs to handle "trainer has no tier assignment for this category" gracefully — probably by surfacing "rate not configured" as a TBD badge.

## Files in the repo

| File | Contents | Sensitive? |
|---|---|---|
| `programme_categories.csv` | 5 category definitions | No |
| `trainer_rate_tiers_TEMPLATE.csv` | Schema with 45 empty tier rows | No (no rates) |
| `trainer_tier_assignments.csv` | Trainer → tier groupings | Low (reveals seniority structure only) |
| `trainer_rates.md` (this doc) | Knowledge doc + calculation rules | No |

What's NOT in the repo:
- `trainer_rate_tiers.csv` with real rates — lives only in Neon
- `session_economics` view — defined in SQL, runs only against Neon

## What this entity enables for the website

Once these tables exist + the rates are populated in Neon:

1. **Per-session viability badge** on the planning grid
2. **Breakeven pax indicator** for "do we need more registrations"
3. **Realistic vs Confirmed view toggle** for honest planning
4. **Trainer suggestion ranking** that considers cost — when picking between qualified trainers, prefer ones whose tier produces better margin (configurable: prefer cheaper OR prefer SME)
5. **Monthly margin reports** for finance — aggregated, never exposing per-session detail to non-finance
6. **Capacity planning** — "if we run 10 sessions of ACDM-DMA this month with current trainer mix, projected margin is $X"
