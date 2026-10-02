jest.mock("../supabase", () => ({ supabase: {} }))
jest.mock("../queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })
import { renderCheckSectionHtml, FRIENDLY } from "../tedSync"
import { buildFinding } from "../../checks/blogSidebarCheck"

const render = (group: any[], pageUrlById = new Map<string, string>()) =>
  renderCheckSectionHtml("blog_sidebar", group, new Map(), { remaining: 0 }, pageUrlById)

const row = (pageId: string, url: string, v: any) => ({ ...(buildFinding(v, url, url, null) as any), id: `f-${pageId}-${v.kind}`, page_id: pageId })
const NO_SIDEBAR = { kind: "fail", noSidebar: true, missing: ["search", "recent", "categories"], notInSidebar: [] }
const NO_CATS = { kind: "fail", noSidebar: false, missing: ["categories"], notInSidebar: [] }

describe("TED report — blog_sidebar section", () => {
  const urls = new Map([
    ["p1", "https://site.test/blog/one/"],
    ["p2", "https://site.test/blog/two/"],
    ["p3", "https://site.test/blog/three/"],
  ])

  it("has a friendly label", () => {
    expect(FRIENDLY.blog_sidebar).toBe("Blog Post Sidebar")
  })

  it("no rows → could not complete (never a silent pass)", async () => {
    const r = await render([])
    expect(r.status).toBe("errored")
    expect(r.html).toContain("no blog post pages were found")
  })

  it("lists EVERY failing post link — identical rows are not collapsed", async () => {
    const r = await render(
      [row("p1", urls.get("p1")!, NO_SIDEBAR), row("p2", urls.get("p2")!, NO_SIDEBAR), row("p3", urls.get("p3")!, { kind: "pass" })],
      urls,
    )
    expect(r.status).toBe("failed")
    expect(r.html).toContain("2 of 3 blog posts failed")
    expect(r.html).toContain("https://site.test/blog/one/")
    expect(r.html).toContain("https://site.test/blog/two/")
    expect(r.html).not.toContain("https://site.test/blog/three/")
  })

  it("a retried page (lapse + verdict) counts once, by its verdict", async () => {
    const r = await render(
      [row("p1", urls.get("p1")!, { kind: "lapse", reason: "x" }), row("p1", urls.get("p1")!, NO_CATS), row("p1", urls.get("p1")!, NO_CATS)],
      urls,
    )
    expect(r.status).toBe("failed")
    expect(r.html).toContain("1 of 1 blog post failed")
    expect(r.html).not.toContain("Could not check")
    expect(r.html).toContain("missing: Categories section")
  })

  it("passes + an unread post → could not complete, naming the unread link", async () => {
    const r = await render([row("p1", urls.get("p1")!, { kind: "pass" }), row("p2", urls.get("p2")!, { kind: "lapse", reason: "the page did not finish loading" })], urls)
    expect(r.status).toBe("errored")
    expect(r.html).toContain("checked 1 of 2 blog posts")
    expect(r.html).toContain("https://site.test/blog/two/")
  })

  it("all posts pass → passed with the count", async () => {
    const r = await render([row("p1", urls.get("p1")!, { kind: "pass" }), row("p2", urls.get("p2")!, { kind: "pass" })], urls)
    expect(r.status).toBe("passed")
    expect(r.html).toContain("All 2 blog posts have a sidebar")
  })

  it("falls back to the context_text link when the page map lacks the id", async () => {
    const r = await render([row("px", "https://site.test/blog/orphan/", NO_SIDEBAR)])
    expect(r.html).toContain("https://site.test/blog/orphan/")
  })
})
