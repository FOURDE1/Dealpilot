-- 0019 — drop the unreachable 'pending' dispatch status.
--
-- 0017 declared `pending` and defaulted to it, but booking creates a run
-- already assigned: nothing could ever produce a pending row. Worse, the column
-- DEFAULT was 'pending', so any future insert that omitted the status would
-- land on a value the API's own schema rejects — a trap rather than a state.
--
-- 0017 is merged and applied, so it is not edited. Forward-only.

ALTER TABLE dispatch_assignments ALTER COLUMN status SET DEFAULT 'assigned';

ALTER TABLE dispatch_assignments DROP CONSTRAINT dispatch_assignments_status_check;
ALTER TABLE dispatch_assignments ADD CONSTRAINT dispatch_assignments_status_check
  CHECK (status IN ('assigned','departed','arrived','completed','cancelled'));

-- Nothing to migrate: the only writer hardcodes 'assigned'. This asserts that
-- rather than assuming it — if a pending row somehow exists, the constraint
-- above would have failed and this migration stops instead of silently
-- leaving an unreachable state behind.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dispatch_assignments WHERE status = 'pending') THEN
    RAISE EXCEPTION 'pending dispatch rows exist — decide what they should become before dropping the status';
  END IF;
END $$;
