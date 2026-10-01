jest.mock("../../lib/aiFallback", () => ({ completeTextIsolated: jest.fn(), describeImageResult: jest.fn() }))

import {
  isCleanPassFinding,
  isToolLapseFinding,
  isRealDefect,
  aiLapseBlocksPass,
  resultForCheck,
} from "@qacc/shared"
import {
  classifyByUrl,
  classifyByBodyClass,
  pickServiceName,
  parseImageVerdict,
  parseDescription,
  parseServicePageVerdict,
  decidePage,
  imageKey,
  isCrossLink,
  isListingPage,
  fileNameHint,
  hintNamesService,
  judgePrompt,
  normalizePageUrl,
  CheckedImage,
} from "../imageRelevanceCheck"

const SITE = "https://nuvoaestheticsclinic.gogroth.com/"
const at = (p: string) => `https://nuvoaestheticsclinic.gogroth.com${p}`

describe("classifyByUrl", () => {
  it("homepage in any spelling", () => {
    expect(classifyByUrl(SITE, SITE).kind).toBe("home")
    expect(classifyByUrl("http://www.nuvoaestheticsclinic.gogroth.com", SITE).kind).toBe("home")
    expect(classifyByUrl(at("/index.php"), SITE).kind).toBe("home")
    expect(classifyByUrl(at("/?utm=x"), SITE).kind).toBe("home")
  })

  it("service paths", () => {
    expect(classifyByUrl(at("/services/botox/"), SITE).kind).toBe("service")
    expect(classifyByUrl(at("/treatments/laser-hair-removal"), SITE).kind).toBe("service")
    expect(classifyByUrl(at("/acne-treatment/"), SITE).kind).toBe("service")
    expect(classifyByUrl(at("/medical-spa-services/hydrafacial/"), SITE).kind).toBe("service")
  })

  it("services hub and utility pages are excluded", () => {
    for (const p of ["/services/", "/our-treatments/", "/contact-us/", "/about/", "/blog/botox-myths/",
      "/category/news/", "/privacy-policy/", "/gallery/", "/before-after-botox/", "/meet-dr-smith/",
      "/faq/", "/specials/", "/blog/page/2/", "/2024/05/", "/thank-you/", "/book-now/"])
      expect([p, classifyByUrl(at(p), SITE).kind]).toEqual([p, "excluded"])
  })

  it("services hub is excluded but a page under it is not", () => {
    expect(classifyByUrl(at("/services/injectables/"), SITE).kind).toBe("service")
  })

  it("root-level treatment slugs are left to the next signal", () => {
    expect(classifyByUrl(at("/botox/"), SITE).kind).toBe("unknown")
  })

  it("sub-folder installs", () => {
    const sub = "https://example.com/clinic/"
    expect(classifyByUrl("https://example.com/clinic", sub).kind).toBe("home")
    expect(classifyByUrl("https://example.com/clinic/services/botox/", sub).kind).toBe("service")
  })
})

describe("classifyByBodyClass", () => {
  it("blog / archive templates are excluded", () => {
    expect(classifyByBodyClass(["single", "single-post", "postid-4"]).kind).toBe("excluded")
    expect(classifyByBodyClass(["archive", "category"]).kind).toBe("excluded")
    expect(classifyByBodyClass(["error404"]).kind).toBe("excluded")
  })
  it("service post types are services", () => {
    expect(classifyByBodyClass(["single", "single-services"]).kind).toBe("service")
    expect(classifyByBodyClass(["single-treatment"]).kind).toBe("service")
  })
  it("plain pages are unknown", () => {
    expect(classifyByBodyClass(["page", "page-id-12", "elementor-page"]).kind).toBe("unknown")
  })
})

describe("pickServiceName", () => {
  const base = { title: "", brandHints: ["Nuvo Aesthetics Clinic"], host: "nuvoaestheticsclinic.gogroth.com", slug: "botox" }
  it("prefers the content H1", () => {
    expect(pickServiceName({ ...base, h1s: ["Botox Cosmetic"], menuLabel: "Botox" })).toBe("Botox Cosmetic")
  })
  it("skips generic headings", () => {
    expect(pickServiceName({ ...base, h1s: ["Welcome to Nuvo", "Our Services"], menuLabel: "Botox" })).toBe("Botox")
  })
  it("falls back to the tab title without the brand, then the slug", () => {
    expect(pickServiceName({ ...base, h1s: [], title: "Lip Fillers | Nuvo Aesthetics Clinic" })).toBe("Lip Fillers")
    expect(pickServiceName({ ...base, h1s: [], slug: "laser-hair-removal" })).toBe("Laser Hair Removal")
  })
})

describe("AI reply parsing", () => {
  it("reads the image verdict, tolerating chatter", () => {
    const v = parseImageVerdict('Sure! {"shows":"a dental chair","category":"Irrelevant","confidence":0.9,"reason":"dentistry"} hope that helps')
    expect(v).toEqual({ category: "irrelevant", confidence: 0.9, shows: "a dental chair", reason: "dentistry" })
  })
  it("rejects unknown categories and junk", () => {
    expect(parseImageVerdict('{"category":"maybe"}')).toBeNull()
    expect(parseImageVerdict("no json here")).toBeNull()
  })
  it("clamps confidence", () => {
    expect(parseImageVerdict('{"category":"relevant","confidence":7}')!.confidence).toBe(1)
    expect(parseImageVerdict('{"category":"relevant","confidence":"x"}')!.confidence).toBe(0)
  })
  it("reads description and service-page replies", () => {
    expect(parseDescription('{"shows": "a woman getting a facial with a handheld device"}')).toBe(
      "a woman getting a facial with a handheld device",
    )
    // Prose is accepted (small models often skip the JSON for this step).
    expect(parseDescription("The image shows a woman receiving an injection in her forehead.")).toBe(
      "a woman receiving an injection in her forehead.",
    )
    expect(parseDescription("ok")).toBeNull()
    expect(parseDescription('{"other": 1}')).toBeNull()
    expect(parseDescription('{"shows": ""}')).toBeNull()
    expect(parseServicePageVerdict('{"service_page": true, "service": "Botox", "confidence": 0.9}')).toEqual({
      servicePage: true,
      service: "Botox",
      confidence: 0.9,
    })
    expect(parseServicePageVerdict('{"service": "Botox"}')).toBeNull()
  })
})

describe("helpers", () => {
  it("imageKey merges WordPress size variants", () => {
    expect(imageKey("https://x.com/wp-content/uploads/botox-300x200.jpg?v=2")).toBe(
      imageKey("https://x.com/wp-content/uploads/botox.jpg"),
    )
    expect(imageKey("https://x.com/a/botox-scaled.jpg")).toBe(imageKey("https://x.com/a/botox.jpg"))
  })
  it("isCrossLink: only internal links to other pages", () => {
    const page = at("/services/botox/")
    expect(isCrossLink(at("/services/fillers/"), page)).toBe(true)
    expect(isCrossLink(at("/services/botox"), page)).toBe(false)
    expect(isCrossLink(at("/contact-us/"), page)).toBe(false)
    expect(isCrossLink(at("/book-appointment/"), page)).toBe(false)
    expect(isCrossLink(at("/wp-content/uploads/botox.jpg"), page)).toBe(false)
    expect(isCrossLink("https://instagram.com/x", page)).toBe(false)
    expect(isCrossLink("tel:+15551234", page)).toBe(false)
    expect(isCrossLink("", page)).toBe(false)
  })
  it("isListingPage: only cards to 3+ other pages and no own image", () => {
    const page = at("/skin-treatments/")
    const card = (p: string) => ({ linkHref: at(p) })
    expect(isListingPage([card("/services/a/"), card("/services/b/"), card("/services/c/")], page)).toBe(true)
    // Same target repeated is not 3 services.
    expect(isListingPage([card("/services/a/"), card("/services/a"), card("/services/b/")], page)).toBe(false)
    // A service page with a related-treatments row still has its own image.
    expect(isListingPage([{ linkHref: "" }, card("/services/a/"), card("/services/b/"), card("/services/c/")], page)).toBe(false)
    // No images at all is not a listing page (that is "missing images").
    expect(isListingPage([], page)).toBe(false)
  })
  it("fileNameHint", () => {
    expect(fileNameHint("https://x.com/wp-content/uploads/2026/05/MOXI%C2%AE-Skin-Resurfacing-TX-768x538.webp")).toBe(
      "MOXI® Skin Resurfacing TX",
    )
    expect(fileNameHint("https://x.com/u/IMG_4521.jpg")).toBe("")
    expect(fileNameHint("not a url")).toBe("")
  })
  it("hintNamesService", () => {
    expect(hintNamesService("MOXI® Skin Resurfacing", "MOXI® Skin new Resurfacing TX at Elite")).toBe(true)
    expect(hintNamesService("Lip Fillers", "lip filler before after")).toBe(true)
    expect(hintNamesService("Laser Treatment", "treatment room")).toBe(false) // stop words only
    expect(hintNamesService("Botox", "")).toBe(false)
  })
  it("judgePrompt: file name / nearby text only on the rescue pass", () => {
    const plain = judgePrompt("Botox", "", "a dentist", undefined).user
    expect(plain).not.toMatch(/file name|next to the image/i)
    const rescue = judgePrompt("Botox", "", "a dentist", { near: "Botox results", fileName: "botox hero" }).user
    expect(rescue).toMatch(/Image file name: botox hero/)
    expect(rescue).toMatch(/Text next to the image: Botox results/)
  })
  it("normalizePageUrl", () => {
    expect(normalizePageUrl("https://www.X.com/a/b/?q=1#h")).toBe("x.com/a/b")
  })
})

describe("decidePage → one finding, classified correctly", () => {
  const url = at("/services/botox/")
  const img = (category: any, confidence = 0.9, extra: Partial<CheckedImage> = {}): CheckedImage => ({
    src: `https://x.com/${Math.random()}.jpg`,
    thumb: "",
    verdict: { category, confidence, shows: `a ${category} thing`, reason: "" },
    ...extra,
  })
  const base = { pageUrl: url, service: "Botox", loadOk: true, lastError: "" }

  it("pass: all read, at least one relevant", () => {
    const f = decidePage({ ...base, candidates: 3, checked: [img("relevant"), img("neutral"), img("relevant")] })
    expect(isCleanPassFinding(f)).toBe(true)
    expect(isToolLapseFinding(f)).toBe(false)
  })

  it("fail: a confirmed irrelevant image, with the X-should-be-Y note", () => {
    const f = decidePage({
      ...base,
      candidates: 2,
      checked: [img("relevant"), img("irrelevant", 0.9, { confirmed: true })],
    })
    expect(isRealDefect(f)).toBe(true)
    expect(f.title).toContain('not relevant to "Botox"')
    const rows = JSON.parse(f.context_text as string)
    expect(rows).toHaveLength(1)
    expect(rows[0].note).toMatch(/^Shows a irrelevant thing — should show something related to Botox$/)
  })

  it("fail even when other images could not be read", () => {
    const f = decidePage({
      ...base,
      candidates: 2,
      lastError: "429 rate limit",
      checked: [img("irrelevant", 0.9, { confirmed: true }), { src: "s", thumb: "", verdict: null }],
    })
    expect(isRealDefect(f)).toBe(true)
  })

  it("fail: every image read, all generic", () => {
    const f = decidePage({ ...base, candidates: 2, checked: [img("neutral"), img("neutral")] })
    expect(isRealDefect(f)).toBe(true)
    expect(f.title).toContain("do not show the service")
  })

  it("fail: a weak 'relevant' does not count as a match", () => {
    const f = decidePage({ ...base, candidates: 1, checked: [img("relevant", 0.3)] })
    expect(isRealDefect(f)).toBe(true)
  })

  it("fail: service page with no content images", () => {
    const f = decidePage({ ...base, candidates: 0, checked: [] })
    expect(isRealDefect(f)).toBe(true)
    expect(f.title).toContain("missing images")
  })

  it("lapse: page did not load and nothing was read", () => {
    const f = decidePage({ ...base, loadOk: false, candidates: 0, checked: [] })
    expect(isToolLapseFinding(f)).toBe(true)
  })

  it("lapse: vision down, nothing relevant confirmed", () => {
    const f = decidePage({
      ...base,
      candidates: 2,
      lastError: "429 Too Many Requests",
      checked: [{ src: "a", thumb: "", verdict: null }, img("neutral")],
    })
    expect(isToolLapseFinding(f)).toBe(true)
    expect(f.description).toContain("AI limit exhausted")
  })

  it("lapse: relevant images exist but another image was never read", () => {
    const f = decidePage({
      ...base,
      candidates: 2,
      lastError: "vision attempt timed out",
      checked: [img("relevant"), { src: "a", thumb: "", verdict: null }],
    })
    expect(isToolLapseFinding(f)).toBe(true)
  })

  it("lapse: irrelevant but the second opinion never answered", () => {
    const f = decidePage({ ...base, candidates: 2, checked: [img("relevant"), img("irrelevant", 0.9)] })
    expect(isToolLapseFinding(f)).toBe(true)
  })

  it("service names cannot trick the classifiers", () => {
    for (const service of ["No Issues Found Facial", "Skin Problems Were Treated", "Error Correction", "Skipped Step Peel"]) {
      const fail = decidePage({ ...base, service, candidates: 1, checked: [img("neutral")] })
      expect([service, isRealDefect(fail)]).toEqual([service, true])
      const missing = decidePage({ ...base, service, candidates: 0, checked: [] })
      expect([service, isRealDefect(missing)]).toEqual([service, true])
    }
  })
})

describe("check-level rollup", () => {
  it("no rows at the end of a run is not a pass", () => {
    expect(resultForCheck("image_relevance", [], true)).toBe("lapsed")
    expect(resultForCheck("image_relevance", [], false)).toBe("notRun")
  })
  it("the crawl job's generic lapse row counts as a lapse", () => {
    const f = { check_factor: "image_relevance", title: "Check Failed", description: "The image_relevance check encountered an unexpected error" }
    expect(isToolLapseFinding(f)).toBe(true)
    expect(isRealDefect(f)).toBe(false)
  })
  it("a lapsed page blocks a pass", () => {
    const pass = { check_factor: "image_relevance", title: "No image relevance issues found", description: "ok", page_id: "1" }
    const lapse = {
      check_factor: "image_relevance",
      title: "Image Relevance Check Failed",
      description: "Could not complete: AI limit exhausted. x Process aborted gracefully.",
      page_id: "2",
    }
    expect(aiLapseBlocksPass("image_relevance", [pass, lapse])).toBe(true)
    expect(resultForCheck("image_relevance", [pass, lapse], true)).toBe("lapsed")
    expect(resultForCheck("image_relevance", [pass], true)).toBe("pass")
  })
})
