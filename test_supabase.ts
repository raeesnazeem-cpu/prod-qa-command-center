import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"

dotenv.config({ path: "apps/api/.env" })

const supabaseUrl = process.env.SUPABASE_URL || ""
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ""

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
  const { data, error } = await supabase.from("findings").select("*").eq("check_factor", "social_share_heading").order("created_at", { ascending: false }).limit(5)
  console.log("Findings:", data, "Error:", error)
}

test()
