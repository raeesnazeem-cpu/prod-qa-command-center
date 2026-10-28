-- Point stored media URLs at the new CDN (plan §8 step 5).
--   psql -v old='https://<project>.supabase.co/storage/v1/object/public/' \
--        -v new='https://<cdn>/' -f rewrite-media-urls.sql
--
-- Files keep their path: Supabase  …/storage/v1/object/public/<bucket>/<path>
-- become                           <cdn>/<bucket>/<path>  (S3 key <bucket>/<path>).
-- Scans every text / varchar / json / jsonb column in public, so no column is
-- missed. One transaction; prints how many rows changed per column.
-- Old URLs that are not rewritten still work in the app (downloadStoredObject
-- understands both shapes), but browsers need the new ones.

begin;

create temp table rewrite_args (old text, new text) on commit drop;
insert into rewrite_args values (:'old', :'new');

do $$
declare
  c record;
  n bigint;
  v_old text := (select old from rewrite_args);
  v_new text := (select new from rewrite_args);
  total bigint := 0;
begin
  for c in
    select table_name, column_name, data_type
      from information_schema.columns
     where table_schema = 'public'
       and data_type in ('text', 'character varying', 'json', 'jsonb')
       and table_name in (select table_name from information_schema.tables
                           where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    if c.data_type in ('json', 'jsonb') then
      execute format(
        'update public.%I set %I = replace(%I::text, $1, $2)::%s where strpos(%I::text, $1) > 0',
        c.table_name, c.column_name, c.column_name, c.data_type, c.column_name)
        using v_old, v_new;
    else
      execute format(
        'update public.%I set %I = replace(%I, $1, $2) where strpos(%I, $1) > 0',
        c.table_name, c.column_name, c.column_name, c.column_name)
        using v_old, v_new;
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      raise notice '%.%: % rows', c.table_name, c.column_name, n;
      total := total + n;
    end if;
  end loop;
  raise notice 'total rows changed: %', total;
end $$;

commit;
