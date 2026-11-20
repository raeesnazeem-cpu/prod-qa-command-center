jest.mock("../supabase", () => ({ supabase: {} }))
jest.mock("../queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })
// Real-TED mode: read once when tedSync loads, so set it before requiring it.
process.env.TED_PREVIEW_ONLY = "false"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { postTedComment } = require("../tedSync")
import { INTERNAL_TOKEN_HEADER, isValidInternalToken } from "@qacc/shared/internalAuth"

// Prod 2026-11-10: the worker had no working X_API_KEY, so every run report fell
// back to the Bearer token and showed under that person's name.
const calls: { url: string; init: any }[] = []
function mockFetch(answers: Record<string, number>) {
  calls.length = 0
  ;(global as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init })
    const key = Object.keys(answers).find((k) => url.endsWith(k))
    const status = key ? answers[key] : 404
    return {
      status,
      ok: status < 300,
      headers: { get: () => "application/json" },
      text: async () => "",
    }
  })
}

describe("postTedComment — worker without its own key relays through the API", () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env = { ...env, TED_PREVIEW_ONLY: "false", SUPABASE_SERVICE_ROLE_KEY: "service-role-test", TED_API_TOKEN: "bearer-of-a-person" }
    delete process.env.X_API_KEY
    delete process.env.TED_API_BASE
    delete process.env.QACC_API_URL
  })
  afterAll(() => {
    process.env = env
  })

  it("posts via the QACC API relay, never the Bearer token", async () => {
    mockFetch({ "/internal/ted-comment": 200, "/comments": 200 })
    expect(await postTedComment("65011", "<p>result</p>", "qacc-status:1")).toBe(true)
    expect(calls.map((c) => c.url)).toEqual(["https://api.qacc.raees.dev/internal/ted-comment"])
    const sent = calls[0].init
    expect(isValidInternalToken("ted-comment", sent.headers[INTERNAL_TOKEN_HEADER])).toBe(true)
    expect(JSON.parse(sent.body)).toEqual({ taskId: "65011", text: "<p>result</p>", eventKey: "qacc-status:1" })
  })

  it("falls back to Bearer only when the relay fails", async () => {
    mockFetch({ "/internal/ted-comment": 502, "/comments": 200 })
    expect(await postTedComment("65011", "x", "qacc-status:2")).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.qacc.raees.dev/internal/ted-comment",
      "https://ted.growth99.com/api/tasks/65011/comments",
    ])
  })

  it("a local worker (TED_API_BASE set) never relays to the production API", async () => {
    process.env.TED_API_BASE = "http://localhost:8197"
    mockFetch({ "/comments": 200 })
    await postTedComment("900004", "x", "qacc-status:3")
    expect(calls.some((c) => c.url.includes("qacc.raees.dev"))).toBe(false)
  })
})
