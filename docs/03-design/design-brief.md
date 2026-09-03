# Training Planner — Design Brief (v0.7, 2026-09-03 — V4 design inputs)

Load this before any Claude Design canvas or UI critique for the Training Planner. It records what the current UI is, what the brand is, what the Lovable reference contributes, and the agreed direction. Facts come from `apps/web/src/styles.css`, `App.tsx`, `docs/01-product/planning-workflow-roadmap.md` on `main` @ `53bffa55daaf1f22c34e2d921b08db08a5463431`, and the Lovable export "Project Spec UI 1" (TanStack Start + Tailwind v4 + shadcn; presentation reference only — its Supabase, TanStack, Tailwind/Radix, realtime and AI code are explicitly not to be imported).

## 1. Product and users

Internal scheduling tool for ASK Training (Singapore adult education). Ops plan 100–150 sessions a month across programme families (FTDM, FTIIO, DGAI, ASK standalone). Roles: Admin, Ops (primary), Finance, Viewer. Ops see viability badges, never dollar figures. Desktop-first for planning work; must be usable on a 390px phone for checking and approving.

## 2. Brand tokens (already in `styles.css`)

Colour: `--ask-red #E02B20`, `--ask-red-dark #B51F17`, `--ask-red-soft #FFF1F0`; canvas `#F5F6F8`; surface `#FFFFFF`; text `#212529`; muted `#667085`; soft `#8A94A6`; border `#DDE1E7` / strong `#C7CDD6`; success `#197A4B` on `#EAF7F0`; warning `#9A6700` on `#FFF7DF`; danger `#B42318` on `#FFF0EF`; info `#175CD3` on `#EDF4FF`; focus ring `#9C1C15`.

Type: Inter, system fallback. Current scale clusters at 0.75–0.86rem for UI text with 1.05rem section titles, ~1.42rem page titles, 1.5rem metric numbers. Radii 8–12px. Cards: white surface, 1px border, soft shadow. Eyebrow labels: red, uppercase, letter-spaced.

## 3. Component vocabulary in use

Red top bar with brand lockup, role pill, tab bar (white pill = active), sign-out. Page hero card with red left border. Metric tiles with a 3px coloured top accent. Filter panel with segmented period control (Upcoming / Past / Custom), selects, and checkbox chips. Data table in `.table-wrap` with horizontal scroll. Status pills (draft = info, confirmed/completed = success, cancelled = danger), programme pills, issue pills, history-source pills (Direct history / FT proxy / No history / Profile unavailable). Side "Session details" panel with trainer amendment form. Course Planning: programme group cards → course cards → evidence mini-tiles → run cards with status chips and inline actions. Admin: invite form, count tiles, tabbed account table, invitation and immutable-history columns.

## 4. What the current UI gets right

Consistent brand. Course Planning page has clear grouping and evidence cards. Mobile stacks cleanly; Admin table card-ifies well. Zero console errors under mocked data.

## 5. Problems to fix (agreed 2026-09-02)

1. Red carries every meaning: brand, active tab, eyebrows, primary CTA, metric accent, destructive. Approve and Reject on Admin are identical red buttons.
2. Sessions table is below the fold: hero + 8 equal metric tiles + full filter panel come first. Filters take more space than data.
3. Status and Issues columns clipped on desktop because an empty fixed-width details panel takes ~27% width even with nothing selected.
4. Rows ~100px tall: History column stacks pill + 3 lines of evidence; ISO dates wrap ("2026-09-\n08"). 12 rows ≈ 2,600px page.
5. Raw identifiers in UI: `unknown_trainer`, `account_created`, `start_date`, unlabelled grey "None" chip in drawer, developer-note paragraph on Course Planning, disabled primary button reads as broken (washed pink).
6. Tab bar overflows at 390px with five tabs; PR3J and PR3K will add more sections.
7. Admin invite form: note textarea floats above/right of Email/Role with uneven baselines; "Change note" field orphaned; count tiles duplicate the tab counts beneath them.

## 5b. Lovable reference — what to borrow, what to leave

The Lovable version is the opposite extreme from the current app: near-monochrome, 13px body text, 0.5px hairline borders instead of shadows, no red anywhere (blue `--info` is the action colour), a 48px top bar, and a 1152px centred container. It is calmer and far denser, but it has no ASK brand presence at all. The target sits between the two: ASK red in the shell and on the one primary action, Lovable's density and restraint everywhere else.

Borrow:

- Tab strip with count pills as the primary view switch (Pending assignment · Assigned · Cancelled · Overview), replacing the eight metric tiles. Counts double as status: pending tints amber when > 0, cancelled red.
- Planning table density: 44px min row height, 13px text, tabular numbers, hairline row dividers, tinted header strip, hover wash; dates as "10–12 Sep"; amber row wash for rows needing a trainer; cancelled rows at 50% opacity with strikethrough code.
- Two click targets per row: course-code pill opens detail, trainer cell opens the picker. Inline trainer chip states: assigned (green), suggested ("Name · pick", blue, PR4 only), "Assign trainer" (amber link).
- Right-side overlay drawer (448px desktop, full-width mobile) with: title + status badge, external reference, 2-column definition list, notes box, action row, and a provenance line built only from `managementSource` ("Imported from Excel" / "Managed in Training Planner") plus `externalRef`. Nested drawers allowed (detail → picker).
- Trainer picker card anatomy for PR4: avatar, name, confidence chip, load this month coloured by threshold, "taught N×", one-line reason, score, Pick button; "Include inactive" and name search in the footer.
- Programme family colour dots/pills (blue / teal / purple / amber / grey) for scanning, used consistently in table, drawer and future calendar.
- Confirm-with-reason dialog for cancel; Undo toast for assignments.
- `label-xs` eyebrow style (11px, uppercase, 0.06em) in neutral grey, not red.
- Single 768px breakpoint. (Bottom nav on mobile: decided OUT of PR3G-V on 2026-09-03 — a navigation change to be raised as a separate UX proposal; the phone artboard keeps it only as that proposal.)
- Trainer × day calendar with sticky trainer column, weekend tint, today column, pinned "Unassigned" row — reference for PR6.

Leave:

- Blue as the action colour (ASK red takes that role, used once per view).
- No-shadow aesthetic taken to the point of invisibility; keep a soft card shadow so hierarchy survives on lower-quality screens.
- Scope toggle ("mine"/"all"), AI review, assistant FAB, knowledge/wiki, notes strip, auto-suggest: deferred or out of scope per roadmap (PR4 rules-based picker, PR5 AI).
- Two coexisting colour systems (oklch tokens vs hard-coded Tailwind palette classes) — pick one token set.
- Fixed-width planning grid that clips on mobile; the current app's card-ification is better there.

## 6. Direction for the first pass (PR3G-V — a frontend-only UI/IX revision with no API or database changes; not "presentation-only", because tabs, count filters and the drawer change the client interaction model)

Keep the shell and brand. Rules:

- Red is reserved for intentional emphasis: the brand shell, the primary action of a view, errors, and destructive semantics (danger tokens). Decorative red — eyebrows, metric accents, count numbers, section labels — moves to neutral/muted. A destructive button next to a primary is danger-outline, not a second solid red.
- Tab strip with count pills (Needs attention · Upcoming · Past · Cancelled) replaces the eight metric tiles; a compact issue-count strip (Unassigned trainers 4 · Missing rooms 2 · Over capacity 2 · Unresolved venue 1) sits under it and each count is a clickable filter.
- Filters collapse to one row (period segmented control + programme + trainer + venue) with a "More filters" disclosure for room, status chips, issue chips. Active filters shown as removable chips.
- Table (Lovable density, ASK tokens): columns Dates ("8–9 Sep" + "2d" muted) · Course (code pill with programme dot + name) · Trainer chip · Venue / Room · Pax · Status pill · Issues. History evidence leaves the row entirely (source pill only on hover/drawer). Row 44–48px, 13px text, tabular numbers, hairline dividers, tinted header strip, sticky header. Amber wash on rows with an unassigned trainer.
- Details panel: closed state takes no width; open state is a 448px right overlay drawer (desktop) / full-screen sheet (mobile). Sections in order: title + status pill, mono batch/external ref, 2-col definition list (dates, venue/room, pax expected/confirmed, programme, TMS code), Issues (labelled, each with a plain-English line), Trainer amendment (current → proposed, note, one red primary button, grey when disabled), History evidence (source pill + three evidence lines), Audit history (newest first, human-readable actions and Singapore-formatted timestamps), provenance chip.
- Humanise all identifiers via a label map. Disabled buttons look disabled (grey), not broken.
- Preserve every behaviour: date modes, stale-edit, conflict states, pagination, roles.

First canvas: Sessions page (desktop 1440 and mobile 390), default state and drawer-open state. Sequencing decided 2026-09-03: R12 (structural page extraction) lands first with no styling changes; PR3G-V follows as a separate PR built on the extracted `SessionsPage`.

## 7. Later passes (not in scope now)

Attention-queue layout for Sessions; shell with left rail / bottom nav for six-plus sections; Admin area pattern for PR3J Trainer Directory and PR3K Rate Reconciliation; calendar and room views (PR6).

## 7b. Data-model check (2026-09-03)

Fixture vocabulary in mockups must come from the real model, not from sample data. Active programmes: FTDM (blue), FTIIO (amber), DGAI (purple), ASK standalone (grey); ACDM/DDM/SDDM/CIIO/ACIIO/DIIO are obsolete and must not appear. Programme tones match `getProgrammeTone()` in `App.tsx`. New H2 2026 AI courses (ASKAME, ASKARM, ASKGAT, ASKMPT, …) are ASK standalone, 1-day, hotel-delivered — "no history" and "no room needed" are normal states. No fee, rate, tier or viability element on Ops-facing artboards until PR4E is scheduled. The Sessions canvas was corrected to this vocabulary on 2026-09-03 and, after Sol's review, to canonical seeded records: FTDM-DME Digital Marketing Essentials, FTIIO-NFT Network Fundamentals and Troubleshooting, DGAI-HR AI in HR, ASQMEI Microsoft Excel Intermediate (WSQ), ASKGAT, ASKAME; rooms Quality (IP) and Wisdom (JTC); venues Furama Hotel and HBL. Every person in any canvas is a synthetic identity (Demo Planner, Demo Trainer 1–5); every session is fictional; no production data is used.

## 7c. API-contract rules for canvases (added after Sol's architecture gate, 2026-09-03)

- Every displayed value must map to a field in the current client contract (`apps/web/src/api.ts`). For Sessions that is `PlanningSession` (`externalRef`, `course.{code,tmsCode,name,programmeCode}`, `trainer.{id,name,rawName}`, `venue.{code,name,type,rawText}`, `room.{id,name,capacity}`, `dates`, `pax`, `status`, `managementSource`, `version`, `issues`, `planningProfile`) and `SessionHistoryEntry` (`trainer_assigned` / `trainer_replaced` / `trainer_unassigned` only, with actor, previous/new trainer, note, createdAt).
- Not available today and therefore not shown: import batch row number, last-sync timestamp, "managed since", Excel-import events in history. Provenance in PR3G-V is limited to `managementSource` ("Imported from Excel" / "Managed in Training Planner") and `externalRef`; `managementSource = application` must not be presented as "amended after import", since an application-created session is indistinguishable from an amended one. Trainer-history transitions show "Unassigned" for an empty side, never "none". Backlog proposal (not PR3G-V): expose the existing `sessions.app_managed_at` and `sessions.upload_batch_id` columns as additive read-only fields on `/planning/sessions`.
- Course titles render `course.name` verbatim (exact canonical names). In dense tables they are truncated with CSS ellipsis at a fixed column width, with the full name in the element `title` attribute and in the drawer heading. No client-side short-label system is introduced.
- Venue renders `venue.name` (canonical: International Plaza, JTC Summit, Furama Hotel, Home-Based Learning, …), falling back to `venue.rawText` only when unresolved.
- Navigation must be preserved on every viewport. On phones PR3G-V keeps the existing top-level tabs as a horizontally scrollable row; any new navigation pattern (e.g. bottom nav) is a separate proposal.

## 8. How to use this brief

Claude loads this brief, then opens a Claude Design canvas. Approved mockups are exported as PNG and committed to the repository together with this brief (proposed `docs/03-design/`) so they are immutable review inputs before PR3G-V is authorised; Luna Max implements in `styles.css` / `App.tsx` with no API, auth, backend, dependency, or infra changes. Terra Max reviews technical correctness and Claude reviews UI/IX conformance in parallel against the same exact head; neither edits.
