-- ============================================
-- AUTH + RBAC — Supabase Auth Integration
-- Foundation Story F-005
-- ============================================

-- 1. Add auth_id column to users (links to auth.users)
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);

-- 2. Expand role constraint to 10 roles
-- First drop old constraint, then add new one
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'owner',
    'gm',
    'sales_manager',
    'used_car_manager',
    'fi_manager',
    'salesperson',
    'wholesale_manager',
    'logistics',
    'admin_office',
    'bdc_agent'
  ));

-- 3. Update existing users with default role if they have old roles
UPDATE users SET role = 'salesperson' WHERE role NOT IN (
  'owner', 'gm', 'sales_manager', 'used_car_manager', 'fi_manager',
  'salesperson', 'wholesale_manager', 'logistics', 'admin_office', 'bdc_agent'
);
