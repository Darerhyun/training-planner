# Class Planning Rules & Logic

> Derived from 18 months of operational history (Jan 2025 – May 2026, 4,556 scheduled classes) plus planner-stated rules. This is the rulebook the planning engine and AI assistant must follow. Companion data: `course_planning_profiles.csv` (371 course × venue profiles with cadence, confirm rates, and gap statistics).

## Core concept: the overplanning funnel

ASK deliberately schedules MORE classes than will run. Historical confirm rate is ~68% (2025) — roughly 1 in 3 planned classes cancels for lack of learners. This is intentional pipeline-filling: advertise wide, let demand decide, cancel what doesn't fill.

```
PLAN (overbook intentionally)  →  advertise widely
CONFIRM (enough learners)      →  ~55–75% survive, varies by course
CANCEL (not enough interest)   →  the rest die off naturally
DELIVER                        →  confirmed classes must fit physical slots
```

Planning limits are therefore TWO-STAGE:
- **Planning stage:** slot limits are soft — overplanning is allowed and expected. Show the ratio, warn only at extremes.
- **Confirmation stage:** slot limits are HARD. A day cannot have more confirmed classes than the venue can physically host.

## Rule table

| ID | Rule | Stage | Type |
|---|---|---|---|
| R1 | Same course must NOT run at IP and JTC on the same day | Plan + Confirm | **Hard** (4 historical violations were predecessor mistakes — this system exists to prevent them) |
| R2 | Spacing between runs of the same course at the same venue: use `median_gap_days` from the course profile as the target spacing. CAUTION: `min_gap_days` = 1 in ~26 profiles is a parallel-intake artifact (two concurrent cohorts), NOT a safe floor — do not use min_gap as a rule threshold | Plan | Soft (warn) |
| R3a | Planned classes per day per venue: overplanning allowed; show ratio (e.g. "IP: 15 planned / 12 slots") | Plan | Soft |
| R3b | CONFIRMED classes per day: IP ≤ 12, JTC ≤ 5 | Confirm | **Hard** |
| R3c | Expected-confirmed load = Σ(planned × course confirm_rate). Warn when this approaches the slot limit | Plan | Soft (early warning) |
| R4 | One trainer, one session per day | Plan + Confirm | **Hard** |
| R5 | Full-time cohort modules run in template sequence, no overlap within a cohort | Plan | **Hard** |
| R6 | Venue-locked courses (drones → Lavender; hotel soft-skills → Hotel) | Plan | **Hard** |
| R7 | Per-course cadence targets come from `course_planning_profiles.csv` (`confirmed_per_month` per venue) | Plan | Soft target |
| R8 | Chronic cancellers (confirm rate < 50% over ≥6 runs) get reduced frequency or are flagged for removal | Plan | Soft (advisory) |
| R9 | INHOUSE venues (PKMS, MBS, client sites) are EXEMPT from all slot limits and planning rules — these are private corporate arrangements | All | Exemption |
| R10 | ASKMEN mentoring sessions DO consume a venue slot (they are real room-occupying sessions between SCTP/FT students) | Confirm | Counts toward R3b |
| R11 | HBL (virtual) sessions consume NO physical slot | All | Exemption from R3b |
| R12 | `SCTP-*` and `NS-*` rows are programme ENROLMENT records (spans of 9–37 days), not physical classes — EXCLUDE them from slot-load counting (R3a/R3b/R3c) and from the capacity view. They remain visible in the schedule as enrolment context | All | **Hard** (data classification) |

## Venue model for planning

| Venue | Daily confirmed-class slots | Planning rules apply? |
|---|---|---|
| IP (International Plaza, all levels incl. IP34) | **12** | Yes |
| JTC (JTC Summit) | **5** | Yes |
| HOTEL (Furama / Holiday Inn / Scotts etc.) | ad-hoc booking, no fixed slot count (historical peak: 3 concurrent) | R1-style same-day logic no; capacity managed by booking |
| HBL (virtual / Zoom) | unlimited | No physical constraints |
| INHOUSE (PKMS, MBS, client premises) | n/a — private arrangements | **No rules apply (R9)** |

Room names repeat across venues (both IP and JTC have rooms named Knowledge, Quality, Habits/Habit, Experience). Venue prefix disambiguates: `JTCKnowledge` = JTC's Knowledge room; plain `IP`/`IP34` tracks are International Plaza. Room-level capacity is NOT a planning concern in v1 — only the per-venue slot count matters.

## Course funding-variant aliasing for planning

SCTP and Non-SCTP variants of the same module (e.g. `IIOC-CE` and `NIIOC-CE`) are the SAME course content for planning purposes — canonicalise N-prefixed IIO codes when computing cadence and applying R1/R2:
- `NIIOC-*` ≡ `IIOC-*`, `NACIIO-*` ≡ `ACIIO-*`, `NDIIO-*` ≡ `DIIO-*`

Both variants still appear separately in the schedule (different funding pathways run in parallel — H1 2026 ran ~139 IIOC + ~154 NIIOC classes), but the gap/same-day rules treat them as one course family.

## Key historical facts the planner should know

1. **Confirm rates by course vary hugely** — from 98% (ASKMEN, ASKCAP capstones) down to 0% (ASKMAA, ASKEDP: scheduled repeatedly, never ran). Use per-course rates from the profiles file, never a global average.
2. **December is the STRONGEST month** (81% confirm in 2025) — year-end SkillsFuture credit rush. ASQMEI hit 13 confirmed in Dec 2025, ASKGAI hit 14. Load Excel-WSQ and GenAI courses heavily in Nov–Dec.
3. **January–February are the weakest** (~54–60%) — CNY period. Plan lighter or expect higher cancellation.
4. **Growth-trend courses** (cadence should follow recent months, not the 18-month average): ASQMEI, ASKGAI (GenAI for DM) — both roughly tripled over 2025.
5. **Chronic cancellers (candidates to cut)**: ASKMAA (0/7), ASKEDP (0/6), ASKGEC (17%), ASKCL7 (18%), ASKBRT (20%), ASKDR8 (25%), ASK7VB (25%), all SDDM modules (33–43% — the reason SDDM was retired in the FT restructure).
6. **August 2025 IIO collapse** — nearly every CIIO module failed in Aug 2025 (e.g. IIOC-IIT 1 confirmed / 5 cancelled). Cause unknown; treat as anomaly, not seasonality, unless it repeats.
7. **2026 confirm rates are running lower** (~52–60% Jan–May 2026 vs 59–75% same months 2025). Either overplanning has increased or demand softened — planner should watch this trend.
8. **ACDM/DDM (now FTDM) demand curve**: strongest Feb–May, softer Jun–Oct, steady year-end close. Use this shape for FTDM intake frequency until FTDM builds its own history.

## Applying history to the new FT courses

The profiles use historical codes (ACDM-DME, IIOC-CE, ASKGAI…). New planning uses FT codes (FTDM-DME, FTIIO-CE, …). `ft_history_mapping.csv` maps each FT course to the historical code whose planning profile applies (demand proxy). FT courses with no mapping (FTDM-VM, DGAI-SM, DGAI-INV, DGAI-OPS, DGAI-CAP) have no history — plan by template + planner judgment.

## Full-time programmes (no history — template planning)

FTDM (~36 teaching days/cohort ≈ 7 weeks), FTIIO (~47.5 days ≈ 9.5 weeks), DGAI (~21 days ≈ 4 weeks) are planned via **intake templates**: pick a start date + venue → the system generates the full module chain in sequence (R5), each module a draft session. The old ACDM/DDM/IIOC history is the best demand proxy until FT history accumulates.

A running FT cohort consumes 1 venue slot on each of its teaching days — this continuous consumption must be visible in the capacity view.

## What the planning engine builds (feature spec summary)

1. **Course planning profiles** loaded from `course_planning_profiles.csv` — cadence targets, confirm rates, gap stats per course × venue.
2. **Rhythm generator** — pre-generates draft sessions for recurring courses per their cadence, 2–3 months ahead.
3. **Intake template generator** — one-click FT cohort chain placement.
4. **Capacity view** — day grid per venue: `confirmed/slots` hard number + `planned` overlay + expected-confirmed load (R3c).
5. **Conflict radar** — one list of all R1/R3b/R4/R5 violations in the current plan.
6. **Viability gate** — per-draft badge using course confirm_rate + breakeven (existing badge system).
7. **Confirmation gate** — enforces R3b when Ops confirms a class; blocks the 13th IP / 6th JTC confirmation on a day with bump-or-move options.
