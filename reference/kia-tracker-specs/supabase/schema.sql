-- Kia Mont-Laurier Deal Tracker — Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'salesperson' CHECK (role IN ('admin', 'salesperson')),
  language_pref TEXT NOT NULL DEFAULT 'en' CHECK (language_pref IN ('en', 'fr')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- DEALS TABLE
-- ============================================
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Deal Status
  deal_status TEXT NOT NULL DEFAULT 'open' CHECK (deal_status IN ('open', 'complete', 'cancelled')),

  -- Vehicle Info
  stock_number TEXT,
  vin TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  color TEXT,
  vehicle_source TEXT,
  vehicle_status TEXT DEFAULT 'incoming' CHECK (vehicle_status IN ('incoming', 'at_garage', 'delivered')),
  sale_type TEXT CHECK (sale_type IN ('retail', 'wholesale')),
  listed_online BOOLEAN DEFAULT false,

  -- Deal Info
  customer_name TEXT,
  customer_address TEXT,
  customer_phone TEXT,
  has_cosigner BOOLEAN DEFAULT false,
  cosigner_name TEXT,
  salesperson_name TEXT,
  financing_bank TEXT,
  finance_status TEXT DEFAULT 'pending' CHECK (finance_status IN ('pending', 'approved', 'funded')),
  money_down_amount DECIMAL(10,2) DEFAULT 0,
  money_down_collected BOOLEAN DEFAULT false,
  cash_back_amount DECIMAL(10,2) DEFAULT 0,
  cash_back_sent BOOLEAN DEFAULT false,
  accessories TEXT,
  native_status BOOLEAN DEFAULT false,

  -- Delivery Info
  delivery_date TIMESTAMPTZ,
  driver_booked_date TIMESTAMPTZ,
  chaser_vehicle_info TEXT,
  pickup_location TEXT,
  delivery_address TEXT,
  licensing_province TEXT CHECK (licensing_province IN ('ontario', 'quebec', 'other')),
  licensing_completed BOOLEAN DEFAULT false,
  photos_taken BOOLEAN DEFAULT false,
  wet_ink_signed BOOLEAN DEFAULT false,
  idv_completed BOOLEAN DEFAULT false,

  -- Trade-In Info
  has_trade_in BOOLEAN DEFAULT false,
  trade_year INTEGER,
  trade_make TEXT,
  trade_model TEXT,
  trade_color TEXT,
  trade_plate TEXT,
  trade_vin TEXT,
  trade_stock_number TEXT,
  has_lien BOOLEAN DEFAULT false,
  lien_bank TEXT,
  lien_amount DECIMAL(10,2) DEFAULT 0,

  -- Sold Info
  is_sold BOOLEAN DEFAULT false,
  sold_type TEXT CHECK (sold_type IN ('retail', 'wholesale')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_deals_stock_number ON deals(stock_number);
CREATE INDEX idx_deals_vin ON deals(vin);
CREATE INDEX idx_deals_customer_name ON deals(customer_name);
CREATE INDEX idx_deals_salesperson ON deals(salesperson_name);
CREATE INDEX idx_deals_deal_status ON deals(deal_status);
CREATE INDEX idx_deals_vehicle_status ON deals(vehicle_status);
CREATE INDEX idx_deals_finance_status ON deals(finance_status);
CREATE INDEX idx_deals_sale_type ON deals(sale_type);
CREATE INDEX idx_deals_created_at ON deals(created_at);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

-- Users: anyone authenticated can read all users, insert themselves
CREATE POLICY "Users are viewable by all authenticated users"
  ON users FOR SELECT
  USING (true);

CREATE POLICY "Users can insert themselves"
  ON users FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update their own record"
  ON users FOR UPDATE
  USING (true);

-- Deals: all authenticated users can CRUD all deals (team-shared)
CREATE POLICY "Deals are viewable by all authenticated users"
  ON deals FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert deals"
  ON deals FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update deals"
  ON deals FOR UPDATE
  USING (true);

CREATE POLICY "Authenticated users can delete deals"
  ON deals FOR DELETE
  USING (true);

-- ============================================
-- ENABLE REALTIME
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE deals;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
