-- Add gallery_images column to tasks table for capturing QA finding screenshots
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS gallery_images jsonb DEFAULT '[]'::jsonb;
