import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL || "https://your-project.supabase.co"
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "your-key"
const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  const { data: runs } = await supabase.from("qa_runs").select("*").order("created_at", { ascending: false }).limit(1)
  if (!runs || runs.length === 0) {
    console.log("No runs found")
    return
  }
  const run = runs[0]
  console.log("Latest run ID:", run.id)
  console.log("Site URL:", run.site_url)
  
  const { data: pages } = await supabase.from("pages").select("url").eq("run_id", run.id)
  console.log("Pages count:", pages?.length)
  console.log("Sample pages:", pages?.slice(0, 5))
  
  const { data: findings } = await supabase.from("findings").select("check_factor, page_id").eq("run_id", run.id)
  console.log("Findings count:", findings?.length)
  console.log("Findings factors:", findings?.map(f => f.check_factor))
}

main()
