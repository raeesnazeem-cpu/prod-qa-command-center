jest.mock("../../lib/supabase", () => ({ supabase: {} }))
jest.mock("../../lib/queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })

import { isCleanPassFinding, isRealDefect, isToolLapseFinding } from "@qacc/shared"
import { parseWebAuditNdjson, WebAuditCroResult } from "../../lib/webAuditClient"
import { croFindingsFor, pickCroPages } from "../checkCroAuditJob"
import { renderCheckSectionHtml, FRIENDLY } from "../../lib/tedSync"

const cro = (over: Partial<WebAuditCroResult> = {}): WebAuditCroResult => ({
  score: 50,
  observations: [],
  issues: ["Hero has no clear call to action."],
  recommendations: ["Add a 'Book a consultation' button above the fold."],
  checks: [
    { checkName: "Primary CTA above the fold", passed: false, impact: "critical", remediation: "Add a CTA in the hero." },
    { checkName: "Trust badges", passed: false, impact: "high", remediation: "Show reviews near the form." },
    { checkName: "Footer links", passed: false, impact: "low", remediation: "Tidy footer." },
    { checkName: "Phone visible", passed: true, impact: "high" },
  ],
  ...over,
})

describe("WebAudit NDJSON reader", () => {
  const complete = (c: any) =>
    JSON.stringify({ type: "complete", data: { report: { rawResults: { cro: c } } } })

  it("returns the CRO section from the complete line", () => {
    const text = [
      JSON.stringify({ type: "status", message: "Navigating..." }),
      complete({ score: 61.4, issues: ["a"], recommendations: ["b"], checks: [{ checkName: "x", passed: false, impact: "high" }] }),
      "",
    ].join("\n")
    const r = parseWebAuditNdjson(text)
    expect(r.score).toBe(61)
    expect(r.checks).toHaveLength(1)
    expect(r.issues).toEqual(["a"])
  })

  it("throws on an error line", () => {
    expect(() => parseWebAuditNdjson(JSON.stringify({ type: "error", message: "boom" }))).toThrow(/boom/)
  })

  it("throws when the AI step failed and CRO is missing", () => {
    const text = [
      JSON.stringify({ type: "agent_error", agent: "MasterDesignAgent", message: "quota" }),
      complete(null),
    ].join("\n")
    expect(() => parseWebAuditNdjson(text)).toThrow(/no CRO result \(quota\)/)
  })

  it("throws when the stream is cut off", () => {
    expect(() => parseWebAuditNdjson(JSON.stringify({ type: "status" }) + "\n{\"type\":\"comp")).toThrow(/ended without a result/)
  })
})

describe("pickCroPages", () => {
  const pages = [
    "https://site.com/blog/how-to",
    "https://site.com/services/botox",
    "https://site.com/contact-us",
    "https://site.com/about",
    "https://site.com/",
    "https://site.com/book-appointment",
    "https://site.com/services",
    "https://site.com/specials",
    "https://site.com/privacy-policy",
  ].map((url, i) => ({ id: `p${i}`, url }))

  it("homepage first, then contact, booking, services, pricing (max 4)", () => {
    const urls = pickCroPages(pages, "https://www.site.com").map((p) => p.url)
    expect(urls).toEqual([
      "https://site.com/",
      "https://site.com/contact-us",
      "https://site.com/book-appointment",
      "https://site.com/services",
    ])
  })

  it("a lone homepage is fine", () => {
    expect(pickCroPages([{ id: "a", url: "https://x.com/" }], "https://x.com")).toHaveLength(1)
  })
})

describe("croFindingsFor", () => {
  it("score at/above the pass mark → one clean-pass row", () => {
    const rows = croFindingsFor(cro({ score: 80 }), 70)
    expect(rows).toHaveLength(1)
    expect(isCleanPassFinding(rows[0])).toBe(true)
    expect(isRealDefect(rows[0])).toBe(false)
  })

  it("below the pass mark → one real defect per failed high/critical check, critical first", () => {
    const rows = croFindingsFor(cro(), 70)
    expect(rows.map((r) => r.title)).toEqual(["CRO: Primary CTA above the fold", "CRO: Trust badges"])
    expect(rows.every((r) => isRealDefect(r))).toBe(true)
    expect(rows[0].context_text).toContain("CRO score: 50/100 (pass mark 70)")
  })

  it("below the pass mark with no high-impact failures → one summary defect", () => {
    const rows = croFindingsFor(cro({ checks: [] }), 70)
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toMatch(/below the pass mark/)
    expect(isRealDefect(rows[0])).toBe(true)
  })

  it("the lapse row shape counts as 'could not complete'", () => {
    const lapse = {
      check_factor: "cro_audit",
      title: "Check Failed",
      description: "The cro_audit check encountered an unexpected error: x. Process aborted gracefully.",
    }
    expect(isToolLapseFinding(lapse)).toBe(true)
  })
})

describe("TED report — cro_audit section", () => {
  const render = (group: any[]) =>
    renderCheckSectionHtml("cro_audit", group, new Map(), { remaining: 0 }, new Map([["p1", "https://site.com/"]]))

  it("has a friendly label", () => {
    expect(FRIENDLY.cro_audit).toBe("CRO (Conversion Review)")
  })

  it("defects → failed, pass row → passed", async () => {
    const failed = await render(croFindingsFor(cro(), 70).map((f, i) => ({ ...f, id: `f${i}`, page_id: "p1" })))
    expect(failed.status).toBe("failed")
    expect(failed.html).toContain("Primary CTA above the fold")
    const passed = await render(croFindingsFor(cro({ score: 90 }), 70).map((f) => ({ ...f, id: "ok", page_id: "p1" })))
    expect(passed.status).toBe("passed")
  })
})
