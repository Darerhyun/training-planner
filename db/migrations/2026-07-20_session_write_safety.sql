-- =============================================================================
-- Migration: Session write safety and trainer-change audit
-- Date: 2026-07-20
--
-- Adds application/import ownership, optimistic versioning, and trainer-change
-- audit history. Existing sessions remain import-managed at version 1.
-- Idempotent: safe to run more than once.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_management_source') THEN
    CREATE TYPE session_management_source AS ENUM ('import', 'application');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_change_action') THEN
    CREATE TYPE session_change_action AS ENUM (
      'trainer_assigned',
      'trainer_replaced',
      'trainer_unassigned'
    );
  END IF;
END
$$;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS management_source session_management_source NOT NULL DEFAULT 'import',
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS app_managed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app_managed_by UUID REFERENCES users (id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_sessions_version_positive'
      AND conrelid = 'sessions'::regclass
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT chk_sessions_version_positive CHECK (version > 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sessions_management_source ON sessions (management_source);
CREATE INDEX IF NOT EXISTS idx_sessions_app_managed_by ON sessions (app_managed_by);

CREATE TABLE IF NOT EXISTS session_change_history (
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

CREATE INDEX IF NOT EXISTS idx_session_change_history_session_created
  ON session_change_history (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_change_history_actor
  ON session_change_history (actor_user_id);