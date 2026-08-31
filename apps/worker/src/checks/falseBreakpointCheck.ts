import { Browser } from "playwright"
import { Finding } from "@qacc/shared"

/**
 * False Breakpoint Check
 * ----------------------
 * Detects "false breaking points": viewport widths where the responsive
 * layout breaks UNINTENTIONALLY — i.e. horizontal overflow appears
 * (a horizontal scrollbar) at a width that is not a designed breakpoint.
 *
 * Fully deterministic and AI-free. A false breakpoint is a geometric fact:
 *   - document overflows horizontally  <=>  scrollWidth > clientWidth
 *   - the culprit is the element whose right edge exceeds the viewport
 *   - the exact onset pixel is found by binary search
 *
 * ISOLATION: this check owns its browser context and navigates itself, so it
 * never mutates the shared page's viewport and cannot interfere with other
 * checks running concurrently on the same run. Mirrors the browser-owning
 * checks in preReleaseSuite (checkPrivacyPolicy / checkFooterLogo / ...).
 */

const CHECK_FACTOR = "false_breakpoint"

// Sub-pixel / scrollbar tolerance (px). Overflow at or below this is ignored.
const TOLERANCE = 2

// Fixed viewport height during the sweep (px). Width is what we vary.
const VIEWPORT_HEIGHT = 1080

// Reflow settle time after each viewport resize (ms).
const REFLOW_MS = 120

// Coarse sample widths (px): common device + container widths from small
// phones up to large desktops. Bands of overflow between adjacent samples
// are refined to the exact onset pixel by binary search.
const COARSE_WIDTHS = [
  320, 360, 375, 390, 414, 480, 540, 600, 640, 700, 768, 820, 900, 1024, 1120,
  1200, 1280, 1366, 1440, 1600, 1920,
]

// Safety caps to keep findings/DB writes bounded.
const MAX_BANDS = 4
const MAX_CULPRITS_PER_FINDING = 8

interface Culprit {
  sel: string
  right: number
  width: number
}

interface Measurement {
  vw: number
  sw: number
  overflow: number
  culprits: Culprit[]
}

export async function checkFalseBreakpoints(
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
  let loadOk = false

  try {
    if (onProgress) await onProgress(5, "Opening isolated viewport sweep...")

    context = await browser.newContext({
      viewport: { width: COARSE_WIDTHS[COARSE_WIDTHS.length - 1], height: VIEWPORT_HEIGHT },
    })
    page = await context.newPage()

    try {
      await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 })
      loadOk = true
    } catch (e: any) {
      // Same tolerance as crawlPageJob: proceed on load timeout/abort — but a
      // page that never loaded must NOT be reported as a clean pass. The sweep
      // of an unloaded/empty document trivially has no overflow, which would
      // fabricate a "No false breaking points detected" result.
      if (
        !(
          e.message?.includes("Timeout") ||
          e.message?.includes("aborted") ||
          e.message?.includes("closed")
        )
      ) {
        throw e
      }
    }

    // Measures horizontal overflow + culprit elements at a given width.
    const measure = async (width: number): Promise<Measurement> => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
      await page.waitForTimeout(REFLOW_MS)
      return (await page.evaluate((tol: number) => {
        const doc = document.documentElement
        const vw = doc.clientWidth
        const sw = doc.scrollWidth
        const overflow = sw - vw
        const culprits: { sel: string; right: number; width: number }[] = []

        if (overflow > tol) {
          // Elements whose right edge spills past the viewport's right edge.
          const offenders: Element[] = []
          const all = document.body ? document.body.querySelectorAll("*") : []
          for (const el of Array.from(all)) {
            const style = getComputedStyle(el)
            if (style.display === "none" || style.visibility === "hidden") continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue
            if (r.right > vw + tol) offenders.push(el)
          }

          // Keep only leaf-most offenders (an offender containing another
          // offender is just an ancestor inheriting the overflow — noise).
          //
          // Walk each offender's ancestor chain once and mark any ancestor that
          // is itself an offender. That is O(offenders x depth); the previous
          // `offenders.some(... el.contains(o))` form was O(offenders^2) with a
          // DOM containment test per pair, and a broken layout can easily put
          // hundreds of elements in this list.
          const offenderSet = new Set(offenders)
          const hasOffenderDescendant = new Set<Element>()
          for (const el of offenders) {
            let p: Element | null = el.parentElement
            while (p) {
              if (offenderSet.has(p)) {
                if (hasOffenderDescendant.has(p)) break // chain already marked
                hasOffenderDescendant.add(p)
              }
              p = p.parentElement
            }
          }
          const leaves = offenders.filter((el) => !hasOffenderDescendant.has(el))

          for (const el of leaves) {
            const r = el.getBoundingClientRect()
            const tag = el.tagName.toLowerCase()
            const id = (el as HTMLElement).id ? "#" + (el as HTMLElement).id : ""
            const cls =
              typeof el.className === "string" && el.className.trim()
                ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
                : ""
            culprits.push({
              sel: (tag + id + cls).slice(0, 120),
              right: Math.round(r.right),
              width: Math.round(r.width),
            })
          }
        }

        return { vw, sw, overflow, culprits }
      }, TOLERANCE)) as Measurement
    }

    // --- 1. COARSE SWEEP ---
    if (onProgress) await onProgress(20, "Sweeping viewport widths...")
    const samples: { width: number; m: Measurement }[] = []
    for (let i = 0; i < COARSE_WIDTHS.length; i++) {
      const width = COARSE_WIDTHS[i]
      const m = await measure(width)
      samples.push({ width, m })
      if (onProgress) {
        const pct = 20 + Math.round((60 * (i + 1)) / COARSE_WIDTHS.length)
        await onProgress(pct, `Checked ${width}px (${m.overflow > TOLERANCE ? "broken" : "ok"})`)
      }
    }

    // --- 2. GROUP CONTIGUOUS BROKEN SAMPLES INTO BANDS ---
    const bands: { fromWidth: number; toWidth: number; prevCleanWidth: number | null }[] = []
    for (let i = 0; i < samples.length; i++) {
      const broken = samples[i].m.overflow > TOLERANCE
      if (!broken) continue
      const last = bands[bands.length - 1]
      const prevBrokenContiguous =
        last && i > 0 && samples[i - 1].m.overflow > TOLERANCE
      if (prevBrokenContiguous) {
        last.toWidth = samples[i].width
      } else {
        bands.push({
          fromWidth: samples[i].width,
          toWidth: samples[i].width,
          prevCleanWidth: i > 0 ? samples[i - 1].width : null,
        })
      }
    }

    // --- 3. REFINE ONSET + EMIT ONE FINDING PER BAND ---
    if (onProgress) await onProgress(85, "Pinpointing exact break widths...")
    for (const band of bands.slice(0, MAX_BANDS)) {
      // Exact onset pixel: smallest width that overflows, between the last
      // clean sample and the first broken sample.
      let onsetWidth = band.fromWidth
      if (band.prevCleanWidth !== null) {
        let lo = band.prevCleanWidth // known clean
        let hi = band.fromWidth // known broken
        while (hi - lo > 2) {
          const mid = Math.round((lo + hi) / 2)
          const m = await measure(mid)
          if (m.overflow > TOLERANCE) hi = mid
          else lo = mid
        }
        onsetWidth = hi
      }

      // Re-measure at the worst (narrowest broken) width for culprit reporting.
      const worst = await measure(band.fromWidth)
      const culprits = worst.culprits.slice(0, MAX_CULPRITS_PER_FINDING)

      // Capture the overflowing viewport as evidence (page is at the broken width).
      let shotUrl = ""
      try {
        const buf = await page.screenshot()
        if (buf) {
          const jpg = await sharp(buf).jpeg({ quality: 85 }).toBuffer()
          shotUrl = await uploadScreenshot(
            jpg,
            `${runId}/false_breakpoint_${band.fromWidth}_${Date.now()}.jpg`,
            { bucket: "evidence", isPublic: true },
          ).catch(() => "")
        }
      } catch {}

      const bandLabel =
        band.fromWidth === band.toWidth
          ? `around ${band.fromWidth}px`
          : `from ${band.fromWidth}px to ${band.toWidth}px`

      const culpritList = culprits.length
        ? culprits
            .map(
              (c) =>
                `- <code>${c.sel}</code> — right edge at ${c.right}px (width ${c.width}px)`,
            )
            .join("\n")
        : "- (no single element isolated; likely a wide fixed-width block or unwrapped media)"

      findings.push({
        check_factor: CHECK_FACTOR,
        title: `False breaking point at ${onsetWidth}px (${bandLabel})`,
        description: `The layout develops a horizontal scrollbar starting at a viewport width of <strong>${onsetWidth}px</strong> and remains broken ${bandLabel}. Content overflows the viewport by up to <strong>${worst.overflow}px</strong>, which is not a designed responsive breakpoint. Likely culprits:\n\n${culpritList}`,
        context_text: `URL: ${pageUrl}\nOnset width: ${onsetWidth}px\nBroken band: ${band.fromWidth}px–${band.toWidth}px\nMax overflow: ${worst.overflow}px`,
        screenshot_url: shotUrl || null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    // --- 4. PASS / LAPSE FINDING ---
    if (findings.length === 0 && !loadOk) {
      // Page never finished loading — the sweep measured an empty/partial
      // document. Report a lapse, not a clean pass, so tedSync marks this
      // "could not complete" rather than "passed".
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "False Breakpoint Check Failed",
        description: `The page did not finish loading within the timeout, so the viewport sweep could not run against a rendered layout. No pass/fail conclusion can be drawn — this check could not complete.`,
        context_text: `URL: ${pageUrl}\nPage load: timed out / aborted`,
        status: "open",
        ai_generated: false,
      } as Finding)
    } else if (findings.length === 0) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "No false breaking points detected",
        description: `No false-breakpoint issues were found. Swept viewport widths from ${COARSE_WIDTHS[0]}px to ${COARSE_WIDTHS[COARSE_WIDTHS.length - 1]}px; no unintended horizontal overflow appeared — the layout stays within the viewport at every sampled width.`,
        context_text: `URL: ${pageUrl}\nWidths sampled: ${COARSE_WIDTHS.length}`,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    if (onProgress) await onProgress(100, "False breakpoint check complete")
    return findings
  } catch (error: any) {
    // Graceful abort — never stall the run (matches heroMediaCheck).
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "False Breakpoint Check Failed",
        description: `The check encountered an unexpected error: ${error.message}. Process aborted gracefully to prevent stalling the scan.`,
        context_text: `URL: ${pageUrl}\nSystem Error`,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } finally {
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
  }
}
