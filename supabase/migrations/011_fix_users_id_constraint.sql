-- 011_fix_users_id_constraint.sql
-- Fix the users table to work with Clerk integration

-- Drop the foreign key constraint from users.id to auth.users
DO $$ 
BEGIN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_fkey;
EXCEPTION
    WHEN others THEN null;
END $$;
