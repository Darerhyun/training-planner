-- =============================================================================
-- Migration: Admin Trainer Directory schema foundation
-- Date: 2026-09-08
--
-- Adds the PR3J trainer lifecycle, normalized eligibility exclusions, aliases
-- uniqueness, and immutable trainer history. `trainer_course_exclusions` is
-- authoritative; the legacy `trainers.module_excludes` array is retained as a
-- rollback-compatible projection and is synchronized during this migration.
-- Future eligibility writes must update both representations in one API
-- transaction. A bidirectional trigger is intentionally not added because
-- legacy import writes still target the array and could create unsafe recursive
-- reconciliation. Readiness grandfathering is claimed by a durable marker and
-- shared with the fresh-bootstrap reference-data finalizer.
--
-- Additive and idempotent: safe to run repeatedly. The duplicate-alias
-- preflight runs before any DDL/DML and deliberately aborts rather than
-- silently selecting a winner.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight: normalized alias uniqueness
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  duplicate_aliases TEXT;
BEGIN
  SELECT string_agg(normalized_alias, ', ' ORDER BY normalized_alias)
    INTO duplicate_aliases
  FROM (
    SELECT lower(btrim(alias_name)) AS normalized_alias
    FROM trainer_aliases
    GROUP BY lower(btrim(alias_name))
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_aliases IS NOT NULL THEN
    RAISE EXCEPTION
      'PR3J migration stopped: duplicate normalized trainer aliases: %',
      duplicate_aliases;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Enum types
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scheduling_readiness') THEN
    CREATE TYPE scheduling_readiness AS ENUM ('needs_setup', 'ready');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'readiness_origin') THEN
    CREATE TYPE readiness_origin AS ENUM ('grandfathered', 'admin_confirmed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trainer_change_event_action') THEN
    CREATE TYPE trainer_change_event_action AS ENUM (
      'trainer_created',
      'trainer_updated',
      'trainer_deactivated',
      'trainer_reactivated',
      'alias_added',
      'alias_removed',
      'course_access_changed',
      'scheduling_readiness_changed'
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Trainer lifecycle and optimistic-version fields
-- ---------------------------------------------------------------------------
ALTER TABLE trainers
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scheduling_readiness scheduling_readiness NOT NULL DEFAULT 'needs_setup',
  ADD COLUMN IF NOT EXISTS readiness_origin readiness_origin,
  ADD COLUMN IF NOT EXISTS readiness_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_confirmed_by UUID REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS readiness_version INTEGER,
  ADD COLUMN IF NOT EXISTS eligibility_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS exclusions_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exclusions_acknowledged_by UUID REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS exclusions_acknowledged_version INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trainers_version_positive'
      AND conrelid = 'trainers'::regclass
  ) THEN
    ALTER TABLE trainers
      ADD CONSTRAINT chk_trainers_version_positive CHECK (version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trainers_eligibility_version_positive'
      AND conrelid = 'trainers'::regclass
  ) THEN
    ALTER TABLE trainers
      ADD CONSTRAINT chk_trainers_eligibility_version_positive
      CHECK (eligibility_version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trainers_readiness_version_positive'
      AND conrelid = 'trainers'::regclass
  ) THEN
    ALTER TABLE trainers
      ADD CONSTRAINT chk_trainers_readiness_version_positive
      CHECK (readiness_version IS NULL OR readiness_version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trainers_readiness_version_current'
      AND conrelid = 'trainers'::regclass
  ) THEN
    ALTER TABLE trainers
      ADD CONSTRAINT chk_trainers_readiness_version_current
      CHECK (readiness_version IS NULL OR readiness_version <= version);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trainers_readiness_state'
      AND conrelid = 'trainers'::regclass
  ) THEN
    ALTER TABLE trainers
      ADD CONSTRAINT chk_trainers_readiness_state CHECK (
        (scheduling_readiness = 'ready'
          AND readiness_origin IS NOT NULL
          AND readiness_version IS NOT NULL)
        OR (scheduling_readiness = 'needs_setup'
          AND readiness_origin IS NULL
          AND readiness_confirmed_at IS NULL
          AND readiness_confirmed_by IS NULL
          AND readiness_version IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trainers_readiness_origin'
      AND conrelid = 'trainers'::regclass
  ) THEN
    ALTER TABLE trainers
      ADD CONSTRAINT chk_trainers_readiness_origin CHECK (
        (readiness_origin = 'admin_confirmed'
          AND readiness_confirmed_at IS NOT NULL
          AND readiness_confirmed_by IS NOT NULL)
        OR (readiness_origin = 'grandfathered'
          AND readiness_confirmed_at IS NULL
          AND readiness_confirmed_by IS NULL)
        OR (readiness_origin IS NULL
          AND readiness_confirmed_at IS NULL
          AND readiness_confirmed_by IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trainers_exclusions_acknowledgement'
      AND conrelid = 'trainers'::regclass
  ) THEN
    ALTER TABLE trainers
      ADD CONSTRAINT chk_trainers_exclusions_acknowledgement CHECK (
        (exclusions_acknowledged_at IS NULL
          AND exclusions_acknowledged_by IS NULL
          AND exclusions_acknowledged_version IS NULL)
        OR (exclusions_acknowledged_at IS NOT NULL
          AND exclusions_acknowledged_by IS NOT NULL
          AND exclusions_acknowledged_version IS NOT NULL
          AND exclusions_acknowledged_version = eligibility_version)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trainers_notes_length'
      AND conrelid = 'trainers'::regclass
  ) THEN
    ALTER TABLE trainers
      ADD CONSTRAINT chk_trainers_notes_length CHECK (
        notes IS NULL OR char_length(notes) <= 500
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Normalized alias uniqueness
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_aliases_alias_name_normalized
  ON trainer_aliases (lower(btrim(alias_name)));

-- ---------------------------------------------------------------------------
-- 4. Authoritative normalized exclusions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trainer_course_exclusions (
  trainer_id  TEXT NOT NULL REFERENCES trainers (trainer_id) ON UPDATE CASCADE,
  course_code TEXT NOT NULL REFERENCES courses (code) ON UPDATE CASCADE,
  PRIMARY KEY (trainer_id, course_code)
);

CREATE INDEX IF NOT EXISTS idx_trainer_course_exclusions_course
  ON trainer_course_exclusions (course_code);

-- Stop before inserting if a legacy array names no catalog course. The FK is
-- intentional: an exclusion must always identify a canonical course.
DO $$
DECLARE
  unknown_exclusions TEXT;
BEGIN
  SELECT string_agg(trainer_id || ':' || course_code, ', ' ORDER BY trainer_id, course_code)
    INTO unknown_exclusions
  FROM (
    SELECT DISTINCT t.trainer_id, btrim(exclusions.exclusion_code) AS course_code
    FROM trainers AS t
    CROSS JOIN LATERAL unnest(COALESCE(t.module_excludes, ARRAY[]::TEXT[]))
      AS exclusions(exclusion_code)
    LEFT JOIN courses AS c
      ON c.code = btrim(exclusions.exclusion_code)
    WHERE btrim(exclusions.exclusion_code) <> ''
      AND c.code IS NULL
  ) AS unknown;

  IF unknown_exclusions IS NOT NULL THEN
    RAISE EXCEPTION
      'PR3J migration stopped: legacy trainer exclusions reference unknown courses: %',
      unknown_exclusions;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Shared reference-data finalization and one-time readiness grandfathering
-- ---------------------------------------------------------------------------
-- The marker is claimed exactly once. The shared function also backfills and
-- rebuilds the legacy exclusion projection so migration and fresh bootstrap
-- use identical readiness/picker semantics.
CREATE TABLE IF NOT EXISTS trainer_directory_migration_state (
  migration_key TEXT PRIMARY KEY,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION finalize_trainer_directory_reference_data() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO trainer_course_exclusions (trainer_id, course_code)
  SELECT t.trainer_id, btrim(exclusions.exclusion_code)
  FROM trainers AS t
  CROSS JOIN LATERAL unnest(COALESCE(t.module_excludes, ARRAY[]::TEXT[]))
    AS exclusions(exclusion_code)
  WHERE btrim(exclusions.exclusion_code) <> ''
  ON CONFLICT (trainer_id, course_code) DO NOTHING;

  UPDATE trainers AS t
  SET module_excludes = COALESCE(
    (
      SELECT array_agg(e.course_code ORDER BY e.course_code)
      FROM trainer_course_exclusions AS e
      WHERE e.trainer_id = t.trainer_id
    ),
    ARRAY[]::TEXT[]
  )
  WHERE t.module_excludes IS DISTINCT FROM COALESCE(
    (
      SELECT array_agg(e.course_code ORDER BY e.course_code)
      FROM trainer_course_exclusions AS e
      WHERE e.trainer_id = t.trainer_id
    ),
    ARRAY[]::TEXT[]
  );

  INSERT INTO trainer_directory_migration_state (migration_key)
  VALUES ('pr3j.trainer-readiness-grandfathering.v1')
  ON CONFLICT (migration_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE trainers AS t
  SET scheduling_readiness = CASE
        WHEN t.is_active AND EXISTS (
          SELECT 1
          FROM trainer_courses AS tc
          WHERE tc.trainer_id = t.trainer_id
            AND NOT EXISTS (
              SELECT 1
              FROM trainer_course_exclusions AS e
              WHERE e.trainer_id = tc.trainer_id
                AND e.course_code = tc.course_code
            )
        ) THEN 'ready'::scheduling_readiness
        ELSE 'needs_setup'::scheduling_readiness
      END,
      readiness_origin = CASE
        WHEN t.is_active AND EXISTS (
          SELECT 1
          FROM trainer_courses AS tc
          WHERE tc.trainer_id = t.trainer_id
            AND NOT EXISTS (
              SELECT 1
              FROM trainer_course_exclusions AS e
              WHERE e.trainer_id = tc.trainer_id
                AND e.course_code = tc.course_code
            )
        ) THEN 'grandfathered'::readiness_origin
        ELSE NULL
      END,
      readiness_version = CASE
        WHEN t.is_active AND EXISTS (
          SELECT 1
          FROM trainer_courses AS tc
          WHERE tc.trainer_id = t.trainer_id
            AND NOT EXISTS (
              SELECT 1
              FROM trainer_course_exclusions AS e
              WHERE e.trainer_id = tc.trainer_id
                AND e.course_code = tc.course_code
            )
        ) THEN t.version
        ELSE NULL
      END
  WHERE t.scheduling_readiness = 'needs_setup'
    AND t.readiness_origin IS NULL
    AND t.version = 1
    AND t.eligibility_version = 1;
END
$$;

SELECT finalize_trainer_directory_reference_data();

-- ---------------------------------------------------------------------------
-- 6. Immutable trainer history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trainer_change_events (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id                    TEXT NOT NULL REFERENCES trainers (trainer_id),
  actor_user_id                 UUID NOT NULL REFERENCES users (id),
  action                        trainer_change_event_action NOT NULL,
  previous_is_active            BOOLEAN,
  new_is_active                 BOOLEAN,
  previous_scheduling_readiness scheduling_readiness,
  new_scheduling_readiness      scheduling_readiness,
  previous_version              INTEGER,
  new_version                   INTEGER,
  previous_eligibility_version  INTEGER,
  new_eligibility_version       INTEGER,
  note                          TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  metadata                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_trainer_event_previous_version_positive CHECK (
    previous_version IS NULL OR previous_version > 0
  ),
  CONSTRAINT chk_trainer_event_new_version_positive CHECK (
    new_version IS NULL OR new_version > 0
  ),
  CONSTRAINT chk_trainer_event_previous_eligibility_version_positive CHECK (
    previous_eligibility_version IS NULL OR previous_eligibility_version > 0
  ),
  CONSTRAINT chk_trainer_event_new_eligibility_version_positive CHECK (
    new_eligibility_version IS NULL OR new_eligibility_version > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_trainer_change_events_trainer_time
  ON trainer_change_events (trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_change_events_actor
  ON trainer_change_events (actor_user_id);

CREATE OR REPLACE FUNCTION prevent_trainer_change_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'trainer_change_events is append-only';
END $$;
CREATE OR REPLACE TRIGGER trg_trainer_change_events_append_only
  BEFORE UPDATE OR DELETE ON trainer_change_events
  FOR EACH ROW EXECUTE FUNCTION prevent_trainer_change_event_mutation();
