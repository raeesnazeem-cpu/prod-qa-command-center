import { Browser } from "playwright"
import { Finding } from "@qacc/shared"
import { describeImage } from "../lib/aiFallback"

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
  naturalWidth: number
  naturalHeight: number
  outerHTML: string
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

  const uploadThumb = async (buf: Buffer, name: string): Promise<string> => {
    try {
      const thumb = await sharp(buf)
        .resize({ width: 600, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
      return await uploadScreenshot(thumb, `${runId}/imgq_${name}.jpg`).catch(() => "")
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
    context = await (browser || (await chromium.launch({ headless: true }))).newContext({
      viewport: { width: 1440, height: 900 },
    })
    page = await context.newPage()

    if (onProgress) await onProgress(10, "Loading page for image quality...")
    let loadOk = true
    try {
      await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 })
    } catch (e: any) {
      if (
        !(
          e.message?.includes("Timeout") ||
          e.message?.includes("aborted") ||
          e.message?.includes("closed")
        )
      ) {
        throw e
      }
      // Page did not finish loading. Remember this so we never emit a clean
      // "no issues" pass over a page that never rendered.
      loadOk = false
    }
    await page.waitForTimeout(500)

    // Enumerate images (same pattern as imageComplianceCheck / heroMediaCheck).
    const imgs: ImgInfo[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img")).map((img: any) => ({
        src: img.src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        outerHTML: (img.outerHTML || "").substring(0, 300),
      })),
    )

    // Filter to real content images: no data:/svg, big enough, deduped, capped.
    const seen = new Set<string>()
    const candidates = imgs
      .filter(
        (im) =>
          im.src &&
          !/^data:/i.test(im.src) &&
          !/\.svg(\?|$)/i.test(im.src) &&
          im.naturalWidth >= MIN_DIMENSION &&
          im.naturalHeight >= MIN_DIMENSION,
      )
      .filter((im) => (seen.has(im.src) ? false : (seen.add(im.src), true)))
      .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
      .slice(0, MAX_IMAGES)

    if (onProgress)
      await onProgress(30, `Downloading & checking ${candidates.length} image(s)...`)

    let visionUsed = 0
    let checked = 0

    // Collect ALL offending images, then emit ONE consolidated finding (table).
    const issues: {
      type: "blur" | "watermark"
      src: string
      thumb: string
      note: string
    }[] = []

    for (let i = 0; i < candidates.length; i++) {
      if (issues.length >= MAX_ISSUES) break
      const im = candidates[i]
      let buf: Buffer | null = null
      try {
        const resp = await context.request.get(im.src, { timeout: 20000 })
        if (resp.ok()) buf = await resp.body()
      } catch {
        buf = null
      }
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
          const raw = await describeImage(
            buf,
            'Does this image contain a visible watermark (a stock-photo mark, logo overlay, "sample", or repeating text/logo overlaid across it)? Respond with STRICT JSON only: {"watermark": true|false, "confidence": 0.0-1.0, "note": "<short reason>"}.',
          )
          const m = raw.match(/\{[\s\S]*\}/)
          if (m) {
            const o = JSON.parse(m[0])
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
        } catch {
          // vision failure is non-fatal
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
        description: `Found ${issues.length} problem image(s) on this page. Reference images are attached below.<br>${descLines.join("<br>")}`,
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
    } else if (candidates.length > 0 && checked === 0) {
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
    } else {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Image quality: no watermark or blur issues",
        description: `Checked ${checked} content image${checked === 1 ? "" : "s"} on this page (blur on all, watermark vision on up to ${MAX_VISION}). No watermarks or blurry images detected.`,
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
