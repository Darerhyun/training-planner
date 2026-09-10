-- =============================================================================
-- Migration: REFERENCE-DATA-1A canonical reference-data authority
-- Date: 2026-09-10
--
-- Adds lifecycle, optimistic concurrency, sibling aliases, namespace revision
-- counters, and append-only audit for courses, venues, and rooms. Existing
-- records are preserved as active version 1 records. No reference mapping is
-- seeded and no historical event is fabricated by this migration.
--
-- The preflight is deliberately the first statement. It rejects ambiguous
-- normalized identities and invalid legacy room ownership before any DDL/DML.
-- This file is idempotent and is intended to be run by the migration runner in
-- one transaction (the SQL itself never reads or writes production data).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Preflight: reject unsafe legacy identities before DDL/DML
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  duplicates TEXT;
  invalid_rooms TEXT;
BEGIN
  SELECT string_agg(identity, ', ' ORDER BY identity)
    INTO duplicates
  FROM (
    SELECT 'course:' || lower(btrim(code)) AS identity
    FROM courses
    GROUP BY lower(btrim(code))
    HAVING count(*) > 1
    UNION ALL
    SELECT 'venue:' || lower(btrim(code)) AS identity
    FROM venues
    GROUP BY lower(btrim(code))
    HAVING count(*) > 1
    UNION ALL
    SELECT 'room:' || lower(btrim(room_id)) AS identity
    FROM rooms
    GROUP BY lower(btrim(room_id))
    HAVING count(*) > 1
    UNION ALL
    SELECT 'course_alias:' || lower(btrim(tms_code)) AS identity
    FROM course_aliases
    GROUP BY lower(btrim(tms_code))
    HAVING count(*) > 1
  ) AS duplicate_identities;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION
      'REFERENCE-DATA-1A migration stopped: duplicate normalized identities: %',
      duplicates;
  END IF;

  -- These sibling tables are new in the approved baseline, but the guarded
  -- checks keep a partially upgraded disposable database from reaching the
  -- unique-index DDL with ambiguous aliases.
  IF to_regclass('venue_aliases') IS NOT NULL THEN
    EXECUTE $query$
      SELECT string_agg(identity, ', ' ORDER BY identity)
      FROM (
        SELECT 'venue_alias:' || lower(btrim(alias)) AS identity
        FROM venue_aliases
        GROUP BY lower(btrim(alias))
        HAVING count(*) > 1
      ) AS duplicate_aliases
    $query$ INTO duplicates;
    IF duplicates IS NOT NULL THEN
      RAISE EXCEPTION
        'REFERENCE-DATA-1A migration stopped: duplicate normalized identities: %',
        duplicates;
    END IF;
  END IF;

  IF to_regclass('room_aliases') IS NOT NULL THEN
    EXECUTE $query$
      SELECT string_agg(identity, ', ' ORDER BY identity)
      FROM (
        SELECT 'room_alias:' || lower(btrim(venue_code)) || ':' || lower(btrim(alias)) AS identity
        FROM room_aliases
        GROUP BY lower(btrim(venue_code)), lower(btrim(alias))
        HAVING count(*) > 1
      ) AS duplicate_aliases
    $query$ INTO duplicates;
    IF duplicates IS NOT NULL THEN
      RAISE EXCEPTION
        'REFERENCE-DATA-1A migration stopped: duplicate normalized identities: %',
        duplicates;
    END IF;
  END IF;

  SELECT string_agg(r.room_id || ' -> ' || COALESCE(r.venue_code, '(null)'), ', ' ORDER BY r.room_id)
    INTO invalid_rooms
  FROM rooms AS r
  LEFT JOIN venues AS v ON v.code = r.venue_code
  WHERE v.code IS NULL OR v.type::text <> 'owned';

  IF invalid_rooms IS NOT NULL THEN
    RAISE EXCEPTION
      'REFERENCE-DATA-1A migration stopped: rooms must belong to existing owned venues: %',
      invalid_rooms;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Canonical lifecycle/version fields
-- ---------------------------------------------------------------------------
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS raw_room_text TEXT;

ALTER TABLE course_aliases
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_courses_version_positive' AND conrelid = 'courses'::regclass) THEN
    ALTER TABLE courses ADD CONSTRAINT chk_courses_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_courses_notes_length' AND conrelid = 'courses'::regclass) THEN
    ALTER TABLE courses ADD CONSTRAINT chk_courses_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_venues_version_positive' AND conrelid = 'venues'::regclass) THEN
    ALTER TABLE venues ADD CONSTRAINT chk_venues_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_venues_notes_length' AND conrelid = 'venues'::regclass) THEN
    ALTER TABLE venues ADD CONSTRAINT chk_venues_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rooms_version_positive' AND conrelid = 'rooms'::regclass) THEN
    ALTER TABLE rooms ADD CONSTRAINT chk_rooms_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rooms_capacity_nonnegative' AND conrelid = 'rooms'::regclass) THEN
    ALTER TABLE rooms ADD CONSTRAINT chk_rooms_capacity_nonnegative CHECK (capacity IS NULL OR capacity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rooms_notes_length' AND conrelid = 'rooms'::regclass) THEN
    ALTER TABLE rooms ADD CONSTRAINT chk_rooms_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_course_aliases_version_positive' AND conrelid = 'course_aliases'::regclass) THEN
    ALTER TABLE course_aliases ADD CONSTRAINT chk_course_aliases_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_course_aliases_notes_length' AND conrelid = 'course_aliases'::regclass) THEN
    ALTER TABLE course_aliases ADD CONSTRAINT chk_course_aliases_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Sibling alias tables
-- ---------------------------------------------------------------------------
-- A composite key makes a room alias unable to point across venue namespaces.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_rooms_room_venue' AND conrelid = 'rooms'::regclass) THEN
    ALTER TABLE rooms ADD CONSTRAINT uq_rooms_room_venue UNIQUE (room_id, venue_code);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS venue_aliases (
  alias       TEXT PRIMARY KEY,
  venue_code  TEXT NOT NULL REFERENCES venues (code) ON UPDATE CASCADE,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_venue_aliases_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500)
);

CREATE TABLE IF NOT EXISTS room_aliases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_code  TEXT NOT NULL,
  alias       TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_room_aliases_room_venue
    FOREIGN KEY (room_id, venue_code) REFERENCES rooms (room_id, venue_code)
      ON UPDATE CASCADE,
  CONSTRAINT chk_room_aliases_alias_nonempty CHECK (char_length(btrim(alias)) > 0),
  CONSTRAINT chk_room_aliases_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_venue_aliases_alias_nonempty' AND conrelid = 'venue_aliases'::regclass) THEN
    ALTER TABLE venue_aliases ADD CONSTRAINT chk_venue_aliases_alias_nonempty CHECK (char_length(btrim(alias)) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_venue_aliases_version_positive' AND conrelid = 'venue_aliases'::regclass) THEN
    ALTER TABLE venue_aliases ADD CONSTRAINT chk_venue_aliases_version_positive CHECK (version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_room_aliases_version_positive' AND conrelid = 'room_aliases'::regclass) THEN
    ALTER TABLE room_aliases ADD CONSTRAINT chk_room_aliases_version_positive CHECK (version > 0);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_aliases_tms_code_normalized
  ON course_aliases (lower(btrim(tms_code)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_code_normalized
  ON courses (lower(btrim(code)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_code_normalized
  ON venues (lower(btrim(code)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_room_id_normalized
  ON rooms (lower(btrim(room_id)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_aliases_alias_normalized
  ON venue_aliases (lower(btrim(alias)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_aliases_venue_alias_normalized
  ON room_aliases (venue_code, lower(btrim(alias)));

-- ---------------------------------------------------------------------------
-- 3. Namespace revisions and append-only history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_data_namespace_revisions (
  namespace   TEXT PRIMARY KEY,
  revision    BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_reference_namespace CHECK (
    namespace IN ('courses', 'venues', 'rooms', 'course_aliases', 'venue_aliases', 'room_aliases')
  )
);

INSERT INTO reference_data_namespace_revisions (namespace)
VALUES
  ('courses'), ('venues'), ('rooms'),
  ('course_aliases'), ('venue_aliases'), ('room_aliases')
ON CONFLICT (namespace) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reference_data_entity') THEN
    CREATE TYPE reference_data_entity AS ENUM (
      'course', 'venue', 'room', 'course_alias', 'venue_alias', 'room_alias'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reference_data_change_action') THEN
    CREATE TYPE reference_data_change_action AS ENUM (
      'course_created', 'course_updated', 'course_deactivated', 'course_reactivated',
      'venue_created', 'venue_updated', 'venue_deactivated', 'venue_reactivated',
      'room_created', 'room_updated', 'room_deactivated', 'room_reactivated',
      'course_alias_created', 'course_alias_retargeted',
      'course_alias_deactivated', 'course_alias_reactivated',
      'venue_alias_created', 'venue_alias_retargeted',
      'venue_alias_deactivated', 'venue_alias_reactivated',
      'room_alias_created', 'room_alias_retargeted',
      'room_alias_deactivated', 'room_alias_reactivated'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS reference_data_change_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      reference_data_entity NOT NULL,
  entity_id        TEXT NOT NULL,
  namespace        TEXT NOT NULL REFERENCES reference_data_namespace_revisions (namespace),
  actor_user_id    UUID NOT NULL REFERENCES users (id),
  action           reference_data_change_action NOT NULL,
  previous_version INTEGER,
  new_version      INTEGER NOT NULL,
  previous_state   JSONB,
  new_state        JSONB NOT NULL,
  note             TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_reference_event_previous_version_positive CHECK (previous_version IS NULL OR previous_version > 0),
  CONSTRAINT chk_reference_event_new_version_positive CHECK (new_version > 0),
  CONSTRAINT chk_reference_event_note_length CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_reference_data_events_entity_time
  ON reference_data_change_events (entity_type, entity_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reference_data_events_namespace_time
  ON reference_data_change_events (namespace, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_reference_data_change_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reference_data_change_events is append-only';
END
$$;

DROP TRIGGER IF EXISTS trg_reference_data_change_events_append_only ON reference_data_change_events;
CREATE TRIGGER trg_reference_data_change_events_append_only
  BEFORE UPDATE OR DELETE ON reference_data_change_events
  FOR EACH ROW EXECUTE FUNCTION prevent_reference_data_change_event_mutation();

-- ---------------------------------------------------------------------------
-- 4. Database-level immutability and no-hard-delete guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_reference_data_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  identity_column TEXT;
BEGIN
  FOREACH identity_column IN ARRAY TG_ARGV LOOP
    IF to_jsonb(OLD)->>identity_column IS DISTINCT FROM to_jsonb(NEW)->>identity_column THEN
      RAISE EXCEPTION '% identity or scope is immutable', TG_TABLE_NAME;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION prevent_reference_data_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records and aliases are never hard-deleted', TG_TABLE_NAME;
END
$$;

CREATE OR REPLACE FUNCTION prevent_owned_venue_type_change_with_rooms() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.type = 'owned' AND NEW.type <> 'owned'
    AND EXISTS (SELECT 1 FROM rooms WHERE venue_code = OLD.code) THEN
    RAISE EXCEPTION 'owned venue type cannot change while rooms exist'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION require_active_owned_venue_for_room() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  venue_active BOOLEAN;
  venue_kind TEXT;
BEGIN
  IF NEW.is_active THEN
    SELECT v.is_active, v.type::text
      INTO venue_active, venue_kind
      FROM venues AS v
      WHERE v.code = NEW.venue_code FOR UPDATE;
    IF NOT FOUND OR venue_active IS DISTINCT FROM TRUE OR venue_kind <> 'owned' THEN
      RAISE EXCEPTION 'rooms require an active owned venue'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_courses_identity_immutable ON courses;
  CREATE TRIGGER trg_courses_identity_immutable
    BEFORE UPDATE ON courses FOR EACH ROW
    EXECUTE FUNCTION prevent_reference_data_identity_mutation('code');
  DROP TRIGGER IF EXISTS trg_venues_identity_immutable ON venues;
  CREATE TRIGGER trg_venues_identity_immutable
    BEFORE UPDATE ON venues FOR EACH ROW
    EXECUTE FUNCTION prevent_reference_data_identity_mutation('code');
  DROP TRIGGER IF EXISTS trg_rooms_identity_immutable ON rooms;
  CREATE TRIGGER trg_rooms_identity_immutable
    BEFORE UPDATE ON rooms FOR EACH ROW
    EXECUTE FUNCTION prevent_reference_data_identity_mutation('room_id', 'venue_code');
  DROP TRIGGER IF EXISTS trg_course_aliases_identity_immutable ON course_aliases;
  CREATE TRIGGER trg_course_aliases_identity_immutable
    BEFORE UPDATE ON course_aliases FOR EACH ROW
    EXECUTE FUNCTION prevent_reference_data_identity_mutation('tms_code');
  DROP TRIGGER IF EXISTS trg_venue_aliases_identity_immutable ON venue_aliases;
  CREATE TRIGGER trg_venue_aliases_identity_immutable
    BEFORE UPDATE ON venue_aliases FOR EACH ROW
    EXECUTE FUNCTION prevent_reference_data_identity_mutation('alias');
  DROP TRIGGER IF EXISTS trg_room_aliases_identity_immutable ON room_aliases;
  CREATE TRIGGER trg_room_aliases_identity_immutable
    BEFORE UPDATE ON room_aliases FOR EACH ROW
    EXECUTE FUNCTION prevent_reference_data_identity_mutation('id', 'alias', 'venue_code');

  DROP TRIGGER IF EXISTS trg_venues_type_requires_no_rooms ON venues;
  CREATE TRIGGER trg_venues_type_requires_no_rooms
    BEFORE UPDATE OF type ON venues FOR EACH ROW
    EXECUTE FUNCTION prevent_owned_venue_type_change_with_rooms();
  DROP TRIGGER IF EXISTS trg_rooms_require_active_owned_venue ON rooms;
  CREATE TRIGGER trg_rooms_require_active_owned_venue
    BEFORE INSERT OR UPDATE OF is_active, venue_code ON rooms
    FOR EACH ROW EXECUTE FUNCTION require_active_owned_venue_for_room();

  DROP TRIGGER IF EXISTS trg_courses_no_delete ON courses;
  CREATE TRIGGER trg_courses_no_delete BEFORE DELETE ON courses
    FOR EACH ROW EXECUTE FUNCTION prevent_reference_data_delete();
  DROP TRIGGER IF EXISTS trg_venues_no_delete ON venues;
  CREATE TRIGGER trg_venues_no_delete BEFORE DELETE ON venues
    FOR EACH ROW EXECUTE FUNCTION prevent_reference_data_delete();
  DROP TRIGGER IF EXISTS trg_rooms_no_delete ON rooms;
  CREATE TRIGGER trg_rooms_no_delete BEFORE DELETE ON rooms
    FOR EACH ROW EXECUTE FUNCTION prevent_reference_data_delete();
  DROP TRIGGER IF EXISTS trg_course_aliases_no_delete ON course_aliases;
  CREATE TRIGGER trg_course_aliases_no_delete BEFORE DELETE ON course_aliases
    FOR EACH ROW EXECUTE FUNCTION prevent_reference_data_delete();
  DROP TRIGGER IF EXISTS trg_venue_aliases_no_delete ON venue_aliases;
  CREATE TRIGGER trg_venue_aliases_no_delete BEFORE DELETE ON venue_aliases
    FOR EACH ROW EXECUTE FUNCTION prevent_reference_data_delete();
  DROP TRIGGER IF EXISTS trg_room_aliases_no_delete ON room_aliases;
  CREATE TRIGGER trg_room_aliases_no_delete BEFORE DELETE ON room_aliases
    FOR EACH ROW EXECUTE FUNCTION prevent_reference_data_delete();
END
$$;
