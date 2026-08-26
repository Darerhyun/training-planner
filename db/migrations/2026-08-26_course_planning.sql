-- =============================================================================
-- Migration: Future Course Planning
-- Date: 2026-08-26
--
-- Adds one persistent row per planned course run. Rows move forward from
-- proposed to approved to scheduled; scheduling links exactly one application-
-- managed draft Session. Existing data is not changed or backfilled.
--
-- Idempotent: enum creation is guarded and table/index creation uses IF NOT
-- EXISTS. The complete table definition is created atomically on first apply.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'planned_course_run_status') THEN
    CREATE TYPE planned_course_run_status AS ENUM ('proposed', 'approved', 'scheduled');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS planned_course_runs (
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

CREATE INDEX IF NOT EXISTS idx_planned_course_runs_month_venue
  ON planned_course_runs (planning_month, venue_code);
CREATE INDEX IF NOT EXISTS idx_planned_course_runs_course
  ON planned_course_runs (course_code);
CREATE INDEX IF NOT EXISTS idx_planned_course_runs_status
  ON planned_course_runs (status);
