jest.mock("../supabase", () => ({ supabase: {} }))
jest.mock("../queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })
import { renderCheckSectionHtml, FRIENDLY } from "../tedSync"

const render = (group: any[], pageUrlById = new Map<string, string>()) =>
  renderCheckSectionHtml("image_relevance", group, new Map(), { remaining: 0 }, pageUrlById)

describe("TED report — image_relevance section", () => {
  it("has a friendly label", () => {
    expect(FRIENDLY.image_relevance).toBe("Image Relevance (Service Pages)")
  })

  it("no rows at all → could not complete, shown (not hidden, not passed)", async () => {
    const r = await render([])
    expect(r.status).toBe("errored")
    expect(r.html).toContain("no service pages were identified")
  })

  it("defect → per-page block with 'Shows X — should show Y' lines", async () => {
    const rows = [
      { type: "irrelevant", src: "https://x.com/a.jpg", thumb: "", note: "Shows a dental chair — should show something related to Botox" },
    ]
    const r = await render(
      [
        {
          id: "f1",
          page_id: "p1",
          check_factor: "image_relevance",
          title: '1 image not relevant to "Botox"',
          description: "x",
          context_text: JSON.stringify(rows),
        },
      ],
      new Map([["p1", "https://site.com/services/botox/"]]),
    )
    expect(r.status).toBe("failed")
    expect(r.html).toContain("https://site.com/services/botox/")
    expect(r.html).toContain("1. Shows a dental chair — should show something related to Botox")
  })

  it("missing images → its description is shown", async () => {
    const r = await render([
      {
        page_id: "p1",
        check_factor: "image_relevance",
        title: 'Service page "Lip Filler" is missing images',
        description: "The Lip Filler service page has no images in its content.",
        context_text: "Page: x",
      },
    ])
    expect(r.status).toBe("failed")
    expect(r.html).toContain("has no images in its content")
  })

  it("a lapsed page blocks the pass and names the reason", async () => {
    const r = await render([
      { page_id: "p1", check_factor: "image_relevance", title: "No image relevance issues found", description: "ok" },
      {
        page_id: "p2",
        check_factor: "image_relevance",
        title: "Image Relevance Check Failed",
        description: "Could not complete: AI limit exhausted. Read 0 of 2. Process aborted gracefully.",
      },
    ])
    expect(r.status).toBe("errored")
    expect(r.html).toContain("AI limit exhausted")
    expect(r.html).toContain("checked 1 of 2 pages")
  })

  it("pass → says how many service pages were verified", async () => {
    const r = await render([
      { page_id: "p1", check_factor: "image_relevance", title: "No image relevance issues found", description: "ok" },
      { page_id: "p2", check_factor: "image_relevance", title: "No image relevance issues found", description: "ok" },
    ])
    expect(r.status).toBe("passed")
    expect(r.html).toContain("Images on 2 service pages match")
  })
})
