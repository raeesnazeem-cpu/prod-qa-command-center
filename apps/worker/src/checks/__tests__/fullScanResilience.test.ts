/**
 * Full-scan resilience for the API-backed checks: a scan of ANY URL (no TED
 * client, no PSI quota, a non-public host) must produce an honest
 * could-not-run result, never a crash and never a false site defect.
 * No network: got / TED / HubSpot are mocked.
 */
import { isToolLapseFinding, isRealDefect, isCleanPassFinding } from "@qacc/shared"

jest.mock("got", () => jest.fn())
jest.mock("../../lib/tedClient", () => ({
  resolveClient: jest.fn(),
  getClientTimeline: jest.fn(async () => []),
  getClientHubspotId: jest.fn(async () => null),
  getClientNotesText: jest.fn(async () => ""),
  getClientPlanField: (c: any) => (c?.plan || "").toString().trim(),
  tasksByDepartment: () => [],
  parsePlan: (raw: any) => (raw ? { raw, addOns: [], hasLeadGen: /lead gen/i.test(raw) } : null),
}))
jest.mock("../../lib/hubspotClient", () => ({ resolveHubspotClientData: jest.fn(async () => null) }))
jest.mock("../../lib/aiFallback", () => ({ describeImageResult: jest.fn() }))
jest.mock("../../lib/supabaseStorage", () => ({ uploadScreenshot: jest.fn(async () => "") }))
jest.mock("sharp", () => jest.fn())

import got from "got"
import * as ted from "../../lib/tedClient"
import { checkPageSpeed } from "../pageSpeedCheck"
import { checkPaidMedia } from "../paidMediaCheck"
import { checkProjectPlan } from "../projectPlanCheck"
import { classifyReputationLinks } from "../reviewReputationCheck"

const gotMock = got as unknown as jest.Mock
const psiOk = (score: number) => ({
  json: async () => ({
    lighthouseResult: {
      categories: { performance: { score } },
      audits: { "largest-contentful-paint": { displayValue: "2.1 s" } },
    },
  }),
})
const psiFail = (statusCode: number, message: string) => ({
  json: async () => {
    const e: any = new Error(`Response code ${statusCode}`)
    e.response = { statusCode, body: JSON.stringify({ error: { message } }) }
    throw e
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  process.env.TED_API_TOKEN = "test-token"
})

describe("page_speed", () => {
  it("non-public URL is a skip, not a pass", async () => {
    const [f] = await checkPageSpeed("http://localhost:9400/")
    expect(f.title).toMatch(/Skipped/)
    expect(isToolLapseFinding(f)).toBe(true)
    expect(gotMock).not.toHaveBeenCalled()
  })

  it("quota on both strategies is a lapse naming the quota", async () => {
    gotMock.mockImplementation(() => psiFail(429, "Quota exceeded"))
    const [f] = await checkPageSpeed("https://example.com/")
    expect(isToolLapseFinding(f)).toBe(true)
    expect(f.description).toMatch(/quota exceeded/i)
  })

  it("one strategy failing still reports the other", async () => {
    gotMock.mockImplementation((u: string) =>
      /strategy=mobile/.test(u) ? psiFail(500, "boom") : psiOk(0.95),
    )
    const [f] = await checkPageSpeed("https://example.com/")
    expect(isCleanPassFinding(f)).toBe(true)
    expect(f.description).toMatch(/desktop score was used/)
  })

  it("no score from Lighthouse is a lapse, never a pass", async () => {
    gotMock.mockImplementation(() => ({
      json: async () => ({ lighthouseResult: { runtimeError: { code: "NO_FCP", message: "No content painted" } } }),
    }))
    const [f] = await checkPageSpeed("https://example.com/")
    expect(isToolLapseFinding(f)).toBe(true)
    expect(f.description).toMatch(/No content painted/)
  })

  it("low mobile score is a real defect", async () => {
    gotMock.mockImplementation((u: string) => psiOk(/strategy=mobile/.test(u) ? 0.3 : 0.8))
    const [f] = await checkPageSpeed("https://example.com/")
    expect(isRealDefect(f)).toBe(true)
  })
})

describe("paid_media", () => {
  it("no TED client for the URL is a skip, not 'details not found'", async () => {
    ;(ted.resolveClient as jest.Mock).mockResolvedValue(null)
    const [f] = await checkPaidMedia("Full Scan — example.com", null, "https://example.com")
    expect(f.title).toMatch(/Skipped/)
    expect(isToolLapseFinding(f)).toBe(true)
  })

  it("TED failure is a skip", async () => {
    ;(ted.resolveClient as jest.Mock).mockRejectedValue(new Error("ECONNRESET"))
    const [f] = await checkPaidMedia("Acme", null, null)
    expect(isToolLapseFinding(f)).toBe(true)
  })

  it("empty client name never reaches TED as ''", async () => {
    ;(ted.resolveClient as jest.Mock).mockResolvedValue(null)
    await checkPaidMedia("", null, "https://example.com")
    expect(ted.resolveClient).toHaveBeenCalledWith(null, "https://example.com")
  })

  it("timeline is read by the resolved client's id", async () => {
    ;(ted.resolveClient as jest.Mock).mockResolvedValue({ id: 1397, plan: "Lead Generation", paidMediaStrategist: { name: "Sam" } })
    const [f] = await checkPaidMedia("Full Scan — example.com", null, "https://example.com")
    expect(ted.getClientTimeline).toHaveBeenCalledWith(1397)
    expect(isCleanPassFinding(f)).toBe(true)
    expect(f.description).toMatch(/Strategist: Sam/)
  })

  it("client found but no details stays a real finding", async () => {
    ;(ted.resolveClient as jest.Mock).mockResolvedValue({ id: 5 })
    const [f] = await checkPaidMedia("Acme", 5, null)
    expect(f.title).toBe("Paid Media details not found")
    expect(isRealDefect(f)).toBe(true)
  })
})

describe("project_plan", () => {
  it("no TED client for the URL is a skip, not 'plan not set'", async () => {
    ;(ted.resolveClient as jest.Mock).mockResolvedValue(null)
    const [f] = await checkProjectPlan("Full Scan — example.com", { siteUrl: "https://example.com" })
    expect(f.title).toMatch(/^Project Plan Check Skipped/)
    expect(isToolLapseFinding(f)).toBe(true)
  })

  it("TED failure is a skip, not a defect", async () => {
    ;(ted.resolveClient as jest.Mock).mockRejectedValue(new Error("socket hang up"))
    const [f] = await checkProjectPlan("Acme", { siteUrl: "https://example.com" })
    expect(isToolLapseFinding(f)).toBe(true)
    expect(isRealDefect(f)).toBe(false)
  })

  it("client with no plan stays 'Project Plan not set'", async () => {
    ;(ted.resolveClient as jest.Mock).mockResolvedValue({ id: 7 })
    const [f] = await checkProjectPlan("Acme", { siteUrl: "https://example.com" })
    expect(f.title).toBe("Project Plan not set")
    expect(ted.getClientNotesText).toHaveBeenCalledWith(7)
  })

  it("non-Accelerator plan passes without a browser", async () => {
    ;(ted.resolveClient as jest.Mock).mockResolvedValue({ id: 7, plan: "Starter" })
    const [f] = await checkProjectPlan("Acme", { siteUrl: "https://example.com" })
    expect(isCleanPassFinding(f)).toBe(true)
  })

  it("Accelerator plan with no site URL is a skip, not 'widget missing'", async () => {
    ;(ted.resolveClient as jest.Mock).mockResolvedValue({ id: 7, plan: "Accelerator" })
    const [f] = await checkProjectPlan("Acme", {})
    expect(f.title).toMatch(/Skipped/)
    expect(isToolLapseFinding(f)).toBe(true)
  })
})

describe("review_reputation link classification", () => {
  it("matches social by host, not substring", () => {
    const r = classifyReputationLinks(["https://www.fedex.com/track", "https://x.com/acme", "https://m.facebook.com/acme"])
    expect(r.social).toEqual(["https://x.com/acme", "https://m.facebook.com/acme"])
  })

  it("recognises modern Google Maps / review links and map iframes", () => {
    expect(classifyReputationLinks(["https://maps.app.goo.gl/abc123"]).google).toHaveLength(1)
    expect(classifyReputationLinks(["https://www.google.com/search?q=acme#lrd=0x1:0x2,1"]).google).toHaveLength(1)
    expect(classifyReputationLinks([], ["https://www.google.com/maps/embed?pb=1"]).google).toHaveLength(1)
    expect(classifyReputationLinks(["https://www.google.com/"]).google).toHaveLength(0)
  })

  it("tel / mailto are deduplicated", () => {
    const r = classifyReputationLinks(["tel:+1555", "tel:+1555", "mailto:a@b.co"])
    expect(r.tel).toEqual(["tel:+1555"])
    expect(r.mail).toEqual(["mailto:a@b.co"])
  })
})
