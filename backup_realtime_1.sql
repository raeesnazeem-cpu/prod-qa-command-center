-- Enable Realtime for qa_runs and pages
alter publication supabase_realtime add table qa_runs;
alter publication supabase_realtime add table pages;

-- Create RPC for incrementing pages_processed safely
create or replace function increment_pages_processed(run_id_param uuid)
returns void
language plpgsql
security definer
as $$
begin
  update qa_runs
  set pages_processed = coalesce(pages_processed, 0) + 1
  where id = run_id_param;
end;
$$;
