-- Update qa_runs status check constraint to include 'paused' and 'cancelled'
ALTER TABLE qa_runs DROP CONSTRAINT IF EXISTS qa_runs_status_check;

ALTER TABLE qa_runs ADD CONSTRAINT qa_runs_status_check 
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timed_out', 'paused', 'cancelled'));
