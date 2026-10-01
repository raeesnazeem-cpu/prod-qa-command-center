import { Browser } from "playwright"
import { Finding } from "@qacc/shared"

/**
 * QA Media Crop — images & videos cut off at desktop / tablet / mobile
 *
 * FULL SCAN ONLY, every page. Scan only — there is no automated fix.
 *
 * For every visible content <img> and <video> the page is loaded at three
 * widths and two kinds of cropping are measured from the rendered layout:
 *
 *   1. object-fit crop — the box's aspect ratio differs from the media's own
 *      ratio and `object-fit: cover` (or `none`) cuts the overflow off. The
 *      hidden share is exact: the scaled media area minus the box area.
 *   2. clip crop — an ancestor with `overflow: hidden/clip/auto/scroll`, or the
 *      right/left edge of the screen, cuts part of the element's box off.
 *
 * A media item is flagged when, combined, at least MIN_HIDDEN of it is hidden.
 * The evidence thumbnail is a screenshot of exactly what the visitor sees at
 * that width, next to a link to the full source file.
 *
 * Skipped on purpose (they are designed to crop, not defects): theme/builder
 * BACKGROUND media — Elementor background video / slideshow, the block-theme
 * Cover block's background image/video — and the clip measurement inside known
 * slider/carousel markup, where partly visible "peek" slides are intentional.
 */

const CHECK_FACTOR = "media_crop"

// Share of an image/video that must be hidden before it is reported.
export const MIN_HIDDEN = 0.3
// Rendered size floor — icons, avatars and logos are not content media.
const MIN_RENDER_W = 120
const MIN_RENDER_H = 80
const MIN_RENDER_AREA = 15000
// Natural (source) size floor for images.
const MIN_NATURAL = 100
// Per viewport caps so a gallery page can't blow up the run.
const MAX_CANDIDATES = 80
const MAX_FLAGGED_PER_VIEWPORT = 8

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export const VIEWPORTS: {
  name: "desktop" | "tablet" | "mobile"
  label: string
  width: number
  height: number
  mobile: boolean
  ua: string
}[] = [
  { name: "desktop", label: "Desktop", width: 1440, height: 900, mobile: false, ua: DESKTOP_UA },
  {
    name: "tablet",
    label: "Tablet",
    width: 768,
    height: 1024,
    mobile: true,
    ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  {
    name: "mobile",
    label: "Mobile",
    width: 390,
    height: 844,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
]

// Raw layout facts for one media element, measured inside the page.
export interface MediaFacts {
  idx: number
  kind: "image" | "video"
  src: string
  // Element border box (viewport coords at measure time, page-scroll adjusted).
  boxW: number
  boxH: number
  // Content box (border box minus padding + border) — where the media paints.
  contentW: number
  contentH: number
  naturalW: number
  naturalH: number
  objectFit: string
  // Share of the border box left visible after ancestor + screen-edge clipping.
  clipVisible: number
  // Which edges the clip cut ("left", "right", "top", "bottom").
  clipEdges: string[]
  inSlider: boolean
}

export interface CropResult {
  hidden: number // 0..1 share of the media not visible
  reasons: string[]
}

/**
 * Share of the media's own pixels visible inside its box for a given
 * object-fit. Pure, unit-tested. `fill` stretches (distortion, not a crop) and
 * `contain`/`scale-down` letterbox, so neither hides anything.
 */
export function objectFitVisible(
  fit: string,
  boxW: number,
  boxH: number,
  natW: number,
  natH: number,
): { visible: number; cut: "sides" | "top-bottom" | "both" | null } {
  if (!(boxW > 0 && boxH > 0 && natW > 0 && natH > 0)) return { visible: 1, cut: null }
  const f = (fit || "fill").toLowerCase()
  if (f === "cover") {
    const scale = Math.max(boxW / natW, boxH / natH)
    const sw = natW * scale
    const sh = natH * scale
    const visible = Math.min(1, (boxW * boxH) / (sw * sh))
    const cut = sw - boxW > 0.5 ? "sides" : sh - boxH > 0.5 ? "top-bottom" : null
    return { visible, cut: visible < 0.999 ? cut : null }
  }
  if (f === "none") {
    const vw = Math.min(boxW, natW)
    const vh = Math.min(boxH, natH)
    const visible = Math.min(1, (vw * vh) / (natW * natH))
    const sides = natW > boxW + 0.5
    const tb = natH > boxH + 0.5
    return { visible, cut: sides && tb ? "both" : sides ? "sides" : tb ? "top-bottom" : null }
  }
  return { visible: 1, cut: null }
}

/** Combine object-fit and clip crop into one hidden share + readable reasons. Pure. */
export function measureCrop(m: MediaFacts): CropResult {
  const reasons: string[] = []
  // <video> without object-fit letterboxes (UA default is contain-like).
  const fit = m.kind === "video" && (!m.objectFit || m.objectFit === "fill") ? "contain" : m.objectFit
  const of = objectFitVisible(fit, m.contentW, m.contentH, m.naturalW, m.naturalH)
  if (of.cut) {
    const pct = Math.round((1 - of.visible) * 100)
    const where = of.cut === "sides" ? "left/right" : of.cut === "top-bottom" ? "top/bottom" : "all sides"
    reasons.push(`object-fit: ${fit} cuts ${pct}% off the ${where}`)
  }
  // Clip inside sliders is intentional (peek / transition slides).
  const clip = m.inSlider ? 1 : Math.max(0, Math.min(1, m.clipVisible))
  if (clip < 0.999 && m.clipEdges.length) {
    const pct = Math.round((1 - clip) * 100)
    reasons.push(`${pct}% hidden past the ${m.clipEdges.join(" / ")} edge of its container or the screen`)
  }
  return { hidden: 1 - of.visible * clip, reasons }
}

/** The page-side measurer. Self-contained — runs inside page.evaluate. */
function collectMediaFacts(args: {
  max: number
  minW: number
  minH: number
  minArea: number
  minNatural: number
  screenW: number
}): MediaFacts[] {
  const BACKGROUND_SEL = [
    ".elementor-background-video-container",
    ".elementor-background-slideshow",
    ".elementor-background-overlay",
    ".wp-block-cover__image-background",
    ".wp-block-cover__video-background",
    ".wp-block-cover__background",
  ].join(",")
  const SLIDER_SEL = [
    ".swiper",
    ".swiper-container",
    ".swiper-slide",
    ".slick-slider",
    ".slick-slide",
    ".owl-carousel",
    ".owl-item",
    ".elementor-image-carousel-wrapper",
    ".elementor-slides-wrapper",
    ".flickity-slider",
    ".splide",
    ".glide",
    ".wp-block-jetpack-slideshow",
  ].join(",")

  // The device width, not window.innerWidth: mobile emulation widens the
  // layout viewport to fit overflowing content, which would hide the very
  // "past the screen edge" crop being measured.
  const vw = args.screenW || window.innerWidth
  const out: MediaFacts[] = []
  const els = Array.from(document.querySelectorAll("img, video")) as (HTMLImageElement | HTMLVideoElement)[]
  let idx = 0
  for (const el of els) {
    if (out.length >= args.max) break
    if (el.closest(BACKGROUND_SEL)) continue
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < args.minW || r.height < args.minH || r.width * r.height < args.minArea) continue

    const isVideo = el.tagName === "VIDEO"
    let src = ""
    let natW = 0
    let natH = 0
    if (isVideo) {
      const v = el as HTMLVideoElement
      src = v.currentSrc || v.src || (v.querySelector("source") as HTMLSourceElement | null)?.src || v.poster || ""
      natW = v.videoWidth
      natH = v.videoHeight
    } else {
      const im = el as HTMLImageElement
      src = im.currentSrc || im.src || ""
      if (!src || /^data:/i.test(src) || /\.svg(\?|$)/i.test(src)) continue
      natW = im.naturalWidth
      natH = im.naturalHeight
      if (natW < args.minNatural || natH < args.minNatural) continue
    }
    if (!src) continue

    const px = (v: string) => parseFloat(v) || 0
    const contentW = r.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth)
    const contentH = r.height - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth)

    // Intersect the box with every clipping ancestor, then the screen's
    // horizontal edges (the page scrolls vertically, so top/bottom of the
    // screen is never a crop).
    let L = r.left
    let T = r.top
    let R = r.right
    let B = r.bottom
    const edges = new Set<string>()
    const clipBy = (cl: number, ct: number, cr: number, cb: number) => {
      if (cl > L + 0.5) edges.add("left")
      if (cr < R - 0.5) edges.add("right")
      if (ct > T + 0.5) edges.add("top")
      if (cb < B - 0.5) edges.add("bottom")
      L = Math.max(L, cl)
      T = Math.max(T, ct)
      R = Math.min(R, cr)
      B = Math.min(B, cb)
    }
    let anc = el.parentElement
    while (anc && anc !== document.body && anc !== document.documentElement) {
      const as = getComputedStyle(anc)
      const ox = as.overflowX
      const oy = as.overflowY
      const clipX = ox !== "visible"
      const clipY = oy !== "visible"
      if (clipX || clipY) {
        const ar = anc.getBoundingClientRect()
        clipBy(clipX ? ar.left : -1e9, clipY ? ar.top : -1e9, clipX ? ar.right : 1e9, clipY ? ar.bottom : 1e9)
      }
      // A fixed-position ancestor stops page clipping from applying.
      if (as.position === "fixed") break
      anc = anc.parentElement
    }
    clipBy(0, -1e9, vw, 1e9)
    const visArea = Math.max(0, R - L) * Math.max(0, B - T)
    const clipVisible = visArea / (r.width * r.height)
    // Fully clipped = an inactive slide / off-canvas panel, not a visible crop.
    if (clipVisible <= 0.02) continue

    el.setAttribute("data-qacc-crop", String(idx))
    out.push({
      idx,
      kind: isVideo ? "video" : "image",
      src,
      boxW: r.width,
      boxH: r.height,
      contentW,
      contentH,
      naturalW: natW,
      naturalH: natH,
      objectFit: cs.objectFit,
      clipVisible,
      clipEdges: Array.from(edges),
      inSlider: !!el.closest(SLIDER_SEL),
    })
    idx++
  }
  return out
}

export interface CropIssue {
  type: "cropped"
  viewport: string
  src: string
  thumb: string
  note: string
  hidden: number
}

export async function checkMediaCrop(
  pageUrl: string,
  runId: string,
  pageId: string,
  browser: Browser | null,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const sharp = require("sharp")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let ownBrowser: any = null
  const issues: CropIssue[] = []
  const loaded: string[] = []
  const failed: string[] = []
  let mediaSeen = 0

  try {
    if (!browser) {
      const { chromium } = require("playwright")
      ownBrowser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
    }

    for (let v = 0; v < VIEWPORTS.length; v++) {
      const vp = VIEWPORTS[v]
      const base = 5 + v * 30
      let context: any = null
      try {
        context = await (browser || ownBrowser).newContext({
          viewport: { width: vp.width, height: vp.height },
          userAgent: vp.ua,
          ...(vp.mobile ? { isMobile: true, hasTouch: true } : {}),
        })
        const page = await context.newPage()
        context.on("page", (p: any) => (p === page ? null : p.close().catch(() => {})))

        if (onProgress) await onProgress(base, `Loading page at ${vp.label} width...`)
        let status = 0
        try {
          const resp = await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 })
          status = resp?.status() || 0
        } catch (e: any) {
          if (!/Timeout|aborted|closed/i.test(e?.message || "")) throw e
          failed.push(`${vp.label}: page load timed out`)
          continue
        }
        if (status >= 400) {
          failed.push(`${vp.label}: HTTP ${status}`)
          continue
        }

        // Scroll through so lazy images load and videos get their metadata.
        try {
          await page.evaluate(async () => {
            const step = Math.max(400, Math.floor(window.innerHeight * 0.8))
            const deadline = Date.now() + 20000
            for (let y = 0; y < document.body.scrollHeight && Date.now() < deadline; y += step) {
              window.scrollTo(0, y)
              await new Promise((r) => setTimeout(r, 200))
            }
            window.scrollTo(0, 0)
            const pending = Array.from(document.images).filter((i) => !i.complete)
            const vids = Array.from(document.querySelectorAll("video")).filter((x) => x.readyState < 1)
            await Promise.race([
              Promise.all([
                ...pending.map((i) => new Promise((r) => ((i.onload = r), (i.onerror = r)))),
                ...vids.map((x) => new Promise((r) => x.addEventListener("loadedmetadata", r, { once: true }))),
              ]),
              new Promise((r) => setTimeout(r, 4000)),
            ])
          })
        } catch {}
        await page.waitForTimeout(400)

        const facts: MediaFacts[] = await page.evaluate(collectMediaFacts, {
          max: MAX_CANDIDATES,
          minW: MIN_RENDER_W,
          minH: MIN_RENDER_H,
          minArea: MIN_RENDER_AREA,
          minNatural: MIN_NATURAL,
          screenW: vp.width,
        })
        loaded.push(vp.label)
        mediaSeen += facts.length

        const flagged = facts
          .map((m) => ({ m, c: measureCrop(m) }))
          .filter(({ c }) => c.hidden >= MIN_HIDDEN && c.reasons.length)
          .sort((a, b) => b.c.hidden - a.c.hidden)
          .slice(0, MAX_FLAGGED_PER_VIEWPORT)

        for (let i = 0; i < flagged.length; i++) {
          const { m, c } = flagged[i]
          if (onProgress) await onProgress(base + 15, `${vp.label}: capturing ${flagged.length} cropped item(s)...`)
          // Screenshot exactly what is visible of the element (its clipped box).
          let thumb = ""
          try {
            const loc = page.locator(`[data-qacc-crop="${m.idx}"]`).first()
            await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
            await page.waitForTimeout(150)
            const box = await loc.boundingBox()
            if (box) {
              const pad = 6
              const x = Math.max(0, box.x - pad)
              const y = Math.max(0, box.y - pad)
              const w = Math.min(vp.width - x, box.width + pad * 2)
              const h = Math.min(vp.height - y, box.height + pad * 2)
              if (w > 10 && h > 10) {
                const buf = await page.screenshot({ clip: { x, y, width: w, height: h } })
                const small = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
                thumb = await uploadScreenshot(small, `${runId}/mcrop_${pageId}_${vp.name}_${i}.jpg`).catch(() => "")
              }
            }
          } catch {}
          issues.push({
            type: "cropped",
            viewport: vp.label,
            src: m.src,
            thumb,
            note: `${vp.label} (${vp.width}px) — ${m.kind} ${Math.round(c.hidden * 100)}% hidden: ${c.reasons.join("; ")}`,
            hidden: c.hidden,
          })
        }
      } catch (e: any) {
        failed.push(`${vp.label}: ${e?.message || e}`)
      } finally {
        await context?.close().catch(() => {})
      }
    }
  } finally {
    await ownBrowser?.close().catch(() => {})
  }

  if (onProgress) await onProgress(95, "Finalizing media crop findings...")

  if (issues.length > 0) {
    const byVp = VIEWPORTS.map((vp) => `${issues.filter((i) => i.viewport === vp.label).length} ${vp.label.toLowerCase()}`).join(", ")
    const lines = issues.map((it) => `• <a href="${it.src}">${it.src}</a> — ${it.note}`)
    return [
      {
        check_factor: CHECK_FACTOR,
        title: `${issues.length} cropped image/video item${issues.length > 1 ? "s" : ""} found — ${byVp}`,
        description:
          `Images or videos on this page are cut off at some screen sizes. Screenshots show what the visitor actually sees at that width.<br>${lines.join("<br>")}` +
          (failed.length ? `<br>Note: not checked at ${failed.join("; ")}.` : ""),
        context_text: JSON.stringify(issues),
        screenshot_url: issues.map((i) => i.thumb).filter(Boolean).join(",") || null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  if (loaded.length < VIEWPORTS.length) {
    // At least one width never rendered — cannot call the page clean.
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Media Crop Check Failed",
        description: `The page could not be checked at every screen size (${failed.join("; ")}). Process aborted gracefully.`,
        context_text: `Page: ${pageUrl}\nViewports checked: ${loaded.join(", ") || "none"}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  return [
    {
      check_factor: CHECK_FACTOR,
      title: "No media cropping issues found",
      description:
        mediaSeen > 0
          ? `Checked the page's images and videos at desktop, tablet and mobile widths — none are cut off.`
          : "This page has no content images or videos to check (icons, logos, SVGs and background media are skipped).",
      context_text: `Page: ${pageUrl}\nMedia measured across viewports: ${mediaSeen}`,
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
