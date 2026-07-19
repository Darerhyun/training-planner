-- =============================================================================
-- Migration: Generic owned room labels from August 2026 Master Schedule
-- Date: 2026-07-19
--
-- Adds only the generic owned-room combinations observed in the August workbook.
-- Class1/Class2/Classroom are venue-scoped labels: IP and JTC versions are
-- distinct rooms. Missing combinations are intentionally not guessed.
-- =============================================================================

INSERT INTO rooms (room_id, venue_code, name, capacity, notes) VALUES
  ('ip-class1',     'IP',  'Class1',    NULL, 'Generic room label from August 2026 Master Schedule'),
  ('ip-class2',     'IP',  'Class2',    NULL, 'Generic room label from August 2026 Master Schedule'),
  ('ip-classroom',  'IP',  'Classroom', NULL, 'Generic room label from August 2026 Master Schedule'),
  ('jtc-classroom', 'JTC', 'Classroom', NULL, 'Generic room label from August 2026 Master Schedule')
ON CONFLICT (room_id) DO NOTHING;