
  create table "public"."activity_logs" (
    "id" uuid not null default gen_random_uuid(),
    "performer_id" uuid not null,
    "performer_name" text not null,
    "action_type" text not null,
    "entity_id" uuid,
    "entity_type" text,
    "details" jsonb default '{}'::jsonb,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."activity_logs" enable row level security;


  create table "public"."notifications" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "activity_id" uuid,
    "is_read" boolean default false,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."notifications" enable row level security;


  create table "public"."redis_stats" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "total_commands" bigint not null
      );


alter table "public"."redis_stats" enable row level security;

alter table "public"."embeddings" add column "metadata" jsonb;

alter table "public"."embeddings" add column "project_id" uuid;

alter table "public"."project_settings" add column "notify_critical_finding" boolean default true;

alter table "public"."project_settings" add column "notify_run_complete" boolean default true;

alter table "public"."project_settings" add column "notify_sign_off" boolean default true;

alter table "public"."qa_runs" add column "org_id" uuid;

alter table "public"."users" add column "notification_prefs" jsonb default '{}'::jsonb;

CREATE UNIQUE INDEX activity_logs_pkey ON public.activity_logs USING btree (id);

CREATE INDEX embeddings_org_idx ON public.embeddings USING btree (org_id);

CREATE INDEX embeddings_source_idx ON public.embeddings USING btree (source_type, source_id);

CREATE UNIQUE INDEX embeddings_source_unique ON public.embeddings USING btree (source_type, source_id);

CREATE INDEX embeddings_vector_idx ON public.embeddings USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');

CREATE INDEX idx_activity_logs_created_at ON public.activity_logs USING btree (created_at DESC);

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);

CREATE INDEX idx_redis_stats_created_at ON public.redis_stats USING btree (created_at);

CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);

CREATE UNIQUE INDEX redis_stats_pkey ON public.redis_stats USING btree (id);

alter table "public"."activity_logs" add constraint "activity_logs_pkey" PRIMARY KEY using index "activity_logs_pkey";

alter table "public"."notifications" add constraint "notifications_pkey" PRIMARY KEY using index "notifications_pkey";

alter table "public"."redis_stats" add constraint "redis_stats_pkey" PRIMARY KEY using index "redis_stats_pkey";

alter table "public"."embeddings" add constraint "embeddings_source_unique" UNIQUE using index "embeddings_source_unique";

alter table "public"."notifications" add constraint "notifications_activity_id_fkey" FOREIGN KEY (activity_id) REFERENCES public.activity_logs(id) ON DELETE CASCADE not valid;

alter table "public"."notifications" validate constraint "notifications_activity_id_fkey";

alter table "public"."qa_runs" add constraint "qa_runs_org_id_fkey" FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."qa_runs" validate constraint "qa_runs_org_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.match_embeddings(query_embedding public.vector, query_org_id uuid, match_count integer DEFAULT 8, query_project_id uuid DEFAULT NULL::uuid, query_source_type text DEFAULT NULL::text)
 RETURNS TABLE(source_type text, source_id uuid, content text, similarity double precision, metadata jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  select
    e.source_type,
    e.source_id,
    e.content,
    1 - (e.embedding <=> query_embedding) as similarity,
    e.metadata
  from embeddings e
  where
    e.org_id = query_org_id
    and (query_project_id is null or e.project_id = query_project_id)
    and (query_source_type is null or e.source_type = query_source_type)
    and 1 - (e.embedding <=> query_embedding) > 0.5
  order by e.embedding <=> query_embedding
  limit match_count;
$function$
;

grant delete on table "public"."activity_logs" to "anon";

grant insert on table "public"."activity_logs" to "anon";

grant references on table "public"."activity_logs" to "anon";

grant select on table "public"."activity_logs" to "anon";

grant trigger on table "public"."activity_logs" to "anon";

grant truncate on table "public"."activity_logs" to "anon";

grant update on table "public"."activity_logs" to "anon";

grant delete on table "public"."activity_logs" to "authenticated";

grant insert on table "public"."activity_logs" to "authenticated";

grant references on table "public"."activity_logs" to "authenticated";

grant select on table "public"."activity_logs" to "authenticated";

grant trigger on table "public"."activity_logs" to "authenticated";

grant truncate on table "public"."activity_logs" to "authenticated";

grant update on table "public"."activity_logs" to "authenticated";

grant delete on table "public"."activity_logs" to "service_role";

grant insert on table "public"."activity_logs" to "service_role";

grant references on table "public"."activity_logs" to "service_role";

grant select on table "public"."activity_logs" to "service_role";

grant trigger on table "public"."activity_logs" to "service_role";

grant truncate on table "public"."activity_logs" to "service_role";

grant update on table "public"."activity_logs" to "service_role";

grant delete on table "public"."notifications" to "anon";

grant insert on table "public"."notifications" to "anon";

grant references on table "public"."notifications" to "anon";

grant select on table "public"."notifications" to "anon";

grant trigger on table "public"."notifications" to "anon";

grant truncate on table "public"."notifications" to "anon";

grant update on table "public"."notifications" to "anon";

grant delete on table "public"."notifications" to "authenticated";

grant insert on table "public"."notifications" to "authenticated";

grant references on table "public"."notifications" to "authenticated";

grant select on table "public"."notifications" to "authenticated";

grant trigger on table "public"."notifications" to "authenticated";

grant truncate on table "public"."notifications" to "authenticated";

grant update on table "public"."notifications" to "authenticated";

grant delete on table "public"."notifications" to "service_role";

grant insert on table "public"."notifications" to "service_role";

grant references on table "public"."notifications" to "service_role";

grant select on table "public"."notifications" to "service_role";

grant trigger on table "public"."notifications" to "service_role";

grant truncate on table "public"."notifications" to "service_role";

grant update on table "public"."notifications" to "service_role";

grant delete on table "public"."redis_stats" to "anon";

grant insert on table "public"."redis_stats" to "anon";

grant references on table "public"."redis_stats" to "anon";

grant select on table "public"."redis_stats" to "anon";

grant trigger on table "public"."redis_stats" to "anon";

grant truncate on table "public"."redis_stats" to "anon";

grant update on table "public"."redis_stats" to "anon";

grant delete on table "public"."redis_stats" to "authenticated";

grant insert on table "public"."redis_stats" to "authenticated";

grant references on table "public"."redis_stats" to "authenticated";

grant select on table "public"."redis_stats" to "authenticated";

grant trigger on table "public"."redis_stats" to "authenticated";

grant truncate on table "public"."redis_stats" to "authenticated";

grant update on table "public"."redis_stats" to "authenticated";

grant delete on table "public"."redis_stats" to "service_role";

grant insert on table "public"."redis_stats" to "service_role";

grant references on table "public"."redis_stats" to "service_role";

grant select on table "public"."redis_stats" to "service_role";

grant trigger on table "public"."redis_stats" to "service_role";

grant truncate on table "public"."redis_stats" to "service_role";

grant update on table "public"."redis_stats" to "service_role";


  create policy "Admins can view all activity logs"
  on "public"."activity_logs"
  as permissive
  for select
  to public
using ((((auth.jwt() ->> 'role'::text) = 'admin'::text) OR ((auth.jwt() ->> 'role'::text) = 'super-admin'::text)));



  create policy "activity_logs_insert_service"
  on "public"."activity_logs"
  as permissive
  for insert
  to public
with check (true);



  create policy "activity_logs_select_admin"
  on "public"."activity_logs"
  as permissive
  for select
  to public
using ((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())) = ANY (ARRAY['super_admin'::text, 'admin'::text])));



  create policy "activity_logs_select_all_authenticated"
  on "public"."activity_logs"
  as permissive
  for select
  to public
using ((auth.uid() IS NOT NULL));



  create policy "activity_logs_select_member"
  on "public"."activity_logs"
  as permissive
  for select
  to public
using (((( SELECT users.role
   FROM public.users
  WHERE (users.id = auth.uid())) <> ALL (ARRAY['super_admin'::text, 'admin'::text])) AND (entity_type = ANY (ARRAY['task'::text, 'run'::text, 'project'::text]))));



  create policy "Users can see their own notifications"
  on "public"."notifications"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "Users can view their own notifications"
  on "public"."notifications"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "notifications_insert_service"
  on "public"."notifications"
  as permissive
  for insert
  to public
with check (true);



  create policy "notifications_select_own"
  on "public"."notifications"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "notifications_update_own"
  on "public"."notifications"
  as permissive
  for update
  to public
using ((user_id = auth.uid()));



