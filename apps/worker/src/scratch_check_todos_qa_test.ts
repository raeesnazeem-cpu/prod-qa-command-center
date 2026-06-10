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

  const bucketUrl = `https://3.basecampapi.com/${basecamp_account_id}/buckets/${basecamp_project_id}.json`
  const bucketResponse = await axios.get(bucketUrl, { headers })
  
  const todosetTool = bucketResponse.data.dock?.find(
    (tool: any) => tool.title === "To-dos" || tool.url?.includes("/todosets/"),
  )

  const todosetDetailResponse = await axios.get(todosetTool.url, { headers })
  const todolistsUrl = todosetDetailResponse.data.todolists_url

  const listsResponse = await axios.get(todolistsUrl, { headers })
  for (const list of listsResponse.data) {
    if (list.name === "QA Test") {
      const todosResponse = await axios.get(list.todos_url, { headers })
      console.log(`Checklist items for list "${list.name}":`)
      for (const todo of todosResponse.data) {
        console.log(`  * "${todo.content}" (ID: ${todo.id})`)
      }
    }
  }
}

main().catch(console.error)
