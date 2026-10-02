import { Finding } from "@qacc/shared"
import { gotoResilient, launchStealthBrowser, looksBlocked, newRealContext } from "../lib/browserContext"

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

const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
]

/**
 * Classify the page's links (and embedded map iframes) into the reputation
 * signals this check looks for. Pure and exported for tests. Social links are
 * matched on the parsed HOST, so "fedex.com" never counts as x.com.
 */
export function classifyReputationLinks(
  hrefs: string[],
  frameSrcs: string[] = [],
): { tel: string[]; mail: string[]; social: string[]; google: string[] } {
  const clean = hrefs.map((h) => (h || "").trim()).filter(Boolean)
  const hostOf = (h: string) => {
    try {
      return new URL(h, "https://placeholder.invalid").hostname.toLowerCase().replace(/^www\./, "")
    } catch {
      return ""
    }
  }
  const GOOGLE =
    /google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|g\.co\/kgs|business\.google|search\.google\.com\/local|google\.[a-z.]+\/search\?[^#]*\b(ludocid|lrd)=|#lrd=/i
  const uniq = (a: string[]) => Array.from(new Set(a))
  return {
    tel: uniq(clean.filter((h) => /^tel:/i.test(h))),
    mail: uniq(clean.filter((h) => /^mailto:/i.test(h))),
    social: uniq(
      clean.filter((h) => {
        const host = hostOf(h)
        return SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))
      }),
    ),
    google: uniq([...clean, ...frameSrcs].filter((h) => GOOGLE.test(h))),
  }
}

/** The site's own reviews/testimonials page linked from the page, or null. */
async function findReviewsLink(page: any, origin: string): Promise<string | null> {
  try {
    await gotoResilient(page, origin, { timeout: 30000 })
    const hrefs: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href),
    )
    const host = new URL(origin).hostname.replace(/^www\./, "")
    for (const h of hrefs) {
      let u: URL
      try {
        u = new URL(h)
      } catch {
        continue
      }
      if (u.hostname.replace(/^www\./, "") !== host) continue
      if (/\/(reviews?|testimonials?|patient-reviews|client-reviews)(\/|$)/i.test(u.pathname))
        return `${u.origin}${u.pathname}`
    }
  } catch {}
  return null
}

export async function checkReviewReputation(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  const origin = (() => {
    try {
      return new URL(url).origin
    } catch {
      return url.replace(/\/$/, "")
    }
  })()
  let reviewsUrl = `${origin}/reviews`

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
    browser = sharedBrowser || (await launchStealthBrowser())
    // Real browser UA + tolerant TLS: a bare context sends "HeadlessChrome",
    // which Cloudflare-style filters block (403) on many non-WP hosts.
    context = await newRealContext(browser, { viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()

    if (onProgress) await onProgress(15, "Opening /reviews page...")
    // "load", not "networkidle": chat widgets / analytics on many sites never go
    // idle. A load timeout is not fatal — the page is usually usable.
    let nav = await gotoResilient(page, reviewsUrl, { timeout: 45000 })
    let status = nav.status

    // No /reviews on this site: look for the site's own reviews/testimonials
    // page in the homepage links before calling it missing (Squarespace, Wix,
    // custom builds often use /testimonials or /patient-reviews).
    if (status === 404) {
      const alt = await findReviewsLink(page, origin)
      const altNav = alt ? await gotoResilient(page, alt, { timeout: 45000 }) : null
      if (alt && altNav && altNav.ok && (altNav.status === null || altNav.status < 400)) {
        reviewsUrl = alt
        nav = altNav
        status = altNav.status
      } else {
        // Back to the 404 page so the screenshot below shows what was missing.
        await gotoResilient(page, reviewsUrl, { timeout: 20000 })
      }
    }

    if (status === 404) {
      const s = await shot(page, "no_page")
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Reviews page not found (/reviews)",
        description: `Requesting ${reviewsUrl} returned HTTP 404, and the homepage links to no other reviews/testimonials page. The reviews & reputation page appears to be missing.`,
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
    // A bot-challenge page (Cloudflare "Just a moment...") is also not the
    // real page. A load TIMEOUT with a usable page (nav.ok, no status) is fine.
    const blocked = nav.ok && (await looksBlocked(page))
    if (!nav.ok || (status !== null && status >= 400) || blocked) {
      const s = await shot(page, "load_error")
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Review & Reputation Check Failed",
        description: `The reviews page could not be loaded${blocked ? " (blocked by a bot-protection challenge)" : status ? ` (HTTP ${status})` : " (navigation failed)"}, so it could not be verified. Process aborted gracefully; QACC will retry on the next run.`,
        context_text: `URL: ${reviewsUrl}\nHTTP: ${status ?? "no response"}${nav.error ? `\nError: ${nav.error.slice(0, 200)}` : ""}`,
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
      // Common triggers: a button/link whose text mentions "review", tried in
      // priority order (explicit buttons first). Clicking a plain link can
      // navigate away (e.g. the nav item "Reviews" or a Google review link);
      // when that happens, go back and try the next candidate.
      const TRIGGERS = [
        'button:has-text("Write a Review"), button:has-text("Leave a Review")',
        'button:has-text("review"), [role="button"]:has-text("review"), [class*="review" i] button',
        'a:has-text("review")',
      ]
      for (const sel of TRIGGERS) {
        if (popupOpened) break
        const candidates = page.locator(sel)
        const n = Math.min(await candidates.count().catch(() => 0), 3)
        for (let i = 0; i < n && !popupOpened; i++) {
          const trigger = candidates.nth(i)
          if (!(await trigger.isVisible().catch(() => false))) continue
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
          const bare = (u: string) => u.split("#")[0].replace(/\/+$/, "")
          if (!popupOpened && bare(page.url()) !== bare(reviewsUrl)) {
            await gotoResilient(page, reviewsUrl, { timeout: 30000 })
          }
        }
      }
    } catch {
      // fall through — we still screenshot + scrape whatever is on the page
    }

    await page.waitForTimeout(1000)
    if (onProgress) await onProgress(65, "Capturing and scraping reputation data...")
    const popupShot = await shot(page, "popup")

    // --- Deterministic scrape (popup is in the DOM either way) ---
    const raw = await page
      .evaluate(() => ({
        hrefs: Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") || ""),
        frames: Array.from(document.querySelectorAll("iframe[src]")).map((f) => f.getAttribute("src") || ""),
      }))
      .catch(() => ({ hrefs: [] as string[], frames: [] as string[] }))
    const data = classifyReputationLinks(raw.hrefs, raw.frames)

    // --- If the popup never opened, flag it (with the screenshot). ---
    if (!popupOpened) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Review popup did not open",
        description:
          "Could not detect a review popup/modal opening on the reviews page. Verify the 'Write a Review' flow works. Screenshot attached for confirmation.",
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
      `Contact number: ${data.tel.length ? data.tel.join(", ") : "❌ missing"}`,
      `Email: ${data.mail.length ? data.mail.join(", ") : "❌ missing"}`,
      `Social: ${data.social.length ? data.social.join(", ") : "❌ missing"}`,
      `Google reference: ${data.google.length ? data.google.join(", ") : "❌ missing"}`,
      ``,
      `Address and Google-My-Business match are shown in the screenshot — please confirm they match the client's GMB listing.`,
    ]

    findings.push({
      check_factor: CHECK_FACTOR,
      title:
        missing.length > 0
          ? `Review & Reputation: missing ${missing.join(", ")}`
          : "Review & Reputation: contact & social present",
      description:
        missing.length > 0
          ? summaryLines.join("\n")
          : `No issues found. The reviews page shows the contact number, email, social links, and Google reference.\n\n${summaryLines.join("\n")}`,
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
