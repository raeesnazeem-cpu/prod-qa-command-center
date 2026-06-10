import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing credentials")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  const findingId = "b68c5ba7-5eca-435b-a2b5-9cc1c8505bc9"
  const { data: finding, error } = await supabase
    .from("findings")
    .select("*")
    .eq("id", findingId)
    .single()

  if (error) {
    console.error("Error fetching finding:", error)
    return
  }

  console.log("Finding details:")
  console.log(`- ID: ${finding.id}`)
  console.log(`- Title: "${finding.title}"`)
  console.log(`- Factor: "${finding.check_factor}"`)
  console.log(`- Context text: "${finding.context_text}"`)
  console.log(`- Screenshot URL: "${finding.screenshot_url}"`)
}

main().catch(console.error)
