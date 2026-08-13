import { Finding } from "@qacc/shared"

/**
 * QA-Review & Reputation Check
 * ----------------------------
 * Opens the site's /reviews page, triggers the review popup, screenshots it,
 * and verifies the reputation data shown to a visitor:
 *   - the review popup actually appears
 *   - contact number (tel:), email (mailto:), social links are present
 *   - a Google (My Business / Maps / reviews) reference is present
 *   - address is captured (screenshot) for human confirmation vs GMB
 *
 * Phone / email / social / Google-link are checked DETERMINISTICALLY from the
 * DOM (hrefs are reliable). Address & "matches GMB" are inherently a human
 * judgement, so the value there is the screenshot evidence attached to the
 * finding. Homepage-anchored, browser-owning check (own context). No WP login.
 *
 * Signature mirrors the homepage browser-owning checks in preReleaseSuite:
 *   (url, runId, pageId, sharedBrowser?, onProgress?)
 */

const CHECK_FACTOR = "review_reputation_check"

export async function checkReviewReputation(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  const origin = (() => {
    try {
      return new URL(url).origin
    } catch {
      return url.replace(/\/$/, "")
    }
  })()
  const reviewsUrl = `${origin}/reviews`

  const findings: Finding[] = []
  let browser: any = null
  let context: any = null

  const shot = async (page: any, name: string) => {
    try {
      const buffer = await page.screenshot({ fullPage: true }).catch(() => null)
      if (!buffer) return ""
      return await uploadScreenshot(buffer, `${runId}/review_${name}.png`).catch(() => "")
    } catch {
      return ""
    }
  }

  try {
    browser = sharedBrowser || (await chromium.launch({ headless: true }))
    context = await browser.newContext()
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })

    if (onProgress) await onProgress(15, "Opening /reviews page...")
    const resp = await page
      .goto(reviewsUrl, { waitUntil: "networkidle", timeout: 45000 })
      .catch(() => null)
    const status = resp ? resp.status() : null

    if (status === 404) {
      const s = await shot(page, "no_page")
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Reviews page not found (/reviews)",
        description: `Requesting ${reviewsUrl} returned HTTP 404. The reviews & reputation page appears to be missing.`,
        context_text: `URL: ${reviewsUrl}\nHTTP: 404`,
        screenshot_url: s || null,
        status: "open",
        ai_generated: false,
      } as Finding)
      return findings
    }

    // A failed navigation (timeout/DNS/reset → resp === null) or any non-404
    // error status means the page never loaded. Scraping the empty DOM below
    // would fabricate "missing contact number / email / social / Google"
    // defects that assert the page lacks content it may well have. Treat this
    // as a check that could not complete, not a page full of defects.
    if (!resp || status === null || status >= 400) {
      const s = await shot(page, "load_error")
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Review & Reputation Check Failed",
        description: `The reviews page could not be loaded${status ? ` (HTTP ${status})` : " (navigation failed)"}, so it could not be verified. Process aborted gracefully; QACC will retry on the next run.`,
        context_text: `URL: ${reviewsUrl}\nHTTP: ${status ?? "no response"}`,
        screenshot_url: s || null,
        status: "open",
        ai_generated: false,
      } as Finding)
      return findings
    }

    // --- Trigger the review popup ---
    if (onProgress) await onProgress(40, "Triggering the review popup...")
    let popupOpened = false
    try {
      // Common triggers: a button/link whose text mentions "review".
      const trigger = page
        .locator(
          'button:has-text("review"), a:has-text("review"), [class*="review" i] button, button:has-text("Write a Review"), button:has-text("Leave a Review")',
        )
        .first()
      if ((await trigger.count()) > 0) {
        await trigger.click({ timeout: 5000 }).catch(() => {})
        // Wait for a dialog/modal/overlay to show.
        await page
          .waitForSelector(
            '[role="dialog"], .modal, .modal.show, [class*="popup" i], [class*="modal" i]',
            { state: "visible", timeout: 6000 },
          )
          .catch(() => {})
        popupOpened =
          (await page
            .locator('[role="dialog"], .modal.show, [class*="popup" i]:visible')
            .count()
            .catch(() => 0)) > 0
      }
    } catch {
      // fall through — we still screenshot + scrape whatever is on the page
    }

    await page.waitForTimeout(1000)
    if (onProgress) await onProgress(65, "Capturing and scraping reputation data...")
    const popupShot = await shot(page, "popup")

    // --- Deterministic scrape (popup is in the DOM either way) ---
    const data = await page.evaluate(() => {
      const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) =>
        (a.getAttribute("href") || "").trim(),
      )
      const tel = hrefs.filter((h) => /^tel:/i.test(h))
      const mail = hrefs.filter((h) => /^mailto:/i.test(h))
      const socialHosts = [
        "facebook.com",
        "instagram.com",
        "twitter.com",
        "x.com",
        "linkedin.com",
        "youtube.com",
        "tiktok.com",
      ]
      const social = hrefs.filter((h) => socialHosts.some((s) => h.toLowerCase().includes(s)))
      const google = hrefs.filter(
        (h) =>
          /google\.com\/maps|maps\.google|g\.page|business\.google|goo\.gl\/maps|search\.google\.com\/local/i.test(
            h,
          ),
      )
      return {
        tel: Array.from(new Set(tel)),
        mail: Array.from(new Set(mail)),
        social: Array.from(new Set(social)),
        google: Array.from(new Set(google)),
      }
    })

    // --- If the popup never opened, flag it (with the screenshot). ---
    if (!popupOpened) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Review popup did not open",
        description:
          "Could not detect a review popup/modal opening on the /reviews page. Verify the 'Write a Review' flow works. Screenshot attached for confirmation.",
        context_text: `URL: ${reviewsUrl}`,
        screenshot_url: popupShot || null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    // --- Presence checklist (deterministic) ---
    const missing: string[] = []
    if (data.tel.length === 0) missing.push("contact number (tel: link)")
    if (data.mail.length === 0) missing.push("email (mailto: link)")
    if (data.social.length === 0) missing.push("social media links")
    if (data.google.length === 0) missing.push("Google (My Business / Maps) reference")

    const summaryLines = [
      `Contact number: ${data.tel.length ? data.tel.join(", ") : "❌ none found"}`,
      `Email: ${data.mail.length ? data.mail.join(", ") : "❌ none found"}`,
      `Social: ${data.social.length ? data.social.join(", ") : "❌ none found"}`,
      `Google reference: ${data.google.length ? data.google.join(", ") : "❌ none found"}`,
      ``,
      `Address and Google-My-Business match are shown in the screenshot — please confirm they match the client's GMB listing.`,
    ]

    findings.push({
      check_factor: CHECK_FACTOR,
      title:
        missing.length > 0
          ? `Review & Reputation: missing ${missing.join(", ")}`
          : "Review & Reputation: contact & social present",
      description: summaryLines.join("\n"),
      context_text: `URL: ${reviewsUrl}\nPopup opened: ${popupOpened ? "yes" : "no"}`,
      screenshot_url: popupShot || null,
      status: "open",
      ai_generated: false,
    } as Finding)

    if (onProgress) await onProgress(95, "Finalizing review & reputation findings...")
    return findings
  } catch (error: any) {
    findings.push({
      check_factor: CHECK_FACTOR,
      title: "Review & Reputation Check Failed",
      description: `The check encountered an unexpected error: ${error.message}. Process aborted gracefully to prevent stalling the scan.`,
      context_text: `URL: ${reviewsUrl}\nSystem Error`,
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding)
    return findings
  } finally {
    try {
      if (context) await context.close().catch(() => {})
      if (browser && !sharedBrowser) await browser.close().catch(() => {})
    } catch {}
  }
}
