import {
  tedGetJson,
  getTedClientProfile,
  clearTedClientProfileCache,
  findTaskIdByTemplateKey,
  pickReleasedUrl,
} from "../tedApi"

type Reply = { status?: number; body?: any; headers?: Record<string, string> }

// Route fetch by URL path → queue of replies (last reply repeats).
function mockTed(routes: Record<string, Reply[]>) {
  const calls: string[] = []
  ;(global as any).fetch = jest.fn(async (url: string) => {
    const path = new URL(url).pathname
    calls.push(path)
    const q = routes[path]
    if (!q) throw new Error(`unexpected ${path}`)
    const r = q.length > 1 ? q.shift()! : q[0]
    const status = r.status ?? 200
    const headers = new Map(Object.entries({ "content-type": "application/json", ...(r.headers || {}) }))
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      json: async () => r.body,
    }
  })
  return calls
}

const RATE_LIMITED: Reply = {
  status: 429,
  body: { error: "rate_limited" },
  headers: { "retry-after": "0.001" },
}

beforeEach(() => {
  process.env.TED_API_TOKEN = "test-token"
  clearTedClientProfileCache()
  jest.spyOn(console, "log").mockImplementation(() => {})
  jest.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe("tedGetJson", () => {
  it("retries a 429 instead of returning null", async () => {
    const calls = mockTed({ "/api/clients/1/info": [RATE_LIMITED, RATE_LIMITED, { body: { betaSiteUrl: "https://a.gogroth.com" } }] })
    await expect(tedGetJson("/api/clients/1/info")).resolves.toEqual({ betaSiteUrl: "https://a.gogroth.com" })
    expect(calls).toHaveLength(3)
  })

  it("gives up after the retry budget", async () => {
    const calls = mockTed({ "/x": [RATE_LIMITED] })
    await expect(tedGetJson("/x", { retries: 2 })).resolves.toBeNull()
    expect(calls).toHaveLength(3)
  })

  it("treats an HTML 200 (TED SSR fallback) as a miss", async () => {
    mockTed({ "/x": [{ body: "<html>", headers: { "content-type": "text/html" } }] })
    await expect(tedGetJson("/x")).resolves.toBeNull()
  })
})

describe("getTedClientProfile", () => {
  it("reads info + deal-summary once and reuses it", async () => {
    const calls = mockTed({
      "/api/clients/1534/info": [{ body: { liveSiteUrl: "https://nuvo.com" } }],
      "/api/clients/1534/deal-summary": [{ body: { plan: "Growth99 Elite", addons: [{ key: "leadgen" }] } }],
    })
    const [a, b] = await Promise.all([getTedClientProfile(1534), getTedClientProfile("1534")])
    expect(a).toBe(b)
    expect(a?.dealSummary?.plan).toBe("Growth99 Elite")
    expect(calls).toHaveLength(2)
  })

  it("does not cache a failed read", async () => {
    const calls = mockTed({
      "/api/clients/9/info": [{ status: 404, body: {} }, { body: { betaSiteUrl: "https://b.gogroth.com" } }],
      "/api/clients/9/deal-summary": [{ body: {} }],
    })
    await expect(getTedClientProfile(9)).resolves.toBeNull()
    await new Promise((r) => setImmediate(r))
    expect((await getTedClientProfile(9))?.info?.betaSiteUrl).toBe("https://b.gogroth.com")
    expect(calls.filter((c) => c.endsWith("/info"))).toHaveLength(2)
  })
})

describe("findTaskIdByTemplateKey", () => {
  it("skips subtasks and stops at the first verified task", async () => {
    const calls = mockTed({
      "/api/clients/7/timeline": [{
        body: {
          activeTasks: [],
          timeline: [
            { id: "sub_1", parentId: "500", title: "Pre-Release: Favicon" },
            { id: "501", parentId: "500", title: "Pre-Release: Internal Links" },
            { id: "500", parentId: null, title: "Complete website pre-release development" },
            { id: "600", parentId: null, title: "Complete QA pre-release testing" },
            { id: "601", parentId: null, title: "Complete QA pre-release testing (old)" },
          ],
        },
      }],
      "/api/tasks/500": [{ body: { automation: { templateKey: "release.pre_dev" } } }],
      "/api/tasks/600": [{ body: { automation: { templateKey: "release.qa_pre" } } }],
    })
    await expect(findTaskIdByTemplateKey(7, "release.qa_pre", /pre-?release/i)).resolves.toBe("600")
    expect(calls).toEqual(["/api/clients/7/timeline", "/api/tasks/500", "/api/tasks/600"])
  })

  it("finds the renamed launch task by its new title", async () => {
    mockTed({
      "/api/clients/8/timeline": [{ body: { timeline: [{ id: "88224", parentId: null, title: "Website Launch (Beta to Live)" }] } }],
      "/api/tasks/88224": [{ body: { automation: { templateKey: "release.security" } } }],
    })
    await expect(
      findTaskIdByTemplateKey(8, "release.security", /website launch|beta to live|security and release|release.*security/i),
    ).resolves.toBe("88224")
  })
})

describe("pickReleasedUrl", () => {
  it("prefers a keyed token", () => {
    expect(pickReleasedUrl("releaseUrl=https://nuvo.com/ done")).toBe("https://nuvo.com/")
  })

  it("reads a labelled line from an HTML comment", () => {
    expect(pickReleasedUrl("<div>Site is live!</div><div>Live URL - nuvo.com</div>")).toBe("https://nuvo.com")
  })

  it("ignores GitHub, beta and QACC report links", () => {
    const text =
      "GitHub repo: https://github.com/G99agency/nuvo Beta URL: https://nuvo.gogroth.com/ " +
      "Report: https://qacc.raees.dev/runs/abc https://nuvo.gogroth.com/contact"
    expect(pickReleasedUrl(text)).toBeNull()
    expect(pickReleasedUrl(text, "nuvo.com")).toBeNull()
  })

  it("accepts a bare link only on the client's live domain", () => {
    const text = "See https://example.org/x and https://www.nuvo.com/ for the site"
    expect(pickReleasedUrl(text)).toBeNull()
    expect(pickReleasedUrl(text, "nuvo.com")).toBe("https://www.nuvo.com/")
  })
})
