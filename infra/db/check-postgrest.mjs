// Checks that supabase-js behaves the same through plain PostgREST as on Supabase Cloud
// (plan §11), and that anon sees nothing. Creates a throwaway org and deletes it at the end.
//   PGRST_JWT_SECRET=... node infra/db/check-postgrest.mjs [http://127.0.0.1:3000]
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const secret = process.env.PGRST_JWT_SECRET;
if (!secret) { console.error("set PGRST_JWT_SECRET"); process.exit(1); }
const jwt = (role) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
};
const svcKey = jwt("service_role");
const anonKey = jwt("anon");
let failed = 0;
// PostgREST serves at root; supabase-js appends /rest/v1 -> strip it (what §7.1 will do in app code)
const fetchRewrite = (u, init) => fetch(String(u).replace(`${BASE}/rest/v1`, BASE), init);
const opts = { auth: { persistSession: false }, global: { fetch: fetchRewrite } };
const svc = createClient(BASE, svcKey, opts);
const anon = createClient(BASE, anonKey, opts);
const ok = (label, cond, extra = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label} ${extra}`);
};

const { data: org, error: e1 } = await svc.from("organizations").insert({ name: "floci test org" }).select().single();
ok("insert+select+single", !e1 && org?.id, e1?.message);
const { data: proj, error: e2 } = await svc.from("projects")
  .upsert({ org_id: org.id, name: "QACC Local Test 1397", site_url: "https://example.com" }, { onConflict: "org_id,name" })
  .select().single();
ok("upsert onConflict", !e2 && proj?.id, e2?.message);
const { data: proj2, error: e2b } = await svc.from("projects")
  .upsert({ org_id: org.id, name: "QACC Local Test 1397", site_url: "https://example.org" }, { onConflict: "org_id,name" })
  .select().single();
ok("upsert onConflict updates same row", !e2b && proj2?.id === proj.id && proj2.site_url === "https://example.org", e2b?.message);
const { data: run, error: e3 } = await svc.from("qa_runs")
  .insert({ project_id: proj.id, run_type: "internal_qa", site_url: "https://example.com", status: "running" }).select("id").single();
ok("insert qa_run", !e3 && run?.id, e3?.message);
const { data: page, error: e4 } = await svc.from("pages").insert({ run_id: run.id, url: "https://example.com/" }).select("id").single();
ok("insert page", !e4, e4?.message);
const { error: e5 } = await svc.from("findings").insert([
  { run_id: run.id, page_id: page.id, check_factor: "seo", title: "A", severity: "high" },
  { run_id: run.id, page_id: page.id, check_factor: "seo", title: "B", severity: "low" }]);
ok("bulk insert findings", !e5, e5?.message);

const { data: emb, error: e6 } = await svc.from("qa_runs").select("id, projects(name), findings(title)").eq("id", run.id).single();
ok("embeds (to-one + to-many)", !e6 && emb?.projects?.name && emb?.findings?.length === 2, e6?.message || JSON.stringify(emb));
const { count, error: e7 } = await svc.from("findings").select("*", { count: "exact", head: true }).eq("run_id", run.id);
ok("count exact head", !e7 && count === 2, e7?.message || `count=${count}`);
const { data: rng, count: c2, error: e8 } = await svc.from("findings").select("title", { count: "exact" }).order("title").range(0, 0);
ok("range + count", !e8 && rng?.length === 1 && c2 >= 2, e8?.message);
const { data: ms, error: e9 } = await svc.from("findings").select("id").eq("id", "00000000-0000-0000-0000-000000000000").maybeSingle();
ok("maybeSingle (none)", !e9 && ms === null, e9?.message);
const { error: e10 } = await svc.from("qa_runs").update({ status: "completed" }).eq("id", run.id);
ok("update", !e10, e10?.message);
const { data: slot, error: e11 } = await svc.rpc("acquire_run_slot", { p_run_id: run.id, p_stale_seconds: 600 });
ok("rpc acquire_run_slot", !e11 && slot === true, e11?.message || String(slot));
const { error: e12 } = await svc.rpc("release_run_slot", { p_run_id: run.id });
ok("rpc release_run_slot", !e12, e12?.message);
const { error: e13 } = await svc.rpc("increment_pages_processed", { run_id_param: run.id }).then(r => r, e => ({ error: e }));
ok("rpc increment_pages_processed", !e13, e13?.message);
const vec = Array.from({ length: 768 }, () => 0.01);
const { error: e14 } = await svc.from("embeddings").insert({ org_id: org.id, project_id: proj.id, content: "hello", embedding: vec, source_type: "finding", source_id: run.id });
ok("insert vector(768)", !e14, e14?.message);
const { data: m, error: e15 } = await svc.rpc("match_embeddings", { query_embedding: vec, query_org_id: org.id, match_count: 3 });
ok("rpc match_embeddings", !e15 && m?.length >= 1, e15?.message);
const { error: e16 } = await svc.from("run_check_results").select("*").limit(1);
ok("service reads non-RLS table", !e16, e16?.message);

const { data: a1, error: a1e } = await anon.from("qa_runs").select("id");
ok("anon sees no qa_runs (RLS)", !a1e && a1.length === 0, a1e?.message || `rows=${a1?.length}`);
const { data: a2, error: a2e } = await anon.from("findings").select("id");
ok("anon sees no findings (RLS)", !a2e && a2.length === 0, a2e?.message || `rows=${a2?.length}`);
const { error: a3e } = await anon.from("ted_comments").select("id");
ok("anon denied ted_comments", !!a3e, a3e?.code);
const { error: a4e } = await anon.from("qa_runs").delete().eq("id", run.id).select();
const { count: still } = await svc.from("qa_runs").select("*", { count: "exact", head: true }).eq("id", run.id);
ok("anon cannot delete", still === 1, a4e?.message || "");

// cleanup
await svc.from("organizations").delete().eq("id", org.id);
const { count: left } = await svc.from("qa_runs").select("*", { count: "exact", head: true }).eq("id", run.id);
ok("cleanup (cascade)", left === 0, `left=${left}`);
process.exit(failed ? 1 : 0);
