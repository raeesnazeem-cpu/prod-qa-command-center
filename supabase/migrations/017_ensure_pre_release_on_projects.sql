-- Add is_pre_release flag to projects if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'projects' AND column_name = 'is_pre_release') THEN 
        ALTER TABLE projects ADD COLUMN is_pre_release boolean NOT NULL DEFAULT false; 
    END IF; 
END $$;
