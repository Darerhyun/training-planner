-- SYNC-RESOLUTION-1: durable evidence for an acknowledged applied Preview.
-- Apply with psql --single-transaction only after a separately approved release.

ALTER TABLE upload_batches
  ADD COLUMN IF NOT EXISTS original_workbook_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS acknowledged_digest TEXT,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_upload_batches_workbook_sha256'
      AND conrelid = 'upload_batches'::regclass
  ) THEN
    ALTER TABLE upload_batches ADD CONSTRAINT chk_upload_batches_workbook_sha256
      CHECK (original_workbook_sha256 IS NULL OR original_workbook_sha256 ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_upload_batches_acknowledged_digest'
      AND conrelid = 'upload_batches'::regclass
  ) THEN
    ALTER TABLE upload_batches ADD CONSTRAINT chk_upload_batches_acknowledged_digest
      CHECK (acknowledged_digest IS NULL OR acknowledged_digest ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_upload_batches_acknowledgement_evidence'
      AND conrelid = 'upload_batches'::regclass
  ) THEN
    ALTER TABLE upload_batches ADD CONSTRAINT chk_upload_batches_acknowledgement_evidence
      CHECK (
        (acknowledged_by IS NULL AND acknowledged_digest IS NULL AND acknowledged_at IS NULL)
          OR (status = 'applied' AND applied_at IS NOT NULL AND acknowledged_by IS NOT NULL
            AND acknowledged_digest IS NOT NULL AND acknowledged_at IS NOT NULL)
      );
  END IF;
END
$$;
