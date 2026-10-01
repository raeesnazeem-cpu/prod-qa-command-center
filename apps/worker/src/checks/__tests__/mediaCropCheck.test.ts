import { isCleanPassFinding, isToolLapseFinding, isRealDefect } from "@qacc/shared"
import { objectFitVisible, measureCrop, MIN_HIDDEN, MediaFacts } from "../mediaCropCheck"

const facts = (over: Partial<MediaFacts> = {}): MediaFacts => ({
  idx: 0,
  kind: "image",
  src: "https://example.test/a.jpg",
  boxW: 400,
  boxH: 400,
  contentW: 400,
  contentH: 400,
  naturalW: 1600,
  naturalH: 900,
  objectFit: "fill",
  clipVisible: 1,
  clipEdges: [],
  inSlider: false,
  ...over,
})

describe("objectFitVisible", () => {
  it("cover on a 16:9 image in a square box hides the sides", () => {
    const r = objectFitVisible("cover", 400, 400, 1600, 900)
    // visible width share = (400/400*900/1600) → 0.5625
    expect(r.visible).toBeCloseTo(0.5625, 3)
    expect(r.cut).toBe("sides")
  })

  it("cover on a matching ratio hides nothing", () => {
    const r = objectFitVisible("cover", 800, 450, 1600, 900)
    expect(r.visible).toBeCloseTo(1, 3)
    expect(r.cut).toBeNull()
  })

  it("cover on a wide box hides top/bottom", () => {
    const r = objectFitVisible("cover", 1600, 300, 1600, 900)
    expect(r.visible).toBeCloseTo(1 / 3, 3)
    expect(r.cut).toBe("top-bottom")
  })

  it("contain / fill / scale-down never crop", () => {
    for (const f of ["contain", "fill", "scale-down", ""]) {
      expect(objectFitVisible(f, 400, 400, 1600, 900).visible).toBe(1)
    }
  })

  it("none shows only the box-sized part of a big image", () => {
    const r = objectFitVisible("none", 400, 300, 800, 600)
    expect(r.visible).toBeCloseTo(0.25, 3)
    expect(r.cut).toBe("both")
  })

  it("unknown natural size is treated as not cropped", () => {
    expect(objectFitVisible("cover", 400, 400, 0, 0).visible).toBe(1)
  })
})

describe("measureCrop", () => {
  it("flags a cover image that hides most of itself", () => {
    const c = measureCrop(facts({ objectFit: "cover" }))
    expect(c.hidden).toBeGreaterThanOrEqual(MIN_HIDDEN)
    expect(c.reasons[0]).toMatch(/object-fit: cover cuts 44% off the left\/right/)
  })

  it("flags an image pushed past the screen edge", () => {
    const c = measureCrop(facts({ naturalW: 400, naturalH: 400, clipVisible: 0.5, clipEdges: ["right"] }))
    expect(c.hidden).toBeCloseTo(0.5, 3)
    expect(c.reasons[0]).toMatch(/50% hidden past the right edge/)
  })

  it("combines object-fit and clip crop", () => {
    const c = measureCrop(facts({ objectFit: "cover", clipVisible: 0.8, clipEdges: ["bottom"] }))
    expect(c.hidden).toBeCloseTo(1 - 0.5625 * 0.8, 3)
    expect(c.reasons).toHaveLength(2)
  })

  it("ignores clip inside a slider (peek slides are intentional)", () => {
    const c = measureCrop(facts({ naturalW: 400, naturalH: 400, clipVisible: 0.4, clipEdges: ["right"], inSlider: true }))
    expect(c.hidden).toBe(0)
    expect(c.reasons).toHaveLength(0)
  })

  it("a video without object-fit letterboxes, so it is not cropped", () => {
    const c = measureCrop(facts({ kind: "video", objectFit: "fill" }))
    expect(c.hidden).toBe(0)
  })

  it("a cover video is measured like an image", () => {
    const c = measureCrop(facts({ kind: "video", objectFit: "cover" }))
    expect(c.hidden).toBeCloseTo(1 - 0.5625, 3)
  })

  it("small trims stay under the threshold", () => {
    const c = measureCrop(facts({ objectFit: "cover", boxW: 800, boxH: 500, contentW: 800, contentH: 500 }))
    expect(c.hidden).toBeLessThan(MIN_HIDDEN)
  })
})

describe("media_crop verdicts", () => {
  const row = (title: string, description = "") => ({ check_factor: "media_crop", title, description })

  it("pass row is a clean pass", () => {
    const f = row("No media cropping issues found", "Checked the page's images and videos at desktop, tablet and mobile widths — none are cut off.")
    expect(isCleanPassFinding(f)).toBe(true)
    expect(isRealDefect(f)).toBe(false)
  })

  it("lapse row is a tool lapse", () => {
    const f = row("Media Crop Check Failed", "The page could not be checked at every screen size (Mobile: HTTP 503). Process aborted gracefully.")
    expect(isToolLapseFinding(f)).toBe(true)
    expect(isRealDefect(f)).toBe(false)
  })

  it("failure row is a real defect", () => {
    const f = row("3 cropped image/video items found — 0 desktop, 1 tablet, 2 mobile", "Images or videos on this page are cut off at some screen sizes.")
    expect(isRealDefect(f)).toBe(true)
  })
})
