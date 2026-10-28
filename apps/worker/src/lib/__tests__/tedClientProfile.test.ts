import { getClientProfile, profileContextLine, clearTedCaches } from "../tedClient"

// Client 2341 (Skinsculpt Aesthetics) as TED returned it on 2026-10-28.
const CLIENT = {
  id: "2341",
  name: "Skinsculpt Aesthetics",
  status: "Happy",
  plan: "Growth99 Elite / Lead Generation",
  hubspotId: "58886659616",
  onboardingType: "Standard On-Boarding",
  clientStage: "In Onboarding",
  onHoldReason: null,
  clientDetails: { contactPhone: "+16195873207", betaUrl: "https://skinsculpt-aesthetics.gogroth.com/" },
}
const INFO = {
  clientId: "2341",
  name: "Skinsculpt Aesthetics",
  contactPhone: "+16195873207",
  businessAddress: null,
  liveSiteUrl: "https://www.skinsculpt-aesthetics.com/",
  betaSiteUrl: "https://skinsculpt-aesthetics.gogroth.com/",
}
const DEAL_SUMMARY = {
  dealType: { raw: "Initial Deal", label: "Initial Deal" },
  plan: "Growth99 Elite",
  addons: [
    { key: "gia", label: "GIA Voice", sourceField: "gia_ai_agent = true" },
    { key: "ada", label: "ADA Basic", sourceField: "accessibility_plan_add_on = Basic" },
    { key: "leadgen", label: "Lead Gen", sourceField: "growth99_plan “/ Lead Generation”" },
  ],
}

function mockTed(over: { clients?: any[]; deal?: any; rateLimitInfoOnce?: boolean } = {}) {
  let infoCalls = 0
  ;(global as any).fetch = jest.fn(async (url: string) => {
    const path = new URL(url).pathname
    const json = (body: any, status = 200) => ({
      status,
      ok: status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => body,
    })
    if (path === "/api/clients") return json(over.clients ?? [CLIENT])
    if (path.endsWith("/info")) {
      infoCalls++
      if (over.rateLimitInfoOnce && infoCalls === 1) return json({ error: "rate_limited" }, 429)
      return json(INFO)
    }
    if (path.endsWith("/deal-summary")) return json(over.deal ?? DEAL_SUMMARY)
    throw new Error(`unexpected ${path}`)
  })
  return () => infoCalls
}

beforeEach(() => {
  process.env.TED_API_TOKEN = "test-token"
  clearTedCaches()
})

describe("getClientProfile", () => {
  it("merges the plan with the deal-summary add-ons", async () => {
    mockTed()
    const p = await getClientProfile("2341")
    expect(p?.name).toBe("Skinsculpt Aesthetics")
    expect(p?.plan?.base).toBe("Growth99 Elite")
    // Lead Gen is already in the plan text, so it isn't listed twice.
    expect(p?.plan?.addOns).toEqual(["Lead Generation", "GIA Voice", "ADA Basic"])
    expect(p?.hasLeadGen).toBe(true)
    expect(p?.hasGia).toBe(true)
    expect(p?.adaTier).toBe("basic")
    expect(p?.adaRaw).toBe("Basic")
    expect(p?.contactPhone).toBe("+16195873207")
    expect(p?.dealType).toBe("Initial Deal")
    expect(p?.onboardingTier).toBe("Standard On-Boarding")
  })

  it("finds an upsold Lead Gen the plan text leaves out", async () => {
    mockTed({
      clients: [{ ...CLIENT, plan: "Growth99 Elite" }],
      deal: { plan: "Growth99 Elite", addons: [{ key: "leadgen", label: "Lead Gen" }] },
    })
    const p = await getClientProfile("2341")
    expect(p?.plan?.hasLeadGen).toBe(true)
    expect(p?.plan?.addOns).toEqual(["Lead Gen"])
  })

  it("reads ADA Complete and leaves the tier null without an ADA add-on", async () => {
    mockTed({ deal: { addons: [{ key: "ada", label: "ADA Complete" }] } })
    expect((await getClientProfile("2341"))?.adaTier).toBe("complete")
    clearTedCaches()
    mockTed({ deal: { addons: [] } })
    expect((await getClientProfile("2341"))?.adaTier).toBeNull()
  })

  it("retries a TED rate limit instead of losing the info", async () => {
    const calls = mockTed({ rateLimitInfoOnce: true })
    const p = await getClientProfile("2341")
    expect(p?.info?.betaSiteUrl).toBe(INFO.betaSiteUrl)
    expect(calls()).toBe(2)
  }, 10000)

  it("returns null when no TED client matches", async () => {
    mockTed({ clients: [] })
    await expect(getClientProfile("9999")).resolves.toBeNull()
  })
})

describe("profileContextLine", () => {
  it("summarises tier, deal, stage and add-ons", async () => {
    mockTed()
    expect(profileContextLine(await getClientProfile("2341"))).toBe(
      "\n\nClient details (TED): Onboarding: Standard On-Boarding · Deal: Initial Deal · Stage: In Onboarding · GIA add-on · ADA: Basic.",
    )
  })
})
