import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL || ""
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  const { data: runs } = await supabase.from("qa_runs").select("*").order("created_at", { ascending: false }).limit(1)
  const run = runs[0]
  
  const { data: findings } = await supabase.from("findings").select("*").eq("run_id", run.id)
  console.log("Findings:", JSON.stringify(findings, null, 2))
}

main()
