import { Browser } from "playwright"
import { Finding } from "@qacc/shared"

/**
 * QA Website Functionality Testing (bounded per page)
 * ---------------------------------------------------
 * On each page, exercises a CAPPED set of interactive controls (buttons,
 * dropdowns, accordions, tabs, nav toggles) and reports two reliable signals:
 *   1. a JavaScript/console error triggered by the interaction
 *   2. a layout break (horizontal overflow) introduced by the interaction
 *
 * Deterministic and bounded (hard cap + per-click timeout) to stay fast and
 * price-safe. Non-navigating controls only — real cross-page links are the
 * dead-link check's job; if a click does navigate, we return to the page and
 * continue. All-pages, browser-owning check (own context).
 *
 * Signature: (pageUrl, runId, browser, onProgress?)
 */

const CHECK_FACTOR = "functionality_check"

const MAX_INTERACTIONS = 25
const MAX_FINDINGS = 8
const CLICK_TIMEOUT = 2000
const SETTLE_MS = 400
const OVERFLOW_TOL = 2

// Non-navigating interactive controls we can safely click.
const INTERACTIVE_SELECTOR = [
  "button",
  '[role="button"]',
  "summary",
  "select",
  "[aria-haspopup]",
  "[aria-expanded]",
  "[data-toggle]",
  ".dropdown-toggle",
  ".accordion-button",
  ".accordion-header",
  ".menu-toggle",
  ".hamburger",
  'a[href^="#"]',
  "a:not([href])",
].join(", ")

export async function checkFunctionality(
  pageUrl: string,
  runId: string,
  browser: Browser,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  const findings: Finding[] = []
  let context: any = null
  let page: any = null

  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  const measureOverflow = async (): Promise<number> => {
    try {
      return await page.evaluate(() => {
        const d = document.documentElement
        return d.scrollWidth - d.clientWidth
      })
    } catch {
      return 0
    }
  }

  const shot = async (name: string) => {
    try {
      const buffer = await page.screenshot({ fullPage: false }).catch(() => null)
      if (!buffer) return ""
      return await uploadScreenshot(buffer, `${runId}/functionality_${name}.png`).catch(() => "")
    } catch {
      return ""
    }
  }

  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    page = await context.newPage()

    // Collect JS errors as they happen.
    page.on("console", (msg: any) => {
      if (msg.type() === "error" && consoleErrors.length < 100) consoleErrors.push(msg.text())
    })
    page.on("pageerror", (err: any) => {
      if (pageErrors.length < 100) pageErrors.push(err.message)
    })
    // A click may open a new tab (target=_blank) — close it to avoid hangs.
    context.on("page", (p: any) => {
      p.close().catch(() => {})
    })

    if (onProgress) await onProgress(10, "Loading page for functionality testing...")
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
      // Page did not finish loading — never emit a "no errors" pass over it.
      loadOk = false
    }
    await page.waitForTimeout(500)

    const baselineOverflow = await measureOverflow()

    // Enumerate candidate controls (bounded).
    const handles = await page.$$(INTERACTIVE_SELECTOR)
    const targets = handles.slice(0, MAX_INTERACTIONS)
    if (onProgress)
      await onProgress(30, `Exercising ${targets.length} interactive controls...`)

    let exercised = 0
    for (let i = 0; i < targets.length; i++) {
      if (findings.length >= MAX_FINDINGS) break
      const el = targets[i]
      try {
        // PERF: fold the previous three CDP round-trips (isVisible + isEnabled +
        // label evaluate) into ONE evaluate returning {visible, enabled, label}.
        // The visible/enabled logic reimplements Playwright's documented
        // semantics in-page so the exact same controls are skipped/clicked as
        // before:
        //   visible = non-empty bounding box (display:none and [hidden] collapse
        //             the box to 0) and computed visibility !== "hidden"
        //   enabled = NOT natively disabled (disabled attr, or a disabled
        //             <fieldset> ancestor — native form controls only, and the
        //             fieldset's own <legend> is exempt) and NOT aria-disabled
        //             (inherited up the ancestor chain, matching Playwright).
        // Loop stays serial (shared page state); this changes only how state is
        // read, not what gets clicked or flagged. A single evaluate failure
        // (detached node) yields visible:false → the control is skipped, exactly
        // as the old per-call `.catch(() => false)` did.
        const state: { visible: boolean; enabled: boolean; label: string } =
          await el
            .evaluate((node: Element) => {
              const style = getComputedStyle(node)
              const rect = node.getBoundingClientRect()
              const visible =
                !!style &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0

              const NATIVE = ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "OPTION", "OPTGROUP"]
              let nativelyDisabled = false
              if (NATIVE.includes(node.nodeName)) {
                if (node.hasAttribute("disabled")) {
                  nativelyDisabled = true
                } else {
                  const fs = node.closest("fieldset[disabled]")
                  if (fs) {
                    const legend = fs.querySelector(":scope > legend")
                    nativelyDisabled = !(legend && legend.contains(node))
                  }
                }
              }
              let ariaDisabled = false
              let a: Element | null = node
              while (a) {
                if (a.getAttribute("aria-disabled") === "true") {
                  ariaDisabled = true
                  break
                }
                a = a.parentElement
              }
              const enabled = !(nativelyDisabled || ariaDisabled)

              const t = node.tagName.toLowerCase()
              const txt = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)
              const aria = node.getAttribute("aria-label") || ""
              const label = `${t}${txt ? ` "${txt}"` : aria ? ` "${aria}"` : ""}`
              return { visible, enabled, label }
            })
            .catch(() => ({ visible: false, enabled: false, label: "control" }))

        const visible = state.visible
        const enabled = state.enabled
        const label = state.label
        if (!visible || !enabled) continue

        const errBefore = consoleErrors.length + pageErrors.length

        await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
        await el.click({ timeout: CLICK_TIMEOUT }).catch(() => {})
        exercised++
        await page.waitForTimeout(SETTLE_MS)

        // If the click navigated away, return to the page and continue.
        let navigated = false
        try {
          const cur = page.url()
          if (cur && cur.split("#")[0] !== pageUrl.split("#")[0]) {
            navigated = true
            await page.goto(pageUrl, { waitUntil: "load", timeout: 30000 }).catch(() => {})
            await page.waitForTimeout(300)
          }
        } catch {}

        if (navigated) continue // don't attribute post-nav state to this control

        // Signal 1: new JS error.
        const errAfter = consoleErrors.length + pageErrors.length
        if (errAfter > errBefore && findings.length < MAX_FINDINGS) {
          const newErrs = [...consoleErrors, ...pageErrors].slice(errBefore, errAfter)
          const s = await shot(`err_${i}`)
          findings.push({
            check_factor: CHECK_FACTOR,
            title: `JavaScript error triggered by interaction: ${label}`,
            description: `Clicking ${label} produced a new console/page error:\n${newErrs.join("\n")}`,
            context_text: `Page: ${pageUrl}\nControl: ${label}`,
            screenshot_url: s || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }

        // Signal 2: interaction introduced horizontal overflow.
        const overflowNow = await measureOverflow()
        if (
          overflowNow > baselineOverflow + OVERFLOW_TOL &&
          findings.length < MAX_FINDINGS
        ) {
          const s = await shot(`break_${i}`)
          findings.push({
            check_factor: CHECK_FACTOR,
            title: `Layout break triggered by interaction: ${label}`,
            description: `Interacting with ${label} introduced ${overflowNow - baselineOverflow}px of horizontal overflow (page went from ${baselineOverflow}px to ${overflowNow}px). Check the expanded/opened state's responsive layout.`,
            context_text: `Page: ${pageUrl}\nControl: ${label}`,
            screenshot_url: s || null,
            status: "open",
            ai_generated: false,
          } as Finding)
          // Reset by reloading so subsequent controls measure from baseline.
          await page.goto(pageUrl, { waitUntil: "load", timeout: 30000 }).catch(() => {})
          await page.waitForTimeout(300)
        }
      } catch {
        // stale handle / detached node — skip this control
        continue
      }
    }

    if (onProgress) await onProgress(95, "Finalizing functionality findings...")

    if (findings.length === 0 && !loadOk) {
      // Page never loaded — cannot claim functionality is fine.
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Functionality Check Failed",
        description: `The page did not finish loading, so interactive functionality could not be exercised. Process aborted gracefully; QACC will retry on the next run.`,
        context_text: `Page: ${pageUrl}\nSystem Error: page load timeout`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    } else if (findings.length === 0 && exercised === 0) {
      // Nothing was actually tested — "no errors" here would be a false pass.
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Functionality Check Failed",
        description: `No interactive controls could be exercised on this page, so functionality could not be verified. Process aborted gracefully; QACC will retry on the next run.`,
        context_text: `Page: ${pageUrl}\nControls exercised: 0`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    } else if (findings.length === 0) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Functionality: no interaction errors or breaks",
        description: `Exercised ${exercised} interactive control${exercised === 1 ? "" : "s"} on this page. No JavaScript errors or layout breaks were triggered.`,
        context_text: `Page: ${pageUrl}\nControls exercised: ${exercised}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    return findings
  } catch (error: any) {
    findings.push({
      check_factor: CHECK_FACTOR,
      title: "Functionality Check Failed",
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
