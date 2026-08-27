import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"
import axios from "axios"
import * as cheerio from "cheerio"
import pLimit from "p-limit"
import type { ThemeType } from "../lib/themeType"
import pino from "pino"

/** A discovered page and its browser-tab title. */
interface PageInfo {
  url: string
  title: string
}

// Bounds for the URL/tab comparison crawl. Concurrency is deliberately modest:
// production runs qa-api + qa-worker on one 2 vCPU / 4 GB box with
// WORKER_CONCURRENCY=3, and this check can run while browser contexts are open.
const MAX_CRAWL_PAGES = 60
const MAX_TITLE_FETCHES = 50
const URL_COMPARE_CONCURRENCY = Math.max(
  1,
  Number(process.env.URL_COMPARE_CONCURRENCY || 8),
)

// Header/banner selectors. Block/FSE themes expose the header as a
// template-part (`.wp-block-template-part`, `#masthead`, `<header>`); many
// classic PHP themes — especially Stitch-generated ones — have NO <header> at
// all and render the site nav as a bare <nav> (e.g. `<nav id="topNav">`). The
// classic variant therefore also accepts <nav>, so the header check isn't a
// false "no header found" on a classic theme.
const HEADER_SELECTOR_BLOCK =
  "header, [role='banner'], .wp-block-template-part[class*='header'], .site-header, #masthead"
const HEADER_SELECTOR_CLASSIC =
  HEADER_SELECTOR_BLOCK +
  ", nav#topNav, nav[id*='nav' i], nav[class*='nav' i], nav[class*='header' i], nav"
function headerSelectorFor(themeType?: ThemeType): string {
  return themeType === "classic" ? HEADER_SELECTOR_CLASSIC : HEADER_SELECTOR_BLOCK
}

// 1. Initialize Logger
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

// Memory lock to prevent multiple pages from taking screenshots at the exact same time
const contactFormScreenshotLocks = new Set<string>()

/**
 * =========================================================================
 * 2️⃣ CHECK 2: Privacy Policy Page Check
 * =========================================================================
 * The Logic:
 * - We check if the footer element contains a link to "Privacy Policy" or "Privacy".
 * - If WooCommerce is enabled, we navigate to '/checkout' and verify that it contains a "Privacy Policy" notice.
 */
export async function checkPrivacyPolicy(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const sharp = require("sharp")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let screenshotUrl = ""
  let checkoutScreenshotUrl = ""

  let browser
  try {
    browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.setViewportSize({ width: 1920, height: 1080 })
    if (onProgress)
      await onProgress(10, "Navigating to homepage to check footer...")

    // 1. Check Homepage Footer
    await page
      .goto(url, { waitUntil: "networkidle", timeout: 25000 })
      .catch(() => {})

    let footerHasLink = false
    let footerElement = page.locator("footer").first()
    if ((await footerElement.count()) === 0) {
      footerElement = page
        .locator(
          '[role="contentinfo"], .wp-block-template-part[class*="footer"], .site-footer, .footer, #footer, .wp-block-group[class*="footer"]',
        )
        .first()
    }

    if ((await footerElement.count()) > 0) {
      const privacyLinks = footerElement.locator(
        'a:has-text("Privacy Policy"), a:has-text("Privacy")',
      )
      if ((await privacyLinks.count()) > 0) {
        footerHasLink = true
        await footerElement.scrollIntoViewIfNeeded().catch(() => null)
        const screenshotBuffer = await footerElement
          .screenshot()
          .catch(() => null)
        if (screenshotBuffer) {
          const compressed = await sharp(screenshotBuffer)
            .jpeg({ quality: 85 })
            .toBuffer()
          const storagePath = `evidence/privacy_policy/${runId}-footer-${Date.now()}.jpg`
          screenshotUrl = await uploadScreenshot(compressed, storagePath, {
            bucket: "evidence",
            isPublic: true,
          }).catch(() => "")
        }
      }
    }

    if (!footerHasLink) {
      const screenshotBuffer = await page.screenshot().catch(() => null)
      if (screenshotBuffer) {
        const compressed = await sharp(screenshotBuffer)
          .jpeg({ quality: 85 })
          .toBuffer()
        const storagePath = `evidence/privacy_policy/${runId}-fallback-${Date.now()}.jpg`
        screenshotUrl = await uploadScreenshot(compressed, storagePath, {
          bucket: "evidence",
          isPublic: true,
        }).catch(() => "")
      }
    }

    // 2. Check Checkout Page
    if (onProgress)
      await onProgress(40, "Checking checkout page for privacy notice...")

    const checkoutUrl = url.endsWith("/") ? `${url}checkout` : `${url}/checkout`
    // The checkout privacy notice only applies to WooCommerce (ecommerce) sites.
    // Non-ecommerce sites have no /checkout — requiring a notice there would
    // fabricate a "Privacy Policy Missing" defect on every brochure site. Gate
    // on a REAL WooCommerce checkout element (WP often soft-404s /checkout with
    // a 200 + theme 404 template) and scope the notice to WooCommerce's
    // dedicated .woocommerce-privacy-policy-text element, not a bare "privacy"
    // substring anywhere on the page (which a footer link would satisfy).
    let checkoutExists = false
    let hasPrivacyPolicyOnCheckout = false

    try {
      const resp = await page.goto(checkoutUrl, {
        waitUntil: "networkidle",
        timeout: 15000,
      })
      const status = resp ? resp.status() : 0
      if (status >= 200 && status < 400) {
        const checkoutInfo = await page.evaluate(() => {
          const hasCheckoutForm =
            !!document.querySelector(
              'form.woocommerce-checkout, form.checkout, .wc-block-checkout, .woocommerce-checkout',
            ) || document.body.className.includes("woocommerce-checkout")
          const privacyEl = document.querySelector(
            ".woocommerce-privacy-policy-text",
          )
          const privacyText = privacyEl ? privacyEl.textContent || "" : ""
          const hasPrivacyLink = !!(
            privacyEl && privacyEl.querySelector('a[href*="privacy"]')
          )
          return {
            hasCheckoutForm,
            hasPrivacyNotice: /privacy/i.test(privacyText) || hasPrivacyLink,
          }
        })
        checkoutExists = checkoutInfo.hasCheckoutForm
        hasPrivacyPolicyOnCheckout = checkoutInfo.hasPrivacyNotice
      }
    } catch (e) {
      // Ignored if checkout page is inaccessible
    }

    // 3. Check Full Privacy Policy Page
    if (onProgress)
      await onProgress(70, "Scanning full Privacy Policy content...")

    const policyUrl = url.endsWith("/")
      ? `${url}privacy-policy`
      : `${url}/privacy-policy`
    let fullPolicyScreenshotUrl = ""
    let isContentMatch = false
    let actualPolicyText = ""

    try {
      await page.goto(policyUrl, { waitUntil: "networkidle", timeout: 15000 })
      let policyText = await page.evaluate(() => document.body.innerText)

      const startMatch = policyText.match(/Privacy Policy/i)
      if (startMatch && startMatch.index !== undefined) {
        policyText = policyText.substring(startMatch.index)
      }

      const endMarker =
        "If you have any questions or concerns about our Privacy Policy or how your information is handled, please contact us."
      const endMatch = policyText.match(
        new RegExp(endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      )
      if (endMatch && endMatch.index !== undefined) {
        policyText = policyText.substring(0, endMatch.index + endMarker.length)
      }

      actualPolicyText = policyText

      const templateStr = `[Your Business Name] Privacy Policy

Effective Date: [Current Date]

Our Commitment to Your Privacy

At [Your Business Name], we are dedicated to respecting and protecting your privacy. This Privacy Policy outlines how we collect, use, and safeguard your personal information when you interact with our website, mobile app, or services.

1. Data We Collect. We collect various types of information:

   1.1. Non-Personally-Identifying Information. This includes details such as browser type, language preference, referring site, and the date and time of each visitor request. This information helps us understand how visitors use our website and improve our services.

   1.2. Potentially Personally-Identifying Information. For users who log in or leave comments on our website, we may collect Internet Protocol (IP) addresses.

   1.3. Personally-Identifying Information. When you engage with our services, we may collect personal details such as your name, contact information (email and phone number), and other information relevant to the services you request.

2. How We Use Your Information. Your data is used to:

   2.1. Operate and improve our website and services.

   2.2. Customize your experience with our offerings.

   2.3. Develop new services and products.

   2.4. Communicate with you regarding appointments, promotions, and updates.

   2.5. Process financial transactions.

   2.6. Send you notifications, with your consent.

   2.7. Ensure security and prevent fraudulent activities.

3. Sharing Your Information. We may share your information with:

   3.1. Third-Party Service Providers. These providers support our operations, such as customer support, payment processing, and technical services. These third parties are bound by confidentiality agreements and are only permitted to use your data for the purposes we specify.

   3.2. Legal Authorities. We may disclose your information if required by law or if we believe in good faith that it is necessary to protect the rights, property, or safety of [Your Business Name], our users, or the public.

   3.3. We do not rent or sell your personally-identifying information to third parties for marketing or advertising purposes.

4. Protection of Your Data.

   4.1. We implement a variety of security measures to protect your personal information from unauthorized access, alteration, or destruction. While we strive to use commercially acceptable means to protect your data, please note that no method of transmission over the Internet or electronic storage is 100% secure.

5. Your Data Rights. Depending on your location, you may have the following rights:

   5.1. Access. You can request access to the personal data we hold about you.

   5.2. Correction. You can request that we correct any inaccuracies in your personal data.

   5.3. Deletion. You can request that we delete your personal data, subject to certain legal obligations.

   5.4. Restriction. You can request limitations on how we process your personal data.

   5.5. To exercise any of these rights, please contact us using the information provided below.

6. Cookies

   6.1. We use cookies to enhance your experience on our website. Cookies help us track your preferences and understand how you interact with our site. If you prefer, you can set your browser to refuse cookies, but this may limit your ability to use certain features of our website.

7. Children’s Privacy

   7.1. We do not knowingly collect, solicit data from, or market to children under 18 years of age, nor do we knowingly sell such personal information. By using the Services, you represent that you are at least 18 or that you are the parent or guardian of such a minor and consent to such minor dependent's use of the Services. If we learn that personal information from users less than 18 years of age has been collected, we will deactivate the account and take reasonable measures to promptly delete such data from our records. If you become aware of any data we may have collected from children under age 18, please contact us at <<your email address>>.

8. CCPA (doing business in California)

   8.1. Information We Collect: We collect the following categories of personal information from California residents, depending on how you interact with our services:

      8.1.1. Identifiers: Such as your name, email address, IP address, and other contact information.

      8.1.2. Commercial Information: Such as records of products or services purchased.

      8.1.3. Internet or Other Electronic Network Activity: Such as browsing history, search history, and interactions with our website.

      8.1.4. Geolocation Data: Such as physical location from your device when using our website.

      8.1.5. Professional or Employment-Related Information: Such as job title and company name.

      8.1.6. Inferences: Derived from the information you provide to create a profile or analysis.

9. SMS Communications

   9.1. Use of SMS Communications: We may use your phone number to send SMS messages related to appointments, service updates, and promotional offers, where you have provided your consent to receive such communications.

   9.2. Your Choices and Rights: You may opt out at any time by replying “STOP.” For assistance, reply “HELP” or contact us through our website. SMS consent is not a condition of purchase. Mobile numbers will not be shared with third parties for marketing purposes.

10. Business Transfers

   10.1. In the event that [Your Business Name] or substantially all of its assets are acquired, or if we go out of business or enter bankruptcy, your information may be transferred to or acquired by a third party. You acknowledge that such transfers may occur, and that any acquirer of [Your Business Name] may continue to use your personal information as set forth in this policy.

11. Policy Updates

   11.1. We may update this Privacy Policy from time to time. When changes are made, we will revise the "Effective Date" at the top of this page. We encourage you to review this policy periodically to stay informed about how we are protecting your information.

12. Contact Information

   12.1. If you have any questions or concerns about our Privacy Policy or how your information is handled, please contact us.
   
   12.2. [Address]`

      const normalizeStr = (s: string) =>
        s.replace(/\s+/g, " ").trim().toLowerCase()
      const escapedTemplate = normalizeStr(templateStr).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )
      const regexPattern = escapedTemplate
        .replace(/\\\[.*?\\\]/g, ".*?")
        .replace(/<<.*?>>/g, ".*?")

      isContentMatch = new RegExp(regexPattern, "i").test(
        normalizeStr(policyText),
      )

      const screenshotBuffer = await page
        .screenshot({ fullPage: true })
        .catch(() => null)
      if (screenshotBuffer) {
        const compressed = await sharp(screenshotBuffer)
          .jpeg({ quality: 85 })
          .toBuffer()
        const storagePath = `evidence/privacy_policy/${runId}-full-policy-${Date.now()}.jpg`
        fullPolicyScreenshotUrl = await uploadScreenshot(
          compressed,
          storagePath,
          {
            bucket: "evidence",
            isPublic: true,
          },
        ).catch(() => "")
      }
    } catch (e) {
      // Ignored if privacy policy page is inaccessible
    }

    if (!sharedBrowser) await browser.close()
    if (onProgress) await onProgress(90, "Finalizing findings...")

    const finalScreenshotUrl = [screenshotUrl, fullPolicyScreenshotUrl]
      .filter(Boolean)
      .join(",")

    // The checkout notice is only REQUIRED when the site actually has a
    // WooCommerce checkout. Brochure/non-ecommerce sites pass on the footer
    // link alone (they have no checkout to carry a notice).
    const checkoutRequirementMet = !checkoutExists || hasPrivacyPolicyOnCheckout
    const checkoutStatus = !checkoutExists
      ? "N/A (no WooCommerce checkout)"
      : hasPrivacyPolicyOnCheckout
        ? "Found"
        : "Missing"

    if (footerHasLink && checkoutRequirementMet) {
      return [
        {
          check_factor: "privacy_policy",
          title: "Privacy Policy Verified",
          description: checkoutExists
            ? "The Privacy Policy link was successfully found in the footer, and the WooCommerce checkout privacy notice is present."
            : "The Privacy Policy link was successfully found in the footer. This site has no WooCommerce checkout, so a checkout privacy notice is not applicable.",
          context_text: `Footer Link: Found\nCheckout Notice: ${checkoutStatus}\nContent Match: ${isContentMatch ? "Yes" : "No"}\n\n===ACTUAL POLICY TEXT===\n${actualPolicyText}`,
          screenshot_url: finalScreenshotUrl,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    } else {
      return [
        {
          check_factor: "privacy_policy",
          title: "Privacy Policy Missing",
          description: `Privacy Policy check failed. Footer Link: ${footerHasLink ? "Found" : "Missing"}. Checkout Notice: ${checkoutStatus}.`,
          context_text: `Content Match: ${isContentMatch ? "Yes" : "No"}\n\n===ACTUAL POLICY TEXT===\n${actualPolicyText}`,
          screenshot_url: finalScreenshotUrl,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }
  } catch (err: any) {
    if (!sharedBrowser && browser) await browser.close().catch(() => null)
    return [
      {
        check_factor: "privacy_policy",
        title: "Privacy Policy Check Failed",
        description: `The check encountered an unexpected error: ${err.message}. Process aborted gracefully.`,
        context_text: "System Error",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}

/**
 * =========================================================================
 * 3️⃣ CHECK 3: Footer Logo Check (No Tagline)
 * =========================================================================
 * The Logic:
 * - Locate the logo image inside the footer.
 * - Analyze the image attributes (alt, src) to detect tagline keywords.
 */
export async function checkFooterLogo(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let desktopUrl = ""
  let tabletUrl = ""
  let mobileUrl = ""
  let footerFoundAny = false
  let loadedAny = false
  const footerBuffers: { name: string; buffer: Buffer }[] = []

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const viewports = [
      { name: "desktop", width: 1920, height: 1080 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 375, height: 812 },
    ]
    if (onProgress)
      await onProgress(10, "Initializing viewports for footer logo check...")

    for (const vp of viewports) {
      if (onProgress)
        await onProgress(30, `Checking footer logo on ${vp.name}...`)

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      })
      const newPage = await context.newPage()
      const resp = await newPage
        .goto(url, { waitUntil: "load", timeout: 30000 })
        .catch(() => null)
      if (resp) loadedAny = true

//      const footer = newPage
//        .locator('footer, div[class*="footer"], section[class*="footer"]')
//        .first()

      let footer = newPage.locator("footer").first()
      if ((await footer.count()) === 0) {
        footer = newPage
          .locator(
            '[role="contentinfo"], .wp-block-template-part[class*="footer"], .site-footer, .footer, #footer, .wp-block-group[class*="footer"]',
          )
          .first()
      }

      if ((await footer.count()) > 0) {
        footerFoundAny = true
        // Scroll the footer into view to trigger lazy loading of images
        if (onProgress)
          await onProgress(60, `Taking screenshot of footer on ${vp.name}...`)

        await footer.scrollIntoViewIfNeeded().catch(() => {})

        // 5s delay AFTER scrolling to let the logo and dynamic content load
        await newPage.waitForTimeout(5000)

        // Capture only the footer element
        const buffer = await footer.screenshot()
        footerBuffers.push({ name: vp.name, buffer })

        const storagePath = `${runId}/${pageId}/footer_${vp.name}.png`

        // Upload to supabase
        const publicUrl = await uploadScreenshot(buffer, storagePath)

        if (vp.name === "desktop") desktopUrl = publicUrl
        if (vp.name === "tablet") tabletUrl = publicUrl
        if (vp.name === "mobile") mobileUrl = publicUrl
      }
      await context.close()
    }
    if (!sharedBrowser) await browser.close()
  } catch (e: any) {
    console.error("Footer screenshot failed", e)
    return [
      {
        check_factor: "footer_logo",
        title: "Footer Logo Check Failed",
        description: `The check encountered an unexpected error: ${e.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const screenshotUrls = [desktopUrl, tabletUrl, mobileUrl]
    .filter(Boolean)
    .join(",")

  // Guard against a false "ran fine" result: if the page never loaded, no
  // footer was located, or no screenshot was captured, we have no evidence to
  // verify. Emit a lapse finding (title contains "Check Failed") so tedSync
  // marks this "could not complete" rather than surfacing an empty review card
  // that looks like a clean pass.
  if (!loadedAny || !footerFoundAny || !screenshotUrls) {
    const reason = !loadedAny
      ? "the page did not load"
      : !footerFoundAny
        ? "no footer element could be located on any viewport"
        : "no footer screenshot could be captured"
    return [
      {
        check_factor: "footer_logo",
        title: "Footer Logo Check Failed",
        description: `Could not verify the footer logo because ${reason}. No evidence was captured, so this check could not complete.`,
        context_text: `URL: ${url}`,
        screenshot_url: screenshotUrls || null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // Vision verdict PER VIEW (desktop, tablet, mobile): on each view the correct
  // approved Growth99 logo must load with no tagline. Passes only when ALL
  // captured views pass; fails naming the offending view(s). Falls back to a
  // manual "verify" finding when vision is unavailable for every view.
  const { verifyFooterLogo, evaluateFooterLogo } = require("../lib/footerLogoVision")
  if (onProgress) await onProgress(85, "Analyzing footer logo across views (vision)...")

  const perView: { name: string; pass: boolean; reasons: string[]; variant?: string; notes?: string }[] = []
  const visionErrors: string[] = []
  for (const { name, buffer } of footerBuffers) {
    const { verdict, error } = await verifyFooterLogo(buffer).catch((e: any) => ({
      verdict: null,
      error: e?.message || String(e),
    }))
    if (!verdict) {
      if (error) visionErrors.push(`${name}: ${error}`)
      continue // vision unavailable for this view
    }
    const { pass, reasons } = evaluateFooterLogo(verdict)
    perView.push({ name, pass, reasons, variant: verdict.variant, notes: verdict.notes })
  }

  if (perView.length > 0) {
    const failed = perView.filter((v) => !v.pass)
    if (failed.length === 0) {
      const variants = Array.from(new Set(perView.map((v) => v.variant))).join("/")
      return [
        {
          check_factor: "footer_logo",
          title: "Footer Logo Verified",
          description: `No footer logo issues found. The approved Growth99 logo (${variants} variant) loads correctly with no tagline across all checked views (${perView.map((v) => v.name).join(", ")}).`,
          context_text: JSON.stringify(perView),
          screenshot_url: screenshotUrls,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }
    const detail = failed
      .map((v) => `${v.name}: ${v.reasons.join("; ")}`)
      .join(" | ")
    return [
      {
        check_factor: "footer_logo",
        title: "Footer Logo issue",
        description: `Footer logo did not pass on ${failed.length} of ${perView.length} view(s) — ${detail}. Verify against the evidence screenshots (Desktop/Tablet/Mobile).`,
        context_text: JSON.stringify(perView),
        screenshot_url: screenshotUrls,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // Vision unavailable for every view (no key, or every provider/key errored) →
  // we captured screenshots but could NOT verify, so this must fail for manual
  // review, never pass. The full provider error is already in the worker log
  // (describeImageResult logs it). Evidence screenshots ride along.
  return [
    {
      check_factor: "footer_logo",
      title: "Footer logo not verified — AI vision unavailable",
      description:
        "The footer logo could not be verified because the AI vision service returned no result for any view. Marked as failed for manual review — confirm the approved Growth99 logo (white or colour variant, no tagline) across Desktop, Tablet, and Mobile using the evidence screenshots.",
      // Full technical reason for the worker log + internal QACC copy only —
      // sanitizeClientReport strips this "AI vision unavailable:" line from the
      // client-facing copy.
      context_text: `AI vision unavailable: ${(visionErrors.join(" ; ") || "no result for any view").slice(0, 400)}`,
      screenshot_url: screenshotUrls,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 * CHECK 4: Single Script Features Check
 * =========================================================================
 * The Logic:
 * - Check if chatbot, review widgets are injected, and verify they are correctly right-aligned.
 */
export async function checkSingleScript(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright-extra")
  const stealth = require("puppeteer-extra-plugin-stealth")()
  chromium.use(stealth)
  
  // Decouple from shared browser
  sharedBrowser = undefined;

  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let desktopUrl = ""
  let tabletUrl = ""
  let mobileUrl = ""
  let codeUrl = ""
  // Whether the Growth99 single-script embed is installed on this page. The
  // embed is a one-time, site-wide snippet: a <div id="...business-id..."
  // data-id="..."> plus the integration <script>. The business-id value differs
  // per site, so we key on the STABLE integration script src (installed = the
  // loader script is present); the id div alone (no loader) is not functional.
  let installed = false

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))

    if (onProgress)
      await onProgress(10, "Initializing single script check session...")

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })

    const newPage = await context.newPage()

    let activeJsRequests = 0
    newPage.on("request", (request: any) => {
      if (
        request.resourceType() === "script" ||
        request.url().endsWith(".js")
      ) {
        activeJsRequests++
      }
    })
    newPage.on("requestfinished", (request: any) => {
      if (
        request.resourceType() === "script" ||
        request.url().endsWith(".js")
      ) {
        activeJsRequests = Math.max(0, activeJsRequests - 1)
      }
    })
    newPage.on("requestfailed", (request: any) => {
      if (
        request.resourceType() === "script" ||
        request.url().endsWith(".js")
      ) {
        activeJsRequests = Math.max(0, activeJsRequests - 1)
      }
    })

    if (onProgress)
      await onProgress(30, `Loading page and waiting for external scripts...`)

    await newPage
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

    await newPage.evaluate(() => window.scrollBy(0, 500)).catch(() => {})
    await newPage
      .waitForSelector("#feature-buttons", { timeout: 15000 })
      .catch(() => {})

    // Wait for JS network requests to settle (max 15s)
    let waited = 0
    while (activeJsRequests > 0 && waited < 15000) {
      await newPage.waitForTimeout(500)
      waited += 500
    }

    // Give external scripts 20 more seconds to parse, inject sub-scripts, and modify the DOM
    await newPage.waitForTimeout(20000)

    // Desktop screenshot
    const desktopBuffer = await newPage.screenshot({ fullPage: false })
    desktopUrl = await uploadScreenshot(
      desktopBuffer,
      `${runId}/${pageId}/single_script_desktop.png`,
    )

    // Tablet screenshot
    if (onProgress) await onProgress(50, `Capturing tablet view...`)
    await newPage.setViewportSize({ width: 768, height: 1024 })
    await newPage.waitForTimeout(1000) // allow layout to shift
    const tabletBuffer = await newPage.screenshot({ fullPage: false })
    tabletUrl = await uploadScreenshot(
      tabletBuffer,
      `${runId}/${pageId}/single_script_tablet.png`,
    )

    // Mobile screenshot
    if (onProgress) await onProgress(60, `Capturing mobile view...`)
    await newPage.setViewportSize({ width: 375, height: 812 })
    await newPage.waitForTimeout(1000) // allow layout to shift
    const mobileBuffer = await newPage.screenshot({ fullPage: false })
    mobileUrl = await uploadScreenshot(
      mobileBuffer,
      `${runId}/${pageId}/single_script_mobile.png`,
    )

    // 4th screenshot: Page source of #feature-buttons code (reusing the same page)
    if (onProgress)
      await onProgress(70, "Fetching page source for script verification...")

    const codeSnippet = await newPage.evaluate(() => {
      const el = document.querySelector("#feature-buttons")
      return el
        ? el.outerHTML
        : "Element #feature-buttons not found in page source"
    })

    // Detect the single-script embed: the integration loader script is the
    // definitive signal (id div value varies per site, script src does not).
    try {
      const domHit = await newPage.evaluate(
        () =>
          !!document.querySelector(
            'script[src*="chatbot.growth99.com/assets/js/integration.js"]',
          ),
      )
      const content = await newPage.content().catch(() => "")
      installed =
        domHit ||
        content.includes("chatbot.growth99.com/assets/js/integration.js")
    } catch {
      installed = false
    }

    const renderPage = await context.newPage()
    await renderPage.setContent(
      `<pre style="font-size: 14px; white-space: pre-wrap; word-wrap: break-word; padding: 20px; background: #f4f4f4;">${codeSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
    )
    const codeBuffer = await renderPage.screenshot({ fullPage: false })
    codeUrl = await uploadScreenshot(
      codeBuffer,
      `${runId}/${pageId}/single_script_code.png`,
    )
    await renderPage.close().catch(() => {})

    await context.close()
    if (!sharedBrowser) await browser.close()
    if (onProgress) await onProgress(90, "Finalizing findings...")
  } catch (e: any) {
    console.error("Single script screenshot failed", e)
    return [
      {
        check_factor: "single_script",
        title: "Single Script Check Failed",
        description: `The check encountered an unexpected error: ${e.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const screenshotUrls = [desktopUrl, tabletUrl, mobileUrl, codeUrl]
    .filter(Boolean)
    .join(",")

  // Installed -> pass (clean-pass phrasing so the report marks it Passed).
  // Not installed -> fail: the site-wide single-script embed is missing here.
  if (installed) {
    return [
      {
        check_factor: "single_script",
        title: "Single Script Installed",
        description:
          "No issues found. The single-script embed is installed on this page.",
        screenshot_url: screenshotUrls,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  return [
    {
      check_factor: "single_script",
      title: "Single Script Not Installed",
      description:
        "The single-script embed was not found on this page. This one-time, site-wide snippet should be present in the header or footer of every page.",
      screenshot_url: screenshotUrls,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 * 5️⃣ CHECK 5: Top Bar & Sticky Header Check
 * =========================================================================
 * The Logic:
 * - Top Bar Check: capture the header for manual verification of the metadata
 *   bar (Mobile, Email, Social links).
 * - Sticky Header Check: compare the header's viewport-relative position before
 *   and after scrolling ~800px to determine whether it stays pinned.
 */
export async function checkTopBarAndStickyHeader(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
  themeType?: ThemeType,
): Promise<Finding[]> {
  // Stealth chromium: gogroth (and other Cloudflare-fronted) staging sites 403
  // a plain headless browser. playwright-extra + the stealth plugin hides the
  // headless/webdriver tells. The shared browser is a plain-playwright instance,
  // so decouple and launch our own stealth browser here.
  const { chromium } = require("playwright-extra")
  const stealth = require("puppeteer-extra-plugin-stealth")()
  chromium.use(stealth)
  sharedBrowser = undefined

  const { uploadScreenshot } = require("../lib/supabaseStorage")
  // Classic themes may carry the nav in a bare <nav>; block themes use a
  // template-part header. Pick the matching selector set (defaults to block).
  const headerSelector = headerSelectorFor(themeType)

  let codeUrl = ""
  let headerUrl = ""
  let headerFound = false
  let stickyMeasured = false
  let stickyObserved = false

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    // Set a real desktop UA. Without one, Playwright sends a "HeadlessChrome"
    // user-agent that Cloudflare (and similar WAFs) block with a 403 — every
    // other desktop check here already sets a UA; this one used to be missed.
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })
    const newPage = await context.newPage()
    if (onProgress)
      await onProgress(10, "Navigating to homepage to check top bar...")

    await newPage
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

    await newPage.waitForTimeout(5000)
    if (onProgress) await onProgress(40, "Taking screenshot of the header...")

    const headerElement = newPage
      .locator(headerSelector)
      .first()
    if ((await headerElement.count()) > 0) {
      const buffer = await headerElement.screenshot()
      headerUrl = await uploadScreenshot(
        buffer,
        `${runId}/${pageId}/header_nav.png`,
      )

      // Sticky-header measurement (docstring promise): compare the header's
      // viewport-relative position before and after scrolling. A sticky/fixed
      // header stays pinned near the top (top ~0) after scroll; a normal header
      // scrolls up out of view (top goes strongly negative). getBoundingClientRect
      // is viewport-relative, so this is scroll-aware and reliable.
      try {
        const measure = () =>
          headerElement.evaluate((el: Element) => {
            const r = el.getBoundingClientRect()
            return { top: r.top, height: r.height }
          })
        const before = await measure()
        await newPage.evaluate(() => window.scrollBy(0, 800))
        await newPage.waitForTimeout(600)
        const after = await measure()
        headerFound = true
        // Pinned = still within the top band of the viewport and visible.
        stickyObserved =
          after.top >= -5 && after.top < 150 && after.height > 0

        // Additional pass condition: if the header element itself — or any
        // header/sticky-classed element inside it — declares position:sticky
        // in its computed style, the header is sticky by definition and the
        // check must pass, even if the scroll-based measurement did not
        // observe pinning (e.g. the page is too short to scroll 800px, or a
        // sticky ancestor keeps rect.top from crossing the threshold).
        try {
          const cssSticky = await headerElement.evaluate(
            (el: Element, HEADER_SELECTOR: string) => {
              const isSticky = (node: Element) =>
                getComputedStyle(node).position === "sticky"
              if (isSticky(el)) return true
              const nested = Array.from(
                el.querySelectorAll(
                  `${HEADER_SELECTOR}, .is-sticky, .sticky-header, [class*='sticky' i]`,
                ),
              )
              return nested.some(isSticky)
            },
            headerSelector,
          )
          if (cssSticky) stickyObserved = true
        } catch {
          // Computed-style probe failed — fall back to the scroll measurement.
        }

        stickyMeasured = true
        // Reset scroll so the code-snippet capture below is unaffected.
        await newPage.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
      } catch {
        // Measurement failed — leave stickyMeasured false (manual verify).
      }
    }

    if (onProgress) await onProgress(70, "Extracting header code snippet...")

    const codeSnippet = await newPage.evaluate((HEADER_SELECTOR: string) => {
      // Prefer the element that is GENUINELY pinned (computed position), rather
      // than guessing from class names — block themes pin via theme.json/CSS and
      // carry no framework-specific "sticky" class.
      const candidates = Array.from(
        document.querySelectorAll(
          `${HEADER_SELECTOR}, .is-sticky, .sticky-header, [class*='sticky' i], [class*='fixed' i]`,
        ),
      ).slice(0, 40)
      const pinned = candidates.find((el) => {
        const cs = getComputedStyle(el)
        if (cs.position !== "sticky" && cs.position !== "fixed") return false
        const r = el.getBoundingClientRect()
        return r.height > 0 && r.top + window.scrollY < 400
      })
      if (pinned) return pinned.outerHTML

      const el = document.querySelector(HEADER_SELECTOR)
      return el ? el.outerHTML : "Header element not found"
    }, headerSelector)

    const codeContext = await browser.newContext()
    const renderPage = await codeContext.newPage()
    await renderPage.setContent(
      `<pre style="font-size: 14px; white-space: pre-wrap; word-wrap: break-word; padding: 20px; background: #f4f4f4;">${codeSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
    )
    const codeBuffer = await renderPage.screenshot({ fullPage: false })
    codeUrl = await uploadScreenshot(
      codeBuffer,
      `${runId}/${pageId}/header_code.png`,
    )

    await codeContext.close()
    if (onProgress) await onProgress(90, "Finalizing findings...")
    await context.close()
    if (!sharedBrowser) await browser.close()
  } catch (e: any) {
    console.error("Header screenshot failed", e)
    return [
      {
        check_factor: "top_bar_sticky",
        title: "Top Bar & Sticky Header Check Failed",
        description: `The check encountered an unexpected error: ${e.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const screenshotUrls = [codeUrl, headerUrl].filter(Boolean).join(",")

  const stickyLine = stickyMeasured
    ? `Sticky header measurement: the header ${stickyObserved ? "STAYED pinned near the top" : "did NOT stay pinned (scrolled out of view)"} after an ~800px scroll.`
    : headerFound
      ? "Sticky header measurement: could not be measured this run."
      : "Sticky header measurement: no header element was located."

  return [
    {
      check_factor: "top_bar_sticky",
      title: "Verify Top Bar & Sticky Header",
      description: `Please verify the top bar using the provided screenshots. ${stickyLine}`,
      context_text: `Header found: ${headerFound ? "Yes" : "No"}\nSticky measured: ${stickyMeasured ? "Yes" : "No"}\nSticky observed: ${stickyMeasured ? (stickyObserved ? "Pinned" : "Not pinned") : "N/A"}`,
      screenshot_url: screenshotUrls,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 * CHECK 6: Add Favicon Check
 * =========================================================================
 * The Logic:
 * - Search for favicon link relation inside head tags.
 * - Issue a fast HTTP request (axios.head) to verify the favicon resource returns 200 OK.
 */
export async function checkFavicon(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let desktopUrl = ""
  let tabletUrl = ""
  let mobileUrl = ""
  let codeUrl = ""
  let faviconDeclared = false
  let faviconChecked = false
  let faviconResourceOk = false
  let faviconHttpStatus = 0
  let codeLoadOk = false

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const viewports = [
      { name: "desktop", width: 1920, height: 1080 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 375, height: 812 },
    ]

    if (onProgress)
      await onProgress(10, "Initializing viewports for favicon check...")

    for (const vp of viewports) {
      if (onProgress) await onProgress(30, `Checking favicon on ${vp.name}...`)

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      })

      const newPage = await context.newPage()
      await newPage
        .goto(url, { waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {})

      // Inject mock browser tab UI to visually verify the favicon inside the viewport screenshot
      await newPage
        .evaluate(async () => {
          const faviconUrl = document.querySelector(
            'link[rel*="icon" i], link[rel*="shortcut" i], link[rel="apple-touch-icon" i]',
          ) as HTMLLinkElement | null
          const urlStr = faviconUrl
            ? faviconUrl.href
            : window.location.origin + "/favicon.ico"
          const pageTitle = document.title || "Untitled"

          const bar = document.createElement("div")
          bar.style.cssText =
            "position: fixed; top: 0; left: 0; width: 100vw; height: 40px; background: #dee1e6; display: flex; align-items: flex-end; padding: 0 8px; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; box-sizing: border-box;"

          bar.innerHTML =
            '<div style="display: flex; gap: 6px; padding-bottom: 12px; padding-left: 8px;">' +
            '<div style="width: 12px; height: 12px; border-radius: 50%; background: #ff5f56;"></div>' +
            '<div style="width: 12px; height: 12px; border-radius: 50%; background: #ffbd2e;"></div>' +
            '<div style="width: 12px; height: 12px; border-radius: 50%; background: #27c93f;"></div>' +
            "</div>" +
            '<div style="display: flex; align-items: center; background: #ffffff; height: 32px; min-width: 200px; max-width: 240px; margin-left: 16px; border-radius: 8px 8px 0 0; padding: 0 12px; gap: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">' +
            (urlStr
              ? '<img src="' +
                urlStr +
                '" style="width: 16px; height: 16px; object-fit: contain;">'
              : '<div style="width: 16px; height: 16px; border: 1px dashed #ccc;"></div>') +
            '<span style="font-size: 12px; color: #3c4043; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">' +
            pageTitle +
            "</span>" +
            "</div>"

          document.documentElement.appendChild(bar)

          if (document.body) {
            document.body.style.marginTop = "40px"
          }

          // Wait for the favicon image to fully load before taking the screenshot
          const img = bar.querySelector("img")
          if (img) {
            await new Promise((resolve) => {
              if (img.complete) {
                resolve(true)
              } else {
                img.onload = resolve
                img.onerror = resolve
                setTimeout(resolve, 2000) // 2 second timeout fallback
              }
            })
          }
        })
        .catch(() => {})

      const buffer = await newPage.screenshot({ fullPage: false })
      const storagePath = `${runId}/${pageId}/favicon_${vp.name}.png`
      const publicUrl = await uploadScreenshot(buffer, storagePath)

      if (vp.name === "desktop") desktopUrl = publicUrl
      if (vp.name === "tablet") tabletUrl = publicUrl
      if (vp.name === "mobile") mobileUrl = publicUrl

      await context.close()
    }

    if (onProgress)
      await onProgress(70, "Fetching page source for favicon verification...")

    const codeContext = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })

    const codePage = await codeContext.newPage()
    const codeResp = await codePage
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => null)
    codeLoadOk = !!codeResp

    const faviconInfo = await codePage.evaluate(() => {
      const el = document.querySelector(
        'link[rel*="icon" i], link[rel*="shortcut" i], link[rel="apple-touch-icon" i]',
      ) as HTMLLinkElement | null
      return {
        declared: !!el,
        // Resolve to an absolute URL; fall back to the conventional /favicon.ico.
        href: el ? el.href : window.location.origin + "/favicon.ico",
        outerHTML: el
          ? el.outerHTML
          : "Favicon element not found in page source",
      }
    })
    const codeSnippet = faviconInfo.outerHTML

    // Actually verify the favicon RESOURCE resolves (docstring promise). A link
    // tag that points at a 404 is a broken favicon and must be reported, not
    // silently passed. Only attempt when the page itself loaded.
    if (codeLoadOk) {
      try {
        const res = await codePage.request.get(faviconInfo.href, {
          timeout: 15000,
        })
        faviconHttpStatus = res.status()
        const ct = (res.headers()["content-type"] || "").toLowerCase()
        // OK = 2xx AND not obviously the HTML 404/soft-404 page.
        faviconResourceOk = res.ok() && !ct.includes("text/html")
        faviconChecked = true
      } catch (e) {
        // Network-level failure — cannot determine; leave faviconChecked false
        // so we fall back to the manual-verify card rather than a false defect.
        faviconChecked = false
      }
    }
    faviconDeclared = faviconInfo.declared

    const renderPage = await codeContext.newPage()
    await renderPage.setContent(
      `<pre style="font-size: 14px; white-space: pre-wrap; word-wrap: break-word; padding: 20px; background: #f4f4f4;">${codeSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
    )
    const codeBuffer = await renderPage.screenshot({ fullPage: false })
    codeUrl = await uploadScreenshot(
      codeBuffer,
      `${runId}/${pageId}/favicon_code.png`,
    )

    await codeContext.close()
    if (!sharedBrowser) await browser.close()
    if (onProgress) await onProgress(90, "Finalizing findings...")
  } catch (e: any) {
    console.error("Favicon screenshot failed", e)
    return [
      {
        check_factor: "favicon",
        title: "Favicon Check Failed",
        description: `The check encountered an unexpected error: ${e.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const screenshotUrls = [desktopUrl, tabletUrl, mobileUrl, codeUrl]
    .filter(Boolean)
    .join(",")

  // If the HTTP verification ran and the favicon is missing or broken, that's a
  // real defect — report it instead of the generic manual-verify card.
  if (faviconChecked && !faviconResourceOk) {
    return [
      {
        check_factor: "favicon",
        title: "Favicon Missing or Broken",
        description: faviconDeclared
          ? `A favicon link was found in the page source, but the favicon resource did not resolve successfully (HTTP ${faviconHttpStatus || "error"}). A broken favicon shows a blank/default icon in the browser tab.`
          : `No favicon link was declared in the page source, and the conventional /favicon.ico did not resolve successfully (HTTP ${faviconHttpStatus || "error"}). The browser tab will show a default icon.`,
        context_text: `URL: ${url}\nFavicon declared: ${faviconDeclared ? "Yes" : "No"}\nFavicon HTTP status: ${faviconHttpStatus || "unreachable"}`,
        screenshot_url: screenshotUrls || null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  return [
    {
      check_factor: "favicon",
      title: "Verify Favicon",
      description: faviconChecked
        ? `The favicon resource resolved successfully (HTTP ${faviconHttpStatus}). Please verify it displays correctly across Desktop, Tablet, Mobile.`
        : "Please verify the favicon across Desktop, Tablet, Mobile and verify the favicon code addition.",
      screenshot_url: screenshotUrls,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 * 7️⃣ CHECK 7: URL & Tab Name Matching Check
 * =========================================================================
 * The Logic:
 * - Extract page title and verify that it is formatted and not generic (like 'Untitled' or blank).
 * - Compare crawled relative page list with expected major pages (/about, /contact, /services, /reviews) to make sure none are missed.
 */
export async function checkUrlAndTabMatching(
  page: PlaywrightPage,
  devUrls: string[],
  liveSiteUrl: string,
  pageRecord?: any,
): Promise<Finding[]> {
  const findings: Finding[] = []

  const pageTitle = await page.title()
  // Only flag titles that are actually generic placeholders. The previous
  // `includes("page")` test wrongly flagged valid titles like "Homepage" and
  // "About Page" as invalid — a fabricated defect. Match known placeholder
  // patterns (WP defaults, bare/numbered "Page", "Untitled") instead.
  const trimmedTitle = (pageTitle || "").trim()
  const placeholderPatterns = [
    /untitled/i, // "Untitled", "Untitled Page"
    /^sample page$/i, // WP default page title
    /^new page$/i,
    /^page\s*\d*$/i, // "Page", "Page 1"
  ]
  const isPlaceholderTitle = placeholderPatterns.some((p) =>
    p.test(trimmedTitle),
  )
  if (!pageTitle || trimmedTitle === "" || isPlaceholderTitle) {
    findings.push({
      check_factor: "url_matching",
      title: `Invalid Tab Title for ${page.url()}`,
      description: `The page tab title "${pageTitle || "Empty"}" is invalid or blank. Please format it with your business name and page details.`,
      status: "open",
      ai_generated: false,
    } as Finding)
  }

  if (liveSiteUrl) {
    try {
      const currentUrl = page.url()
      const isHomepage =
        currentUrl === liveSiteUrl ||
        currentUrl === `${liveSiteUrl}/` ||
        currentUrl.replace(/www\./, "") === liveSiteUrl.replace(/www\./, "")

      if (isHomepage && devUrls.length > 0) {
        const devPaths = devUrls
          .map((url) => {
            try {
              return new URL(url).pathname.replace(/\/$/, "")
            } catch {
              return ""
            }
          })
          .filter(Boolean)

        const essentialPaths = ["/about", "/contact", "/services", "/reviews"]
        const missingPaths = essentialPaths.filter(
          (path) => !devPaths.some((devPath) => devPath.endsWith(path)),
        )

        if (missingPaths.length > 0) {
          findings.push({
            check_factor: "url_matching",
            title: "Dev Site Sitemap URL Mismatch",
            description: `We compared standard live site page paths and found some essential paths are missing on the new dev site: ${missingPaths.join(", ")}. Please verify if these should be migrated.`,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      }
    } catch (e: any) {
      logger.error({ error: e.message }, "Error during URL sitemap matching.")
    }
  }

  return findings
}

/**
 * =========================================================================
 * 8️⃣ CHECK 8: Growth99 Contact Form Check
 * =========================================================================
 * The Logic:
 * - Search the page DOM for standard email/contact form elements.
 * - Verify the form fields and submit button are present, enabled, and responsive.
 */
export async function checkGrowth99ContactForm(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")
  const { supabase } = require("../lib/supabase")

  let hasForm = false
  let screenshots: string[] = []
  let contactFormCheckError: string | null = null

  const browser = sharedBrowser || (await chromium.launch({ headless: true }))
  let context: any = null
  let page: any = null

  if (
    sharedBrowser &&
    sharedBrowser.contexts().length > 0 &&
    sharedBrowser.contexts()[0].pages().length > 0
  ) {
    page = sharedBrowser.contexts()[0].pages()[0]
  } else {
    context = await browser.newContext()
    page = await context.newPage()
  }

  try {
    if (onProgress)
      await onProgress(10, "Checking page source for contact form...")

    if (context) {
      await page
        .goto(url, { waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {})
    }
    const content = await page.content().catch(() => "")

    hasForm = content.includes(
      "widget-ui.growth99.com/assets/widgets/new-form.html",
    )

    if (hasForm) {
      // Check if any screenshots were already taken for this run to avoid duplicates
      const { data: existingFindings } = await supabase
        .from("findings")
        .select("screenshot_url")
        .eq("run_id", runId)
        .eq("check_factor", "contact_form")
        .not("screenshot_url", "is", null)

      const alreadyHasScreenshots =
        existingFindings &&
        existingFindings.length > 0 &&
        existingFindings[0].screenshot_url

      // Only give permission to take screenshots if no other page has already locked it
      let acquiredLock = false
      if (!contactFormScreenshotLocks.has(runId)) {
        contactFormScreenshotLocks.add(runId)
        acquiredLock = true
      }

      if (!alreadyHasScreenshots && acquiredLock) {
        if (onProgress)
          await onProgress(
            30,
            "Taking multiview screenshots of the contact form...",
          )

        const viewports = [
          { name: "desktop", width: 1920, height: 1080 },
          { name: "tablet", width: 768, height: 1024 },
          { name: "mobile", width: 375, height: 812 },
        ]

        for (const vp of viewports) {
          const vpContext = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
          })
          const vpPage = await vpContext.newPage()
          await vpPage
            .goto(url, { waitUntil: "networkidle", timeout: 30000 })
            .catch(() => {})

          const iframeLoc = vpPage
            .locator(
              'iframe[src*="widget-ui.growth99.com/assets/widgets/new-form.html"]',
            )
            .first()
          if ((await iframeLoc.count()) > 0) {
            await iframeLoc.scrollIntoViewIfNeeded().catch(() => {})
            await vpPage.waitForTimeout(2000)
          }

          const buffer = await vpPage.screenshot({ fullPage: false })
          const publicUrl = await uploadScreenshot(
            buffer,
            `${runId}/${pageId}/contact_form_${vp.name}.png`,
          )
          screenshots.push(publicUrl)
          await vpContext.close()
        }

        if (onProgress)
          await onProgress(70, "Submitting dummy data to the contact form...")

        const iframeElement = await page
          .waitForSelector(
            'iframe[src*="widget-ui.growth99.com/assets/widgets/new-form.html"]',
            { timeout: 10000 },
          )
          .catch(() => null)
        if (iframeElement) {
          await iframeElement.scrollIntoViewIfNeeded().catch(() => {})
          const frame = await iframeElement.contentFrame()
          if (frame) {
            await frame
              .fill('input[name="First Name"]', "Test Name", { timeout: 3000 })
              .catch(() => {})
            await frame
              .fill('input[name="Last Name"]', "User", { timeout: 3000 })
              .catch(() => {})
            await frame
              .fill('input[name="Email"]', "test@growth99.com", {
                timeout: 3000,
              })
              .catch(() => {})
            await frame
              .fill('input[name="Phone Number"]', "1234567890", {
                timeout: 3000,
              })
              .catch(() => {})
            await frame
              .fill('input[name="Message"]', "Test Message", { timeout: 3000 })
              .catch(() => {})
            await frame
              .click('button[type="submit"]', { timeout: 3000 })
              .catch(() => {})

            await page.waitForTimeout(4000) // Wait for thank you page

            const thankYouBuffer = await page.screenshot({ fullPage: false })
            const thankYouUrl = await uploadScreenshot(
              thankYouBuffer,
              `${runId}/${pageId}/contact_form_thankyou.png`,
            )
            screenshots.push(thankYouUrl)
          }
        }
      }
    }

    if (onProgress) await onProgress(90, "Finalizing contact form findings...")
  } catch (e: any) {
    console.error("Growth99 contact form check failed:", e)
    contactFormScreenshotLocks.delete(runId) // release the lock on error
    contactFormCheckError = e?.message || String(e)
  } finally {
    if (context) await context.close()
    if (!sharedBrowser) await browser.close()
  }

  // If the check crashed, do NOT fall through to the normal "Verify Contact
  // Form" card — with hasForm defaulting to false and no screenshots it is
  // indistinguishable from a genuine "no form found" result (a silent lapse
  // reported as a normal pass). Surface the failure instead.
  if (contactFormCheckError) {
    return [
      {
        check_factor: "contact_form",
        title: "Contact Form Check Failed",
        description: `The contact form check could not complete: ${contactFormCheckError}. Process aborted gracefully; QACC will retry on the next run.`,
        context_text: `URL: ${url}\nSystem Error`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const findingData = {
    url,
    hasForm,
  }

  // hasForm was set by scanning the rendered page source for the Growth99 form
  // widget (matched on a stable substring, independent of the per-form id). The
  // report must NEVER echo that widget URL/snippet — only the found/not-found
  // outcome, so:
  //   • found     -> clean-pass phrasing ("No … issues found") so it passes,
  //   • not found -> a real defect ("Contact form not found") so it fails.
  if (hasForm) {
    return [
      {
        check_factor: "contact_form",
        title: "Contact Form Verified",
        description:
          "No contact form issues found. The contact form is present on this page.",
        context_text: JSON.stringify(findingData),
        screenshot_url: screenshots.length > 0 ? screenshots.join(",") : null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  return [
    {
      check_factor: "contact_form",
      title: "Contact Form Not Found",
      description: "No contact form was found on this page.",
      context_text: JSON.stringify(findingData),
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 * 9️⃣ CHECK 9: Chatbot & Virtual Consultation Check
 * =========================================================================
 * The Logic:
 * - Search launcher widgets. If launcher button is present, simulate click action.
 * - Verify widget displays the conversational layout context.
 */
export async function checkChatbotAndConsultation(
  page: PlaywrightPage,
  runId?: string,
  opts?: { projectId?: string; projectName?: string; siteUrl?: string },
): Promise<Finding[]> {
  const sharp = require("sharp")
  const { uploadScreenshot } = require("../lib/supabaseStorage")
  const { analyzeChatWidgets, confirmSelfAssessmentWidget } = require("../lib/chatWidgetsVision")
  const { getChatbotConsultationCodes } = require("../lib/basecampClient")

  const factor = "chatbot_consultation"

  // 1. Let every JS-injected widget settle, then screenshot the loaded page.
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(5000)
  const shot = await page.screenshot().catch(() => null)
  let screenshotUrl: string | null = null
  if (shot && runId) {
    const jpg = await sharp(shot).jpeg({ quality: 85 }).toBuffer()
    screenshotUrl =
      (await uploadScreenshot(jpg, `${runId}/chatbot_consultation_${Date.now()}.jpg`, {
        bucket: "evidence",
        isPublic: true,
      }).catch(() => "")) || null
  }

  // 2. Vision: are the circular buttons + chatbot bubble actually visible?
  const verdict = shot ? await analyzeChatWidgets(shot).catch(() => null) : null

  // 3. Definitive backend proof: are the Basecamp install codes in the source?
  const source = (await page.content().catch(() => "")) || ""
  const codes = await getChatbotConsultationCodes(
    opts?.projectId,
    opts?.projectName,
  ).catch(() => null)

  // Cliff Hanger integration script (enables the chatbot + launcher buttons).
  const INTEGRATION = "chatbot.growth99.com/assets/js/integration.js"
  const cliffScriptInSource = source.includes(INTEGRATION)
  const bizId = codes?.cliffhanger.businessId || ""
  const bizIdInSource = bizId ? new RegExp(`data-id=["']?${bizId}\\b`).test(source) : false
  const cliffhangerInSource = cliffScriptInSource || bizIdInSource
  // Virtual Consultation composer (may load in an iframe on click, so this is a
  // supporting signal, not the gate).
  const vcInSource =
    source.includes("app.growth99.com/assets/static/composer.html") ||
    (!!codes?.vc.fid && source.includes(`fid=${codes.vc.fid}`))

  const buttonsVisible = !!verdict?.buttonsVisible
  const chatbotVisible = !!verdict?.chatbotVisible

  // 3b. Best-effort self-assessment functional test: click the first (self-
  // assessment) launcher and vision-confirm a body-model widget opened. Only
  // worth trying when the script is installed and buttons are visible. Brittle
  // (injected buttons have no stable selector), so a null result never fails the
  // check — it just annotates it.
  let selfAssessmentOpened: boolean | null = null
  if (cliffhangerInSource && buttonsVisible) {
    const launcherSelectors = [
      '[title="Self Assessment" i]',
      '[aria-label*="Self Assessment" i]',
      '[class*="self-assessment"]',
      '[id*="self-assessment"]',
      ".g99-consultation-btn",
      "#g99-consultation-btn",
      '[class*="consultation-btn"]',
    ]
    for (const sel of launcherSelectors) {
      const loc = page.locator(sel).first()
      const present = (await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))
      if (!present) continue
      try {
        await loc.click({ timeout: 5000 })
        await page.waitForTimeout(3000)
        const shot2 = await page.screenshot().catch(() => null)
        if (shot2) {
          const r = await confirmSelfAssessmentWidget(shot2).catch(() => null)
          if (r) {
            selfAssessmentOpened = r.opened
            if (r.opened && runId) {
              const jpg2 = await sharp(shot2).jpeg({ quality: 85 }).toBuffer()
              const u = await uploadScreenshot(jpg2, `${runId}/self_assessment_${Date.now()}.jpg`, {
                bucket: "evidence",
                isPublic: true,
              }).catch(() => "")
              if (u) screenshotUrl = screenshotUrl ? `${screenshotUrl},${u}` : u
            }
            break
          }
        }
      } catch {}
    }
  }
  const selfAssessNote =
    selfAssessmentOpened === true
      ? " Self-assessment widget opened correctly on click."
      : selfAssessmentOpened === false
        ? " Note: clicking the self-assessment button did not open the body-model widget — verify manually."
        : " (Self-assessment click test was inconclusive — verify manually.)"

  const ctx = `cliffhangerInSource: ${cliffhangerInSource} (script:${cliffScriptInSource}, bizId:${bizIdInSource || "n/a"}); vcInSource: ${vcInSource}; selfAssessmentOpened: ${selfAssessmentOpened}; vision: ${JSON.stringify(verdict || {})}; basecampCodes: ${JSON.stringify(codes || {})}`

  // 4. Verdict.
  //   • script installed + widgets visibly load  -> PASS
  //   • script installed but widgets NOT visible  -> MANUAL (contradiction)
  //   • script NOT installed                      -> FAIL (not implemented)
  if (cliffhangerInSource) {
    if (chatbotVisible && buttonsVisible) {
      return [
        {
          check_factor: factor,
          title: "Chatbot & Virtual Consultation Verified",
          description: `No chatbot/consultation issues found. The Cliff Hanger integration script is present in the page source and the widgets load correctly — ${verdict?.buttonCount ?? "the"} circular consultation buttons and the chatbot bubble are visible.${vcInSource ? " The Virtual Consultation composer code is also present." : ""}${selfAssessNote}`,
          context_text: ctx,
          screenshot_url: screenshotUrl,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }
    // Installed in the backend but not visibly loading → needs human eyes.
    const missing = [
      !chatbotVisible && "the chatbot bubble is not visible",
      !buttonsVisible && "the circular consultation buttons are not visible",
    ].filter(Boolean)
    return [
      {
        check_factor: factor,
        title: "Chatbot & Virtual Consultation — needs manual review",
        description: `The install code IS present in the page source (Cliff Hanger integration script), but ${missing.join(" and ")} in the loaded screenshot. This may be a load/timing or rendering issue — please review manually on the live page.${selfAssessNote}`,
        context_text: ctx,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // No integration script in source → not implemented.
  return [
    {
      check_factor: factor,
      title: "Chatbot & Virtual Consultation not installed",
      description: `The Cliff Hanger integration script (${INTEGRATION}) was not found in the page source, so the chatbot and virtual consultation are not installed. No automatic fix — first confirm with the client's requirement whether the chatbot and virtual consultation are meant to be added for this client; if they are required, add the Cliff Hanger + Virtual Consultation codes from Basecamp.${verdict ? ` Vision: buttons ${buttonsVisible ? "visible" : "not visible"}, chatbot ${chatbotVisible ? "visible" : "not visible"}.` : ""}`,
      context_text: ctx,
      screenshot_url: screenshotUrl,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 *  CHECK 11: Text Share Metadata Check
 * =========================================================================
 * The Logic:
 * - Grab 'og:title', 'og:site_name', and 'twitter:title' meta tags.
 * - Verify they don't contain WordPress boilerplate text like "My blog" or "Untitled WordPress Page".
 */
export async function checkTextShareMetadata(
  page: PlaywrightPage,
  projectName: string,
  pageRecord?: any,
): Promise<Finding[]> {
  const findings: Finding[] = []

  try {
    const metaTags = await page.evaluate(() => {
      const ogTitle = document.querySelector(
        'meta[property="og:title"]',
      ) as HTMLMetaElement
      const ogSiteName = document.querySelector(
        'meta[property="og:site_name"]',
      ) as HTMLMetaElement
      const twitterTitle = document.querySelector(
        'meta[name="twitter:title"]',
      ) as HTMLMetaElement
      return {
        ogTitle: ogTitle ? ogTitle.content : null,
        ogSiteName: ogSiteName ? ogSiteName.content : null,
        twitterTitle: twitterTitle ? twitterTitle.content : null,
      }
    })

    if (metaTags.ogTitle) {
      const titleLower = metaTags.ogTitle.toLowerCase()
      if (
        titleLower.includes("wordpress") ||
        titleLower.includes("elementor") ||
        titleLower.includes("my blog")
      ) {
        findings.push({
          check_factor: "text_share",
          title: "Text Share Metadata - Default WordPress Value Found",
          description: `The og:title is set to a default value "${metaTags.ogTitle}", which looks like a WordPress boilerplate. Please update this tag before release.`,
          status: "open",
          ai_generated: false,
        } as Finding)
      }
    } else {
      findings.push({
        check_factor: "text_share",
        title: "Text Share Metadata - Missing og:title Tag",
        description:
          "The Open Graph title tag (og:title) is missing. When users share the link via SMS/WhatsApp, it won't display a proper preview card title.",
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    if (metaTags.ogSiteName) {
      const siteNameLower = metaTags.ogSiteName.toLowerCase()
      if (
        siteNameLower.includes("wordpress") ||
        siteNameLower.includes("my website")
      ) {
        findings.push({
          check_factor: "text_share",
          title: "Text Share Metadata - Default Site Name",
          description: `The og:site_name contains default placeholder text "${metaTags.ogSiteName}" instead of matching the actual business name.`,
          status: "open",
          ai_generated: false,
        } as Finding)
      }
    }
  } catch (err: any) {
    logger.error(
      { error: err.message },
      "Error during text share metadata check",
    )
    // Don't swallow: returning the empty `findings` here reads as "metadata is
    // fine". Surface the failure so the check is marked incomplete, not passed.
    findings.push({
      check_factor: "text_share",
      title: "Text Share Metadata Check Failed",
      description: `The share-metadata check could not complete: ${err.message}. Process aborted gracefully; QACC will retry on the next run.`,
      context_text: "System Error",
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding)
  }

  return findings
}

/**
 * =========================================================================
 * CHECK: Callnow & Links Check
 * =========================================================================
 */
export async function checkCallnowLinks(
  url: string,
  runId: string,
  pageId: string,
  wpPassword?: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  if (!wpPassword) {
    return [
      {
        check_factor: "callnow_links",
        title: "Callnow Check Skipped - No Password",
        description:
          "The WordPress admin password was not provided. Skipping Callnow backend checks.",
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  let pluginScreenshotUrl = ""
  let settingsScreenshotUrl = ""
  let mobileScreenshotUrl = ""

  let browser
  try {
    browser = sharedBrowser || (await chromium.launch({ headless: true }))

    const adminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    if (onProgress) await onProgress(10, "Logging into WordPress admin...")

    const baseUrl = new URL(url).origin
    await adminPage
      .goto(`${baseUrl}/wp-login.php`, {
        waitUntil: "networkidle",
        timeout: 30000,
      })
      .catch(() => {})

    const userField = adminPage.locator('#user_login, input[name="log"]')
    const passField = adminPage.locator('#user_pass, input[name="pwd"]')
    const submitBtn = adminPage.locator('#wp-submit, input[type="submit"]')

    let loginOk = false
    if ((await userField.count()) > 0 && (await passField.count()) > 0) {
      await userField.fill("onboarding.india@growth99.com")
      await passField.fill(wpPassword)
      await submitBtn.click()
      // Use domcontentloaded instead of networkidle to prevent hangs from WordPress heartbeat/polling
      await adminPage.waitForLoadState("domcontentloaded", { timeout: 15000 })
      // Wait for the admin bar to signal a successful login. #wpadminbar only
      // renders for an authenticated session — the login page (bad password)
      // does NOT have it, so it's the reliable success signal (unlike ".wrap",
      // which can appear elsewhere).
      await adminPage
        .waitForSelector("#wpadminbar", { timeout: 15000 })
        .catch(() => {})
      loginOk = (await adminPage.locator("#wpadminbar").count()) > 0
    }

    // Guard against a fake report: if login failed (bad/expired password), every
    // subsequent wp-admin navigation redirects back to wp-login.php, and we'd
    // screenshot the LOGIN PAGE as a normal "Verify Call Now" card — a false
    // pass. Emit a lapse finding instead.
    if (!loginOk) {
      const loginShot = await adminPage.screenshot({ fullPage: false }).catch(() => null)
      let loginShotUrl = ""
      if (loginShot) {
        loginShotUrl = await uploadScreenshot(
          loginShot,
          `${runId}/${pageId}/callnow_login_failed.png`,
        ).catch(() => "")
      }
      await adminPage.close().catch(() => {})
      await adminContext.close().catch(() => {})
      return [
        {
          check_factor: "callnow_links",
          title: "Call Now & Links Check Failed",
          description:
            "Could not log in to WordPress admin (the admin bar never appeared — the password may be incorrect or expired). The Call Now plugin/settings checks require admin access and could not complete.",
          context_text: `URL: ${url}\nWP admin login: failed`,
          screenshot_url: loginShotUrl || null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    await adminPage
      .goto(`${baseUrl}/wp-admin/plugins.php`, {
        waitUntil: "networkidle",
        timeout: 30000,
      })
      .catch(() => {})
    const pluginRow = adminPage
      .locator(
        'tr[data-slug="call-now-button"], tr:has-text("Call Now Button")',
      )
      .first()
    if ((await pluginRow.count()) > 0) {
      if (onProgress)
        await onProgress(40, "Checking Call Now Button plugin status...")

      const buffer = await pluginRow.screenshot()
      pluginScreenshotUrl = await uploadScreenshot(
        buffer,
        `${runId}/${pageId}/callnow_plugin.png`,
      )
    } else {
      if (onProgress)
        await onProgress(40, "Call Now Button plugin not found in list...")

      const buffer = await adminPage.screenshot({ fullPage: true })
      pluginScreenshotUrl = await uploadScreenshot(
        buffer,
        `${runId}/${pageId}/callnow_plugin.png`,
      )
    }

    await adminPage
      .goto(`${baseUrl}/wp-admin/options-general.php?page=call-now-button`, {
        waitUntil: "networkidle",
        timeout: 30000,
      })
      .catch(() => {})
    const settingsBuffer = await adminPage.screenshot({ fullPage: true })
    if (onProgress) await onProgress(60, "Capturing plugin settings...")

    settingsScreenshotUrl = await uploadScreenshot(
      settingsBuffer,
      `${runId}/${pageId}/callnow_settings.png`,
    )

    await adminPage.close()
    await adminContext.close()

    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    })
    const mobilePage = await mobileContext.newPage()
    if (onProgress)
      await onProgress(80, "Verifying Call Now button on mobile view...")

    await mobilePage
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})
    await mobilePage.waitForTimeout(5000)
    const mobileBuffer = await mobilePage.screenshot({ fullPage: false })
    mobileScreenshotUrl = await uploadScreenshot(
      mobileBuffer,
      `${runId}/${pageId}/callnow_mobile.png`,
    )

    await mobilePage.close()
    await mobileContext.close()
  } catch (error: any) {
    console.error("Callnow Links check failed:", error)
    return [
      {
        check_factor: "callnow_links",
        title: "Call Now & Links Check Failed",
        description: `The check encountered an unexpected error: ${error.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } finally {
    if (browser && !sharedBrowser) {
      await browser.close()
    }
  }

  const screenshotUrls = [
    pluginScreenshotUrl,
    mobileScreenshotUrl,
    settingsScreenshotUrl,
  ]
    .filter(Boolean)
    .join(",")

  return [
    {
      check_factor: "callnow_links",
      title: "Verify Call Now Button & Links",
      description: `Please verify the Call Now plugin setup and homepage links using the evidence screenshots.`,
      screenshot_url: screenshotUrls,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 * CHECK: URL & Tab Name Comparison Check
 * =========================================================================
 * The Logic:
 * - Crawl all pages of the dev/project site and collect URL + tab title pairs.
 * - Crawl the client's live site URL and collect URL + tab title pairs.
 * - Store both sets as JSON in context_text.
 * - The Finding Card in the UI will parse this and show a side-by-side comparison.
 */
export async function checkUrlTabComparison(
  devSiteUrl: string,
  liveSiteUrl: string,
  runId: string,
  pageId: string,
  allDevUrls: string[],
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  // Path of a URL, normalised for comparison ("" -> "/", no trailing slash).
  // Falls back to the raw string so an unparseable URL still compares to itself.
  const pathOf = (u: string): string => {
    try {
      return new URL(u).pathname.replace(/\/$/, "") || "/"
    } catch {
      return u
    }
  }

  const extractTitle = (html: unknown): string =>
    cheerio.load(String(html || ""))("title").text().trim() || "(no title)"

  // Fetch titles for URLs we did NOT crawl ourselves (the run supplies dev URLs
  // without titles). Bounded fan-out rather than a serial loop — these are
  // independent 10 s-timeout requests, so serialising them was the single
  // slowest part of this check.
  async function fetchTabTitles(
    urls: string[],
    label: string,
    baseProg: number,
  ): Promise<PageInfo[]> {
    const targetUrls = urls.slice(0, MAX_TITLE_FETCHES)
    let done = 0
    const limit = pLimit(URL_COMPARE_CONCURRENCY)

    return Promise.all(
      targetUrls.map((url) =>
        limit(async () => {
          let title: string
          try {
            const response = await axios.get(url, {
              timeout: 10000,
              validateStatus: () => true,
            })
            title = extractTitle(response.data)
          } catch {
            title = "(error loading)"
          }
          done++
          if (onProgress) {
            const cur = baseProg + Math.round((done / targetUrls.length) * 20)
            await onProgress(
              cur,
              `Collecting ${label} title ${done} of ${targetUrls.length}: ${url.replace(/^https?:\/\//, "")}`,
            )
          }
          return { url, title }
        }),
      ),
    )
  }

  // Crawl a site and return each page WITH its <title>.
  //
  // The title is read from the HTML we already downloaded during the crawl.
  // Previously the crawl threw the HTML away and a second pass re-downloaded
  // every page just to read <title>, roughly doubling the request count.
  //
  // Traversal is breadth-first, one level at a time, with the level fetched
  // concurrently. `queued` is a Set: the old frontier test was
  // `!toVisit.includes(clean)`, a linear scan run for every anchor on every
  // page — O(links x frontier).
  async function crawlSite(
    baseUrl: string,
    label: string,
    baseProg: number,
  ): Promise<PageInfo[]> {
    const baseHost = new URL(baseUrl).hostname.replace(/^www\./, "")
    const queued = new Set<string>([baseUrl])
    const found: PageInfo[] = []
    let frontier: string[] = [baseUrl]
    const limit = pLimit(URL_COMPARE_CONCURRENCY)

    while (frontier.length > 0 && found.length < MAX_CRAWL_PAGES) {
      if (onProgress) {
        const cur = baseProg + Math.round((found.length / MAX_CRAWL_PAGES) * 15)
        await onProgress(
          cur,
          `Discovering ${label} URLs: found ${found.length}/${MAX_CRAWL_PAGES}`,
        )
      }

      // Never fetch more than the remaining budget.
      const batch = frontier.slice(0, MAX_CRAWL_PAGES - found.length)
      frontier = frontier.slice(batch.length)

      const fetched = await Promise.all(
        batch.map((url) =>
          limit(async () => {
            try {
              const response = await axios.get(url, {
                timeout: 10000,
                validateStatus: () => true,
              })
              return { url, html: String(response.data || "") }
            } catch {
              return { url, html: "" }
            }
          }),
        ),
      )

      const nextLevel: string[] = []
      for (const { url, html } of fetched) {
        const $ = cheerio.load(html)
        found.push({ url, title: extractTitle(html) })

        $("a[href]").each((_: any, a: any) => {
          try {
            const rawHref = $(a).attr("href")
            if (!rawHref) return

            // Automatically resolve relative URLs (e.g. "/about" -> "https://domain.com/about")
            const urlObj = new URL(rawHref, url)
            const href = urlObj.href

            if (
              urlObj.hostname.includes(baseHost) &&
              !href.includes("#") &&
              !href.match(/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|webm)$/i)
            ) {
              const clean = href.replace(/\/$/, "")
              if (!queued.has(clean)) {
                queued.add(clean)
                nextLevel.push(clean)
              }
            }
          } catch (e) {
            // skip invalid URLs
          }
        })
      }

      frontier = frontier.concat(nextLevel)
    }

    return found
  }

  let browser: any = null
  try {
    // Step 1: dev pages. URLs supplied by the run carry no titles, so those
    // still need a title pass; a self-crawl already returns them.
    const devPages: PageInfo[] =
      allDevUrls.length > 0
        ? await fetchTabTitles(allDevUrls, "dev site", 0)
        : await crawlSite(devSiteUrl, "dev site", 0)

    // Step 2: live pages — crawled with titles in the same pass.
    const livePages = await crawlSite(liveSiteUrl, "live site", 30)

    // Step 3: Build context_text as JSON string
    if (onProgress) await onProgress(90, "Analyzing discrepancies...")

    const contextData = {
      devPages,
      livePages,
    }

    // Set membership instead of `.some()` inside `.filter()` — the diff was
    // O(n x m) over two lists that can each hold 50+ pages.
    const devPaths = new Set(devPages.map((p) => pathOf(p.url)))
    const livePaths = new Set(livePages.map((p) => pathOf(p.url)))

    const missingInDev = livePages.filter((lp) => !devPaths.has(pathOf(lp.url)))
    const missingInLive = devPages.filter((dp) => !livePaths.has(pathOf(dp.url)))

    const totalMissing = missingInDev.length + missingInLive.length

    return [
      {
        check_factor: "url_tab_compare",
        title: `URL & Tab Name Comparison — ${totalMissing} discrepancies found`,
        description: `Compared ${devPages.length} dev site pages with ${livePages.length} live site pages. Found ${missingInDev.length} URLs missing in dev (present in live) and ${missingInLive.length} URLs missing in live (present in dev).`,
        context_text: JSON.stringify(contextData),
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } catch (err: any) {
    if (browser) await browser.close().catch(() => {})
    logger.error({ error: err.message }, "URL Tab Comparison check failed")
    return [
      {
        check_factor: "url_tab_compare",
        title: "URL & Tab Comparison — Check Failed",
        description: `The check encountered an unexpected error: ${err.message}. Process aborted gracefully.`,
        context_text: JSON.stringify({ devPages: [], livePages: [] }),
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}

/**
 * =========================================================================
 * CHECK: Verify Plugin Updates
 * =========================================================================
 */
export async function checkPluginUpdates(
  url: string,
  runId: string,
  pageId: string,
  wpPassword?: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  if (!wpPassword) {
    return [
      {
        check_factor: "verify_plugin_updates",
        title: "Plugins Update Check Failed",
        description: "WordPress password was not provided.",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  let screenshotUrl = ""

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const context = await browser.newContext()
    const newPage = await context.newPage()
    if (onProgress)
      await onProgress(10, "Navigating to WordPress admin login...")

    await newPage.setViewportSize({ width: 1920, height: 1080 })

    const loginUrl = url.endsWith("/")
      ? `${url}wp-login.php`
      : `${url}/wp-login.php`
    await newPage
      .goto(loginUrl, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

    // Hardcoded username as requested
    if (onProgress) await onProgress(30, "Logging into WordPress...")

    const userField = newPage.locator('#user_login, input[name="log"]')
    const passField = newPage.locator('#user_pass, input[name="pwd"]')
    const submitBtn = newPage.locator('#wp-submit, input[type="submit"]')

    let loginOk = false
    if ((await userField.count()) > 0 && (await passField.count()) > 0) {
      await userField.fill("onboarding.india@growth99.com")
      await passField.fill(wpPassword)
      await Promise.all([
        newPage
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 })
          .catch(() => {}),
        submitBtn.click(),
      ])
      // #wpadminbar only renders for an authenticated session — it's the
      // reliable login-success signal (unlike ".wrap", which can appear on
      // other pages). A bad/expired password leaves us on wp-login.php.
      await newPage
        .waitForSelector("#wpadminbar", { timeout: 15000 })
        .catch(() => {})
      loginOk = (await newPage.locator("#wpadminbar").count()) > 0
    }

    // Guard against a fake report: if login failed, plugins.php redirects to
    // wp-login.php and we'd screenshot the LOGIN PAGE as a normal "Verify
    // Plugin Updates" card — a false pass. Emit a lapse finding instead.
    if (!loginOk) {
      const loginShot = await newPage.screenshot({ fullPage: false }).catch(() => null)
      let loginShotUrl = ""
      if (loginShot) {
        loginShotUrl = await uploadScreenshot(
          loginShot,
          `${runId}/plugins_login_failed.png`,
        ).catch(() => "")
      }
      if (!sharedBrowser) await browser.close().catch(() => {})
      return [
        {
          check_factor: "verify_plugin_updates",
          title: "Verify Plugin Updates Check Failed",
          description:
            "Could not log in to WordPress admin (the admin bar never appeared — the password may be incorrect or expired). The plugin-updates check requires admin access and could not complete.",
          context_text: `URL: ${url}\nWP admin login: failed`,
          screenshot_url: loginShotUrl || null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    if (onProgress) await onProgress(60, "Navigating to Plugins page...")

    const pluginsUrl = url.endsWith("/")
      ? `${url}wp-admin/plugins.php`
      : `${url}/wp-admin/plugins.php`
    await newPage
      .goto(pluginsUrl, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

    // Wait for the plugins list to fully load
    await newPage.waitForTimeout(5000)
    if (onProgress) await onProgress(80, "Taking screenshot of plugins list...")

    const buffer = await newPage
      .screenshot({ fullPage: true })
      .catch(() => null)
    if (buffer) {
      const storagePath = `${runId}/plugins_update.png`
      screenshotUrl = await uploadScreenshot(buffer, storagePath)
    }

    if (!sharedBrowser) await browser.close()
    if (onProgress) await onProgress(90, "Finalizing findings...")
  } catch (e: any) {
    console.error("Plugins screenshot failed", e)
    return [
      {
        check_factor: "verify_plugin_updates",
        title: "Verify Plugin Updates Check Failed",
        description: `The check encountered an unexpected error: ${e.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  return [
    {
      check_factor: "verify_plugin_updates",
      title: "Verify Plugin Updates",
      description:
        "Please verify if all plugins are in updated state except All-in-Migration, Litespeed Cache, Wp-Rocket, ELEMENTOR, WOO-COMMERCE.",
      screenshot_url: screenshotUrl,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 * CHECK: Social Share Heading Check
 * =========================================================================
 */
export async function checkSocialShareHeading(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let facebookUrl = ""
  let xUrl = ""
  let linkedinUrl = ""
  let metaTagsUrl = ""

  let browser
  try {
    browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    })
    const page = await context.newPage()

    if (onProgress)
      await onProgress(10, "Navigating to social share preview tool...")

    await page.goto("https://socialsharepreview.com/", {
      waitUntil: "networkidle",
      timeout: 45000,
    })

    // Fill the URL and hit enter
    const inputLocator = page
      .locator('input[type="url"], input[type="text"]')
      .first()
    await inputLocator.fill(url)
    await inputLocator.press("Enter")
    if (onProgress) await onProgress(30, "Generating social share previews...")

    // Wait for the result to load visually
    await page.waitForTimeout(6000)

    // Capture Facebook tab
    if (onProgress) await onProgress(50, "Capturing Facebook preview...")
    const fbTab = page
      .locator('.tabs-component-tab-a:has-text("Facebook")')
      .first()
    if ((await fbTab.count()) > 0) await fbTab.click()
    await page.waitForTimeout(2000)
    const fbBuffer = await page.screenshot()
    facebookUrl = await uploadScreenshot(
      fbBuffer,
      `${runId}/${pageId}/social_fb.png`,
    )

    // Capture X tab
    if (onProgress) await onProgress(70, "Capturing X (Twitter) preview...")

    const xTab = page.locator('.tabs-component-tab-a:has-text("X")').first()
    if ((await xTab.count()) > 0) await xTab.click()
    await page.waitForTimeout(2000)
    const xBuffer = await page.screenshot()
    xUrl = await uploadScreenshot(xBuffer, `${runId}/${pageId}/social_x.png`)

    // Capture LinkedIn tab
    if (onProgress) await onProgress(90, "Capturing LinkedIn preview...")

    const lnTab = page
      .locator('.tabs-component-tab-a:has-text("LinkedIn")')
      .first()

    if ((await lnTab.count()) > 0) await lnTab.click()
    await page.waitForTimeout(2000)
    const lnBuffer = await page.screenshot()
    linkedinUrl = await uploadScreenshot(
      lnBuffer,
      `${runId}/${pageId}/social_ln.png`,
    )

    if (onProgress) await onProgress(95, "Capturing meta tags source code...")

    const codeContext = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })

    const codePage = await codeContext.newPage()
    await codePage
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

    const codeSnippet = await codePage.evaluate(() => {
      const tags = document.querySelectorAll(
        'title, meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], meta[property^="twitter:"]',
      )
      return tags.length > 0
        ? Array.from(tags)
            .map((tag) => tag.outerHTML)
            .join("\n")
        : "Meta tags not found in page source"
    })

    const renderPage = await codeContext.newPage()
    await renderPage.setContent(
      `<pre style="font-size: 14px; white-space: pre-wrap; word-wrap: break-word; padding: 20px; background: #f4f4f4;">${codeSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
    )
    const codeBuffer = await renderPage.screenshot({ fullPage: false })
    metaTagsUrl = await uploadScreenshot(
      codeBuffer,
      `${runId}/${pageId}/social_meta_tags.png`,
    )

    await codeContext.close()

    if (!sharedBrowser) await browser.close()
  } catch (err: any) {
    if (!sharedBrowser && browser) await browser.close().catch(() => null)
    console.error("Social Share Heading Check failed:", err)
    return [
      {
        check_factor: "social_share_heading",
        title: "Social Share Heading Check Failed",
        description: `The check encountered an unexpected error: ${err.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const screenshotUrls = [facebookUrl, xUrl, linkedinUrl, metaTagsUrl]
    .filter(Boolean)
    .join(",")

  return [
    {
      check_factor: "social_share_heading",
      title: "Social Share Heading Check",
      description:
        "Verify the social sharing preview headings for Facebook, X, and LinkedIn.",
      screenshot_url: screenshotUrls,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}

/**
 * =========================================================================
 * CHECK: Logo on Chatbot Check (homepage, AI-vision)
 * =========================================================================
 * The chatbot launcher is a circular toggle pinned to the bottom-right/left of
 * the homepage; it carries the client's brand logo. This check:
 *   1. loads the homepage (only) with Playwright and locates that circular
 *      toggle in a bottom corner,
 *   2. also captures the site's MAIN header logo (the reference),
 *   3. screenshots JUST the toggle and uploads a thumbnail,
 *   4. asks an AI vision model whether the toggle icon is the SAME BRAND as the
 *      header logo — allowing variations (icon/symbol only, wordmark only, or a
 *      simplified mark of the full logo). The client name is supplementary
 *      context only.
 *
 * PASS only when vision judges the toggle shows the same brand as the header
 * logo. No toggle / no logo → FAIL. A different company's logo → FAIL. Toggle
 * and header-logo thumbnails are attached in every case.
 */
export async function checkLogoOnChatbot(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
  projectId?: string,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const sharp = require("sharp")
  const { uploadScreenshot } = require("../lib/supabaseStorage")
  const { describeImageResult } = require("../lib/aiFallback")
  const { supabase } = require("../lib/supabase")

  const CHECK_FACTOR = "logo_chatbot"
  // Circular launcher toggles vary per embed; cover the Growth99 ids/classes
  // plus generic "chat/bot launcher/widget/button" hooks.
  const LAUNCHER_SELECTOR =
    "#g99-chatbot-launcher, .g99-chatbot-launcher, #g99-chatbot-button, #cliffhanger-button, [class*='chatbot-launcher'], #chatbot-icon-div-tracker, .chat-bot-icon, [class*='chat'][class*='launcher'], [id*='chat'][id*='launcher'], [class*='chatbot'], [id*='chatbot'], [aria-label*='chat' i]"

  // Resolve the client's name so vision can judge "is this THAT client's logo".
  let clientName = ""
  if (projectId) {
    try {
      const { data: project } = await supabase
        .from("projects")
        .select("name")
        .eq("id", projectId)
        .single()
      clientName = project?.name || ""
    } catch {}
  }

  // Shrink any buffer to a thumbnail (attached in every outcome).
  const thumb = async (buf: Buffer, name: string): Promise<string> => {
    try {
      const t = await sharp(buf)
        .resize({ width: 240, height: 240, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer()
      return await uploadScreenshot(t, `${runId}/${pageId}/${name}.png`).catch(() => "")
    } catch {
      return ""
    }
  }

  let browser: any = null
  let context: any = null
  try {
    browser = sharedBrowser || (await chromium.launch({ headless: true }))
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })
    const page = await context.newPage()

    if (onProgress) await onProgress(10, "Loading homepage for chatbot logo check...")
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {})
    // Let a lazily-injected launcher mount.
    await page.waitForTimeout(6000)

    if (onProgress) await onProgress(40, "Locating the chatbot toggle...")
    const launcher = page.locator(LAUNCHER_SELECTOR).first()
    const found = await launcher
      .waitFor({ state: "visible", timeout: 12000 })
      .then(() => true)
      .catch(() => false)

    // No toggle → FAIL, with a bottom-corner homepage thumbnail as evidence.
    if (!found) {
      const hp = await page.screenshot({ fullPage: false }).catch(() => null)
      const shot = hp ? await thumb(hp, "logo_chatbot_none") : ""
      return [
        {
          check_factor: CHECK_FACTOR,
          title: "No chatbot logo found",
          description:
            "No chatbot toggle was found in the bottom corner of the homepage, so the client's logo could not be verified on it.",
          context_text: `Homepage: ${url}\nChatbot toggle: not found`,
          screenshot_url: shot || null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    if (onProgress) await onProgress(60, "Capturing the chatbot toggle...")
    await launcher.scrollIntoViewIfNeeded().catch(() => {})
    const iconBuf: Buffer | null = await launcher.screenshot().catch(() => null)
    const iconShot = iconBuf ? await thumb(iconBuf, "logo_chatbot_icon") : ""

    if (!iconBuf) {
      return [
        {
          check_factor: CHECK_FACTOR,
          title: "Logo on Chatbot Check Failed",
          description:
            "The chatbot toggle was located but its screenshot could not be captured. Process aborted gracefully; QACC will retry on the next run.",
          context_text: "System Error (toggle capture)",
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    // Capture the site's MAIN header logo as the reference to compare against.
    // Ordered specific → generic; first selector with a visible match wins so a
    // hero/nav image doesn't get mistaken for the logo.
    if (onProgress) await onProgress(70, "Capturing the header logo (reference)...")
    const HEADER_LOGO_SELECTORS = [
      ".custom-logo",
      ".wp-block-site-logo img",
      "header a[href='/'] img, header a[href$='/'] img",
      "[role='banner'] img[alt*='logo' i], header img[alt*='logo' i]",
      "img[class*='logo' i], [class*='logo' i] img",
      "header img, [role='banner'] img, .site-header img, #masthead img, nav img",
    ]
    let headerBuf: Buffer | null = null
    for (const sel of HEADER_LOGO_SELECTORS) {
      const loc = page.locator(sel).first()
      const vis = await loc.isVisible().catch(() => false)
      if (!vis) continue
      headerBuf = await loc.screenshot().catch(() => null)
      if (headerBuf) break
    }
    const headerShot = headerBuf ? await thumb(headerBuf, "logo_chatbot_header") : ""

    if (onProgress) await onProgress(85, "Comparing chatbot logo to the header logo (AI vision)...")
    // Prefer the two-image comparison (header logo vs toggle); fall back to a
    // name-based judgment when the header logo couldn't be captured.
    const buffers: Buffer[] = headerBuf ? [headerBuf, iconBuf] : [iconBuf]
    const nameCtx = clientName ? ` The business is "${clientName}".` : ""
    const prompt = headerBuf
      ? `Image 1 is a website's MAIN header logo. Image 2 is the circular chatbot toggle icon from the same site.${nameCtx} Do they represent the SAME brand? The chatbot icon may be a VARIATION of the main logo — the symbol/icon alone, the wordmark alone, or a simplified mark — and that still counts as a match. It is NOT a match if image 2 is a generic chat/speech-bubble icon, empty, or a DIFFERENT company's logo. Answer on the FIRST line with exactly MATCH or NO_MATCH, then a second line with a one-sentence reason.`
      : `This is the circular chatbot toggle from a website's homepage.${nameCtx} Does it show the website owner's own brand logo/mark (or a variation of it — icon or wordmark alone), as opposed to no logo, a generic chat/speech-bubble icon, or a different company's logo? Answer on the FIRST line with exactly MATCH or NO_MATCH, then a second line with a one-sentence reason.`

    const vision = await describeImageResult(buffers, prompt)
    const verdictRaw = vision.text || ""
    const shots = [iconShot, headerShot].filter(Boolean).join(",")
    const refNote = headerBuf ? "" : " (header logo could not be captured — judged from the toggle alone)"

    // Vision unavailable (no key, or every provider/key errored) → we CANNOT
    // verify the logo, so we must NOT pass and must NOT invent a "does not match"
    // verdict. Report it as a failed check needing manual review, with the
    // captured screenshots as evidence. The full provider error is already in the
    // worker log (describeImageResult logs it); a short reason rides along here.
    if (!vision.ok) {
      return [
        {
          check_factor: CHECK_FACTOR,
          title: "Chatbot logo not verified — AI vision unavailable",
          description:
            "The chatbot logo could not be verified because the AI vision service returned no result. Marked as failed for manual review — confirm the chatbot toggle shows the client's own brand logo (see the evidence screenshot).",
          context_text: `AI vision unavailable: ${(vision.error || "no result").slice(0, 300)}${refNote}`,
          screenshot_url: shots || iconShot || null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    const isMatch = /\bMATCH\b/i.test(verdictRaw) && !/\bNO[_\s-]?MATCH\b/i.test(verdictRaw)
    const reason = verdictRaw.replace(/\s+/g, " ").trim().slice(0, 400)

    if (isMatch) {
      return [
        {
          check_factor: CHECK_FACTOR,
          title: "Chatbot logo matches the site logo",
          description: `No issues found. AI vision confirmed the chatbot toggle shows the same brand as the site's header logo${headerBuf ? " (a variation is allowed)" : ""}.`,
          context_text: `AI vision: ${reason || "match"}${refNote}`,
          screenshot_url: shots || iconShot || null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Chatbot logo does not match the site logo",
        description: `The chatbot toggle is not the same brand as the site's header logo (it appears to be missing, a generic chat icon, or a different company's logo). Replace it with the client's brand logo.`,
        context_text: `AI vision: ${reason || "no match"}${refNote}`,
        screenshot_url: shots || iconShot || null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } catch (e: any) {
    console.error("Logo on chatbot check failed", e)
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Logo on Chatbot Check Failed",
        description: `The check encountered an unexpected error: ${e.message}. Process aborted gracefully.`,
        context_text: "System Error",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } finally {
    try {
      if (context) await context.close().catch(() => {})
      if (browser && !sharedBrowser) await browser.close().catch(() => {})
    } catch {}
  }
}
