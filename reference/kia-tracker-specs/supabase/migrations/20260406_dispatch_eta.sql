-- ============================================
-- DRIVER DISPATCH — ETA + Driver Assignment
-- Core Module Story M-005
-- ============================================

ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS driver_name TEXT;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS driver_phone TEXT;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS driver_vehicle TEXT;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS eta_departure TIMESTAMPTZ;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS eta_arrival TIMESTAMPTZ;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS actual_departure TIMESTAMPTZ;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS actual_arrival TIMESTAMPTZ;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS dispatch_status TEXT DEFAULT 'assigned'
  CHECK (dispatch_status IN ('assigned', 'departed', 'arrived', 'completed', 'cancelled'));
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS customer_notified BOOLEAN DEFAULT false;
ALTER TABLE dispatch_assignments ADD COLUMN IF NOT EXISTS customer_notified_at TIMESTAMPTZ;
