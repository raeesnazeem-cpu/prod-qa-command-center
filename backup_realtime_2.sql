-- Fix pages table status constraint to include 'screenshotted' and 'failed' (renamed from 'error' for consistency)
ALTER TABLE pages DROP CONSTRAINT pages_status_check;
ALTER TABLE pages ADD CONSTRAINT pages_status_check CHECK (status IN ('pending', 'processing', 'screenshotted', 'done', 'failed'));

-- Update any existing 'error' statuses to 'failed'
UPDATE pages SET status = 'failed' WHERE status = 'error';
