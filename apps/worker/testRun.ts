import { supabase } from "./src/lib/supabase";
async function run() {
  const { data } = await supabase.from("qa_runs").select("id, enabled_checks").order("created_at", { ascending: false }).limit(2);
  console.log(JSON.stringify(data, null, 2));
}
run();
