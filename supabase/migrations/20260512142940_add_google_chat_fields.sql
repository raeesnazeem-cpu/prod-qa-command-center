-- Add Google Chat settings to project_settings
ALTER TABLE project_settings 
ADD COLUMN IF NOT EXISTS google_chat_webhook_url text,
ADD COLUMN IF NOT EXISTS google_chat_enabled boolean DEFAULT false;

-- Add Google Chat User ID to users table for @mentions
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_chat_user_id text;
