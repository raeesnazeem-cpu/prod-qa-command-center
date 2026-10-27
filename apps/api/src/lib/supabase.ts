import ws from "ws"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error("Missing environment variable: SUPABASE_URL")
}

if (!supabaseServiceRoleKey) {
  throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY")
}

// AWS mode: a PostgREST sidecar replaces Supabase's /rest/v1. PostgREST serves at its
// root, so rewrite `${SUPABASE_URL}/rest/v1/...` -> `${POSTGREST_URL}/...`.
// Unset = Supabase Cloud, unchanged.
const postgrestUrl = process.env.POSTGREST_URL?.replace(/\/+$/, "")
const restPrefix = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`

const fetchViaPostgrest: typeof fetch = (input, init) => {
  if (postgrestUrl && (typeof input === "string" || input instanceof URL)) {
    const url = String(input)
    if (url.startsWith(restPrefix)) {
      return fetch(postgrestUrl + url.slice(restPrefix.length), init)
    }
  }
  return fetch(input, init)
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: ws as any,
  },
  global: postgrestUrl ? { fetch: fetchViaPostgrest } : undefined,
})

// REALTIME_ENABLED=false (AWS): no Realtime server. An unsubscribed channel's
// send()/httpSend() would fall back to an HTTP POST to /realtime/v1, so hand out a
// channel that does nothing instead of letting each broadcast fail.
if (process.env.REALTIME_ENABLED === "false") {
  const noopChannel: any = {
    send: async () => "ok",
    httpSend: async () => ({ success: true }),
    on: () => noopChannel,
    subscribe: () => noopChannel,
    unsubscribe: async () => "ok",
  }
  supabase.channel = (() => noopChannel) as typeof supabase.channel
  supabase.removeChannel = (async () => "ok") as typeof supabase.removeChannel
}
