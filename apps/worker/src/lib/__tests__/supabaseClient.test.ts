// The AWS switches on the shared client: POSTGREST_URL rewrites /rest/v1 calls to the
// PostgREST sidecar, REALTIME_ENABLED=false turns broadcasts into no-ops.
const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "POSTGREST_URL", "REALTIME_ENABLED"]

describe("supabase client (AWS switches)", () => {
  const realFetch = global.fetch
  const saved: Record<string, string | undefined> = {}
  let fetchMock: jest.Mock

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    process.env.SUPABASE_URL = "http://sb.local"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
    delete process.env.POSTGREST_URL
    delete process.env.REALTIME_ENABLED
    fetchMock = jest.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }))
    global.fetch = fetchMock as any
    jest.resetModules()
  })

  afterEach(() => {
    global.fetch = realFetch
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  const load = async () => (await import("../supabase")).supabase

  it("rewrites /rest/v1 to POSTGREST_URL", async () => {
    process.env.POSTGREST_URL = "http://127.0.0.1:3000/"
    const supabase = await load()
    await supabase.from("qa_runs").select("id").eq("status", "running")
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:3000/qa_runs?select=id&status=eq.running")
  })

  it("keeps Supabase Cloud URLs when POSTGREST_URL is unset", async () => {
    const supabase = await load()
    await supabase.rpc("release_run_slot", { p_run_id: "x" })
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://sb.local/rest/v1/rpc/release_run_slot")
  })

  it("makes channel sends no-ops when REALTIME_ENABLED=false", async () => {
    process.env.REALTIME_ENABLED = "false"
    const supabase = await load()
    const ch = supabase.channel("run:1")
    await ch.send({ type: "broadcast", event: "progress", payload: {} })
    await ch.httpSend("progress_update", {})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
