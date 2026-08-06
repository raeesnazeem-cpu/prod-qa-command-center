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
        const visible = await el.isVisible().catch(() => false)
        const enabled = await el.isEnabled().catch(() => false)
        if (!visible || !enabled) continue

        // A short label for the finding.
        const label: string = await el
          .evaluate((node: Element) => {
            const t = node.tagName.toLowerCase()
            const txt = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)
            const aria = node.getAttribute("aria-label") || ""
            return `${t}${txt ? ` "${txt}"` : aria ? ` "${aria}"` : ""}`
          })
          .catch(() => "control")

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
            severity: "high",
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
            severity: "medium",
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

    if (findings.length === 0) {
      findings.push({
        check_factor: CHECK_FACTOR,
        severity: "low",
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
      severity: "high",
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
