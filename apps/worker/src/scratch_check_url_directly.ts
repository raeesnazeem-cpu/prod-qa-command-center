import { createClient } from "@supabase/supabase-js"
import axios from "axios"
import dotenv from "dotenv"
import crypto from "crypto"

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET

if (!supabaseUrl || !supabaseServiceKey || !ENCRYPTION_SECRET) {
  console.error("Missing credentials")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY = crypto.scryptSync(ENCRYPTION_SECRET, "qacc-salt", 32)

function decrypt(encryptedText: string) {
  const [ivBase64, authTagBase64, encrypted] = encryptedText.split(":")
  const iv = Buffer.from(ivBase64, "base64")
  const authTag = Buffer.from(authTagBase64, "base64")
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted, "base64", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

async function main() {
  const projectId = "5f03b951-9379-44d8-a2fd-3e577504975a"
  const { data: projectSettings } = await supabase
    .from("project_settings")
    .select("*")
    .eq("project_id", projectId)
    .single()

  const { basecamp_token_encrypted, basecamp_account_id, basecamp_project_id } =
    projectSettings
  const token = decrypt(basecamp_token_encrypted)

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "QACC (raees.nazeem@growth99.com)",
    "Content-Type": "application/json",
    Accept: "application/json",
  }

  const url = "https://3.basecampapi.com/4023059/buckets/42822223/todolists/9899445368/groups.json"
  const response = await axios.get(url, { headers })
  console.log("Raw groups response:")
  console.log(response.data)
}

main().catch(console.error)
