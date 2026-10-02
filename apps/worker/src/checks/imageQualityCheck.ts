import { Browser } from "playwright"
import { Finding, aiFailureReason } from "@qacc/shared"
import { describeImageResult } from "../lib/aiFallback"
import pLimit from "p-limit"
import { createHash } from "crypto"
import { newRealContext, gotoResilient, looksBlocked } from "../lib/browserContext"

/**
 * QA Image Quality — watermark & blur (per-image)
 * ------------------------------------------------
 * For each real content image on a page, downloads the ACTUAL image bytes and:
 *   - Blur: a deterministic Laplacian-variance metric (sharp) — free, on ALL
 *     downloaded images. Low variance => blurry.
 *   - Watermark: Gemini vision (fallback-loop describeImage) on the real image
 *     bytes — capped to a few sizable images per page for cost/rate control.
 *
 * Analyzing the real image files (not a downscaled full-page screenshot) is
 * what makes this accurate. Offending images are thumbnailed and attached as
 * evidence (screenshot_url) so they flow into the base64 TED report.
 *
 * All-pages, browser-owning check (own context). Signature mirrors the
 * all-pages style: (pageUrl, runId, browser, onProgress?).
 */

const CHECK_FACTOR = "image_quality"

const MAX_IMAGES = 15 // max images downloaded + blur-checked per page
const MAX_VISION = 8 // max images sent to watermark vision per page
const MIN_DIMENSION = 150 // skip icons/logos/tracking pixels below this (px)
const BLUR_VAR_THRESHOLD = 100 // Laplacian variance below this => blurry (tunable)
const MAX_ISSUES = 30

interface ImgInfo {
  src: string
  naturalWidth: number // 0 = not known yet (lazy image never decoded)
  naturalHeight: number
  outerHTML: string
}

/**
 * Runs in the page. Every content image, whatever the site builder:
 *   • <img>/<picture> — src/currentSrc, then lazy-load attributes
 *     (data-src, data-lazy-src, data-srcset …) when src is still a placeholder;
 *   • CSS background images — only used when the page has no usable <img>
 *     (Squarespace/Wix-style hero blocks), so WP results are unchanged.
 * Plain JS only (no TS helpers are visible in there).
 */
function collectImages(minDim: number): { imgs: ImgInfo[]; bgs: ImgInfo[] } {
  const abs = (u: string) => {
    try {
      return new URL(u, document.baseURI).href
    } catch {
      return ""
    }
  }
  const largestFromSrcset = (ss: string): string => {
    let best = ""
    let bestW = 0
    for (const part of (ss || "").split(",")) {
      const [u, d] = part.trim().split(/\s+/)
      const w = parseFloat(d || "0") || 1
      if (u && w >= bestW) {
        best = u
        bestW = w
      }
    }
    return best
  }
  const isPlaceholder = (u: string) => !u || /^data:/i.test(u) || /^about:/i.test(u)
  const imgs: ImgInfo[] = []
  for (const img of Array.from(document.querySelectorAll("img")).slice(0, 2000) as HTMLImageElement[]) {
    // src first (same file the WP path always used), currentSrc for <picture>.
    let src = img.src || img.currentSrc || ""
    let lazy = false
    if (isPlaceholder(src) || !img.naturalWidth) {
      const alt =
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("data-original") ||
        largestFromSrcset(
          img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset") || img.getAttribute("srcset") || "",
        )
      if (alt && !isPlaceholder(alt)) {
        lazy = true
        src = alt
      }
    }
    src = isPlaceholder(src) ? "" : abs(src)
    // A lazy image that never decoded has no natural size: judge it by its box
    // (or let the download decide, below) instead of dropping it.
    const r = img.getBoundingClientRect()
    const nw = lazy ? 0 : img.naturalWidth || 0
    const nh = lazy ? 0 : img.naturalHeight || 0
    if (!nw && r.width && r.height && (r.width < minDim || r.height < minDim)) continue
    imgs.push({ src, naturalWidth: nw, naturalHeight: nh, outerHTML: (img.outerHTML || "").substring(0, 300) })
  }
  const bgs: ImgInfo[] = []
  const all = document.body ? Array.from(document.body.querySelectorAll("*")).slice(0, 6000) : []
  for (const el of all) {
    if (bgs.length >= 30) break
    const r = el.getBoundingClientRect()
    if (r.width < minDim || r.height < minDim) continue
    const bg = getComputedStyle(el).backgroundImage
    const m = bg && bg !== "none" ? bg.match(/url\(["']?([^"')]+)["']?\)/) : null
    if (!m || isPlaceholder(m[1])) continue
    bgs.push({
      src: abs(m[1]),
      naturalWidth: Math.round(r.width),
      naturalHeight: Math.round(r.height),
      outerHTML: `<${el.tagName.toLowerCase()} style="background-image">`,
    })
  }
  return { imgs, bgs }
}

export async function checkImageQuality(
  pageUrl: string,
  runId: string,
  browser: Browser,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const sharp = require("sharp")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  const findings: Finding[] = []
  let context: any = null
  let page: any = null

  // Per-page key so thumbnails from different pages in the same run don't
  // overwrite each other (upload uses upsert on a shared runId folder).
  const pageKey = createHash("sha1").update(pageUrl).digest("hex").slice(0, 10)

  const uploadThumb = async (buf: Buffer, name: string): Promise<string> => {
    try {
      const thumb = await sharp(buf)
        .resize({ width: 600, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
      return await uploadScreenshot(thumb, `${runId}/imgq_${pageKey}_${name}.jpg`).catch(() => "")
    } catch {
      return ""
    }
  }

  // Laplacian-variance blur metric. Returns variance (low => blurry) or null.
  const blurVariance = async (buf: Buffer): Promise<number | null> => {
    try {
      const { data } = await sharp(buf)
        .greyscale()
        .resize({ width: 1000, withoutEnlargement: true })
        .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
        .raw()
        .toBuffer({ resolveWithObject: true })
      if (!data || data.length === 0) return null
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      const mean = sum / data.length
      let vsum = 0
      for (let i = 0; i < data.length; i++) {
        const d = data[i] - mean
        vsum += d * d
      }
      return vsum / data.length
    } catch {
      return null
    }
  }

  try {
    const { chromium } = require("playwright")
    // Real browser UA + tolerant TLS: a bare context sends "HeadlessChrome",
    // which Cloudflare-fronted sites answer with a 403 challenge page.
    context = await newRealContext(browser || (await chromium.launch({ headless: true })))
    page = await context.newPage()

    if (onProgress) await onProgress(10, "Loading page for image quality...")
    // gotoResilient never throws. A timeout still leaves a usable page, but we
    // remember it so we never emit a clean "no issues" pass over a page that
    // never rendered; a hard navigation error (DNS, refused) is the same.
    const nav = await gotoResilient(page, pageUrl, { timeout: 60000 })
    const loadOk = nav.ok && !nav.error
    if (!nav.ok) throw new Error(nav.error || "page could not be loaded")
    await page.waitForTimeout(500)

    // A bot-challenge page has no content images; "no issues" there is false.
    if (await looksBlocked(page)) {
      const text: string = await page.evaluate(() => document.body?.innerText || "").catch(() => "")
      if (text.length < 3000) {
        return [
          {
            check_factor: CHECK_FACTOR,
            title: "Image Quality Check Failed",
            description:
              "Could not complete: the site served a bot-protection page to the QACC browser, so its images could not be checked. Process aborted gracefully.",
            context_text: `Page: ${pageUrl}\nSystem Error: bot protection`,
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding,
        ]
      }
    }

    // Scroll through the page (bounded) so lazy-loaded images get real sources.
    await page
      .evaluate(async () => {
        const step = Math.max(400, Math.floor(window.innerHeight * 0.8))
        const deadline = Date.now() + 8000
        const max = Math.min(document.body?.scrollHeight || 0, 30000)
        for (let y = 0; y < max && Date.now() < deadline; y += step) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 150))
        }
        window.scrollTo(0, 0)
        const pending = Array.from(document.images).filter((i) => !i.complete)
        await Promise.race([
          Promise.all(pending.map((i) => new Promise((r) => ((i.onload = r), (i.onerror = r))))),
          new Promise((r) => setTimeout(r, 3000)),
        ])
      })
      .catch(() => {})

    // Enumerate images; an evaluate that fails (page navigated itself, odd DOM)
    // is retried once after the page settles.
    let collected: { imgs: ImgInfo[]; bgs: ImgInfo[] }
    try {
      collected = await page.evaluate(collectImages, MIN_DIMENSION)
    } catch {
      await page.waitForTimeout(1500)
      collected = await page.evaluate(collectImages, MIN_DIMENSION)
    }

    // Filter to real content images: no data:/svg, big enough, deduped, capped.
    // Unknown size (lazy, never decoded) is kept here and judged after download.
    const usable = (list: ImgInfo[]) => {
      const seen = new Set<string>()
      return list
        .filter(
          (im) =>
            im.src &&
            /^https?:/i.test(im.src) &&
            !/\.svg(\?|$)/i.test(im.src) &&
            ((im.naturalWidth >= MIN_DIMENSION && im.naturalHeight >= MIN_DIMENSION) ||
              (!im.naturalWidth && !im.naturalHeight)),
        )
        .filter((im) => (seen.has(im.src) ? false : (seen.add(im.src), true)))
        .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
        .slice(0, MAX_IMAGES)
    }
    let candidates = usable(collected.imgs)
    if (candidates.length === 0) candidates = usable(collected.bgs)

    if (onProgress)
      await onProgress(30, `Downloading & checking ${candidates.length} image(s)...`)

    let visionUsed = 0
    let checked = 0
    // How many images the watermark vision actually read, and the last error
    // when it could not — so a vision outage is never reported as "no watermark".
    let visionOk = 0
    let visionError = ""

    // Collect ALL offending images, then emit ONE consolidated finding (table).
    const issues: {
      type: "blur" | "watermark"
      src: string
      thumb: string
      note: string
    }[] = []

    // PERF: pre-download the image bytes with bounded concurrency (pLimit(3)).
    // Only the pure network download is parallelized; the blur (sharp) and
    // vision (Gemini) steps below stay strictly serial and in the same order,
    // so visionUsed / MAX_VISION / MAX_ISSUES caps and finding ordering are
    // unchanged. Each task mirrors the old per-item download exactly (same
    // context.request.get + timeout, returns null on failure/non-ok), and
    // Promise.all preserves order so buffers[i] lines up with candidates[i].
    // Concurrency is capped at 3 (not all 15) to avoid holding many full image
    // buffers in memory at once on the 4 GB box.
    const dlLimit = pLimit(3)
    // Lazy images whose real file turned out to be an icon/logo (not a failure).
    let tooSmall = 0
    const buffers: (Buffer | null)[] = await Promise.all(
      candidates.map((im) =>
        dlLimit(async () => {
          try {
            // Referer: some image CDNs refuse hotlinked (no-referer) requests.
            const resp = await context.request.get(im.src, {
              timeout: 20000,
              headers: { Referer: pageUrl },
            })
            if (!resp.ok() || /svg|html/i.test(resp.headers()["content-type"] || "")) return null
            const body: Buffer = await resp.body()
            if (im.naturalWidth) return body
            // Size was unknown (lazy image): apply the icon/logo filter now.
            const meta = await sharp(body).metadata().catch(() => null)
            if (meta && ((meta.width || 0) < MIN_DIMENSION || (meta.height || 0) < MIN_DIMENSION)) {
              tooSmall++
              return null
            }
            return body
          } catch {
            return null
          }
          return null
        }),
      ),
    )

    for (let i = 0; i < candidates.length; i++) {
      if (issues.length >= MAX_ISSUES) break
      const im = candidates[i]
      const buf: Buffer | null = buffers[i]
      if (!buf || buf.length === 0) continue
      checked++

      let thumbUrl = ""

      // --- Blur (deterministic, all images) ---
      const variance = await blurVariance(buf)
      if (variance !== null && variance < BLUR_VAR_THRESHOLD) {
        thumbUrl = await uploadThumb(buf, `${i}`)
        issues.push({
          type: "blur",
          src: im.src,
          thumb: thumbUrl,
          note: `Laplacian variance ${variance.toFixed(1)} (threshold ${BLUR_VAR_THRESHOLD})`,
        })
      }

      // --- Watermark (AI vision, capped) ---
      if (visionUsed < MAX_VISION && issues.length < MAX_ISSUES) {
        visionUsed++
        try {
          const vr = await describeImageResult(
            buf,
            'Does this image contain a visible watermark (a stock-photo mark, logo overlay, "sample", or repeating text/logo overlaid across it)? Respond with STRICT JSON only: {"watermark": true|false, "confidence": 0.0-1.0, "note": "<short reason>"}.',
          )
          if (!vr.ok) visionError = vr.error || "vision unavailable"
          const m = vr.ok ? vr.text.match(/\{[\s\S]*\}/) : null
          if (vr.ok && !m) visionError = visionError || "vision reply could not be read"
          if (m) {
            const o = JSON.parse(m[0])
            visionOk++
            if (o.watermark === true && Number(o.confidence) >= 0.6) {
              if (!thumbUrl) thumbUrl = await uploadThumb(buf, `${i}`)
              issues.push({
                type: "watermark",
                src: im.src,
                thumb: thumbUrl,
                note: `AI confidence ${Number(o.confidence).toFixed(2)}${o.note ? ` — ${o.note}` : ""}`,
              })
            }
          }
        } catch (e: any) {
          // An unreadable reply: this image's watermark was not verified.
          visionError = visionError || `vision reply could not be read: ${e?.message || e}`
        }
      }

      if (onProgress) {
        const pct = 30 + Math.round((60 * (i + 1)) / candidates.length)
        await onProgress(pct, `Checked ${checked} image(s)...`)
      }
    }

    if (onProgress) await onProgress(95, "Finalizing image quality findings...")

    if (issues.length > 0) {
      const wm = issues.filter((i) => i.type === "watermark").length
      const blur = issues.filter((i) => i.type === "blur").length
      // Human-readable HTML for the TED report (a per-image list + links).
      const descLines = issues.map(
        (it) =>
          `• <strong>${it.type === "watermark" ? "Watermark" : "Blurry"}</strong> — <a href="${it.src}">${it.src}</a> (${it.note})`,
      )
      findings.push({
        check_factor: CHECK_FACTOR,
        title: `${issues.length} image quality issue${issues.length > 1 ? "s" : ""} found — ${wm} watermark, ${blur} blurry`,
        description: `Found ${issues.length} problem image(s) on this page. Reference images are attached below.<br>${descLines.join("<br>")}${visionUsed > visionOk ? `<br>Note: watermark not checked on ${visionUsed - visionOk} of ${visionUsed} image(s) (${aiFailureReason(visionError)}).` : ""}`,
        // Structured payload the ImageQualityFindingCard parses into a table.
        context_text: JSON.stringify(issues),
        // Comma-joined thumbnails → Phase 1 base64-embeds each into the TED report.
        screenshot_url: issues.map((i) => i.thumb).filter(Boolean).join(",") || null,
        status: "open",
        ai_generated: wm > 0,
      } as Finding)
    } else if (!loadOk) {
      // Page never finished loading — we cannot claim "no issues".
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Image Quality Check Failed",
        description: `The page did not finish loading, so image quality could not be verified. Process aborted gracefully; QACC will retry on the next run.`,
        context_text: `Page: ${pageUrl}\nSystem Error: page load timeout`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    } else if (candidates.length - tooSmall > 0 && checked === 0) {
      // There were images to inspect but none could be downloaded/decoded —
      // reporting "no issues" here would be a false clean pass.
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Image Quality Check Failed",
        description: `Found ${candidates.length} candidate image(s) but none could be downloaded or decoded, so image quality could not be verified. Process aborted gracefully.`,
        context_text: `Page: ${pageUrl}\nImages found: ${candidates.length}, successfully analyzed: 0`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    } else if (candidates.length - tooSmall <= 0) {
      // Nothing to inspect — a page without content images is not a defect.
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "No image quality issues found",
        description: "This page has no content images to check (icons, logos and SVGs are skipped).",
        context_text: `Page: ${pageUrl}\nImages checked: 0`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    } else if (visionUsed > 0 && visionOk === 0) {
      // Blur passed, but the watermark half never ran — not a pass.
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Image Quality Check Failed",
        description: `Could not complete: ${aiFailureReason(visionError)}. Blur passed on ${checked} image${checked === 1 ? "" : "s"}, but the watermark check could not run. Process aborted gracefully.`,
        context_text: `Page: ${pageUrl}\nImages checked: ${checked}\nVision error: ${visionError.slice(0, 300)}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    } else {
      const partialVision =
        visionOk < visionUsed ? ` Watermark checked on ${visionOk} of ${visionUsed} images (${aiFailureReason(visionError)} for the rest).` : ""
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Image quality: no watermark or blur issues",
        description: `Checked ${checked} content image${checked === 1 ? "" : "s"} on this page (blur on all, watermark vision on up to ${MAX_VISION}). No watermarks or blurry images detected.${partialVision}`,
        context_text: `Page: ${pageUrl}\nImages checked: ${checked}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    return findings
  } catch (error: any) {
    findings.push({
      check_factor: CHECK_FACTOR,
      title: "Image Quality Check Failed",
      description: `The check encountered an unexpected error: ${error.message}. Process aborted gracefully to prevent stalling the scan.`,
      context_text: `Page: ${pageUrl}\nSystem Error`,
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding)
    return findings
  } finally {
    try {
      if (context) await context.close().catch(() => {})
    } catch {}
  }
}
