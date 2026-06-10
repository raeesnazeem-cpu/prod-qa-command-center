-- ============================================================
-- seed.sql
-- Test data: one organization + one super_admin user
-- ============================================================
-- NOTE: The auth.users entry must already exist (created via
-- Supabase Auth or supabase auth admin create-user).
-- Replace the UUID below with the actual user UUID from auth.users.
-- ============================================================

DO $$
DECLARE
  v_org_id  uuid := '00000000-0000-0000-0000-000000000001';
  v_user_id uuid := '00000000-0000-0000-0000-000000000002';
BEGIN

  -- Insert test organization
  INSERT INTO organizations (id, name, created_at)
  VALUES (v_org_id, 'QACC Test Organization', now())
  ON CONFLICT (id) DO NOTHING;

  -- Insert super_admin user profile
  -- Assumes v_user_id already exists in auth.users
  INSERT INTO users (id, org_id, email, full_name, role, created_at, updated_at)
  VALUES (
    v_user_id,
    v_org_id,
    'superadmin@qacc.dev',
    'QACC Super Admin',
    'super_admin',
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

END $$;
