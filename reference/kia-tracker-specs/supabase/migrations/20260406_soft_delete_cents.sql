-- ============================================
-- SOFT DELETES + FINANCIAL PRECISION (INTEGER CENTS)
-- Foundation Story F-007
-- ============================================

-- 1. Add deleted_at to tables that don't have it yet
-- (contacts already has deleted_at from F-003)

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'deals', 'users', 'salespeople', 'commissions',
    'delivery_checklists', 'sourced_units',
    'chaser_vehicles', 'dealer_plates', 'dispatch_assignments'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'deleted_at'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN deleted_at TIMESTAMPTZ', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_deleted_at ON %I(deleted_at)', t, t);
    END IF;
  END LOOP;
END;
$$;

-- 2. Convert money columns from DECIMAL to INTEGER (cents)
-- deals: money_down_amount, cash_back_amount, lien_amount, sale_price, vehicle_cost, fi_reserve
-- commissions: amount, override_amount
-- contacts: lifetime_value
-- stores: (tax_rate stays as decimal — it's a rate, not money)

-- Step 2a: Rename old columns, create new integer columns, migrate data, drop old

-- deals.money_down_amount
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'money_down_amount' AND data_type = 'numeric') THEN
    ALTER TABLE deals RENAME COLUMN money_down_amount TO money_down_amount_old;
    ALTER TABLE deals ADD COLUMN money_down_amount INTEGER DEFAULT 0;
    UPDATE deals SET money_down_amount = ROUND(COALESCE(money_down_amount_old, 0) * 100)::INTEGER;
    ALTER TABLE deals DROP COLUMN money_down_amount_old;
  END IF;
END $$;

-- deals.cash_back_amount
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'cash_back_amount' AND data_type = 'numeric') THEN
    ALTER TABLE deals RENAME COLUMN cash_back_amount TO cash_back_amount_old;
    ALTER TABLE deals ADD COLUMN cash_back_amount INTEGER DEFAULT 0;
    UPDATE deals SET cash_back_amount = ROUND(COALESCE(cash_back_amount_old, 0) * 100)::INTEGER;
    ALTER TABLE deals DROP COLUMN cash_back_amount_old;
  END IF;
END $$;

-- deals.lien_amount
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'lien_amount' AND data_type = 'numeric') THEN
    ALTER TABLE deals RENAME COLUMN lien_amount TO lien_amount_old;
    ALTER TABLE deals ADD COLUMN lien_amount INTEGER DEFAULT 0;
    UPDATE deals SET lien_amount = ROUND(COALESCE(lien_amount_old, 0) * 100)::INTEGER;
    ALTER TABLE deals DROP COLUMN lien_amount_old;
  END IF;
END $$;

-- deals.sale_price
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'sale_price' AND data_type = 'numeric') THEN
    ALTER TABLE deals RENAME COLUMN sale_price TO sale_price_old;
    ALTER TABLE deals ADD COLUMN sale_price INTEGER DEFAULT 0;
    UPDATE deals SET sale_price = ROUND(COALESCE(sale_price_old, 0) * 100)::INTEGER;
    ALTER TABLE deals DROP COLUMN sale_price_old;
  END IF;
END $$;

-- deals.vehicle_cost
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'vehicle_cost' AND data_type = 'numeric') THEN
    ALTER TABLE deals RENAME COLUMN vehicle_cost TO vehicle_cost_old;
    ALTER TABLE deals ADD COLUMN vehicle_cost INTEGER DEFAULT 0;
    UPDATE deals SET vehicle_cost = ROUND(COALESCE(vehicle_cost_old, 0) * 100)::INTEGER;
    ALTER TABLE deals DROP COLUMN vehicle_cost_old;
  END IF;
END $$;

-- deals.fi_reserve
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'fi_reserve' AND data_type = 'numeric') THEN
    ALTER TABLE deals RENAME COLUMN fi_reserve TO fi_reserve_old;
    ALTER TABLE deals ADD COLUMN fi_reserve INTEGER DEFAULT 0;
    UPDATE deals SET fi_reserve = ROUND(COALESCE(fi_reserve_old, 0) * 100)::INTEGER;
    ALTER TABLE deals DROP COLUMN fi_reserve_old;
  END IF;
END $$;

-- contacts.lifetime_value
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'lifetime_value' AND data_type = 'numeric') THEN
    ALTER TABLE contacts RENAME COLUMN lifetime_value TO lifetime_value_old;
    ALTER TABLE contacts ADD COLUMN lifetime_value INTEGER DEFAULT 0;
    UPDATE contacts SET lifetime_value = ROUND(COALESCE(lifetime_value_old, 0) * 100)::INTEGER;
    ALTER TABLE contacts DROP COLUMN lifetime_value_old;
  END IF;
END $$;
