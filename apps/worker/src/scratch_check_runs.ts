import { supabase } from "./lib/supabase"

async function run() {
  console.log("Fetching latest 5 runs from Supabase...")
  const { data: runs, error } = await supabase
    .from("qa_runs")
    .select("id, project_id, status, pages_total, pages_processed, enabled_checks, created_at")
    .order("created_at", { ascending: false })
    .limit(5)

  if (error) {
    console.error("Error fetching runs:", error)
    return
  }

  for (const r of runs) {
    console.log(`\n--------------------------------------------`)
    console.log(`Run ID: ${r.id}`)
    console.log(`Project ID: ${r.project_id}`)
    console.log(`Status: ${r.status}`)
    console.log(`Pages Total: ${r.pages_total}`)
    console.log(`Pages Processed: ${r.pages_processed}`)
    console.log(`Enabled Checks: ${JSON.stringify(r.enabled_checks)}`)
    console.log(`Created At: ${r.created_at}`)

    // Count pages
    const { count: pagesCount } = await supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("run_id", r.id)
    console.log(`Pages in table: ${pagesCount}`)

    // Count findings
    const { count: findingsCount } = await supabase
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("run_id", r.id)
    console.log(`Findings in table: ${findingsCount}`)
  }
}

run().catch(console.error)
