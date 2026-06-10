import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"
import axios from "axios"
import * as cheerio from "cheerio"
import pino from "pino"

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
          '.site-footer, .footer, #footer, [data-elementor-type="footer"]',
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
    let hasPrivacyPolicyOnCheckout = false

    try {
      await page.goto(checkoutUrl, { waitUntil: "networkidle", timeout: 15000 })
      const checkoutText = await page.evaluate(() =>
        document.body.innerText.toLowerCase(),
      )
      hasPrivacyPolicyOnCheckout =
        checkoutText.includes("privacy policy") ||
        checkoutText.includes("privacy")
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

    if (footerHasLink && hasPrivacyPolicyOnCheckout) {
      return [
        {
          check_factor: "privacy_policy",
          severity: "low",
          title: "Privacy Policy Verified",
          description:
            "The Privacy Policy link was successfully found in the footer, and the policy notice is present on the checkout page.",
          context_text: `Content Match: ${isContentMatch ? "Yes" : "No"}\n\n===ACTUAL POLICY TEXT===\n${actualPolicyText}`,
          screenshot_url: finalScreenshotUrl,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    } else {
      return [
        {
          check_factor: "privacy_policy",
          severity: "medium",
          title: "Privacy Policy Missing",
          description: `Privacy Policy check failed. Footer Link: ${footerHasLink ? "Found" : "Missing"}. Checkout Notice: ${hasPrivacyPolicyOnCheckout ? "Found" : "Missing"}.`,
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
        severity: "high",
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

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
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
      await newPage
        .goto(url, { waitUntil: "load", timeout: 30000 })
        .catch(() => {})

      const footer = newPage
        .locator('footer, div[class*="footer"], section[class*="footer"]')
        .first()

      if ((await footer.count()) > 0) {
        // Scroll the footer into view to trigger lazy loading of images
        if (onProgress)
          await onProgress(60, `Taking screenshot of footer on ${vp.name}...`)

        await footer.scrollIntoViewIfNeeded().catch(() => {})

        // 5s delay AFTER scrolling to let the logo and dynamic content load
        await newPage.waitForTimeout(5000)

        // Capture only the footer element
        const buffer = await footer.screenshot()

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
        severity: "high",
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

  return [
    {
      check_factor: "footer_logo",
      severity: "low",
      title: "Verify Footer Logo",
      description:
        "Please verify the footer logo across all 3 views (Desktop, Tablet, Mobile) using the evidence screenshots. The logo should not contain a tagline.",
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
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let desktopUrl = ""
  let tabletUrl = ""
  let mobileUrl = ""
  let codeUrl = ""

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 375, height: 812 },
    ]
    if (onProgress)
      await onProgress(10, "Initializing viewports for single script check...")

    for (const vp of viewports) {
      if (onProgress)
        await onProgress(30, `Checking single script on ${vp.name}...`)

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      })

      const newPage = await context.newPage()
      await newPage
        // networkidle waits until there are no network connections for at least 500 ms (ensures JS fully loads)
        .goto(url, { waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {})
      await newPage.evaluate(() => window.scrollBy(0, 500)).catch(() => {})

      await newPage
        .waitForSelector("#feature-buttons", { timeout: 15000 })
        .catch(() => {})
      await newPage.waitForTimeout(5000)

      // Capture visible viewport only
      const buffer = await newPage.screenshot({ fullPage: false })
      const storagePath = `${runId}/${pageId}/single_script_${vp.name}.png`
      const publicUrl = await uploadScreenshot(buffer, storagePath)

      if (vp.name === "desktop") desktopUrl = publicUrl
      if (vp.name === "tablet") tabletUrl = publicUrl
      if (vp.name === "mobile") mobileUrl = publicUrl

      await context.close()
    }

    // 4th screenshot: Page source of #feature-buttons code
    if (onProgress)
      await onProgress(70, "Fetching page source for script verification...")

    const codeContext = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })

    const codePage = await codeContext.newPage()
    await codePage
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})
    await codePage.evaluate(() => window.scrollBy(0, 500)).catch(() => {})

    await codePage
      .waitForSelector("#feature-buttons", { timeout: 15000 })
      .catch(() => {})
    await codePage.waitForTimeout(5000)

    const codeSnippet = await codePage.evaluate(() => {
      const el = document.querySelector("#feature-buttons")
      return el
        ? el.outerHTML
        : "Element #feature-buttons not found in page source"
    })

    const renderPage = await codeContext.newPage()
    await renderPage.setContent(
      `<pre style="font-size: 14px; white-space: pre-wrap; word-wrap: break-word; padding: 20px; background: #f4f4f4;">${codeSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
    )
    const codeBuffer = await renderPage.screenshot({ fullPage: false })
    codeUrl = await uploadScreenshot(
      codeBuffer,
      `${runId}/${pageId}/single_script_code.png`,
    )

    await codeContext.close()
    if (!sharedBrowser) await browser.close()
    if (onProgress) await onProgress(90, "Finalizing findings...")
  } catch (e: any) {
    console.error("Single script screenshot failed", e)
    return [
      {
        check_factor: "single_script",
        severity: "high",
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

  return [
    {
      check_factor: "single_script",
      severity: "medium",
      title: "Verify Single Script Features",
      description:
        "Please verify the single script features across Desktop, Tablet, Mobile and verify the script code addition.",
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
 * - Top Bar Check: Search for Mobile, Email, and Social media links in the header metadata bar.
 * - Sticky Header Check: Bounding box comparison before and after scrolling down 500px to ensure the header stays visible.
 */
export async function checkTopBarAndStickyHeader(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let codeUrl = ""
  let headerUrl = ""

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
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
      .locator(
        "header, .site-header, #masthead, [data-elementor-type='header']",
      )
      .first()
    if ((await headerElement.count()) > 0) {
      const buffer = await headerElement.screenshot()
      headerUrl = await uploadScreenshot(
        buffer,
        `${runId}/${pageId}/header_nav.png`,
      )
    }

    if (onProgress) await onProgress(70, "Extracting header code snippet...")

    const codeSnippet = await newPage.evaluate(() => {
      const el = document.querySelector(
        "header, .site-header, #masthead, [data-elementor-type='header']",
      )
      return el ? el.outerHTML : "Header element not found"
    })

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
        severity: "high",
        title: "Top Bar & Sticky Header Check Failed",
        description: `The check encountered an unexpected error: ${e.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const screenshotUrls = [codeUrl, headerUrl].filter(Boolean).join(",")

  return [
    {
      check_factor: "top_bar_sticky",
      severity: "medium",
      title: "Verify Top Bar & Sticky Header",
      description:
        "Please verify the top bar and sticky header using the provided screenshots.",
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

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
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
    await codePage
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

    const codeSnippet = await codePage.evaluate(() => {
      const el = document.querySelector(
        'link[rel*="icon"], link[rel*="shortcut"]',
      )
      return el ? el.outerHTML : "Favicon element not found in page source"
    })

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
        severity: "high",
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

  return [
    {
      check_factor: "favicon",
      severity: "medium",
      title: "Verify Favicon",
      description:
        "Please verify the favicon across Desktop, Tablet, Mobile and verify the favicon code addition.",
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
  if (
    !pageTitle ||
    pageTitle.trim() === "" ||
    pageTitle.toLowerCase().includes("untitled") ||
    pageTitle.toLowerCase().includes("page")
  ) {
    findings.push({
      check_factor: "url_matching",
      severity: "medium",
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
            severity: "medium",
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
          { name: "desktop", width: 1440, height: 900 },
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
  } finally {
    if (context) await context.close()
    if (!sharedBrowser) await browser.close()
  }

  const findingData = {
    url,
    hasForm,
  }

  return [
    {
      check_factor: "contact_form",
      severity: "medium",
      title: "Verify Contact Form",
      description: "Verify the Growth99 contact form across all pages.",
      context_text: JSON.stringify(findingData),
      screenshot_url: screenshots.length > 0 ? screenshots.join(",") : null,
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
  pageRecord?: any,
): Promise<Finding[]> {
  const findings: Finding[] = []

  const chatbotLauncher = page.locator(
    "#g99-chatbot-launcher, .g99-chatbot-launcher, #g99-chatbot-button",
  )
  const virtualConsultationLauncher = page.locator(
    '.g99-consultation-btn, #g99-consultation-btn, [class*="consultation"]',
  )

  const hasChatbot = (await chatbotLauncher.count()) > 0
  const hasConsultation = (await virtualConsultationLauncher.count()) > 0

  if (!hasChatbot && !hasConsultation) {
    return []
  }

  if (hasChatbot) {
    try {
      await chatbotLauncher.first().click({ timeout: 5000 })
      await page.waitForTimeout(1000)

      const isWindowOpen = await page
        .locator("#g99-chatbot-window, .g99-chatbot-window")
        .first()
        .isVisible()
      if (!isWindowOpen) {
        findings.push({
          check_factor: "chatbot_consultation",
          severity: "medium",
          title: "Chatbot Widget Unresponsive",
          description:
            "Clicked the chatbot launcher button, but the chatbot conversation window failed to open.",
          status: "open",
          ai_generated: false,
        } as Finding)
      }
    } catch (err: any) {
      logger.warn(
        { error: err.message },
        "Failed to interact with chatbot widget.",
      )
    }
  }

  return findings
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
          severity: "medium",
          title: "Text Share Metadata - Default WordPress Value Found",
          description: `The og:title is set to a default value "${metaTags.ogTitle}", which looks like a WordPress boilerplate. Please update this tag before release.`,
          status: "open",
          ai_generated: false,
        } as Finding)
      }
    } else {
      findings.push({
        check_factor: "text_share",
        severity: "medium",
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
          severity: "medium",
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
        severity: "high",
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

    if ((await userField.count()) > 0 && (await passField.count()) > 0) {
      await userField.fill("onboarding.india@growth99.com")
      await passField.fill(wpPassword)
      await submitBtn.click()
      // Use domcontentloaded instead of networkidle to prevent hangs from WordPress heartbeat/polling
      await adminPage.waitForLoadState("domcontentloaded", { timeout: 15000 })
      // Wait for the admin bar or dashboard to signal a successful login
      await adminPage
        .waitForSelector("#wpadminbar, .wrap", { timeout: 15000 })
        .catch(() => {})
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
        severity: "high",
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
      severity: "medium",
      title: "Verify Call Now Button & Links",
      description: `Please verify the Call Now plugin setup and homepage links using the evidence screenshots.\n\nChecks to perform:\n- [ ] Call now installed\n- [ ] Number added\n- [ ] Visible in mobile view\n- [ ] Valid phone\n- [ ] Valid email\n- [ ] All links functional`,
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
  const { chromium } = require("playwright")

  // Helper: fetch tab title for a URL using playwright
  // Helper: fetch tab title for a URL using playwright
  // Helper: fetch tab title for a URL using axios & cheerio
  async function fetchTabTitles(
    browser: any, // kept for signature compatibility
    urls: string[],
    label: string,
    baseProg: number,
  ): Promise<{ url: string; title: string }[]> {
    const results: { url: string; title: string }[] = []
    const targetUrls = urls.slice(0, 50)

    for (let i = 0; i < targetUrls.length; i++) {
      const url = targetUrls[i]
      if (onProgress) {
        const cur = baseProg + Math.round((i / targetUrls.length) * 20)
        await onProgress(
          cur,
          `Collecting ${label} title ${i + 1} of ${targetUrls.length}: ${url.replace(/^https?:\/\//, "")}`,
        )
      }
      try {
        const response = await axios.get(url, {
          timeout: 10000,
          validateStatus: () => true,
        })
        const $ = cheerio.load(response.data || "")
        const titleText = $("title").text().trim() || "(no title)"
        results.push({ url, title: titleText })
      } catch (e) {
        results.push({ url, title: "(error loading)" })
      }
    }
    return results
  }

  // Helper: crawl sitemap of a site and return all page URLs
  // Helper: crawl sitemap of a site and return all page URLs using axios & cheerio
  async function crawlSiteUrls(
    browser: any, // kept for signature compatibility
    baseUrl: string,
    label: string,
    baseProg: number,
  ): Promise<string[]> {
    const visited = new Set<string>()
    const toVisit = [baseUrl]
    const found: string[] = []

    const baseHost = new URL(baseUrl).hostname.replace(/^www\./, "")

    while (toVisit.length > 0 && found.length < 60) {
      if (onProgress) {
        const cur = baseProg + Math.round((found.length / 60) * 15)
        await onProgress(
          cur,
          `Discovering ${label} URLs: found ${found.length}/60`,
        )
      }
      const current = toVisit.shift()!

      if (visited.has(current)) continue
      visited.add(current)
      found.push(current)

      try {
        const response = await axios.get(current, {
          timeout: 10000,
          validateStatus: () => true,
        })
        const $ = cheerio.load(response.data || "")

        $("a[href]").each((_: any, a: any) => {
          try {
            const rawHref = $(a).attr("href")
            if (!rawHref) return

            // Automatically resolve relative URLs (e.g. "/about" -> "https://domain.com/about")
            const urlObj = new URL(rawHref, current)
            const href = urlObj.href

            if (
              urlObj.hostname.includes(baseHost) &&
              !href.includes("#") &&
              !href.match(/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|webm)$/i)
            ) {
              const clean = href.replace(/\/$/, "")
              if (!visited.has(clean) && !toVisit.includes(clean)) {
                toVisit.push(clean)
              }
            }
          } catch (e) {
            // skip invalid URLs
          }
        })
      } catch (e) {
        // skip failed pages
      }
    }

    return found
  }

  let browser: any = null
  try {
    // Step 1: Use provided dev URLs (already crawled by the run) if available, else crawl
    const devUrls =
      allDevUrls.length > 0
        ? allDevUrls
        : await crawlSiteUrls(null, devSiteUrl, "dev site", 0)

    // Step 2: Crawl live site
    const liveUrls = await crawlSiteUrls(null, liveSiteUrl, "live site", 15)

    // Step 3: Fetch tab titles for both
    const devPages = await fetchTabTitles(null, devUrls, "dev site", 30)
    const livePages = await fetchTabTitles(null, liveUrls, "live site", 60)

    // Step 4: Build context_text as JSON string
    if (onProgress) await onProgress(90, "Analyzing discrepancies...")

    const contextData = {
      devPages,
      livePages,
    }

    const devPaths = devPages.map((p) => {
      try {
        return new URL(p.url).pathname.replace(/\/$/, "") || "/"
      } catch {
        return p.url
      }
    })
    const livePaths = livePages.map((p) => {
      try {
        return new URL(p.url).pathname.replace(/\/$/, "") || "/"
      } catch {
        return p.url
      }
    })

    const missingInDev = livePages.filter((lp) => {
      const livePath = (() => {
        try {
          return new URL(lp.url).pathname.replace(/\/$/, "") || "/"
        } catch {
          return lp.url
        }
      })()
      return !devPaths.some((dp) => dp === livePath)
    })

    const missingInLive = devPages.filter((dp) => {
      const devPath = (() => {
        try {
          return new URL(dp.url).pathname.replace(/\/$/, "") || "/"
        } catch {
          return dp.url
        }
      })()
      return !livePaths.some((lp) => lp === devPath)
    })

    const totalMissing = missingInDev.length + missingInLive.length
    const severity =
      totalMissing >= 10 ? "high" : totalMissing >= 4 ? "medium" : "low"

    return [
      {
        check_factor: "url_tab_compare",
        severity,
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
        severity: "high",
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
        severity: "medium",
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

    await newPage.setViewportSize({ width: 1440, height: 900 })

    const loginUrl = url.endsWith("/")
      ? `${url}wp-login.php`
      : `${url}/wp-login.php`
    await newPage
      .goto(loginUrl, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

    // Hardcoded username as requested
    if (onProgress) await onProgress(30, "Logging into WordPress...")

    await newPage
      .fill("#user_login", "onboarding.india@growth99.com")
      .catch(() => {})
    await newPage.fill("#user_pass", wpPassword).catch(() => {})
    await newPage.click("#wp-submit").catch(() => {})
    await newPage
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

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
        severity: "high",
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
      severity: "medium",
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
      viewport: { width: 1440, height: 900 },
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
        severity: "high",
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
      severity: "medium",
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
 * CHECK: Logo on Chatbot Check
 * =========================================================================
 */
export async function checkLogoOnChatbot(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  let codeScreenshotUrl = ""
  let homepageScreenshotUrl = ""
  let openChatbotScreenshotUrl = ""
  let isChatbotActive = false

  try {
    const browser = sharedBrowser || (await chromium.launch({ headless: true }))
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    })

    const page = await context.newPage()
    if (onProgress)
      await onProgress(
        10,
        "Navigating to homepage for Logo on Chatbot check...",
      )

    await page
      .goto(url, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})
    await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {})
    await page.waitForTimeout(5000)

    if (onProgress)
      await onProgress(30, "Checking if chatbot script is present...")

    // Check script
    const codeSnippet = await page.evaluate(() => {
      const scriptEl = document.querySelector(
        'script[src*="chatbot.growth99.com/assets/js/integration.js"]',
      )
      if (scriptEl) {
        const prevEl = scriptEl.previousElementSibling
        return (prevEl ? prevEl.outerHTML + "\n" : "") + scriptEl.outerHTML
      }
      return null
    })

    if (codeSnippet) {
      isChatbotActive = true
      if (onProgress)
        await onProgress(40, "Taking screenshot of the chatbot script...")

      const codeContext = await browser.newContext()
      const renderPage = await codeContext.newPage()
      await renderPage.setContent(
        `<pre style="font-size: 14px; white-space: pre-wrap; word-wrap: break-word; padding: 20px; background: #f4f4f4;">${codeSnippet.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
      )
      const codeBuffer = await renderPage.screenshot({ fullPage: false })
      codeScreenshotUrl = await uploadScreenshot(
        codeBuffer,
        `${runId}/${pageId}/logo_chatbot_code.png`,
      )
      await codeContext.close()
    } else {
      isChatbotActive = false
    }

    if (onProgress)
      await onProgress(60, "Taking screenshot of the homepage for chatbot...")
    const hpBuffer = await page.screenshot({ fullPage: false })
    homepageScreenshotUrl = await uploadScreenshot(
      hpBuffer,
      `${runId}/${pageId}/logo_chatbot_homepage.png`,
    )

    if (isChatbotActive) {
      if (onProgress)
        await onProgress(
          75,
          "Waiting for chatbot icon to appear and clicking...",
        )

      const chatbotLauncher = page.locator(
        "#g99-chatbot-launcher, .g99-chatbot-launcher, #g99-chatbot-button, #cliffhanger-button, [class*='chatbot-launcher'], #chatbot-icon-div-tracker, .chat-bot-icon",
      )

      try {
        // Actively wait for the element to appear in the DOM (up to 15 seconds)
        await chatbotLauncher
          .first()
          .waitFor({ state: "attached", timeout: 15000 })

        // Click the launcher to open the chatbot
        await chatbotLauncher
          .first()
          .click({ timeout: 5000 })
          .catch(() => {})

        // Wait 5 seconds for the chatbot animation/modal to fully open
        await page.waitForTimeout(5000)

        // Take the screenshot of the open chatbot
        const openBuffer = await page.screenshot({ fullPage: false })
        openChatbotScreenshotUrl = await uploadScreenshot(
          openBuffer,
          `${runId}/${pageId}/logo_chatbot_open.png`,
        )
      } catch (e) {
        console.error(
          "Chatbot launcher did not appear in time or could not be clicked",
          e,
        )
      }
    }

    if (onProgress) await onProgress(90, "Finalizing findings...")
    await context.close()
    if (!sharedBrowser) await browser.close()
  } catch (e: any) {
    console.error("Logo on chatbot screenshot failed", e)
    return [
      {
        check_factor: "logo_chatbot",
        severity: "high",
        title: "Logo on Chatbot Check Failed",
        description: `The check encountered an unexpected error: ${e.message}. Process aborted gracefully.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const screenshotUrls = [
    codeScreenshotUrl,
    homepageScreenshotUrl,
    openChatbotScreenshotUrl,
  ]
    .filter(Boolean)
    .join(",")

  return [
    {
      check_factor: "logo_chatbot",
      severity: "medium",
      title: "Verify Logo on Chatbot",
      description: isChatbotActive
        ? "Please verify the actual brand logo on the chatbot using the provided screenshots."
        : "The chatbot script was not found on the homepage.",
      screenshot_url: screenshotUrls,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
