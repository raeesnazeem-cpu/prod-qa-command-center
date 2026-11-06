jest.mock("../../lib/supabase", () => ({ supabase: {} }))
jest.mock("../../lib/queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })

import { isCleanPassFinding, isRealDefect, isToolLapseFinding } from "@qacc/shared"
import { parseWebAuditNdjson, WebAuditCroResult } from "../../lib/webAuditClient"
import { croFindingFor, pickCroPages } from "../checkCroAuditJob"
import { croBand, formatCroContext, parseCroContext } from "../../lib/croReport"
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

  it("picks up WebAudit's saved-report link when present, else null", () => {
    const withLink = JSON.stringify({
      type: "complete",
      data: { reportUrl: "https://auditarena.gogroth.com/dashboard/report?id=1-ab", report: { rawResults: { cro: { score: 75 } } } },
    })
    expect(parseWebAuditNdjson(withLink).reportUrl).toBe("https://auditarena.gogroth.com/dashboard/report?id=1-ab")
    expect(parseWebAuditNdjson(complete({ score: 75 })).reportUrl).toBeNull()
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

describe("croFindingFor (one row per page, always with the full data)", () => {
  it("WebAudit bands: 90+ Excellent, 70-89 Average, <70 Poor", () => {
    expect(croBand(95)).toBe("Excellent")
    expect(croBand(70)).toBe("Average")
    expect(croBand(69)).toBe("Poor")
  })

  it("Average or better → clean pass, but still carries issues, fixes and failed checks", () => {
    const f = croFindingFor("https://site.com/", cro({ score: 80 }))
    expect(isCleanPassFinding(f)).toBe(true)
    expect(isRealDefect(f)).toBe(false)
    expect(f.title).toBe("CRO score 80/100 (Average) — no major conversion issues found")
    const rep = parseCroContext(f.context_text)!
    expect(rep.url).toBe("https://site.com/")
    expect(rep.score).toBe(80)
    expect(rep.band).toBe("Average")
    expect(rep.issues).toEqual(["Hero has no clear call to action."])
    expect(rep.fixes).toEqual(["Add a 'Book a consultation' button above the fold."])
    expect(rep.failedChecks).toEqual([
      { impact: "critical", name: "Primary CTA above the fold", fix: "Add a CTA in the hero." },
      { impact: "high", name: "Trust badges", fix: "Show reviews near the form." },
    ])
  })

  it("Poor → real defect with the same data", () => {
    const f = croFindingFor("https://site.com/", cro({ score: 50 }))
    expect(isRealDefect(f)).toBe(true)
    expect(f.title).toMatch(/^CRO score 50\/100 \(Poor\)/)
    expect(parseCroContext(f.context_text)!.failedChecks).toHaveLength(2)
  })

  it("no high-impact failures → section omitted, parse gives an empty list", () => {
    const f = croFindingFor("https://site.com/", cro({ checks: [] }))
    expect(f.context_text).not.toContain("High-impact failed checks")
    expect(parseCroContext(f.context_text)!.failedChecks).toEqual([])
  })

  it("long WebAudit paragraphs are kept on one line and clipped", () => {
    const long = "word ".repeat(300)
    const ctx = formatCroContext("https://x.com/", cro({ issues: [`first\n${long}`] }))
    const rep = parseCroContext(ctx)!
    expect(rep.issues).toHaveLength(1)
    expect(rep.issues[0].length).toBeLessThanOrEqual(500)
    expect(rep.issues[0].startsWith("first word")).toBe(true)
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

  const row = (pageId: string, url: string, score: number, over: Partial<WebAuditCroResult> = {}) => ({
    ...croFindingFor(url, cro({ score, ...over })),
    id: `f-${pageId}`,
    page_id: pageId,
  })

  it("a pass still shows score, issues found, fixes recommended and failed checks", async () => {
    const r = await render([row("p1", "https://site.com/", 82)])
    expect(r.status).toBe("passed")
    expect(r.html).toContain("Passed")
    expect(r.html).toContain("Score 82/100 (Average)")
    expect(r.html).toContain("Issues found")
    expect(r.html).toContain("Hero has no clear call to action.")
    expect(r.html).toContain("Fixes recommended")
    expect(r.html).toContain("Book a consultation")
    expect(r.html).toContain("High-impact failed checks")
    expect(r.html).toContain("[critical] Primary CTA above the fold — Add a CTA in the hero.")
  })

  it("one Poor page fails the section; every page gets its own block", async () => {
    const pages = new Map([["p1", "https://site.com/"], ["p2", "https://site.com/contact"]])
    const r = await renderCheckSectionHtml(
      "cro_audit",
      [row("p1", "https://site.com/", 85), row("p2", "https://site.com/contact", 40, { checks: [] })],
      new Map(), { remaining: 0 }, pages,
    )
    expect(r.status).toBe("failed")
    expect(r.html).toContain("1 of 2 pages rated Poor")
    expect(r.html).toContain("https://site.com/contact")
    expect(r.html).toContain("Score 40/100 (Poor)")
    expect(r.html).toContain("No high-impact failed checks.")
    // failed page listed first
    expect(r.html.indexOf("Score 40/100")).toBeLessThan(r.html.indexOf("Score 85/100"))
  })

  it("links the full WebAudit report when WebAudit saved it", async () => {
    const link = "https://auditarena.gogroth.com/dashboard/report?id=9-xy"
    const f = row("p1", "https://site.com/", 82, { reportUrl: link })
    expect(parseCroContext(f.context_text)!.reportUrl).toBe(link)
    const r = await render([f])
    expect(r.html).toContain(`Full report: <a href="${link}">G99 WebAudit</a>`)
    const noLink = await render([row("p1", "https://site.com/", 82)])
    expect(noLink.html).not.toContain("Full report")
  })

  it("all pages lapsed → could not complete, with the reason", async () => {
    const lapse = {
      id: "l1", page_id: "p1", check_factor: "cro_audit", title: "Check Failed",
      description: "The cro_audit check encountered an unexpected error: WebAudit request failed with status code 401. Process aborted gracefully.",
    }
    const r = await render([lapse])
    expect(r.status).toBe("errored")
    expect(r.html).toContain("status code 401")
  })

  it("some pages lapsed → listed under the results", async () => {
    const pages = new Map([["p1", "https://site.com/"], ["p2", "https://site.com/contact"]])
    const lapse = {
      id: "l2", page_id: "p2", check_factor: "cro_audit", title: "Check Failed",
      description: "The cro_audit check encountered an unexpected error: x. Process aborted gracefully.",
    }
    const r = await renderCheckSectionHtml("cro_audit", [row("p1", "https://site.com/", 91), lapse], new Map(), { remaining: 0 }, pages)
    expect(r.status).toBe("passed")
    expect(r.html).toContain("Score 91/100 (Excellent)")
    expect(r.html).toContain("Could not check 1 page")
  })
})
