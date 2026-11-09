jest.mock("../../lib/aiFallback", () => ({ completeText: jest.fn() }))
import { isRealDefect, isToolLapseFinding, GAP_CHECKS, GAP_CHECK_KEYS, withGapChecks, resultForCheck } from "@qacc/shared"
import { expiredOfferReason, footerBarProblems, TRADEMARK_BRANDS } from "../gaps/pageGapsCheck"
import { menuParityProblems, offBrandWidgets } from "../gaps/homepageGapsCheck"
import { serviceMenus, orderProblems, namesMatch } from "../gaps/siteConsistencyCheck"
import { imageKey, samePageKey, putFacts, getFacts, releaseFacts, emptyFacts, putMobileOrder } from "../gaps/factsStore"
import { gapFinding, lapseFinding } from "../gaps/findings"
import { isTestPhaseHost, cartFlowAllowed, pickProduct } from "../gaps/cartFlowCheck"
import { hiddenShare, parseVisionJson, VISION_KEYS } from "../gaps/visionGapsCheck"
import { aiLapseBlocksPass, aiFailureReason, gapKeysByScope } from "@qacc/shared"

describe("vision gap checks", () => {
  it("hiddenShare: object-fit cover crop, clipping, and no crop", () => {
    // 1600x900 file in a 400x400 cover box: 225/400 of the width shows.
    expect(hiddenShare({ w: 400, h: 400 }, { w: 1600, h: 900 }, "cover", 1)).toBeCloseTo(1 - 900 / 1600, 3)
    expect(hiddenShare({ w: 400, h: 225 }, { w: 1600, h: 900 }, "fill", 1)).toBe(0)
    expect(hiddenShare({ w: 400, h: 225 }, { w: 1600, h: 900 }, "fill", 0.5)).toBeCloseTo(0.5, 5)
  })
  it("parseVisionJson reads the first JSON object and survives junk", () => {
    expect(parseVisionJson('Sure! {"readable": false, "confidence": 0.8}')).toEqual({ readable: false, confidence: 0.8 })
    expect(parseVisionJson("no json here")).toBeNull()
    expect(parseVisionJson("{broken")).toBeNull()
  })
  it("all four are registered as vision-scope checks", () => {
    expect(gapKeysByScope("vision").sort()).toEqual([...VISION_KEYS].sort())
  })
  it("a vision outage on one page blocks a pass (could not complete, not passed)", () => {
    const lapse = lapseFinding("hero_readability", aiFailureReason("429 quota exceeded"), "https://s.test/a")
    expect(lapse.description).toMatch(/AI limit exhausted/)
    expect(aiLapseBlocksPass("hero_readability", [lapse])).toBe(true)
    expect(resultForCheck("hero_readability", [lapse], true)).toBe("lapsed")
  })
})

describe("cart flow guards", () => {
  it("only beta / staging hosts count as test phase", () => {
    expect(isTestPhaseHost("https://mcptest2.gogroth.com")).toBe(true)
    expect(isTestPhaseHost("https://staging.client.com")).toBe(true)
    expect(isTestPhaseHost("https://client-beta.example.com")).toBe(true)
    expect(isTestPhaseHost("https://www.glowmedspa.com")).toBe(false)
    expect(isTestPhaseHost("https://destiny.com")).toBe(false)
  })
  it("never runs on post-release; always on pre-release / internal QA; full scan only on test hosts", () => {
    expect(cartFlowAllowed("post_release", "https://x.gogroth.com").ok).toBe(false)
    expect(cartFlowAllowed("pre_release", "https://x.gogroth.com").ok).toBe(true)
    expect(cartFlowAllowed("internal_qa", "https://x.gogroth.com").ok).toBe(true)
    expect(cartFlowAllowed("full_scan", "https://x.gogroth.com").ok).toBe(true)
    expect(cartFlowAllowed("full_scan", "https://www.glowmedspa.com").ok).toBe(false)
  })
  it("picks an in-stock simple product, skipping variable and out-of-stock ones", () => {
    const p = pickProduct([
      { name: "Serum", type: "variable", variations: [{ id: 1 }], permalink: "https://s.test/p/serum", is_in_stock: true },
      { name: "Cream", type: "simple", is_in_stock: false, permalink: "https://s.test/p/cream" },
      { name: "SPF <b>50</b>", type: "simple", is_in_stock: true, is_purchasable: true, permalink: "https://s.test/p/spf" },
    ])
    expect(p).toEqual({ name: "SPF 50", url: "https://s.test/p/spf" })
    expect(pickProduct([])).toBeNull()
  })
})

const NOW = new Date(2026, 10, 9) // 9 Nov 2026

describe("expiredOfferReason", () => {
  it("flags an end date in the past", () => {
    expect(expiredOfferReason("Valid through March 31, 2025", NOW)).toMatch(/ended/)
    expect(expiredOfferReason("Offer expires 3/31/25", NOW)).toMatch(/ended/)
  })
  it("keeps a future end date", () => {
    expect(expiredOfferReason("Valid through December 31, 2026", NOW)).toBeNull()
  })
  it("flags an old month / year special", () => {
    expect(expiredOfferReason("October 2025 Specials", NOW)).toMatch(/Oct/i)
    expect(expiredOfferReason("2024 Holiday Specials", NOW)).toMatch(/2024/)
  })
  it("ignores founding years and this month's special", () => {
    expect(expiredOfferReason("Special care since 2015", NOW)).toBeNull()
    expect(expiredOfferReason("November 2026 Specials", NOW)).toBeNull()
  })
})

describe("footerBarProblems", () => {
  it("passes a complete footer bar", () => {
    expect(footerBarProblems("© 2026 Glow Med Spa. All rights reserved.", 1, "Glow Med Spa")).toEqual([])
  })
  it("flags @ instead of ©, missing rights, doubled copyright and missing name", () => {
    const p = footerBarProblems("@ 2026 Something | Privacy", 0, "Glow Med Spa")
    expect(p.join(" ")).toMatch(/"@" is used/)
    expect(p.join(" ")).toMatch(/All rights reserved/)
    expect(p.join(" ")).toMatch(/Glow Med Spa/)
    expect(footerBarProblems("© 2026 Glow Med Spa. All rights reserved. © 2026", 2, "Glow Med Spa").join(" ")).toMatch(/2 times/)
  })
})

describe("menuParityProblems", () => {
  const d = [
    { text: "Home", href: "https://s.test", depth: 0 },
    { text: "About", href: "https://s.test/about", depth: 0 },
    { text: "Services", href: "https://s.test/services", depth: 0 },
    { text: "Botox", href: "https://s.test/botox", depth: 1 },
    { text: "Contact", href: "https://s.test/contact", depth: 0 },
  ]
  it("same menus pass", () => {
    expect(menuParityProblems(d, d, [])).toEqual([])
  })
  it("flags missing items, renamed items and order", () => {
    const m = [
      { text: "Home", href: "https://s.test", depth: 0 },
      { text: "Contact Us", href: "https://s.test/contact", depth: 0 },
      { text: "Services", href: "https://s.test/services", depth: 0 },
    ]
    const p = menuParityProblems(d, m, []).join("\n")
    expect(p).toMatch(/Missing from the hamburger menu: About, Botox/)
    expect(p).toMatch(/"Contact" on desktop is "Contact Us"/)
  })
  it("flags footer tabs in a different order", () => {
    const footer = [
      { text: "Contact", href: "https://s.test/contact" },
      { text: "About", href: "https://s.test/about" },
      { text: "Home", href: "https://s.test" },
    ]
    expect(menuParityProblems(d, null, footer).join(" ")).toMatch(/Footer tabs are in a different order/)
  })
})

describe("offBrandWidgets", () => {
  it("flags a widget colour far from every brand colour, ignores neutrals", () => {
    const brand = ["rgb(180,140,90)", "rgb(255,255,255)"]
    expect(offBrandWidgets(brand, [{ name: "Chatbot", color: "rgb(30,90,250)" }])).toHaveLength(1)
    expect(offBrandWidgets(brand, [{ name: "Chatbot", color: "rgb(175,138,95)" }])).toHaveLength(0)
    expect(offBrandWidgets(brand, [{ name: "ADA", color: "rgb(20,20,20)" }])).toHaveLength(0)
  })
})

describe("service menus, order and names", () => {
  const nav = [
    { text: "Home", href: "https://s.test", depth: 0 },
    { text: "Services", href: "https://s.test/services", depth: 0 },
    { text: "Lip Filler", href: "https://s.test/lip-filler", depth: 1, parent: "Services" },
    { text: "Botox", href: "https://s.test/botox", depth: 1, parent: "Services" },
    { text: "Contact", href: "https://s.test/contact", depth: 0 },
  ]
  it("finds the services dropdown", () => {
    const m = serviceMenus(nav)
    expect(m).toHaveLength(1)
    expect(m[0].items.map((i) => i.text)).toEqual(["Lip Filler", "Botox"])
  })
  it("orderProblems detects missing and out-of-order services", () => {
    expect(orderProblems(["a", "b", "c"], ["a", "b", "c"])).toEqual({ missing: [], outOfOrder: false })
    expect(orderProblems(["a", "b", "c", "d"], ["b", "a", "c"])).toEqual({ missing: ["d"], outOfOrder: true })
  })
  it("namesMatch tolerates plurals and wording, catches different services", () => {
    expect(namesMatch("Lip Filler", "Lip Fillers")).toBe(true)
    expect(namesMatch("Botox", "Botox Injections")).toBe(true)
    expect(namesMatch("Botox", "Laser Hair Removal")).toBe(false)
  })
})

describe("factsStore", () => {
  it("imageKey ignores size suffix, format and query", () => {
    expect(imageKey("https://s.test/wp-content/uploads/2025/01/botox-face-768x538.jpg?v=2")).toBe("botox-face")
    expect(imageKey("/wp-content/uploads/botox-face.jpg.webp")).toBe("botox-face")
    expect(imageKey("https://s.test/a/botox-face-scaled.png")).toBe("botox-face")
    expect(imageKey("data:image/png;base64,xx")).toBe("")
  })
  it("samePageKey ignores scheme, www, slash and query", () => {
    expect(samePageKey("https://www.s.test/a/?x=1")).toBe(samePageKey("http://s.test/a"))
  })
  it("merges the desktop read and the mobile order for one page", () => {
    const run = "run-test"
    putMobileOrder(run, "https://s.test/a", { imageFirst: ["x"], textFirst: [] })
    putFacts(run, { ...emptyFacts("https://s.test/a"), title: "A" })
    const all = getFacts(run)
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe("A")
    expect(all[0].mobileOrder?.imageFirst).toEqual(["x"])
    releaseFacts(run)
    expect(getFacts(run)).toHaveLength(0)
  })
})

describe("gap findings and the shared verdict", () => {
  it("a gap finding is a real defect, never a pass or a lapse", () => {
    for (const c of GAP_CHECKS) {
      const f = gapFinding(c.key, "Example problem", ["No consent checkbox", "No Previous / Next post links", "No map link found for the address"], "https://s.test")
      expect(isRealDefect(f)).toBe(true)
      expect(resultForCheck(c.key, [f], true)).toBe("fail")
    }
  })
  it("a gap lapse is 'could not complete'", () => {
    const f = lapseFinding("link_targets", "the page could not be read", "https://s.test")
    expect(isToolLapseFinding(f)).toBe(true)
    expect(resultForCheck("link_targets", [f], true)).toBe("lapsed")
  })
  it("no rows at the end of a completed run is a pass", () => {
    expect(resultForCheck("trademark_symbols", [], true)).toBe("pass")
  })
})

describe("registry", () => {
  it("keys are unique and every check has a pre-release home", () => {
    expect(new Set(GAP_CHECK_KEYS).size).toBe(GAP_CHECK_KEYS.length)
    for (const c of GAP_CHECKS) expect(c.pre.length).toBeGreaterThan(0)
  })
  it("withGapChecks adds a check only to its home section", () => {
    const t = withGapChecks(
      [
        { matchers: ["functionalitytesting"], checks: ["functionality_check"] },
        { matchers: ["contactform"], checks: ["contact_form"] },
      ],
      "pre",
    )
    expect(t[0].checks).toContain("link_targets")
    expect(t[0].checks).not.toContain("form_quality")
    expect(t[1].checks).toContain("form_quality")
  })
  it("brand list has no duplicates", () => {
    const lower = TRADEMARK_BRANDS.map((b) => b.toLowerCase())
    expect(new Set(lower).size).toBe(lower.length)
  })
})
