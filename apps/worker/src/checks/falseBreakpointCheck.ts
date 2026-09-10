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

// PERF: the old fixed REFLOW_MS = 120 settle wait after each resize was
// removed — measure() now waits on a double-requestAnimationFrame barrier plus
// a 16ms floor instead of a flat 120ms. See measure() for the rationale.

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

// Header-integrity metrics captured at a given viewport width. A "break" here is
// NOT horizontal overflow — it is the header losing its single-row layout above
// the tablet breakpoint: nav items wrapping to a second line, or the CTA button
// text wrapping, while the hamburger has not yet taken over.
interface HeaderMetrics {
  present: boolean
  hamburgerVisible?: boolean
  navVisible?: boolean
  navItemCount?: number
  navWrapped?: boolean
  navSel?: string
  buttonPresent?: boolean
  buttonWrapped?: boolean
  buttonSel?: string
}

// Same shape as HeaderMetrics, named for use inside the in-page evaluate body
// (where `hdr` starts as { present: false } and is reassigned with full metrics).
type HeaderMetricsInPage = HeaderMetrics

interface Measurement {
  vw: number
  sw: number
  overflow: number
  culprits: Culprit[]
  header?: HeaderMetrics
}

// Header font-size floor for the auto-fix cap lives in gitopsFix; here we only
// cap how many header findings we emit.
const MAX_HEADER_FINDINGS = 2

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
    //
    // PERF: `collectCulprits` gates the O(N) getComputedStyle-per-element
    // offender sweep. That sweep runs against every DOM element and is the
    // dominant cost of a measure, yet its result is only ever read from the
    // FINAL `worst` re-measure (below). Coarse-sweep and binary-search calls
    // only use `overflow`, so they pass `false` and skip the sweep entirely.
    // Safe: the returned shape is unchanged (culprits = [] when not collected),
    // and overflow/vw/sw are computed identically regardless of the flag.
    const measure = async (
      width: number,
      collectCulprits = false,
    ): Promise<Measurement> => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
      // PERF: replaced the fixed 120ms reflow wait with a double-requestAnimationFrame
      // barrier — layout is settled once two frames have been painted after the
      // resize, which is typically far faster than a flat 120ms. The synchronous
      // scrollWidth/clientWidth read below also forces layout, so a double-rAF is
      // a sufficient reflow signal. A single 16ms floor is kept as a safety margin
      // for slow responsive-image (srcset) swaps.
      await page.evaluate(
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          ),
      )
      await page.waitForTimeout(16)
      return (await page.evaluate(
        ({ tol, collect }: { tol: number; collect: boolean }) => {
        const doc = document.documentElement
        const vw = doc.clientWidth
        const sw = doc.scrollWidth
        const overflow = sw - vw
        const culprits: { sel: string; right: number; width: number }[] = []

        if (collect && overflow > tol) {
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

        // --- HEADER INTEGRITY (cheap; always measured) ---
        // Detects a header that has lost its single-row layout: nav items or the
        // CTA button text wrapping to a second line while the hamburger toggle is
        // not yet shown. Uses geometry only (row spread + text line count).
        const vis = (el: Element | null): boolean => {
          if (!el) return false
          const st = getComputedStyle(el)
          if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity || "1") === 0)
            return false
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }
        // Nearest ancestor Elementor element id (so the fix can target the widget).
        const elemId = (el: Element | null): string => {
          let p: Element | null = el
          while (p && p !== document.body) {
            if (p.classList) {
              for (const c of Array.from(p.classList)) {
                const m = /^elementor-element-([0-9a-f]{7,8})$/i.exec(c)
                if (m) return m[1]
              }
            }
            p = p.parentElement
          }
          return ""
        }
        // Number of visual text lines an element occupies (via its text rects).
        const lineCount = (el: Element): number => {
          try {
            const range = document.createRange()
            range.selectNodeContents(el)
            const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
            if (!rects.length) return 1
            return new Set(rects.map((r) => Math.round(r.top))).size
          } catch {
            return 1
          }
        }

        let header: Element | null = null
        for (const s of [
          '[data-elementor-type="header"]',
          ".elementor-location-header",
          "header#masthead",
          ".site-header",
          "header",
        ]) {
          const el = document.querySelector(s)
          if (el) {
            header = el
            break
          }
        }

        let hdr: HeaderMetricsInPage = { present: false }
        if (header) {
          const toggle = header.querySelector(
            '.elementor-menu-toggle, [class*="menu-toggle"], button.menu-toggle, button[aria-label*="menu" i], [aria-label*="menu" i][role="button"]',
          )
          const hamburgerVisible = vis(toggle)

          // Pick the DESKTOP menu = the candidate <ul> with the most VISIBLE
          // top-level items. A header often holds both a desktop and a hidden
          // mobile menu; choosing by visible-item count avoids grabbing the
          // hidden one. Works for Elementor and plain theme/Gutenberg headers.
          const menuCands = Array.from(
            header.querySelectorAll(
              ".elementor-nav-menu--main, ul.elementor-nav-menu, .elementor-nav-menu, nav ul, header ul",
            ),
          )
          let menu: Element | null = null
          let visItems: Element[] = []
          for (const u of menuCands) {
            const lis = Array.from(u.children)
              .filter((el) => el.tagName === "LI")
              .filter(vis)
            if (lis.length > visItems.length) {
              visItems = lis
              menu = u
            }
          }
          const navVisible = visItems.length > 0
          let navWrapped = false
          if (visItems.length > 1) {
            const rects = visItems.map((el) => el.getBoundingClientRect())
            const line = Math.max(...rects.map((r) => r.height)) || 20
            const minTop = Math.min(...rects.map((r) => r.top))
            const maxTop = Math.max(...rects.map((r) => r.top))
            navWrapped = maxTop - minTop > line * 0.5
          }

          // CTA button — framework-agnostic (Elementor button, theme `.btn`,
          // Gutenberg button). Flag the first visible one whose text wraps.
          const btnCands = Array.from(
            header.querySelectorAll(
              '.elementor-button, a.elementor-button-link, a.btn, a.button, .btn, .wp-block-button__link, [class*="button"] a, a[class*="btn"]',
            ),
          ).filter((el) => {
            if (!vis(el)) return false
            const t = (el.textContent || "").trim()
            return t.length > 0 && t.length < 40
          })
          const buttonPresent = btnCands.length > 0
          let buttonWrapped = false
          let buttonSel = ""
          for (const b of btnCands) {
            const textEl = b.querySelector(".elementor-button-text") || b
            if (lineCount(textEl) > 1) {
              buttonWrapped = true
              buttonSel = elemId(b)
              break
            }
          }

          hdr = {
            present: true,
            hamburgerVisible,
            navVisible,
            navItemCount: visItems.length,
            navWrapped,
            navSel: menu ? elemId(menu) : "",
            buttonPresent,
            buttonWrapped,
            buttonSel,
          }
        }

        return { vw, sw, overflow, culprits, header: hdr }
        },
        { tol: TOLERANCE, collect: collectCulprits },
      )) as Measurement
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
      // PERF: this is the ONLY call that reads `worst.culprits`, so it is the
      // ONLY measure that runs the offender sweep (collectCulprits = true).
      const worst = await measure(band.fromWidth, true)
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

    // --- 3b. HEADER INTEGRITY (new dimension) ---
    // A header "break" is the header losing its single row ABOVE the tablet
    // breakpoint: nav items wrapping to a second line, or the CTA button text
    // wrapping, while the hamburger has not yet taken over. This is separate from
    // horizontal overflow above and rides the same check_factor.
    if (loadOk) {
      const { describeImageResult } = require("../lib/aiFallback")

      // Empirical tablet breakpoint: the largest sampled width where the
      // hamburger toggle is visible (the switchover to the mobile menu). Below
      // this the hamburger is expected to own the menu; above it the full nav
      // must fit on one row.
      let hamburgerMaxWidth: number | null = null
      let headerSeen = false
      for (const s of samples) {
        const h = s.m.header
        if (!h?.present) continue
        headerSeen = true
        if (h.hamburgerVisible) {
          hamburgerMaxWidth = Math.max(hamburgerMaxWidth ?? 0, s.width)
        }
      }

      // A width is a header-wrap break when: header present, hamburger NOT yet
      // shown (still full-nav mode), the nav is visible, and either the nav items
      // or the button text has wrapped to a second line.
      const isWrapBreak = (m: Measurement): boolean => {
        const h = m.header
        return !!(
          h?.present &&
          !h.hamburgerVisible &&
          h.navVisible &&
          (h.navWrapped || h.buttonWrapped)
        )
      }

      if (headerSeen) {
        // Widest sampled width that wraps — wrap runs from here down to the
        // hamburger switchover, so this is the meaningful onset to report.
        let widestWrapIdx = -1
        for (let i = samples.length - 1; i >= 0; i--) {
          if (isWrapBreak(samples[i].m)) {
            widestWrapIdx = i
            break
          }
        }

        if (widestWrapIdx >= 0) {
          const wrapSample = samples[widestWrapIdx]
          // Refine onset: the largest width that still wraps, between this
          // wrapping sample (lo) and the next-larger clean sample (hi).
          let onsetWidth = wrapSample.width
          const cleanLarger = samples[widestWrapIdx + 1]
          if (cleanLarger) {
            let lo = wrapSample.width // wraps
            let hi = cleanLarger.width // clean
            while (hi - lo > 2) {
              const mid = Math.round((lo + hi) / 2)
              const m = await measure(mid)
              if (isWrapBreak(m)) lo = mid
              else hi = mid
            }
            onsetWidth = lo
          }

          // Re-measure at the onset for culprit ids + screenshot evidence.
          const worst = await measure(onsetWidth)
          const h = worst.header!
          const whatWrapped = [
            h.navWrapped ? "navigation menu items" : "",
            h.buttonWrapped ? "call-to-action button text" : "",
          ]
            .filter(Boolean)
            .join(" and ")

          // Screenshot the header region as evidence (and for vision confirm).
          let headerShot: Buffer | null = null
          try {
            const handle = await page.$(
              '[data-elementor-type="header"], .elementor-location-header, header',
            )
            headerShot = handle ? await handle.screenshot() : await page.screenshot()
          } catch {
            headerShot = null
          }

          // Vision confirmation: suppress a geometric false positive when a
          // working vision provider says the header is NOT wrapped. If vision is
          // unavailable (!ok), keep the deterministic geometric verdict.
          let confirmed = true
          let visionReason = ""
          if (headerShot) {
            const vr = await describeImageResult(
              headerShot,
              'This image is a website header at a desktop/tablet width. Do the navigation menu items or the call-to-action button text WRAP onto a second line (the header is not on a single row)? Reply strictly as JSON: {"wrapped": true|false, "reason": "short"}.',
            ).catch(() => ({ ok: false, text: "" }) as any)
            if (vr.ok && vr.text) {
              const m = vr.text.match(/\{[\s\S]*\}/)
              if (m) {
                try {
                  const j = JSON.parse(m[0])
                  if (typeof j.wrapped === "boolean") {
                    confirmed = j.wrapped
                    visionReason = String(j.reason || "")
                  }
                } catch {}
              }
            }
          }

          if (confirmed) {
            let shotUrl = ""
            if (headerShot) {
              try {
                const jpg = await sharp(headerShot).jpeg({ quality: 85 }).toBuffer()
                shotUrl = await uploadScreenshot(
                  jpg,
                  `${runId}/header_break_${onsetWidth}_${Date.now()}.jpg`,
                  { bucket: "evidence", isPublic: true },
                ).catch(() => "")
              } catch {}
            }

            const bpNote =
              hamburgerMaxWidth !== null
                ? `The hamburger menu takes over at ${hamburgerMaxWidth}px; the header must stay on one row from there up to full desktop width.`
                : `No hamburger menu was detected at any sampled width — the header also has no mobile fallback.`

            const culpritList = [
              h.navWrapped && h.navSel
                ? `- <code>.elementor-element-${h.navSel}</code> — the navigation menu`
                : "",
              h.buttonWrapped && h.buttonSel
                ? `- <code>.elementor-element-${h.buttonSel}</code> — the header button`
                : "",
            ]
              .filter(Boolean)
              .join("\n")

            findings.push({
              check_factor: CHECK_FACTOR,
              title: `Header items break onto a second line at ${onsetWidth}px`,
              description: `The header loses its single-row layout at a viewport width of <strong>${onsetWidth}px</strong>: the ${whatWrapped} wrap${
                whatWrapped.includes(" and ") ? "" : "s"
              } onto a second line while the desktop navigation is still shown. Header navigation and button text must stay on one line until the tablet breakpoint, where the hamburger menu takes over. ${bpNote}${
                visionReason ? `\n\nVision confirmation: ${visionReason}` : ""
              }${culpritList ? `\n\nElements to adjust:\n\n${culpritList}` : ""}`,
              context_text: `URL: ${pageUrl}\nHeader break onset: ${onsetWidth}px\nWrapped: ${whatWrapped}\nHamburger switchover: ${
                hamburgerMaxWidth !== null ? `${hamburgerMaxWidth}px` : "none detected"
              }\nnav element: ${h.navSel || "n/a"}\nbutton element: ${h.buttonSel || "n/a"}`,
              screenshot_url: shotUrl || null,
              status: "open",
              ai_generated: false,
            } as Finding)
          }
        }

        // Secondary: a header with a desktop nav but NO hamburger at any small
        // width never switches to a mobile menu at all.
        if (
          findings.filter((f) => /header/i.test(f.title)).length < MAX_HEADER_FINDINGS &&
          hamburgerMaxWidth === null &&
          samples.some((s) => s.m.header?.present && s.m.header?.navVisible)
        ) {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: `Header has no hamburger menu at mobile widths`,
            description: `The header keeps its desktop navigation at every sampled width down to ${COARSE_WIDTHS[0]}px and never switches to a hamburger menu. A responsive header should collapse the navigation into a hamburger toggle at the tablet breakpoint.`,
            context_text: `URL: ${pageUrl}\nHamburger switchover: none detected\nWidths sampled: ${COARSE_WIDTHS.length}`,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      }
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
