-- ============================================================
-- Kia Deal Tracker — Reporting & Analytics Migration
-- Safe to re-run — skips anything that already exists
-- ============================================================

-- 1. Add financial fields to deals table (safe — skips if exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='sale_price') THEN
    ALTER TABLE deals ADD COLUMN sale_price numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='vehicle_cost') THEN
    ALTER TABLE deals ADD COLUMN vehicle_cost numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='fi_reserve') THEN
    ALTER TABLE deals ADD COLUMN fi_reserve numeric DEFAULT 0;
  END IF;
END $$;

-- 2. Create salespeople table
CREATE TABLE IF NOT EXISTS salespeople (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  commission_rate numeric NOT NULL DEFAULT 0,
  has_pad boolean NOT NULL DEFAULT true,
  pad_amount numeric NOT NULL DEFAULT 1500,
  has_tiered_rate boolean NOT NULL DEFAULT false,
  tier_threshold numeric DEFAULT NULL,
  tier_rate numeric DEFAULT NULL,
  override_on text DEFAULT NULL,
  override_rate numeric DEFAULT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS (safe — ignores if policy exists)
ALTER TABLE salespeople ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='salespeople' AND policyname='Allow all for salespeople') THEN
    CREATE POLICY "Allow all for salespeople" ON salespeople FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. Seed salespeople (only if table is empty)
INSERT INTO salespeople (name, commission_rate, has_pad, pad_amount, has_tiered_rate, tier_threshold, tier_rate, override_on, override_rate)
SELECT * FROM (VALUES
  ('Jason Chahine',         0.30, false, 0,    false, NULL::numeric, NULL::numeric, NULL::text, NULL::numeric),
  ('Ibrahim Hussain',       0.20, true,  1500, false, NULL, NULL, NULL, NULL),
  ('Hussein Alshawi',       0.25, true,  1500, false, NULL, NULL, NULL, NULL),
  ('Hussein Hussein',       0.20, true,  1500, false, NULL, NULL, NULL, NULL),
  ('Hussain Safa',          0.20, true,  1500, false, NULL, NULL, NULL, NULL),
  ('Abdul-Alla Al-Ubeedi',  0.25, true,  1500, false, NULL, NULL, NULL, NULL),
  ('Hassan Alabboudy',      0.35, true,  1500, false, NULL, NULL, 'Hussein Alshawi', 0.05),
  ('Nicolas Sayah',         0.05, true,  1500, false, NULL, NULL, NULL, NULL),
  ('Omar Mohamed',          0.30, true,  1500, false, NULL, NULL, 'Ibrahim Hussain', 0.05),
  ('Muhammad Majid Hassan',  0.25, true,  1500, true,  60000, 0.30, NULL, NULL),
  ('Mustafa Hafid',         0.20, true,  1500, false, NULL, NULL, NULL, NULL),
  ('Michael Belway',        0.20, true,  1500, false, NULL, NULL, NULL, NULL)
) AS v(name, commission_rate, has_pad, pad_amount, has_tiered_rate, tier_threshold, tier_rate, override_on, override_rate)
WHERE NOT EXISTS (SELECT 1 FROM salespeople LIMIT 1);

-- 4. Create commissions table
CREATE TABLE IF NOT EXISTS commissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  salesperson_name text NOT NULL,
  commission_rate numeric NOT NULL,
  pad_amount numeric NOT NULL DEFAULT 0,
  gross_for_commission numeric NOT NULL DEFAULT 0,
  commission_amount numeric NOT NULL DEFAULT 0,
  override_salesperson text DEFAULT NULL,
  override_amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Add unique constraint on deal_id for upsert support
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commissions_deal_id_key') THEN
    ALTER TABLE commissions ADD CONSTRAINT commissions_deal_id_key UNIQUE (deal_id);
  END IF;
END $$;

ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='commissions' AND policyname='Allow all for commissions') THEN
    CREATE POLICY "Allow all for commissions" ON commissions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Enable realtime for new tables (safe — ignores duplicates)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE salespeople;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE commissions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
