import { isCleanPassFinding, isToolLapseFinding, isRealDefect, resultForCheck, aiLapseBlocksPass, aiLapseSummary } from "@qacc/shared"
import {
  decideSidebar,
  buildFinding,
  SidebarFacts,
  BLOG_SIDEBAR_PASS_TITLE,
  BLOG_SIDEBAR_LAPSE_TITLE,
  BLOG_SIDEBAR_MISSING_TITLE,
  BLOG_SIDEBAR_INCOMPLETE_TITLE,
} from "../blogSidebarCheck"

const none = { search: false, recent: false, categories: false }
const all = { search: true, recent: true, categories: true }
const facts = (over: Partial<SidebarFacts> = {}): SidebarFacts => ({
  isPost: true,
  blocked: false,
  readyState: "complete",
  finalUrl: "https://site.test/blog/a/",
  viewportW: 1280,
  contentFound: true,
  beside: { ...none },
  sidebarRegion: false,
  elsewhere: { ...none },
  ...over,
})

describe("decideSidebar", () => {
  it("non-post pages are skipped silently", () => {
    expect(decideSidebar(facts({ isPost: false }))).toEqual({ kind: "skip" })
  })

  it("all three sections beside the post → pass", () => {
    expect(decideSidebar(facts({ beside: { ...all }, sidebarRegion: true }))).toEqual({ kind: "pass" })
  })

  it("pass wins even if the page was still loading", () => {
    expect(decideSidebar(facts({ beside: { ...all }, readyState: "loading" })).kind).toBe("pass")
  })

  it("nothing beside the post → no sidebar", () => {
    const v = decideSidebar(facts())
    expect(v).toEqual({ kind: "fail", noSidebar: true, missing: ["search", "recent", "categories"], notInSidebar: [] })
  })

  it("an empty sidebar region → incomplete, not 'no sidebar'", () => {
    const v: any = decideSidebar(facts({ sidebarRegion: true }))
    expect(v.kind).toBe("fail")
    expect(v.noSidebar).toBe(false)
  })

  it("sidebar missing categories → incomplete with exactly that", () => {
    const v: any = decideSidebar(facts({ beside: { search: true, recent: true, categories: false }, sidebarRegion: true }))
    expect(v).toEqual({ kind: "fail", noSidebar: false, missing: ["categories"], notInSidebar: [] })
  })

  it("widgets only in the footer → no sidebar, and says where they are", () => {
    const v: any = decideSidebar(facts({ elsewhere: { ...all } }))
    expect(v.noSidebar).toBe(true)
    expect(v.notInSidebar).toEqual(["search", "recent", "categories"])
  })

  it("bot-blocked → lapse, even before post detection", () => {
    expect(decideSidebar(facts({ blocked: true, isPost: false })).kind).toBe("lapse")
  })

  it("half-loaded page cannot prove a section is missing → lapse", () => {
    expect(decideSidebar(facts({ readyState: "loading" })).kind).toBe("lapse")
  })

  it("no content area and no sidebar region → lapse, not a false fail", () => {
    expect(decideSidebar(facts({ contentFound: false })).kind).toBe("lapse")
  })
})

describe("buildFinding + shared verdicts", () => {
  const url = "https://site.test/blog/a/"
  it("skip → no row", () => {
    expect(buildFinding({ kind: "skip" }, url, url, null)).toBeNull()
  })

  it("pass row is a clean pass, not a defect, not a lapse", () => {
    const f: any = buildFinding({ kind: "pass" }, url, url, null)
    expect(f.title).toBe(BLOG_SIDEBAR_PASS_TITLE)
    expect(isCleanPassFinding(f)).toBe(true)
    expect(isRealDefect(f)).toBe(false)
    expect(isToolLapseFinding(f)).toBe(false)
  })

  it("lapse row is a lapse with a 'could not complete' reason", () => {
    const f: any = buildFinding({ kind: "lapse", reason: "the page did not finish loading" }, url, url, null)
    expect(f.title).toBe(BLOG_SIDEBAR_LAPSE_TITLE)
    expect(isToolLapseFinding(f)).toBe(true)
    expect(isRealDefect(f)).toBe(false)
    expect(aiLapseSummary([f])).toBe("the page did not finish loading")
  })

  it("crawl-job generic 'Check Failed' lapse is a lapse too", () => {
    expect(isToolLapseFinding({ check_factor: "blog_sidebar", title: "Check Failed", description: "x" })).toBe(true)
  })

  it("fail rows are real defects, with the page link and what is missing", () => {
    const miss: any = buildFinding({ kind: "fail", noSidebar: true, missing: ["search", "recent", "categories"], notInSidebar: [] }, url, url, "https://shot")
    expect(miss.title).toBe(BLOG_SIDEBAR_MISSING_TITLE)
    expect(isRealDefect(miss)).toBe(true)
    expect(miss.context_text).toContain(`Page: ${url}`)
    expect(miss.screenshot_url).toBe("https://shot")
    const inc: any = buildFinding({ kind: "fail", noSidebar: false, missing: ["categories"], notInSidebar: ["categories"] }, url, url, null)
    expect(inc.title).toBe(BLOG_SIDEBAR_INCOMPLETE_TITLE)
    expect(inc.description).toContain("missing: Categories section")
    expect(inc.description).toContain("Found outside a sidebar")
    expect(isRealDefect(inc)).toBe(true)
    expect(isCleanPassFinding(inc)).toBe(false)
  })

  it("a redirect is recorded alongside the crawled link", () => {
    const f: any = buildFinding({ kind: "pass" }, url, "https://site.test/blog/b/", null)
    expect(f.context_text).toContain("Final URL: https://site.test/blog/b/")
  })

  it("check-level result: zero rows lapse; any unread post blocks a pass", () => {
    expect(resultForCheck("blog_sidebar", [], true)).toBe("lapsed")
    const pass: any = buildFinding({ kind: "pass" }, url, url, null)
    const lapse: any = buildFinding({ kind: "lapse", reason: "x" }, url, url, null)
    expect(resultForCheck("blog_sidebar", [pass], true)).toBe("pass")
    expect(aiLapseBlocksPass("blog_sidebar", [pass, lapse])).toBe(true)
    expect(resultForCheck("blog_sidebar", [pass, lapse], true)).toBe("lapsed")
  })
})
