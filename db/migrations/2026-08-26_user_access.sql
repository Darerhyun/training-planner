-- PR3I Admin User Access. Safe to apply repeatedly in one transaction.
DO $$ BEGIN
  CREATE TYPE invitation_status AS ENUM ('pending', 'claimed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE user_access_event_action AS ENUM (
    'invite_created', 'invite_cancelled', 'invite_claimed',
    'user_approved', 'user_reapproved', 'user_rejected', 'role_changed',
    'user_deactivated', 'user_reactivated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT chk_users_version_positive CHECK (version > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (email = lower(btrim(email))),
  intended_role user_role NOT NULL CHECK (intended_role IN ('admin', 'ops', 'finance', 'viewer')),
  status invitation_status NOT NULL DEFAULT 'pending',
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  invited_by UUID NOT NULL REFERENCES users(id),
  claimed_by UUID REFERENCES users(id),
  claimed_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_invitation_lifecycle CHECK (
    (status = 'pending' AND claimed_by IS NULL AND claimed_at IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL)
    OR (status = 'claimed' AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL AND cancelled_by IS NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND claimed_by IS NULL AND claimed_at IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invitations_open_email
  ON user_invitations (email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_user_invitations_status ON user_invitations (status);

CREATE TABLE IF NOT EXISTS user_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  invitation_id UUID REFERENCES user_invitations(id),
  action user_access_event_action NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  previous_role user_role,
  new_role user_role,
  previous_is_active BOOLEAN,
  new_is_active BOOLEAN,
  previous_version INTEGER,
  new_version INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_access_events_user_time ON user_access_events (user_id, created_at DESC);
