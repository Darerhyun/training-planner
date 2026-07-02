-- =============================================================================
-- Migration: Programmes dimension + full-time 2026 restructure
-- Date: 2026-06-30
--
-- Adds a `programmes` lookup table to represent programme identity, lifecycle
-- status (active / obsolete) and supersession. Seeds every programme code that
-- appears in `courses` (4 active + 6 obsolete = 10 rows).
--
-- Scope of THIS migration: schema change + programmes dimension seed only.
-- The 35 full-time courses and the 459 trainer-course links are loaded by the
-- idempotent seed script (`npm run seed-reference-data`), matching the existing
-- TMS reference-data pattern.
--
-- Idempotent: safe to run more than once.
--   - enum creation guarded with a DO block
--   - CREATE TABLE / INDEX IF NOT EXISTS
--   - INSERT ... ON CONFLICT (code) DO UPDATE
--
-- No FK is added on courses.programme_code yet (intentional — avoids seed-order
-- coupling; to be added in a later migration once the data has settled).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. programme_status enum (CREATE TYPE has no IF NOT EXISTS — guard it)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'programme_status') THEN
    CREATE TYPE programme_status AS ENUM ('active', 'obsolete');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. programmes table
--    ta_eligible: programme-level flag for the future Training Assistants
--    feature. No logic is attached to it yet — column only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programmes (
  code           TEXT             PRIMARY KEY,   -- FTDM, FTIIO, DGAI, ASK, ACDM, ...
  name           TEXT             NOT NULL,
  status         programme_status NOT NULL DEFAULT 'active',
  superseded_by  TEXT             REFERENCES programmes (code),  -- self-ref; NULL unless obsolete
  ta_eligible    BOOLEAN          NOT NULL DEFAULT FALSE,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_programmes_status ON programmes (status);

-- ---------------------------------------------------------------------------
-- 3. Seed all programme codes.
--    Active rows are listed first so the obsolete rows can reference them via
--    superseded_by within the same statement.
--    Obsolete rows transcribed from docs/02-domain/obsolete_programmes_2026.csv.
-- ---------------------------------------------------------------------------
INSERT INTO programmes (code, name, status, superseded_by, ta_eligible, notes) VALUES
  -- Active
  ('FTDM',  'Diploma in Digital Marketing (Full-Time)',                            'active',   NULL,    FALSE, 'Consolidated full-time DM diploma'),
  ('FTIIO', 'Advanced Certificate in IT Infrastructure & Operations (Full-Time)',  'active',   NULL,    TRUE,  'TA-eligible: completion qualifies graduate as Training Assistant'),
  ('DGAI',  'Diploma in Generative AI',                                            'active',   NULL,    FALSE, 'New full-time GenAI diploma'),
  ('ASK',   'ASK Standalone Courses',                                              'active',   NULL,    FALSE, 'Standalone ASK catalog courses'),
  -- Obsolete (per obsolete_programmes_2026.csv)
  ('ACDM',  'Advanced Certificate in Digital Marketing',                           'obsolete', 'FTDM',  FALSE, 'Stacked cert structure retired; modules folded into full-time Diploma in DM'),
  ('DDM',   'Diploma in Digital Marketing (Modular)',                              'obsolete', 'FTDM',  FALSE, 'Folded into full-time Diploma in DM'),
  ('SDDM',  'Specialist Diploma in Digital Marketing',                             'obsolete', 'FTDM',  FALSE, 'Advanced variants dropped; SDDM unpopular/frequently cancelled'),
  ('CIIO',  'Certificate in IT Infrastructure & Operations',                       'obsolete', 'FTIIO', FALSE, 'Folded into full-time Advanced Certificate in IT I&O'),
  ('ACIIO', 'Advanced Certificate in IT Infrastructure & Operations (Modular)',    'obsolete', 'FTIIO', FALSE, 'Folded into full-time Advanced Certificate in IT I&O'),
  ('DIIO',  'Diploma in IT Infrastructure & Operations',                           'obsolete', 'FTIIO', FALSE, 'Folded into full-time Advanced Certificate in IT I&O')
ON CONFLICT (code) DO UPDATE SET
  name          = EXCLUDED.name,
  status        = EXCLUDED.status,
  superseded_by = EXCLUDED.superseded_by,
  ta_eligible   = EXCLUDED.ta_eligible,
  notes         = EXCLUDED.notes;
