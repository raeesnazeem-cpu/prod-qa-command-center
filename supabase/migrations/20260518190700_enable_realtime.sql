-- Safely enable Realtime replication for qa_runs, pages, and findings
do $$
begin
  -- 1. Only add 'qa_runs' if it's not already in the publication
  if not exists (
    select 1 from pg_publication_rel pr
    join pg_class c on pr.prrelid = c.oid
    join pg_publication p on pr.prpubid = p.oid
    where p.pubname = 'supabase_realtime' and c.relname = 'qa_runs'
  ) then
    alter publication supabase_realtime add table qa_runs;
  end if;

  -- 2. Only add 'pages' if it's not already in the publication
  if not exists (
    select 1 from pg_publication_rel pr
    join pg_class c on pr.prrelid = c.oid
    join pg_publication p on pr.prpubid = p.oid
    where p.pubname = 'supabase_realtime' and c.relname = 'pages'
  ) then
    alter publication supabase_realtime add table pages;
  end if;

  -- 3. Only add 'findings' if it's not already in the publication
  if not exists (
    select 1 from pg_publication_rel pr
    join pg_class c on pr.prrelid = c.oid
    join pg_publication p on pr.prpubid = p.oid
    where p.pubname = 'supabase_realtime' and c.relname = 'findings'
  ) then
    alter publication supabase_realtime add table findings;
  end if;
end $$;
