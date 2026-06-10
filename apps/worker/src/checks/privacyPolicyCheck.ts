import { chromium } from "playwright"
import { Finding } from "@qacc/shared"
import sharp from "sharp"
import { uploadScreenshot } from "../lib/supabaseStorage"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

export async function checkPrivacyPolicy(
  siteUrl: string,
  runId: string,
  pageId?: string,
  browserObj?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  logger.info({ siteUrl }, "Starting general Privacy Policy check")

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  })

  let screenshotUrl = ""
  let checkoutScreenshotUrl = ""

  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.setViewportSize({ width: 1920, height: 1080 })
    if (onProgress)
      await onProgress(10, "Navigating to homepage to check footer...")

    // 1. Check Homepage Footer
    logger.info({ siteUrl }, "Navigating to homepage to check footer")
    await page.goto(siteUrl, { waitUntil: "networkidle", timeout: 25000 })

    let footerHasLink = false
    let footerElement = page.locator("footer").first()
    if ((await footerElement.count()) === 0) {
      // Strict fallback for sites without a footer tag
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
        // Take screenshot of the footer
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
      // Fallback full page screenshot if missing
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

    const checkoutUrl = siteUrl.endsWith("/")
      ? `${siteUrl}checkout`
      : `${siteUrl}/checkout`
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
      logger.warn("Checkout page not accessible or failed to load")
    }

    // 3. Check Full Privacy Policy Page
    if (onProgress)
      await onProgress(70, "Scanning full Privacy Policy content...")

    const policyUrl = siteUrl.endsWith("/")
      ? `${siteUrl}privacy-policy`
      : `${siteUrl}/privacy-policy`

    let fullPolicyScreenshotUrl = ""
    let isContentMatch = false
    let actualPolicyText = ""
    try {
      logger.info(
        { siteUrl },
        "Navigating to privacy policy page for full screenshot",
      )
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
   
   12.2. [Address]
   `

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
      logger.warn("Privacy policy page not accessible or failed to load")
    }

    await browser.close()

    // Combine URLs for the UI thumbnails
    if (onProgress) await onProgress(90, "Finalizing findings...")

    const finalScreenshotUrl = [screenshotUrl, fullPolicyScreenshotUrl]
      .filter(Boolean)
      .join(",")

    // 3. Generate the General Finding
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
    logger.error({ error: err.message }, "Error during privacy policy check")
    await browser.close().catch(() => null)
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
