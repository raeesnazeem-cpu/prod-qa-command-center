import { supabase } from "./src/lib/supabase";
async function run() {
  const { data } = await supabase.from("findings").select("*").eq("check_factor", "learn_more_buttons").order("created_at", { ascending: false }).limit(5);
  console.log(JSON.stringify(data, null, 2));
}
run();
