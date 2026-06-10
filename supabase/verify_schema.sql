-- verify_schema.sql
-- Run this in the Supabase SQL Editor to verify that all tables were created correctly.

DO $$ 
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name IN (
            'organizations', 'users', 'projects', 'project_members', 
            'qa_runs', 'pages', 'findings', 'tasks', 
            'rebuttals', 'comments', 'visual_diffs', 
            'sign_offs', 'project_settings', 'embeddings'
        )
    LOOP
        RAISE NOTICE 'Found table: %', t;
    END LOOP;
END $$;

-- Check for vector extension
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Check for match_embeddings function
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name = 'match_embeddings';
