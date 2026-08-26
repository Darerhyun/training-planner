-- =============================================================================
-- Training Schedule Planner — Postgres Schema
-- PR1 Foundation · June 2026
--
-- Apply once to a fresh, approved PostgreSQL database. Single schema, no Firestore.
-- Seed data for static catalog tables is included at the bottom.
-- Trainer rate dollar values are NEVER in this file — only the tier structure.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Users
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM (
  'admin', 'ops', 'finance', 'viewer', 'pending', 'rejected'
);

CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid    TEXT        UNIQUE NOT NULL,
  email           TEXT        UNIQUE NOT NULL,
  display_name    TEXT,
  role            user_role   NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_firebase_uid ON users (firebase_uid);
CREATE INDEX idx_users_email        ON users (email);

-- ---------------------------------------------------------------------------
-- 2. Courses & Programmes
-- ---------------------------------------------------------------------------
CREATE TABLE courses (
  code            TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  programme_code  TEXT,          -- FTDM/FTIIO/DGAI/ASK (active), ACDM/DDM/SDDM/CIIO/ACIIO/DIIO (obsolete), or NULL for standalone
  duration_days   NUMERIC(4,1) NOT NULL,
  fee_with_gst    NUMERIC(10,2),  -- total price incl 9% GST; NULL if unknown
  is_capstone     BOOLEAN     NOT NULL DEFAULT FALSE,
  recently_added  BOOLEAN     NOT NULL DEFAULT FALSE,
  notes           TEXT
);

CREATE INDEX idx_courses_programme ON courses (programme_code);

-- Programme dimension: identity, lifecycle status, supersession.
-- No FK from courses.programme_code yet (avoids seed-order coupling; added later).
CREATE TYPE programme_status AS ENUM ('active', 'obsolete');

CREATE TABLE programmes (
  code            TEXT             PRIMARY KEY,   -- FTDM, FTIIO, DGAI, ASK, ACDM, ...
  name            TEXT             NOT NULL,
  status          programme_status NOT NULL DEFAULT 'active',
  superseded_by   TEXT             REFERENCES programmes (code),  -- self-ref; NULL unless obsolete
  ta_eligible     BOOLEAN          NOT NULL DEFAULT FALSE,        -- future Training Assistants feature; column only, no logic
  notes           TEXT
);

CREATE INDEX idx_programmes_status ON programmes (status);

-- ---------------------------------------------------------------------------
-- 3. Trainers
-- ---------------------------------------------------------------------------
CREATE TABLE trainers (
  trainer_id      TEXT        PRIMARY KEY,   -- slug, e.g. "winnie-liu"
  name            TEXT        NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  module_excludes TEXT[]      DEFAULT '{}',  -- course codes this trainer must NOT teach
  notes           TEXT
);

-- ---------------------------------------------------------------------------
-- 3a. Trainer Aliases
--     Maps alternate names (from rate Excel, schedule Excel, etc.)
--     back to canonical trainer_id. Populated in PR2.
-- ---------------------------------------------------------------------------
CREATE TABLE trainer_aliases (
  id              SERIAL      PRIMARY KEY,
  trainer_id      TEXT        NOT NULL REFERENCES trainers (trainer_id) ON UPDATE CASCADE,
  alias_name      TEXT        NOT NULL,
  source          TEXT,         -- e.g. 'rate_excel', 'schedule_excel'
  UNIQUE (alias_name)
);

CREATE INDEX idx_trainer_aliases_trainer ON trainer_aliases (trainer_id);

-- ---------------------------------------------------------------------------
-- 3b. Course Aliases
--     Maps TMS Course / Program IDs to canonical course codes.
--     Populated from docs/02-domain/course_aliases.csv in PR2.
-- ---------------------------------------------------------------------------
CREATE TABLE course_aliases (
  tms_code        TEXT        PRIMARY KEY,
  catalog_code    TEXT        NOT NULL REFERENCES courses (code) ON UPDATE CASCADE,
  notes           TEXT
);

CREATE INDEX idx_course_aliases_catalog ON course_aliases (catalog_code);

-- ---------------------------------------------------------------------------
-- 4. Trainer ↔ Course skill matrix
-- ---------------------------------------------------------------------------
CREATE TABLE trainer_courses (
  trainer_id      TEXT        NOT NULL REFERENCES trainers (trainer_id) ON UPDATE CASCADE,
  course_code     TEXT        NOT NULL REFERENCES courses (code) ON UPDATE CASCADE,
  is_sme          BOOLEAN     NOT NULL DEFAULT FALSE,
  notes           TEXT,
  PRIMARY KEY (trainer_id, course_code)
);

CREATE INDEX idx_trainer_courses_course ON trainer_courses (course_code);

-- ---------------------------------------------------------------------------
-- 5. Programme Categories (for trainer rate lookup)
-- ---------------------------------------------------------------------------
CREATE TABLE programme_categories (
  category_code   TEXT        PRIMARY KEY,   -- IIO, DM, IT-Normal, IT-WSQ, IT-Special
  description     TEXT        NOT NULL,
  applies_to      TEXT                       -- human-readable note
);

-- ---------------------------------------------------------------------------
-- 6. Trainer Rate Tiers (SCHEMA ONLY — real rates restored securely outside GitHub)
--    One column per pax value (3–20) to preserve per-pax rate granularity.
--    Some trainers have rates that change within a pax band (e.g. different
--    rates at pax 15 vs 16), so we store one column per pax value.
-- ---------------------------------------------------------------------------
CREATE TABLE trainer_rate_tiers (
  tier_code             TEXT        PRIMARY KEY,   -- e.g. IIO-T1, DM-T7
  programme_category    TEXT        NOT NULL REFERENCES programme_categories (category_code),
  description           TEXT,
  rate_pax_3            NUMERIC(10,2),   -- daily rate at 3 pax
  rate_pax_4            NUMERIC(10,2),   -- daily rate at 4 pax
  rate_pax_5            NUMERIC(10,2),   -- daily rate at 5 pax
  rate_pax_6            NUMERIC(10,2),   -- daily rate at 6 pax
  rate_pax_7            NUMERIC(10,2),   -- daily rate at 7 pax
  rate_pax_8            NUMERIC(10,2),   -- daily rate at 8 pax
  rate_pax_9            NUMERIC(10,2),   -- daily rate at 9 pax
  rate_pax_10           NUMERIC(10,2),   -- daily rate at 10 pax
  rate_pax_11           NUMERIC(10,2),   -- daily rate at 11 pax
  rate_pax_12           NUMERIC(10,2),   -- daily rate at 12 pax
  rate_pax_13           NUMERIC(10,2),   -- daily rate at 13 pax
  rate_pax_14           NUMERIC(10,2),   -- daily rate at 14 pax
  rate_pax_15           NUMERIC(10,2),   -- daily rate at 15 pax
  rate_pax_16           NUMERIC(10,2),   -- daily rate at 16 pax
  rate_pax_17           NUMERIC(10,2),   -- daily rate at 17 pax
  rate_pax_18           NUMERIC(10,2),   -- daily rate at 18 pax
  rate_pax_19           NUMERIC(10,2),   -- daily rate at 19 pax
  rate_pax_20           NUMERIC(10,2)    -- daily rate at 20 pax
);

CREATE INDEX idx_rate_tiers_category ON trainer_rate_tiers (programme_category);

-- ---------------------------------------------------------------------------
-- 7. Trainer ↔ Tier Assignments
--    A trainer can appear multiple times (once per programme_category).
-- ---------------------------------------------------------------------------
CREATE TABLE trainer_tier_assignments (
  trainer_id            TEXT        NOT NULL REFERENCES trainers (trainer_id) ON UPDATE CASCADE,
  trainer_name          TEXT        NOT NULL,   -- cached display name (from rate Excel)
  programme_category    TEXT        NOT NULL REFERENCES programme_categories (category_code),
  tier_code             TEXT        NOT NULL REFERENCES trainer_rate_tiers (tier_code),
  PRIMARY KEY (trainer_id, programme_category)
);

-- ---------------------------------------------------------------------------
-- 8. Venues
-- ---------------------------------------------------------------------------
CREATE TYPE venue_type AS ENUM ('owned', 'external', 'virtual');

CREATE TABLE venues (
  code            TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  type            venue_type  NOT NULL,
  address         TEXT,
  notes           TEXT
);

-- ---------------------------------------------------------------------------
-- 9. Rooms (only for 'owned' venues)
-- ---------------------------------------------------------------------------
CREATE TABLE rooms (
  room_id         TEXT        PRIMARY KEY,   -- e.g. "ip-knowledge"
  venue_code      TEXT        NOT NULL REFERENCES venues (code),
  name            TEXT        NOT NULL,
  capacity        INT,                        -- NULL = not yet captured
  notes           TEXT
);

CREATE INDEX idx_rooms_venue ON rooms (venue_code);

-- ---------------------------------------------------------------------------
-- 10. Upload batches
-- ---------------------------------------------------------------------------
CREATE TYPE upload_batch_status AS ENUM ('uploaded', 'parsed', 'applied', 'blocked', 'rejected');

CREATE TABLE upload_batches (
  id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename TEXT,
  gcs_object_name TEXT                NOT NULL UNIQUE,
  status          upload_batch_status NOT NULL DEFAULT 'uploaded',
  parse_result    JSONB,
  created_by      UUID                REFERENCES users (id),
  created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ
);

CREATE INDEX idx_upload_batches_status ON upload_batches (status);
CREATE INDEX idx_upload_batches_created_at ON upload_batches (created_at DESC);

-- ---------------------------------------------------------------------------
-- 11. Sessions — the core planning unit
-- ---------------------------------------------------------------------------
CREATE TYPE session_status AS ENUM ('draft', 'confirmed', 'cancelled', 'completed');
CREATE TYPE session_management_source AS ENUM ('import', 'application');
CREATE TYPE session_change_action AS ENUM ('trainer_assigned', 'trainer_replaced', 'trainer_unassigned');

CREATE TABLE sessions (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code     TEXT            REFERENCES courses (code), -- NULL when TMS code is unresolved
  tms_code        TEXT,           -- raw TMS Course / Program ID from the upload
  source_course_name TEXT,        -- verification-only course name from TMS upload
  trainer_id      TEXT            REFERENCES trainers (trainer_id),   -- NULL = unassigned
  raw_trainer_name TEXT,          -- raw TMS trainer name when unresolved or for audit
  venue_code      TEXT            REFERENCES venues (code),
  room_id         TEXT            REFERENCES rooms (room_id),
  raw_venue_text  TEXT,           -- raw TMS venue/address field
  time_text       TEXT,           -- TMS time range, stored as text for PR2
  status          session_status  NOT NULL DEFAULT 'draft',

  -- Dates
  start_date      DATE            NOT NULL,
  end_date        DATE            NOT NULL,

  -- Cohort / intake identification
  cohort_label    TEXT,           -- e.g. "ACDM Intake 12", "Jul 2026 Run 2"

  -- Pax tracking (see trainer_rates.md § Pax state model)
  expected_pax    INT,            -- initial planning estimate
  confirmed_pax   INT,            -- after registration closes
  realistic_pax   INT,            -- round(confirmed_pax × attendance_rate)
  actual_pax      INT,            -- post-session actual count

  -- Upload provenance
  upload_batch_id UUID            REFERENCES upload_batches (id),
  external_ref    TEXT,           -- row identifier from the source Excel

  -- Write safety / ownership
  management_source session_management_source NOT NULL DEFAULT 'import',
  version         INT             NOT NULL DEFAULT 1,
  app_managed_at  TIMESTAMPTZ,
  app_managed_by  UUID            REFERENCES users (id),

  notes           TEXT,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT chk_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_sessions_version_positive CHECK (version > 0),
  CONSTRAINT chk_room_venue CHECK (
    room_id IS NULL OR venue_code IS NOT NULL
  )
);

CREATE INDEX idx_sessions_course    ON sessions (course_code);
CREATE INDEX idx_sessions_trainer   ON sessions (trainer_id);
CREATE INDEX idx_sessions_venue     ON sessions (venue_code);
CREATE INDEX idx_sessions_room      ON sessions (room_id);
CREATE INDEX idx_sessions_dates     ON sessions (start_date, end_date);
CREATE INDEX idx_sessions_status    ON sessions (status);
CREATE INDEX idx_sessions_management_source ON sessions (management_source);
CREATE INDEX idx_sessions_app_managed_by ON sessions (app_managed_by);
CREATE UNIQUE INDEX idx_sessions_external_ref ON sessions (external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE session_change_history (
  id                  UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID                  NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  actor_user_id       UUID                  REFERENCES users (id),
  action              session_change_action NOT NULL,
  previous_trainer_id TEXT                  REFERENCES trainers (trainer_id),
  new_trainer_id      TEXT                  REFERENCES trainers (trainer_id),
  note                TEXT,
  metadata            JSONB                 NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_change_history_session_created
  ON session_change_history (session_id, created_at DESC);
CREATE INDEX idx_session_change_history_actor
  ON session_change_history (actor_user_id);

-- ---------------------------------------------------------------------------
-- 11a. Planned course runs — future course × venue × month planning
-- ---------------------------------------------------------------------------
CREATE TYPE planned_course_run_status AS ENUM ('proposed', 'approved', 'scheduled');

CREATE TABLE planned_course_runs (
  id              UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_month  DATE                      NOT NULL,
  course_code     TEXT                      NOT NULL REFERENCES courses (code) ON UPDATE CASCADE,
  venue_code      TEXT                      NOT NULL REFERENCES venues (code) ON UPDATE CASCADE,
  status          planned_course_run_status NOT NULL DEFAULT 'proposed',
  note            TEXT,
  version         INT                       NOT NULL DEFAULT 1,
  created_by      UUID                      NOT NULL REFERENCES users (id),
  approved_by     UUID                      REFERENCES users (id),
  approved_at     TIMESTAMPTZ,
  scheduled_by    UUID                      REFERENCES users (id),
  scheduled_at    TIMESTAMPTZ,
  session_id      UUID                      UNIQUE REFERENCES sessions (id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ               NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ               NOT NULL DEFAULT now(),

  CONSTRAINT chk_planned_course_runs_month_start CHECK (
    planning_month = date_trunc('month', planning_month)::date
  ),
  CONSTRAINT chk_planned_course_runs_note_length CHECK (
    note IS NULL OR char_length(note) <= 500
  ),
  CONSTRAINT chk_planned_course_runs_version_positive CHECK (version > 0),
  CONSTRAINT chk_planned_course_runs_lifecycle CHECK (
    (status = 'proposed' AND approved_by IS NULL AND approved_at IS NULL
      AND scheduled_by IS NULL AND scheduled_at IS NULL AND session_id IS NULL)
    OR
    (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND scheduled_by IS NULL AND scheduled_at IS NULL AND session_id IS NULL)
    OR
    (status = 'scheduled' AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND scheduled_by IS NOT NULL AND scheduled_at IS NOT NULL AND session_id IS NOT NULL)
  )
);

CREATE INDEX idx_planned_course_runs_month_venue
  ON planned_course_runs (planning_month, venue_code);
CREATE INDEX idx_planned_course_runs_course
  ON planned_course_runs (course_code);
CREATE INDEX idx_planned_course_runs_status
  ON planned_course_runs (status);

-- ---------------------------------------------------------------------------
-- 12. Session Economics — raw data view
--     Exposes session + course + pax data needed by the API layer.
--     ALL cost calculations (category resolution, tier lookup, pax-rate
--     selection, breakeven iteration, viability badge) are done in the
--     API layer (services/core-api) because:
--       - IT sub-category resolution (IT-Normal / IT-WSQ / IT-Special)
--         requires course-code-level logic with a maintained code list
--       - Per-pax rate columns (rate_pax_3..rate_pax_20) need dynamic
--         column selection that is cleaner in application code
--       - Breakeven is iterative (try pax 1..20) across changing rate bands
--       - Role-based field filtering (ops vs finance) is enforced at API
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW session_economics AS
SELECT
  s.id              AS session_id,
  s.course_code,
  s.trainer_id,
  s.venue_code,
  s.status,
  s.start_date,
  s.end_date,

  -- Pax fields
  s.expected_pax,
  s.confirmed_pax,
  s.realistic_pax,
  s.actual_pax,
  COALESCE(s.realistic_pax, s.confirmed_pax, s.expected_pax) AS effective_pax,

  -- Course data needed for revenue calc
  c.fee_with_gst,
  c.duration_days,
  c.programme_code,
  c.name            AS course_name,

  -- Revenue (course fee × effective pax) — visible to all roles
  CASE WHEN c.fee_with_gst IS NOT NULL
        AND COALESCE(s.realistic_pax, s.confirmed_pax, s.expected_pax) IS NOT NULL
    THEN c.fee_with_gst * COALESCE(s.realistic_pax, s.confirmed_pax, s.expected_pax)
    ELSE NULL
  END AS revenue_with_gst

FROM sessions s
LEFT JOIN courses c ON c.code = s.course_code
WHERE s.status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 13. App configuration (key-value for admin-tunable settings)
-- ---------------------------------------------------------------------------
CREATE TABLE app_config (
  key             TEXT        PRIMARY KEY,
  value           JSONB       NOT NULL,
  description     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default attendance rate and viability thresholds
INSERT INTO app_config (key, value, description) VALUES
  ('attendance_rate_default', '0.85', 'Default historical attendance rate for realistic_pax'),
  ('viability_strong_buffer', '4',    'Pax above breakeven to qualify as Strong'),
  ('viability_healthy_buffer', '2',   'Pax above breakeven to qualify as Healthy');


-- =============================================================================
-- SEED DATA — Static catalog tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Venues
-- ---------------------------------------------------------------------------
INSERT INTO venues (code, name, type, address, notes) VALUES
  ('IP',         'International Plaza',   'owned',    '10 Anson Road, #06-11/#20-06/#34-08, Singapore 079903', 'Tanjong Pagar MRT — Central branch'),
  ('JTC',        'JTC Summit',            'owned',    '8 Jurong Town Hall Road, #27-01, Singapore 609434',     'Jurong East — West branch / Headquarter'),
  ('FURAMA',     'Furama Hotel',          'external', NULL, 'External hotel venue, room name per booking'),
  ('HOLIDAYINN', 'Holiday Inn',           'external', NULL, 'External hotel venue, room name per booking'),
  ('SCOTTS',     'Scotts Hotel',          'external', NULL, 'External hotel venue, room name per booking'),
  ('HBL',        'Home-Based Learning',   'virtual',  NULL, 'Virtual delivery, no physical room'),
  ('LAVENDER',   'Lavender Street',       'external', NULL, 'External venue for Drone Flying / Drone Piloting'),
  ('INHOUSE',    'Client In-house',       'external', NULL, 'Sessions at client premises; address varies'),
  ('OUTBOUND',   'Outbound (external)',   'external', NULL, 'Catch-all for off-site / outbound trainings');

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------
INSERT INTO rooms (room_id, venue_code, name, capacity, notes) VALUES
  ('ip-knowledge',      'IP',  'Knowledge',          16,   NULL),
  ('ip-quality',        'IP',  'Quality',            20,   NULL),
  ('ip-habits',         'IP',  'Habits',             18,   NULL),
  ('ip-experience',     'IP',  'Experience',         30,   NULL),
  ('ip-class1',         'IP',  'Class1',             NULL, 'Generic room label from August 2026 Master Schedule'),
  ('ip-class2',         'IP',  'Class2',             NULL, 'Generic room label from August 2026 Master Schedule'),
  ('ip-classroom',      'IP',  'Classroom',          NULL, 'Generic room label from August 2026 Master Schedule'),
  ('jtc-enjoyment',     'JTC', 'Enjoyment',          NULL, 'Capacity not yet captured'),
  ('jtc-gratitude',     'JTC', 'Gratitude',          NULL, 'Capacity not yet captured'),
  ('jtc-happiness',     'JTC', 'Happiness',          NULL, 'Capacity not yet captured'),
  ('jtc-wisdom',        'JTC', 'Wisdom',             NULL, 'Capacity not yet captured'),
  ('jtc-meeting-room',  'JTC', 'Meeting Room',       NULL, 'Capacity not yet captured'),
  ('jtc-adapt',         'JTC', 'Adapt',              NULL, 'Capacity not yet captured'),
  ('jtc-bond',          'JTC', 'Bond',               NULL, 'Capacity not yet captured'),
  ('jtc-concept',       'JTC', 'Concept',            NULL, 'Capacity not yet captured'),
  ('jtc-level20-roomA', 'JTC', 'Level 20 (Room A)',  NULL, 'Capacity not yet captured'),
  ('jtc-level20-roomB', 'JTC', 'Level 20 (Room B)',  NULL, 'Capacity not yet captured'),
  ('jtc-level20-roomC', 'JTC', 'Level 20 (Room C)',  NULL, 'Capacity not yet captured'),
  ('jtc-classroom',     'JTC', 'Classroom',          NULL, 'Generic room label from August 2026 Master Schedule');

-- ---------------------------------------------------------------------------
-- Programme Categories
-- ---------------------------------------------------------------------------
INSERT INTO programme_categories (category_code, description, applies_to) VALUES
  ('IIO',        'Infrastructure & Operations programmes',   'CIIO, ACIIO, DIIO'),
  ('DM',         'Digital Marketing programmes',             'ACDM, DDM, SDDM'),
  ('IT-Normal',  'ASK Microsoft Office (non-WSQ)',           'ASK courses in Office family'),
  ('IT-WSQ',     'WSQ-funded Microsoft Office',              'ASQ* codes (Excel Essentials/Intermediate/Mastery/Advanced)'),
  ('IT-Special', 'Premium IT courses',                       'Excel Power Query/Pivot/DAX, VBA, Power BI bridging');

-- ---------------------------------------------------------------------------
-- Programmes (4 active + 6 obsolete)
-- Active rows first so obsolete rows can reference them via superseded_by.
-- Obsolete rows transcribed from docs/02-domain/obsolete_programmes_2026.csv.
-- ---------------------------------------------------------------------------
INSERT INTO programmes (code, name, status, superseded_by, ta_eligible, notes) VALUES
  ('FTDM',  'Diploma in Digital Marketing (Full-Time)',                            'active',   NULL,    FALSE, 'Consolidated full-time DM diploma'),
  ('FTIIO', 'Advanced Certificate in IT Infrastructure & Operations (Full-Time)',  'active',   NULL,    TRUE,  'TA-eligible: completion qualifies graduate as Training Assistant'),
  ('DGAI',  'Diploma in Generative AI',                                            'active',   NULL,    FALSE, 'New full-time GenAI diploma'),
  ('ASK',   'ASK Standalone Courses',                                              'active',   NULL,    FALSE, 'Standalone ASK catalog courses'),
  ('ACDM',  'Advanced Certificate in Digital Marketing',                           'obsolete', 'FTDM',  FALSE, 'Stacked cert structure retired; modules folded into full-time Diploma in DM'),
  ('DDM',   'Diploma in Digital Marketing (Modular)',                              'obsolete', 'FTDM',  FALSE, 'Folded into full-time Diploma in DM'),
  ('SDDM',  'Specialist Diploma in Digital Marketing',                             'obsolete', 'FTDM',  FALSE, 'Advanced variants dropped; SDDM unpopular/frequently cancelled'),
  ('CIIO',  'Certificate in IT Infrastructure & Operations',                       'obsolete', 'FTIIO', FALSE, 'Folded into full-time Advanced Certificate in IT I&O'),
  ('ACIIO', 'Advanced Certificate in IT Infrastructure & Operations (Modular)',    'obsolete', 'FTIIO', FALSE, 'Folded into full-time Advanced Certificate in IT I&O'),
  ('DIIO',  'Diploma in IT Infrastructure & Operations',                           'obsolete', 'FTIIO', FALSE, 'Folded into full-time Advanced Certificate in IT I&O');

-- ---------------------------------------------------------------------------
-- Trainer Rate Tiers (structure only — dollar values restored securely by an authorized admin)
-- ---------------------------------------------------------------------------
INSERT INTO trainer_rate_tiers (tier_code, programme_category, description) VALUES
  -- IIO: 15 tiers
  ('IIO-T1',  'IIO', 'IIO tier 1'),  ('IIO-T2',  'IIO', 'IIO tier 2'),
  ('IIO-T3',  'IIO', 'IIO tier 3'),  ('IIO-T4',  'IIO', 'IIO tier 4'),
  ('IIO-T5',  'IIO', 'IIO tier 5'),  ('IIO-T6',  'IIO', 'IIO tier 6'),
  ('IIO-T7',  'IIO', 'IIO tier 7'),  ('IIO-T8',  'IIO', 'IIO tier 8'),
  ('IIO-T9',  'IIO', 'IIO tier 9'),  ('IIO-T10', 'IIO', 'IIO tier 10'),
  ('IIO-T11', 'IIO', 'IIO tier 11'), ('IIO-T12', 'IIO', 'IIO tier 12'),
  ('IIO-T13', 'IIO', 'IIO tier 13'), ('IIO-T14', 'IIO', 'IIO tier 14'),
  ('IIO-T15', 'IIO', 'IIO tier 15'),
  -- DM: 17 tiers
  ('DM-T1',  'DM', 'DM tier 1'),   ('DM-T2',  'DM', 'DM tier 2'),
  ('DM-T3',  'DM', 'DM tier 3'),   ('DM-T4',  'DM', 'DM tier 4'),
  ('DM-T5',  'DM', 'DM tier 5'),   ('DM-T6',  'DM', 'DM tier 6'),
  ('DM-T7',  'DM', 'DM tier 7'),   ('DM-T8',  'DM', 'DM tier 8'),
  ('DM-T9',  'DM', 'DM tier 9'),   ('DM-T10', 'DM', 'DM tier 10'),
  ('DM-T11', 'DM', 'DM tier 11'),  ('DM-T12', 'DM', 'DM tier 12'),
  ('DM-T13', 'DM', 'DM tier 13'),  ('DM-T14', 'DM', 'DM tier 14'),
  ('DM-T15', 'DM', 'DM tier 15'),  ('DM-T16', 'DM', 'DM tier 16'),
  ('DM-T17', 'DM', 'DM tier 17'),
  -- IT-Normal: 5 tiers
  ('IT-Normal-T1', 'IT-Normal', 'IT-Normal tier 1'),
  ('IT-Normal-T2', 'IT-Normal', 'IT-Normal tier 2'),
  ('IT-Normal-T3', 'IT-Normal', 'IT-Normal tier 3'),
  ('IT-Normal-T4', 'IT-Normal', 'IT-Normal tier 4'),
  ('IT-Normal-T5', 'IT-Normal', 'IT-Normal tier 5'),
  -- IT-WSQ: 5 tiers
  ('IT-WSQ-T1', 'IT-WSQ', 'IT-WSQ tier 1'),
  ('IT-WSQ-T2', 'IT-WSQ', 'IT-WSQ tier 2'),
  ('IT-WSQ-T3', 'IT-WSQ', 'IT-WSQ tier 3'),
  ('IT-WSQ-T4', 'IT-WSQ', 'IT-WSQ tier 4'),
  ('IT-WSQ-T5', 'IT-WSQ', 'IT-WSQ tier 5'),
  -- IT-Special: 3 tiers
  ('IT-Special-T1', 'IT-Special', 'IT-Special tier 1'),
  ('IT-Special-T2', 'IT-Special', 'IT-Special tier 2'),
  ('IT-Special-T3', 'IT-Special', 'IT-Special tier 3');

-- ---------------------------------------------------------------------------
-- Courses catalog (142 entries from courses_catalog.csv)
-- ---------------------------------------------------------------------------
INSERT INTO courses (code, name, programme_code, duration_days, fee_with_gst, is_capstone, recently_added) VALUES
  -- ACDM (5 modules)
  ('ACDM-DME',  'Digital Marketing Essentials',                        'ACDM', 1,    327.00,  FALSE, FALSE),
  ('ACDM-DA',   'Digital Advertising',                                 'ACDM', 2,    981.00,  FALSE, FALSE),
  ('ACDM-SMM',  'Social Media Marketing',                              'ACDM', 2,    981.00,  FALSE, FALSE),
  ('ACDM-SEO',  'Search Engine Optimisation',                          'ACDM', 2,    981.00,  FALSE, FALSE),
  ('ACDM-DMA',  'Digital Marketing Analytics (Google Analytics)',       'ACDM', 2,    981.00,  FALSE, FALSE),
  -- DDM (6 modules + 1 capstone)
  ('DDM-WWC',   'WordPress Website Creation',                          'DDM',  2,   1076.92,  FALSE, FALSE),
  ('DDM-DCC',   'Digital Content Creation',                            'DDM',  2,   1076.92,  FALSE, FALSE),
  ('DDM-CCW',   'Copywriting & Content Writing',                       'DDM',  2,   1076.92,  FALSE, FALSE),
  ('DDM-GA',    'Google Ads',                                          'DDM',  2,   1076.92,  FALSE, FALSE),
  ('DDM-FB',    'Facebook & Instagram Marketing',                      'DDM',  2,   1076.92,  FALSE, FALSE),
  ('DDM-WCO',   'Website & Landing Page Conversion Optimisation',      'DDM',  2,   1076.92,  FALSE, FALSE),
  ('DDM-CAP',   'Capstone Project (Digital Marketing Campaign)',        'DDM',  1,   2180.00,  TRUE,  FALSE),
  -- SDDM (7 modules + 1 capstone)
  ('SDDM-ADMS', 'Advanced Digital Marketing Strategy',                 'SDDM', 2,   1108.53,  FALSE, FALSE),
  ('SDDM-ADA',  'Advanced Digital Advertising',                        'SDDM', 2,   1108.53,  FALSE, FALSE),
  ('SDDM-ASMM', 'Advanced Social Media Management',                   'SDDM', 2,   1108.53,  FALSE, FALSE),
  ('SDDM-ADCM', 'Advanced Digital Content Marketing',                 'SDDM', 2,   1108.53,  FALSE, FALSE),
  ('SDDM-ASEO', 'Advanced Search Engine Optimisation',                'SDDM', 2,   1108.53,  FALSE, FALSE),
  ('SDDM-ADMA', 'Advanced Digital Marketing Analytics (Google Analytics)', 'SDDM', 2, 1108.53, FALSE, FALSE),
  ('SDDM-EM',   'Email Marketing',                                    'SDDM', 2,   1105.26,  FALSE, FALSE),
  ('SDDM-CAP',  'Capstone Project (Digital Marketing Strategic Plan)', 'SDDM', 1,   2180.00,  TRUE,  FALSE),
  -- CIIO (7 modules)
  ('CIIO-M1',   'M1 Introduction to Information Technology (IT)',      'CIIO', 1,    327.00,  FALSE, FALSE),
  ('CIIO-M2',   'M2 Understanding Computer Hardware & Peripherals',    'CIIO', 2,    599.50,  FALSE, FALSE),
  ('CIIO-M3',   'M3 Operating Systems and Desktop Support',            'CIIO', 2,    599.50,  FALSE, FALSE),
  ('CIIO-M4',   'M4 Network Fundamentals and Troubleshooting',         'CIIO', 3,    981.00,  FALSE, FALSE),
  ('CIIO-M5',   'M5 Cybersecurity Essentials',                         'CIIO', 3,    981.00,  FALSE, FALSE),
  ('CIIO-M6',   'M6 IT Troubleshooting and Problem Solving',           'CIIO', 1,    327.00,  FALSE, FALSE),
  ('CIIO-M7',   'M7 IT Service Management and Help Desk Operations',   'CIIO', 2,    599.50,  FALSE, FALSE),
  -- ACIIO (6 modules + 1 capstone)
  ('ACIIO-AM1', 'AM1 Advanced Hardware and Software Troubleshooting',  'ACIIO', 4,  1308.00,  FALSE, FALSE),
  ('ACIIO-AM2', 'AM2 Advanced Network Administration',                 'ACIIO', 6,  1853.00,  FALSE, FALSE),
  ('ACIIO-AM3', 'AM3 Systems and Server Administration',               'ACIIO', 6,  1853.00,  FALSE, FALSE),
  ('ACIIO-AM4', 'AM4 Cloud Computing',                                 'ACIIO', 5,  1635.00,  FALSE, FALSE),
  ('ACIIO-AM5', 'AM5 Cybersecurity and Ethical Hacking',               'ACIIO', 4,  1308.00,  FALSE, FALSE),
  ('ACIIO-AM6', 'AM6 Emerging Technologies and Trends',                'ACIIO', 2,   763.00,  FALSE, FALSE),
  ('ACIIO-AM7', 'AM7 Capstone Project: Real-world IT Project',         'ACIIO', 2.5, 2180.00,  TRUE,  FALSE),
  -- DIIO (7 modules + 1 capstone)
  ('DIIO-DM1',  'DM1 IT Infrastructure and Operations',               'DIIO', 4,   1744.00,  FALSE, FALSE),
  ('DIIO-DM2',  'DM2 Enterprise Architecture and Design',             'DIIO', 5,   2071.00,  FALSE, FALSE),
  ('DIIO-DM3',  'DM3 IT Infrastructure Planning and Optimisation',    'DIIO', 5,   2071.00,  FALSE, FALSE),
  ('DIIO-DM4',  'DM4 IT Disaster Recovery and Business Continuity',   'DIIO', 2,    817.50,  FALSE, FALSE),
  ('DIIO-DM5',  'DM5 Advanced IT Security and Cybersecurity',         'DIIO', 5,   2071.00,  FALSE, FALSE),
  ('DIIO-DM6',  'DM6 IT Project Management',                          'DIIO', 2,    817.50,  FALSE, FALSE),
  ('DIIO-DM7',  'DM7 IT Infrastructure Automation and Orchestration', 'DIIO', 4,   1744.00,  FALSE, FALSE),
  ('DIIO-DM8',  'DM8 Capstone Project: Audit or Design IT Infrastructure', 'DIIO', 3, 2180.00, TRUE, FALSE),
  -- ASK (84 courses)
  ('ASKMEB',    'Microsoft Excel - Basic',                             'ASK',  2,    436.00,  FALSE, FALSE),
  ('ASKMEI',    'Microsoft Excel - Intermediate',                      'ASK',  2,    436.00,  FALSE, FALSE),
  ('ASKMEA',    'Microsoft Excel - Advanced',                          'ASK',  2,    436.00,  FALSE, FALSE),
  ('ASKFF8',    'Microsoft Excel: Advanced Formulas and Functions',    'ASK',  2,    654.00,  FALSE, FALSE),
  ('ASKTH8',    'Microsoft Excel: 99 Pro Hacks and Tips',              'ASK',  1,    392.40,  FALSE, FALSE),
  ('ASKEP8',    'Advanced Pivot Table Techniques in Microsoft Excel',  'ASK',  1,    392.40,  FALSE, FALSE),
  ('ASKBB8',    'Bridging Big Data Analytics using Excel & Power BI',  'ASK',  2,   1090.00,  FALSE, FALSE),
  ('ASKDR8',    'Data Analysis with Microsoft Excel DASHBOARD Reporting for Management', 'ASK', 2, 1090.00, FALSE, FALSE),
  ('ASKPQ8',    'Introduction to Microsoft Excel Power Query, Data Model, Power Pivot and DAX', 'ASK', 2, 1090.00, FALSE, FALSE),
  ('ASKEDP',    'Excel Dynamic Power Query and Power Pivot Time Intelligence DAX', 'ASK', 2, 1090.00, FALSE, TRUE),
  ('ASK7VB',    'Visual Basic for Applications in Microsoft Excel - Fundamental', 'ASK', 3, 872.00, FALSE, FALSE),
  ('ASKMAB',    'Microsoft Access - Basic and Intermediate',           'ASK',  2,    545.00,  FALSE, FALSE),
  ('ASKMAA',    'Microsoft Access - Advanced',                         'ASK',  2,    545.00,  FALSE, FALSE),
  ('ASKMOB',    'Microsoft Outlook - Basic and Intermediate',          'ASK',  1,    327.00,  FALSE, FALSE),
  ('ASKMOA',    'Microsoft Outlook - Intermediate and Advanced',       'ASK',  1,    327.00,  FALSE, FALSE),
  ('ASKGV7',    'Infographics Concept and Data Visualization Technique', 'ASK', 1,   392.40,  FALSE, FALSE),
  ('ASKCP8',    'Creative Microsoft PowerPoint Designs Masterclass',   'ASK',  1,    392.40,  FALSE, FALSE),
  ('ASKMPB',    'Microsoft PowerPoint - Basic and Intermediate',       'ASK',  2,    436.00,  FALSE, FALSE),
  ('ASKMPA',    'Microsoft PowerPoint - Advanced',                     'ASK',  1,    272.50,  FALSE, FALSE),
  ('ASKMWB',    'Microsoft Word - Basic and Intermediate',             'ASK',  2,    436.00,  FALSE, FALSE),
  ('ASKMWA',    'Microsoft Word - Advanced',                           'ASK',  1,    272.50,  FALSE, FALSE),
  ('ASKPSP',    'AI-Powered Storytelling for Presentation',            'ASK',  2,   1308.00,  FALSE, TRUE),
  ('ASKBCG',    'Beyond ChatGPT: The Ultimate GenAI Toolkit for Workplace Productivity', 'ASK', 1, 817.50, FALSE, TRUE),
  ('ASKCL7',    'IT Clinics (PC/Laptop Maintenance)',                  'ASK',  2,    654.00,  FALSE, FALSE),
  ('ASKDFF',    'Drone Flying - Fundamentals',                         'ASK',  2,    872.00,  FALSE, FALSE),
  ('ASKDPA',    'Drone Piloting - Advanced',                           'ASK',  2,    872.00,  FALSE, FALSE),
  ('ASK3KS',    'Applying Three Kingdom Strategies in Your Organization', 'ASK', 3, 2398.00,  FALSE, FALSE),
  ('ASKSTA',    'Sun Tzu''s Art of War for Modern Leaders',            'ASK',  2,   1635.00,  FALSE, TRUE),
  ('ASK3KL',    'Three Kingdoms'' Leaderships in Today''s Context',    'ASK',  2,   1635.00,  FALSE, FALSE),
  ('ASKAPP',    'Attitude - Your Most Priceless Possession for Senior Officers', 'ASK', 2, 1308.00, FALSE, FALSE),
  ('ASKNLP',    'Connect, Engage and Influence with NLP Interpersonal Communication Techniques', 'ASK', 1, 817.50, FALSE, TRUE),
  ('ASKKYM',    'Enhancing Your Emotional Intelligence: The Key To Effective Leadership', 'ASK', 2, 1308.00, FALSE, TRUE),
  ('ASKHWB',    'Happy Employees Work Better',                         'ASK',  2,   1308.00,  FALSE, FALSE),
  ('ASKKMK',    'Knowing Me, Knowing You – for Better Teamwork',       'ASK',  1,    708.50,  FALSE, TRUE),
  ('ASKMIE',    'People Centered Leadership - Motivating, Inspiring and Engaging others', 'ASK', 1, 708.50, FALSE, FALSE),
  ('ASK5BC',    'The Five Behaviours of a Cohesive Team',              'ASK',  2,   1308.00,  FALSE, FALSE),
  ('ASKCFH',    'Coaching For High Performance',                       'ASK',  1,    872.00,  FALSE, TRUE),
  ('ASKCMC',    'Crisis Management and Communication',                 'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKDDP',    'Dealing with Difficult People at Work',               'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKDCC',    'Dynamic Communication and Collaboration with LEGO® Serious Play®', 'ASK', 1, 817.50, FALSE, TRUE),
  ('ASKEPC',    'Empathy: Harnessing The Power of Connection at Workplace', 'ASK', 2, 1308.00, FALSE, FALSE),
  ('ASKKNR',    'Keys to Instant Rapport – Effective Communication for Better Working Relationships', 'ASK', 1, 708.50, FALSE, FALSE),
  ('ASKLRE',    'Leadership Resilience',                               'ASK',  2,   1635.00,  FALSE, TRUE),
  ('ASKGAR',    'Let''s Get Your Anger Right! (Anger Management)',     'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKPCL',    'Persuasive Communication for Leaders',                'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKSPN',    'Strategies for Persuasive Negotiation',               'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKMGC',    'Working Relationships with Multi-Generational People', 'ASK', 1,    708.50,  FALSE, FALSE),
  ('ASKBKS',    'Be Kiasu, Be Creative and Effective in Problem Solving', 'ASK', 1,  708.50,  FALSE, FALSE),
  ('ASKCRC',    'Colored Brain: Gateway to Improving Communication Skills at the Workplace', 'ASK', 1, 708.50, FALSE, FALSE),
  ('ASKCTH',    'Critical Thinking for Effective Problem Solving',     'ASK',  1,    817.50,  FALSE, TRUE),
  ('ASKCTL',    'Critical Thinking for Leaders',                       'ASK',  2,   1308.00,  FALSE, TRUE),
  ('ASKIST',    'Introduction to Systems Thinking',                    'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKSTL',    'System Thinking for Leaders with LEGO® Serious Play®', 'ASK', 1,   817.50,  FALSE, FALSE),
  ('ASKSDT',    'The 5-Steps of Design Thinking',                      'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKBDD',    'Brainpower - Discovering and Developing Our Mental Skills', 'ASK', 2, 1308.00, FALSE, FALSE),
  ('ASKEBS',    'Effective Brain Smart Skills for the Workplace',      'ASK',  2,   1308.00,  FALSE, FALSE),
  ('ASKPTM',    'Effective Presentation Skills - Share Impactful information with Limited Time', 'ASK', 1, 708.50, FALSE, FALSE),
  ('ASKEYM',    'Enhance Your Memory',                                 'ASK',  1,    817.50,  FALSE, FALSE),
  ('ASKHSR',    'High Impact Speed Reading - Read Fast, Learn Fast',   'ASK',  1,    817.50,  FALSE, FALSE),
  ('ASKSPC',    'Speaking and Presenting with Confidence',             'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKBPR',    'Building Personal Resilience and Wellbeing',          'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKCWC',    'Coping With Uncertainty and Change At Your Workplace', 'ASK', 1,    708.50,  FALSE, FALSE),
  ('ASKERT',    'Effective Relaxation Techniques',                     'ASK',  1,    545.00,  FALSE, FALSE),
  ('ASKSAW',    'Managing Stress and Achieving Wellness',              'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKOYO',    'Outwit Your Obstacles',                               'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKRWP',    'Resilience at Work: Turning Stressful Situations into Your Advantage', 'ASK', 2, 1308.00, FALSE, FALSE),
  ('ASKCWF',    'Unleash Your Creativity in Work and Life',            'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKWUT',    'Wisdom in Using Time and Achieving Goals',            'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKWLB',    'Work-Life Balance',                                   'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKBHW',    'Bringing Humour into the Workplace',                  'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKCHP',    'Cultivate Highly Productive Habits',                  'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKEED',    'Eight Emotional Drivers for a Happier Life at Work',  'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKEEP',    'Even Eagles Need a Push',                             'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKHHL',    'Happier Career, Happier Life',                        'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKHAW',    'H.E.A.R.T. @ Work',                                  'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASK7UP',    'The 7-Ups to Personal Effectiveness',                 'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKPTA',    'The Power of Taking Action',                          'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKUSC',    'Unlock Your Self-Confidence',                         'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKBDF',    'Birds of Different Feathers Can Flock Together',      'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASKRTW',    'Business Report and Technical Writing Skills',        'ASK',  2,    926.50,  FALSE, FALSE),
  ('ASKEMS',    'Business Writing Essentials: From Emails to Meeting Summaries', 'ASK', 2, 926.50, FALSE, FALSE),
  ('ASKMAS',    'Mastering the Art of Silent Communication',           'ASK',  1,    708.50,  FALSE, FALSE),
  ('ASK5LL',    'Winning Relationships with the 5 Love Languages @Workplace', 'ASK', 1, 708.50, FALSE, FALSE),
  ('ASKWMW',    'Women Are Always Right and Men Are Never Wrong @Workplace', 'ASK', 1, 708.50, FALSE, FALSE),
  -- Standalone WSQ/SSG-funded (16 courses, programme_code = NULL)
  ('ASQDVT',    'Data Visualisation and Storytelling with Tableau',     NULL, 2,    959.20,  FALSE, FALSE),
  ('ASQDVS',    'Data Visualisation and Storytelling with Power BI',    NULL, 2,    959.20,  FALSE, FALSE),
  ('ASKDBI',    'AI-Driven Business Intelligence: Smarter Reporting & Analytics', NULL, 3, 1962.00, FALSE, TRUE),
  ('ASKIHR',    'AI in HR: Transforming Talent Acquisition & Workforce Management', NULL, 3, 1962.00, FALSE, TRUE),
  ('ASKIPF',    'AI-Powered Finance: Automating Insights & Risk Management', NULL, 3, 1744.00, FALSE, TRUE),
  ('ASKBRT',    'Business Report and Technical Writing Skills (WSQ)',   NULL, 2,    926.50,  FALSE, TRUE),
  ('ASKBWE',    'Business Writing Essentials: From Emails to Meeting Summaries (WSQ)', NULL, 2, 926.50, FALSE, TRUE),
  ('ASKDFA',    'Design Fundamentals with Adobe Photoshop for Business and Branding', NULL, 2, 763.00, FALSE, TRUE),
  ('ASKCDM',    'Microsoft 365 & Copilot for Data Management',         NULL, 3,   1308.00,  FALSE, FALSE),
  ('ASQMEE',    'Microsoft Excel Essentials (WSQ)',                     NULL, 2,    490.50,  FALSE, FALSE),
  ('ASQMEI',    'Microsoft Excel Intermediate (WSQ)',                   NULL, 2,    490.50,  FALSE, FALSE),
  ('ASQMEM',    'Microsoft Excel Mastery (WSQ)',                        NULL, 2,    654.00,  FALSE, TRUE),
  ('ASKVEG',    'Video Editing',                                        NULL, 2,   1076.92,  FALSE, FALSE),
  ('ASNGAI',    'Generative AI for Digital Marketing',                  NULL, 2,   1076.92,  FALSE, FALSE),
  ('ASNMEA',    'Microsoft Excel Advanced (SSG)',                       NULL, 2,    490.50,  FALSE, FALSE),
  ('ASNTTM',    'TikTok Marketing',                                     NULL, 2,   1076.92,  FALSE, FALSE);

-- ---------------------------------------------------------------------------
-- Trainers (113 from trainers.csv)
-- ---------------------------------------------------------------------------
INSERT INTO trainers (trainer_id, name, is_active, module_excludes) VALUES
  ('abby-sabrina-isa',  'Abby Sabrina Isa',  TRUE,  '{}'),
  ('abelene-hu',        'Abelene Hu',        TRUE,  '{}'),
  ('akshay-chawla',     'Akshay Chawla',     TRUE,  '{}'),
  ('alan-fu',           'Alan Fu',           TRUE,  '{}'),
  ('alex-yap',          'Alex Yap',          TRUE,  '{}'),
  ('allen',             'Allen',             TRUE,  '{}'),
  ('andrew-ang',        'Andrew Ang',        TRUE,  '{}'),
  ('angela',            'Angela',            TRUE,  '{}'),
  ('angela-lai',        'Angela Lai',        TRUE,  '{}'),
  ('anson-kuah',        'Anson Kuah',        TRUE,  '{}'),
  ('audrey',            'Audrey',            TRUE,  '{}'),
  ('bee-hoon',          'Bee Hoon',          TRUE,  '{}'),
  ('benjamin-song',     'Benjamin Song',     TRUE,  '{}'),
  ('bharati-jagdish',   'Bharati Jagdish',   TRUE,  '{}'),
  ('celina-gan',        'Celina Gan',        TRUE,  '{}'),
  ('chen-chen',         'Chen Chen',         TRUE,  '{}'),
  ('chia-wee-wee',      'Chia Wee Wee',      TRUE,  '{}'),
  ('christopher-tan',   'Christopher Tan',   TRUE,  '{}'),
  ('daniel-nathan',     'Daniel Nathan',     TRUE,  '{}'),
  ('daniel-theyagu',    'Daniel Theyagu',    TRUE,  '{}'),
  ('danny-soh',         'Danny Soh',         TRUE,  '{}'),
  ('daryl-lim',         'Daryl Lim',         TRUE,  '{}'),
  ('david-boh',         'David Boh',         TRUE,  '{}'),
  ('david-chan',         'David Chan',        TRUE,  '{}'),
  ('david-fong',        'David Fong',        TRUE,  '{}'),
  ('deleon-lim',        'Deleon Lim',        TRUE,  '{}'),
  ('donald-goh',        'Donald Goh',        TRUE,  '{}'),
  ('dr-lee',            'Dr Lee',            TRUE,  '{}'),
  ('elaine-teo',        'Elaine Teo',        TRUE,  '{}'),
  ('elizabath',         'Elizabath',         TRUE,  '{}'),
  ('eric-heng',         'Eric Heng',         TRUE,  '{}'),
  ('farhana',           'Farhana',           TRUE,  '{}'),
  ('felicia',           'Felicia',           TRUE,  '{}'),
  ('foo-nyuk-wei',      'Foo Nyuk Wei',      TRUE,  '{}'),
  ('frank-ho',          'Frank Ho',          TRUE,  '{}'),
  ('gary-goh',          'Gary Goh',          TRUE,  '{}'),
  ('gavin-chia',        'Gavin Chia',        TRUE,  '{}'),
  ('hk-fung',           'HK Fung',           TRUE,  '{}'),
  ('haja',              'Haja',              TRUE,  '{}'),
  ('han-neng',          'Han Neng',          TRUE,  '{}'),
  ('iris-cheng',        'Iris Cheng',        TRUE,  '{}'),
  ('ivan-phua',         'Ivan Phua',         TRUE,  '{}'),
  ('james-suresh',      'James Suresh',      TRUE,  '{}'),
  ('james-teo',         'James Teo',         TRUE,  '{}'),
  ('jasline-lee',       'Jasline Lee',       TRUE,  '{}'),
  ('jeffrey-goh',       'Jeffrey Goh',       TRUE,  '{}'),
  ('jeffrey-loo',       'Jeffrey Loo',       TRUE,  '{}'),
  ('jennifer-zhou',     'Jennifer Zhou',     TRUE,  '{}'),
  ('jocelyn-goh',       'Jocelyn Goh',       TRUE,  '{}'),
  ('johnson-ong',       'Johnson Ong',       TRUE,  '{}'),
  ('johnson-yeo',       'Johnson Yeo',       TRUE,  '{}'),
  ('justin-chan',        'Justin Chan',       TRUE,  '{}'),
  ('kala-rani',         'Kala Rani',         TRUE,  '{}'),
  ('katherine-chua',    'Katherine Chua',    TRUE,  '{}'),
  ('kelvin-lim',        'Kelvin Lim',        TRUE,  '{}'),
  ('kelvin-wu',         'Kelvin Wu',         TRUE,  '{}'),
  ('ken-goh',           'Ken Goh',           TRUE,  '{}'),
  ('kevin-chua',        'Kevin Chua',        TRUE,  '{}'),
  ('klenton-foo',       'Klenton Foo',       TRUE,  '{}'),
  ('koh-ys',            'Koh YS',            TRUE,  '{}'),
  ('lance-paul',        'Lance Paul',        TRUE,  '{}'),
  ('lee-chee-ngai',     'Lee Chee Ngai',     TRUE,  '{}'),
  ('leonard-tan',       'Leonard Tan',       TRUE,  '{}'),
  ('lim-hui-ling',      'Lim Hui Ling',      TRUE,  '{}'),
  ('lim-jia-he',        'Lim Jia He',        TRUE,  '{}'),
  ('lim-yan-xin',       'Lim Yan Xin',       TRUE,  '{}'),
  ('marcus-chiam',      'Marcus Chiam',      TRUE,  '{}'),
  ('martin-li',         'Martin Li',         TRUE,  '{}'),
  ('mdm-foo',           'Mdm Foo',           TRUE,  '{}'),
  ('melvyn-tan',        'Melvyn Tan',        TRUE,  '{}'),
  ('mohamed-hassan',    'Mohamed Hassan',    TRUE,  '{}'),
  ('nass',              'Nass',              TRUE,  '{}'),
  ('nelson',            'Nelson',            TRUE,  '{}'),
  ('norman',            'Norman',            TRUE,  '{ASKDBI}'),
  ('paul-lim',          'Paul Lim',          TRUE,  '{}'),
  ('pauline-lee',       'Pauline Lee',       TRUE,  '{}'),
  ('peter-low',         'Peter Low',         TRUE,  '{}'),
  ('philip-gan',        'Philip Gan',        TRUE,  '{}'),
  ('priscilla-tan',     'Priscilla Tan',     TRUE,  '{}'),
  ('priya',             'Priya',             TRUE,  '{}'),
  ('rajpal',            'Rajpal',            TRUE,  '{}'),
  ('rasidi',            'Rasidi',            TRUE,  '{}'),
  ('ravi-agarwal',      'Ravi Agarwal',      TRUE,  '{}'),
  ('raymond-teoh',      'Raymond Teoh',      TRUE,  '{}'),
  ('richard-ng',        'Richard Ng',        TRUE,  '{}'),
  ('richard-tin',       'Richard Tin',       TRUE,  '{}'),
  ('richard-wong',      'Richard Wong',      TRUE,  '{}'),
  ('rodney',            'Rodney',            TRUE,  '{}'),
  ('s-a-lim',           'S A Lim',           TRUE,  '{}'),
  ('sam',               'Sam',               FALSE, '{ASKVEG}'),
  ('sandra',            'Sandra',            TRUE,  '{}'),
  ('sarbojit',          'Sarbojit',          TRUE,  '{}'),
  ('say-toon',          'Say Toon',          TRUE,  '{}'),
  ('shashi',            'Shashi',            TRUE,  '{}'),
  ('sherie-poh',        'Sherie Poh',        TRUE,  '{}'),
  ('stella',            'Stella',            TRUE,  '{}'),
  ('swee-chye',         'Swee Chye',         TRUE,  '{}'),
  ('tan-kwan-liang',    'Tan Kwan Liang',    TRUE,  '{}'),
  ('tay-jo-lin',        'Tay Jo Lin',        TRUE,  '{}'),
  ('timothy-ng',        'Timothy Ng',        TRUE,  '{}'),
  ('toh-tai-ann',       'Toh Tai Ann',       TRUE,  '{}'),
  ('tylus-lim',         'Tylus Lim',         TRUE,  '{}'),
  ('val',               'Val',               TRUE,  '{}'),
  ('valene',            'Valene',            TRUE,  '{}'),
  ('victor-pow',        'Victor Pow',        TRUE,  '{}'),
  ('vincent-su',        'Vincent Su',        TRUE,  '{}'),
  ('wan-ting',          'Wan Ting',           TRUE,  '{}'),
  ('weng-kam',          'Weng Kam',          TRUE,  '{}'),
  ('william-ho',        'William Ho',        TRUE,  '{}'),
  ('winnie-liu',        'Winnie Liu',        TRUE,  '{}'),
  ('yathima',           'Yathima',           TRUE,  '{}'),
  ('yong-weng-hong',    'Yong Weng Hong',    TRUE,  '{}'),
  ('zaid',              'Zaid',              TRUE,  '{}');

-- ---------------------------------------------------------------------------
-- Trainer ↔ Tier Assignments
-- Note: Some trainer_ids here use short-form names from the rate Excel
-- (e.g. "philip" not "philip-gan"). These will be resolved via
-- trainer_aliases in PR2. For now they reference trainers directly
-- where possible; aliased entries use the canonical trainer_id.
-- ---------------------------------------------------------------------------
-- We map the rate-Excel short names to canonical trainer_ids where we can.
-- Entries that need alias resolution are commented with their rate-Excel name.

INSERT INTO trainer_tier_assignments (trainer_id, trainer_name, programme_category, tier_code) VALUES
  -- IIO (19 trainers)
  ('alan-fu',       'Alan Fu',       'IIO', 'IIO-T1'),
  ('jennifer-zhou', 'Jennifer Zhou', 'IIO', 'IIO-T1'),
  ('gavin-chia',    'Gavin Chia',    'IIO', 'IIO-T2'),
  ('weng-kam',      'Weng Kam',      'IIO', 'IIO-T3'),
  ('danny-soh',     'Danny Soh',     'IIO', 'IIO-T4'),
  ('johnson-yeo',   'Johnson Yeo',   'IIO', 'IIO-T4'),
  ('ken-goh',       'Ken Goh',       'IIO', 'IIO-T5'),
  ('han-neng',      'Han Neng',      'IIO', 'IIO-T5'),   -- rate Excel: "Nan Heng"
  ('alex-yap',      'Alex Yap',      'IIO', 'IIO-T5'),
  ('say-toon',      'Say Toon',      'IIO', 'IIO-T6'),
  ('rajpal',        'Rajpal',        'IIO', 'IIO-T7'),
  ('william-ho',    'William Ho',    'IIO', 'IIO-T8'),
  ('philip-gan',    'Philip Gan',    'IIO', 'IIO-T9'),   -- rate Excel: "Philip"
  ('sarbojit',      'Sarbojit',      'IIO', 'IIO-T10'),
  ('frank-ho',      'Frank Ho',      'IIO', 'IIO-T11'),
  ('kelvin-lim',    'Kelvin Lim',    'IIO', 'IIO-T12'),
  ('hk-fung',       'HK Fung',       'IIO', 'IIO-T13'),
  ('s-a-lim',       'S A Lim',       'IIO', 'IIO-T14'),
  ('kelvin-wu',     'Kelvin Wu',     'IIO', 'IIO-T15'),
  -- DM (34 trainers)
  ('abby-sabrina-isa', 'Abby Sabrina Isa', 'DM', 'DM-T1'),  -- rate Excel: "Abby"
  ('deleon-lim',    'Deleon Lim',    'DM', 'DM-T2'),
  ('foo-nyuk-wei',  'Foo Nyuk Wei',  'DM', 'DM-T2'),
  ('lim-hui-ling',  'Lim Hui Ling',  'DM', 'DM-T2'),
  ('marcus-chiam',  'Marcus Chiam',  'DM', 'DM-T2'),
  ('jeffrey-loo',   'Jeffrey Loo',   'DM', 'DM-T3'),
  ('victor-pow',    'Victor Pow',    'DM', 'DM-T4'),
  ('allen',         'Allen Wong',    'DM', 'DM-T4'),   -- rate Excel: "Allen Wong"; trainer_id is "allen"
  ('norman',        'Norman Lau',    'DM', 'DM-T4'),   -- rate Excel: "Norman Lau"; trainer_id is "norman"
  ('abelene-hu',    'Abelene Hu',    'DM', 'DM-T5'),
  ('kala-rani',     'Kala Rani',     'DM', 'DM-T5'),
  ('klenton-foo',   'Klenton Foo',   'DM', 'DM-T5'),
  ('martin-li',     'Martin Li',     'DM', 'DM-T5'),
  ('eric-heng',     'Eric Heng',     'DM', 'DM-T6'),
  ('kevin-chua',    'Kevin Chua',    'DM', 'DM-T6'),
  ('lance-paul',    'Lance Paul',    'DM', 'DM-T6'),
  ('lim-jia-he',    'Lim Jia He',    'DM', 'DM-T6'),
  ('rodney',        'Rodney',        'DM', 'DM-T7'),
  ('raymond-teoh',  'Raymond Teoh',  'DM', 'DM-T8'),
  ('elaine-teo',    'Elaine Teo',    'DM', 'DM-T9'),
  ('benjamin-song', 'Benjamin Song', 'DM', 'DM-T10'),
  ('david-boh',     'David Boh',     'DM', 'DM-T10'),
  ('david-fong',    'David Fong',    'DM', 'DM-T10'),
  ('jocelyn-goh',   'Jocelyn Goh',   'DM', 'DM-T10'),
  ('timothy-ng',    'Timothy Ng',    'DM', 'DM-T10'),
  ('tylus-lim',     'Tylus Lim',     'DM', 'DM-T10'),
  ('frank-ho',      'Frank Ho',      'DM', 'DM-T11'),
  ('melvyn-tan',    'Melvyn Tan',    'DM', 'DM-T12'),  -- rate Excel: "Melvyn"
  ('paul-lim',      'Paul Lim',      'DM', 'DM-T13'),
  ('richard-wong',  'Richard Wong',  'DM', 'DM-T14'),
  ('richard-ng',    'Richard Ng',    'DM', 'DM-T15'),
  ('david-chan',     'David Chan',    'DM', 'DM-T16'),
  ('elizabath',     'Elizabath',     'DM', 'DM-T17'),
  ('koh-ys',        'Koh YS',        'DM', 'DM-T17'),
  -- IT-Normal (9 trainer entries)
  ('victor-pow',    'Victor Pow',    'IT-Normal', 'IT-Normal-T1'),  -- rate Excel: "Victor"
  ('richard-tin',   'Richard Tin',   'IT-Normal', 'IT-Normal-T2'),
  ('winnie-liu',    'Winnie Liu',    'IT-Normal', 'IT-Normal-T3'),  -- rate Excel: "Winnie"
  ('philip-gan',    'Philip Gan',    'IT-Normal', 'IT-Normal-T3'),  -- rate Excel: "Philip"
  ('priscilla-tan', 'Priscilla Tan', 'IT-Normal', 'IT-Normal-T3'),  -- rate Excel: "Priscilla"
  ('pauline-lee',   'Pauline Lee',   'IT-Normal', 'IT-Normal-T3'),  -- rate Excel: "Pauline"
  ('sherie-poh',    'Sherie Poh',    'IT-Normal', 'IT-Normal-T4'),
  ('valene',        'Valene',        'IT-Normal', 'IT-Normal-T4'),
  ('stella',        'Stella',        'IT-Normal', 'IT-Normal-T5'),
  -- IT-WSQ (9 trainer entries)
  ('felicia',       'Felicia Lim',   'IT-WSQ', 'IT-WSQ-T1'),   -- rate Excel: "Felicia Lim"; trainer_id "felicia"
  ('victor-pow',    'Victor Pow',    'IT-WSQ', 'IT-WSQ-T2'),   -- rate Excel: "Victor"
  ('kala-rani',     'Kala Rani',     'IT-WSQ', 'IT-WSQ-T3'),   -- rate Excel: "Kala"
  ('richard-tin',   'Richard Tin',   'IT-WSQ', 'IT-WSQ-T3'),
  ('winnie-liu',    'Winnie Liu',    'IT-WSQ', 'IT-WSQ-T4'),
  ('philip-gan',    'Philip Gan',    'IT-WSQ', 'IT-WSQ-T4'),
  ('priscilla-tan', 'Priscilla Tan', 'IT-WSQ', 'IT-WSQ-T4'),
  ('pauline-lee',   'Pauline Lee',   'IT-WSQ', 'IT-WSQ-T4'),
  ('lim-yan-xin',   'Lim Yan Xin',  'IT-WSQ', 'IT-WSQ-T5'),   -- rate Excel: "Yan Xin"
  -- IT-Special (5 trainer entries)
  ('winnie-liu',    'Winnie Liu',    'IT-Special', 'IT-Special-T1'),
  ('priscilla-tan', 'Priscilla Tan', 'IT-Special', 'IT-Special-T1'),
  ('pauline-lee',   'Pauline Lee',   'IT-Special', 'IT-Special-T1'),
  ('valene',        'Valene',        'IT-Special', 'IT-Special-T2'),
  ('stella',        'Stella',        'IT-Special', 'IT-Special-T3');

-- ---------------------------------------------------------------------------
-- Trainer Aliases — initial set from known mismatches (rate Excel short names)
-- Populated further in PR2 when we have the schedule Excel parser.
-- ---------------------------------------------------------------------------
INSERT INTO trainer_aliases (trainer_id, alias_name, source) VALUES
  ('allen',         'Allen Wong',     'rate_excel'),
  ('norman',        'Norman Lau',     'rate_excel'),
  ('philip-gan',    'Philip',         'rate_excel'),
  ('winnie-liu',    'Winnie',         'rate_excel'),
  ('victor-pow',    'Victor',         'rate_excel'),
  ('kala-rani',     'Kala',           'rate_excel'),
  ('priscilla-tan', 'Priscilla',      'rate_excel'),
  ('pauline-lee',   'Pauline',        'rate_excel'),
  ('abby-sabrina-isa', 'Abby',        'rate_excel'),
  ('melvyn-tan',    'Melvyn',         'rate_excel'),
  ('felicia',       'Felicia Lim',    'rate_excel'),
  ('lim-yan-xin',   'Yan Xin',        'rate_excel'),
  ('han-neng',      'Nan Heng',       'rate_excel');

-- Note: trainer_courses seed (929 rows) is loaded via a separate import script
-- in PR2, not inlined here, to keep this file manageable.

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
