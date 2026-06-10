drop extension if exists "pg_net";

drop policy "users_select_self" on "public"."users";

drop policy "users_update_self" on "public"."users";

alter table "public"."pages" drop constraint "pages_status_check";

drop function if exists "public"."match_embeddings"(query_embedding public.vector, match_count integer, p_org_id uuid);

alter table "public"."findings" add column "height" real;

alter table "public"."findings" add column "is_manual" boolean default true;

alter table "public"."findings" add column "viewport" text;

alter table "public"."findings" add column "width" real;

alter table "public"."findings" add column "x_offset" real;

alter table "public"."findings" add column "y_offset" real;

alter table "public"."project_settings" add column "basecamp_post_todolist_id" text;

alter table "public"."projects" add column "is_post_release" boolean;

alter table "public"."tasks" alter column "gallery_images" drop default;

alter table "public"."users" add column "basecamp_person_id" text;

alter table "public"."users" add column "clerk_id" text;

CREATE INDEX idx_comments_task_id_perf ON public.comments USING btree (task_id);

CREATE INDEX idx_findings_page_id_perf ON public.findings USING btree (page_id);

CREATE INDEX idx_findings_run_id_perf ON public.findings USING btree (run_id);

CREATE INDEX idx_findings_status_perf ON public.findings USING btree (status);

CREATE INDEX idx_pages_run_id_perf ON public.pages USING btree (run_id);

CREATE INDEX idx_tasks_assigned_to_perf ON public.tasks USING btree (assigned_to);

CREATE INDEX idx_tasks_project_id_perf ON public.tasks USING btree (project_id);

CREATE INDEX idx_tasks_status_perf ON public.tasks USING btree (status);

CREATE UNIQUE INDEX users_clerk_id_key ON public.users USING btree (clerk_id);

alter table "public"."findings" add constraint "findings_viewport_check" CHECK ((viewport = ANY (ARRAY['desktop'::text, 'tablet'::text, 'mobile'::text]))) not valid;

alter table "public"."findings" validate constraint "findings_viewport_check";

alter table "public"."users" add constraint "users_clerk_id_key" UNIQUE using index "users_clerk_id_key";

alter table "public"."pages" add constraint "pages_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'screenshotted'::text, 'done'::text, 'failed'::text]))) not valid;

alter table "public"."pages" validate constraint "pages_status_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.increment_pages_processed(run_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE qa_runs
  SET pages_processed = COALESCE(pages_processed, 0) + 1
  WHERE id = run_id_param;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.match_embeddings(query_embedding public.vector, match_count integer, filter_org_id uuid)
 RETURNS TABLE(id uuid, org_id uuid, source_type text, source_id uuid, content text, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    e.id,
    e.org_id,
    e.source_type,
    e.source_id,
    e.content,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM embeddings e
  WHERE e.org_id = filter_org_id
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$function$
;


