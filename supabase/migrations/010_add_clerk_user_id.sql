-- 010_add_clerk_user_id.sql
-- Add clerk_user_id column for Clerk integration (alternative approach)

-- Add clerk_user_id column that will store the Clerk user ID
ALTER TABLE users ADD COLUMN clerk_user_id text UNIQUE;

-- Create index for faster lookups
CREATE INDEX idx_users_clerk_user_id ON users(clerk_user_id);

-- Add comment
COMMENT ON COLUMN users.clerk_user_id IS 'Clerk user ID for authentication integration';
