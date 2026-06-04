# Trainer Database

> Source: `Trainer_Courses.xlsx` (113 trainers × 153 courses matrix). Cross-mapped against `courses_catalog.csv`. Compiled June 2026.

## What this catalog contains

Two related files:

- **`trainers.csv`** — the trainer roster (113 trainers). Each row is one trainer with their active status and any course exclusions.
- **`trainer_courses.csv`** — the skill matrix (929 rows). Each row is one (trainer, course) pair indicating the trainer can teach that course, plus whether they're SME.

These two tables together answer "who can teach what" for any session in the planner.

## Trainer roster

113 trainers total:

- **112 active** — at least one course they can teach
- **1 inactive** — Sam (no courses assigned + had an exclusion against Video Editing)

Sam's case is an example of someone in the system but not currently teaching. Use `is_active = false` to keep them in the system (for audit/history) but exclude from the assignment engine.

### Top trainers by breadth (most courses they can teach)

| Trainer | Courses |
|---|---|
| Sandra | 22 |
| Winnie Liu | 22 |
| S A Lim | 19 |
| Say Toon | 19 |
| Kala Rani, Kelvin Wu, Richard Tin, Richard Wong, Stella | 18 each |

### Top SMEs (Subject Matter Experts)

| Trainer | SME for |
|---|---|
| Dr Lee | 5 courses |
| James Suresh | 5 courses |
| Sandra | 5 courses |
| Say Toon | 5 courses |
| Daryl Lim, Philip Gan, Rodney | 4 courses each |

SME flagging means the trainer is the **canonical expert** for the course. The scheduling engine should boost SME trainers when ranking candidates (`+20` to score per earlier decision).

## Course exclusions

Two trainers have explicit `Do Not Assign` markers in the source Excel:

- **Norman** → excluded from `ASKDBI` (AI-Driven Business Intelligence)
- **Sam** → excluded from `ASKVEG` (Video Editing) [Sam is also inactive overall]

Stored as a `module_excludes` array on the trainer row, holding course codes. Empty for everyone else.

**Note on Norman's exclusion:** the source Excel says "WSQ AI-Driven Business Intelligence" specifically. WSQ is a funding label, not a different course. Per planner direction: WSQ doesn't matter, the course content is the same. Norman is excluded from `ASKDBI` regardless of funding type. If the underlying reason is "Norman is not WSQ-accredited," that would need separate modelling — not done in v1.

## Course coverage

**132 of 142** catalog courses have at least one trainer who can teach them.

**10 catalog courses have NO eligible trainers yet:**

| Code | Name | Why no trainer? |
|---|---|---|
| `DDM-CAP` | Capstone Project (Digital Marketing Campaign) | Capstones often have dedicated trainers not in the general matrix |
| `SDDM-CAP` | Capstone Project (Digital Marketing Strategic Plan) | Same |
| `ACIIO-AM7` | AM7 Capstone Project: Real-world IT Project | Same |
| `DIIO-DM8` | DM8 Capstone Project: Audit or Design IT Infrastructure | Same |
| `ASKPSP` | AI-Powered Storytelling for Presentation | NEW course (post-matrix update) |
| `ASKBCG` | Beyond ChatGPT: The Ultimate GenAI Toolkit | NEW course (post-matrix update) |
| `ASKCTH` | Critical Thinking for Effective Problem Solving | Trainer matrix has different "Critical Thinking" variants |
| `ASKRTW` | Business Report and Technical Writing Skills | Excel matrix only has WSQ version (`ASKBRT`) |
| `ASKEMS` | Business Writing Essentials | Excel matrix only has WSQ version (`ASKBWE`) |
| `ASKDFA` | Design Fundamentals with Adobe Photoshop | Excel matrix has only "Photoshop CC" variant (Bucket 2) |

When a session for one of these courses is scheduled, the planner will see "no eligible trainers" — that's the cue to either add trainer eligibility to the matrix or assign someone manually.

## Bucket 2 — courses skipped during import

23 trainer skill assignments referenced courses that are not in the catalog. Per planner direction, these are **silently skipped** during import. They'll surface as alerts only when the Excel session parser encounters them. The skipped courses:

- Better Spoken English for Div 2 and 3 Officers
- Critical Thinking (1-Day)
- Critical Thinking for Division 2 & 3 Officers
- Delivering Constructive Feedback Effectively
- Effective Writing Skills
- Email Writing at Workplace
- Grammar for Effective Business Communication
- Mastering ChatGPT for Strategic Communication
- People Management (2-Day)
- Photoshop CC - Basic to Intermediate
- Presentation Skills (2-day)
- Report Writing
- Supervisory Skills for a New Era
- Team Effectiveness (2-day)
- The Art of Conversation Mastery
- Video Marketing
- Video Production
- Write Minutes of Meeting

If any of these later appear in the schedule Excel, the parser logs an alert and the AI assistant can be asked to either map them to existing courses or add them as new courses.

## File schemas

### `trainers.csv`

```
trainer_id          — primary key, slug form (e.g. "deleon-lim", "winnie-liu")
name                — display name (e.g. "Deleon Lim", "Winnie Liu")
is_active           — true/false
module_excludes     — pipe-separated course codes (e.g. "ASKDBI" or "ASKDBI|ASKVEG")
notes               — free text, currently empty
```

Future extensions (when needed): `tier`, `weekday_only`, `weekend_only`, `allowed_dow`, `unavailability` (will be a separate table).

### `trainer_courses.csv`

```
trainer_id    — FK to trainers
course_code   — FK to courses
is_sme        — true/false (true = subject matter expert)
notes         — free text, currently empty
```

The primary key is `(trainer_id, course_code)`. No row means "this trainer cannot teach this course."

## Trainer name conventions

Names in the source Excel use a mix of full names ("Deleon Lim", "Winnie Liu") and first-name-only entries ("Allen", "Angela", "Audrey", "Sam"). Slug IDs are generated from whatever name appears.

This means some trainer_id values are sparse — `allen` rather than `allen-wong`. If you later want to standardise to full names, two options:

1. **Update names in the database** — change `name = 'Allen'` to `name = 'Allen Wong'` and update `trainer_id = 'allen-wong'`. Requires cascading FK updates.
2. **Add alt_names array** — keep `trainer_id = 'allen'` but add `alt_names = ['Allen Wong']` so the Excel session parser can match either form.

Recommendation: option 2, when you get around to it. Easier to maintain.

## Notes from the import

- `Victor Pow` had a double-space in the Excel ("Victor  Pow") — collapsed to single space.
- `Koh YS` had a constraint embedded in the cell ("Koh YS\nNo TNC") — only the name was kept; the "No TNC" constraint isn't modelled yet. If "No TNC" matters operationally (cannot teach for TNC client), it'll need a separate field.
- `Elizabath` is spelled with "a" not "e" in the source Excel — preserved as-is.

## Trainer rates (next entity, #4)

Trainer fees are NOT in this dataset. They'll be modelled separately in `trainer_rates` table — pax-band rates per trainer, possibly tiered. Sensitive data; will be stored in DB only, not committed to repo.

## Counts summary

- Trainers: 113 (112 active, 1 inactive)
- Trainer-course skill links: 929
- SME flags: 59
- Course exclusions: 2 (Norman, Sam)
- Catalog coverage: 132/142 (93%)
- Bucket 2 skipped courses: 19 (counting from matrix unique courses)
- Bucket 2 skipped skill assignments: 23 (counting per-trainer mentions)
