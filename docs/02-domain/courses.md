# Courses & Modules Catalog

> Source: ASK Training Calendar 2026 PDFs plus full-time restructure files. Compiled June 2026; refreshed July 2026. Uses company internal terminology.

## How to read this catalog

Every product the company schedules is either:

- A **course** that stands on its own (most of the ASK-prefixed offerings), OR
- A **module** that is part of a structured **programme** (active: FTDM, FTIIO, DGAI; historical: ACDM, DDM, SDDM, CIIO, ACIIO, DIIO)

Students enrol per session. A session is one delivery of one course/module on specific dates at a specific venue. Sessions are what gets planned — courses/modules are the catalog.

## Current programmes

| Code | Internal Name | Modules |
|---|---|---|
| `FTDM` | Full-Time Diploma in Digital Marketing | 14 modules |
| `FTIIO` | Full-Time Advanced Certificate in IT Infrastructure & Operations | 14 modules |
| `DGAI` | Diploma in Generative AI | 7 modules |
| `ASK` | ASK Training (in-house non-funded line) | 84 courses, no sub-structure |

The ASK programme is the umbrella for the company's commercial, non-SSG-funded offerings. Some WSQ/SSG-funded courses are standalone (not part of any multi-module programme) and have `programme_code = ""` (blank).

## Catalogue history

The July 2026 full-time restructure added 35 new full-time courses in `courses_fulltime_2026.csv`: 14 FTDM, 14 FTIIO, and 7 DGAI. The original catalog remains in `courses_catalog.csv` because historical sessions still reference those course codes.

ACDM, DDM, and SDDM are obsolete and superseded by FTDM. CIIO, ACIIO, and DIIO are obsolete and superseded by FTIIO. The supersession mapping is stored in `obsolete_programmes_2026.csv` and seeded into the `programmes` table.

## Code conventions

For programme modules: `{PROGRAMME}-{MODULE}`. Examples:
- `FTDM-DME` = Digital Marketing Essentials module of FTDM
- `FTIIO-M1` = Introduction to Information Technology module of FTIIO
- `DGAI-AI` = Artificial Intelligence Essentials module of DGAI
- `ACDM-DMA` = historical Digital Marketing Analytics module of ACDM
- `CIIO-M1` = historical Module 1 of CIIO

For ASK courses: `ASK` + 3-letter abbreviation (e.g. `ASKMEI` = Microsoft Excel Intermediate).

Programme codes are derivable from the course code prefix during import. The Excel parser uses this rule:
- Prefix matches a known programme followed by `-` → that programme
- Prefix `ASK` followed by anything → `ASK` programme
- Any other prefix → standalone (no programme)

## Active full-time programme modules

The authoritative active full-time course rows live in `courses_fulltime_2026.csv`. Use that CSV for parser matching and seed data for FTDM, FTIIO, and DGAI.

## Superseded programme modules

The sections below document historical programme modules retained for legacy sessions. They are not part of the active planning set.

### ACDM — Advanced Certificate in Digital Marketing (superseded by FTDM)
1. `ACDM-DME` — Digital Marketing Essentials (1 day)
2. `ACDM-DA` — Digital Advertising (2 days)
3. `ACDM-SMM` — Social Media Marketing (2 days)
4. `ACDM-SEO` — Search Engine Optimisation (2 days)
5. `ACDM-DMA` — Digital Marketing Analytics (Google Analytics) (2 days)

### DDM — Diploma in Digital Marketing (superseded by FTDM)
1. `DDM-WWC` — WordPress Website Creation (2 days)
2. `DDM-DCC` — Digital Content Creation (2 days)
3. `DDM-CCW` — Copywriting & Content Writing (2 days)
4. `DDM-GA` — Google Ads (2 days)
5. `DDM-FB` — Facebook & Instagram Marketing (2 days)
6. `DDM-WCO` — Website & Landing Page Conversion Optimisation (2 days)
7. `DDM-CAP` — Capstone: Digital Marketing Campaign (1 day, capstone)

### SDDM — Specialist Diploma in Digital Marketing (superseded by FTDM)
1. `SDDM-ADMS` — Advanced Digital Marketing Strategy (2 days)
2. `SDDM-ADA` — Advanced Digital Advertising (2 days)
3. `SDDM-ASMM` — Advanced Social Media Management (2 days)
4. `SDDM-ADCM` — Advanced Digital Content Marketing (2 days)
5. `SDDM-ASEO` — Advanced Search Engine Optimisation (2 days)
6. `SDDM-ADMA` — Advanced Digital Marketing Analytics (Google Analytics) (2 days)
7. `SDDM-EM` — Email Marketing (2 days)
8. `SDDM-CAP` — Capstone: Digital Marketing Strategic Plan (1 day, capstone)

### CIIO — Certificate in Infocomm Technology Infrastructure & Operations (superseded by FTIIO)
1. `CIIO-M1` — Introduction to Information Technology (IT) (1 day)
2. `CIIO-M2` — Understanding Computer Hardware & Peripherals (2 days)
3. `CIIO-M3` — Operating Systems and Desktop Support (2 days)
4. `CIIO-M4` — Network Fundamentals and Troubleshooting (3 days)
5. `CIIO-M5` — Cybersecurity Essentials (3 days)
6. `CIIO-M6` — IT Troubleshooting and Problem Solving (1 day)
7. `CIIO-M7` — IT Service Management and Help Desk Operations (2 days)

### ACIIO — Advanced Certificate in IT Infrastructure and Operations (superseded by FTIIO)
1. `ACIIO-AM1` — Advanced Hardware and Software Troubleshooting (4 days)
2. `ACIIO-AM2` — Advanced Network Administration (6 days)
3. `ACIIO-AM3` — Systems and Server Administration (6 days)
4. `ACIIO-AM4` — Cloud Computing (5 days)
5. `ACIIO-AM5` — Cybersecurity and Ethical Hacking (4 days)
6. `ACIIO-AM6` — Emerging Technologies and Trends (2 days)
7. `ACIIO-AM7` — Capstone: Real-world IT Project (2.5 days, capstone)

### DIIO — Diploma in Infocomm Technology Infrastructure & Operations (superseded by FTIIO)
1. `DIIO-DM1` — IT Infrastructure and Operations (4 days)
2. `DIIO-DM2` — Enterprise Architecture and Design (5 days)
3. `DIIO-DM3` — IT Infrastructure Planning and Optimisation (5 days)
4. `DIIO-DM4` — IT Disaster Recovery and Business Continuity (2 days)
5. `DIIO-DM5` — Advanced IT Security and Cybersecurity (5 days)
6. `DIIO-DM6` — IT Project Management (2 days)
7. `DIIO-DM7` — IT Infrastructure Automation and Orchestration (4 days)
8. `DIIO-DM8` — Capstone: Audit or Design IT Infrastructure (3 days, capstone)

## ASK programme — non-funded standalone courses

84 courses sold commercially. Informally grouped into categories (for trainer skill mapping, not for course classification):

- Microsoft Excel (11)
- Microsoft Office: Access, Outlook, PowerPoint, Word (10)
- AI / Generative AI (2)
- Media Production & IT (3)
- Leadership & Management: Three Kingdoms (3)
- Leadership & Management: Team Building & Motivation (7)
- Leadership & Management: Communication & Management (11)
- Leadership & Management: Problem Solving (7)
- Leadership & Management: Presentation Skills (6)
- Personal Development: Skills (9)
- Personal Development: Motivational (9)
- Personal Development: Writing & Communication (6)

These category groupings are not stored on individual courses. They'll be referenced separately as `trainer_skill_groups` when building the trainer model — a trainer can be qualified to teach "all Excel courses" without manual per-course tagging.

## Standalone WSQ/SSG-funded courses

16 funded courses that are not part of any programme:

- `ASQDVT` — Data Visualisation and Storytelling with Tableau
- `ASQDVS` — Data Visualisation and Storytelling with Power BI
- `ASKDBI` — AI-Driven Business Intelligence: Smarter Reporting & Analytics
- `ASKIHR` — AI in HR: Transforming Talent Acquisition & Workforce Management
- `ASKIPF` — AI-Powered Finance: Automating Insights & Risk Management
- `ASKBRT` — Business Report and Technical Writing Skills (WSQ)
- `ASKBWE` — Business Writing Essentials (WSQ)
- `ASKDFA` — Design Fundamentals with Adobe Photoshop
- `ASKCDM` — Microsoft 365 & Copilot for Data Management
- `ASQMEE` — Microsoft Excel Essentials (WSQ)
- `ASQMEI` — Microsoft Excel Intermediate (WSQ)
- `ASQMEM` — Microsoft Excel Mastery (WSQ)
- `ASKVEG` — Video Editing
- `ASNGAI` — Generative AI for Digital Marketing
- `ASNMEA` — Microsoft Excel Advanced (SSG)
- `ASNTTM` — TikTok Marketing

`programme_code = ""` (blank). Operationally these behave like ASK courses — single sessions, no module sequence.

## Pricing model

One price per course/module: **total amount payable including 9% GST**, ignoring SSG funding subsidies.

- Non-funded ASK courses: fee in PDF already includes GST — stored as-is.
- WSQ/SSG funded: stored fee is `base_fee × 1.09` (9% GST on pre-GST base).
- Subsidised prices (70%/90% in PDFs) are session-time discounts for specific learners, not catalog data.

## Capstones

`is_capstone = true` for capstone modules. Characteristics:
- Higher fee ($2,180 incl GST for ACIIO/DIIO capstones, $2,180 for DDM/SDDM)
- Variable duration (1 to 3 days)
- Multiple delivery dates per intake — students pick which date to sit
- May require specific Capstone-qualified trainers (handled in entity #3)

## CSV schema

```
code            — primary key (e.g. FTDM-DME, ASKMEI, FTIIO-M5)
name            — full display name
programme_code  — FTDM/FTIIO/DGAI/ASK (active), ACDM/DDM/SDDM/CIIO/ACIIO/DIIO (obsolete), or blank for standalone
duration_days   — numeric (decimals OK, e.g. 2.5 for ACIIO-AM7)
fee_with_gst    — total price including 9% GST
is_capstone     — true/false
recently_added  — true/false (mirrors "NEW!" flag from PDF)
notes           — empty, reserved for future use
```

No `ssg_code` column. SSG TGS codes are TMS data, not planning data.

## Catalog vs sessions

This catalog is **static knowledge** — what the company can offer. Rarely changes.

**Sessions are dynamic** — what's actually being delivered. They come from the daily Excel upload and live in the `sessions` table:

```
Catalog (static, in DB)        Daily Excel upload
  courses + programmes      →  rows with course codes, dates, trainers, rooms
        ↓                              ↓
  parse-schedule service matches Excel rows → catalog course codes
        ↓
  If code unknown → flag for review (auto-create placeholder or ask AI to resolve)
        ↓
  Planner sees calendar with full context: trainer, room, fee, programme
```

The catalog needs to be solid first so the Excel parser has something reliable to match against.

## Counts

- Original catalog entries (`courses_catalog.csv`): 142
- Full-time restructure entries (`courses_fulltime_2026.csv`): 35
- Total reference entries retained for matching/history: 177
- Active planning entries: 135 (177 total minus 42 obsolete ACDM/DDM/SDDM/CIIO/ACIIO/DIIO rows)
- Active programmes: 4 (FTDM, FTIIO, DGAI, ASK), plus standalone non-programme courses
- Original catalog capstones: 4
- Original catalog recently added (NEW! in PDF): 19
