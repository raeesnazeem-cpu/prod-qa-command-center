import { chromium } from "playwright"
import { Finding } from "@qacc/shared"
import sharp from "sharp"
import { uploadScreenshot } from "../lib/supabaseStorage"
import { PRIVACY_TEMPLATE } from "../lib/privacyTemplate"
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
          '[role="contentinfo"], .wp-block-template-part[class*="footer"], .site-footer, .footer, #footer, .wp-block-group[class*="footer"]',
        )
        .first()
    }

    // Accept any privacy-policy WORDING (Privacy Policy / Privacy Notice /
    // Privacy Statement / Data Privacy / bare "Privacy") but NOT Terms &
    // Conditions. `has-text("Privacy")` covers the wordings and never matches a
    // Terms link; we still capture the actual href so we can open the real page
    // at whatever slug the client used (not just /privacy-policy).
    let privacyHref = ""
    if ((await footerElement.count()) > 0) {
      const privacyLinks = footerElement.locator(
        'a:has-text("Privacy Policy"), a:has-text("Privacy Notice"), a:has-text("Privacy Statement"), a:has-text("Data Privacy"), a:has-text("Privacy")',
      )
      if ((await privacyLinks.count()) > 0) {
        footerHasLink = true
        privacyHref = (await privacyLinks.first().getAttribute("href").catch(() => "")) || ""
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
    // A checkout privacy notice only applies to WooCommerce (ecommerce) sites.
    // Non-ecommerce sites have no /checkout — requiring a notice there would
    // fabricate a "Privacy Policy Missing" defect on every brochure site.
    // So we gate on the presence of a REAL WooCommerce checkout element (WP
    // often soft-404s /checkout with a 200 + theme 404 template, so status
    // alone is not enough), and scope the notice to WooCommerce's dedicated
    // .woocommerce-privacy-policy-text element rather than a bare "privacy"
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
          // Presence-only: if a WooCommerce checkout is present, the privacy
          // notice element must EXIST. Its wording/content is NOT validated.
          const privacyEl = document.querySelector(
            ".woocommerce-privacy-policy-text, .wc-block-checkout__terms, .wc-block-components-checkout-policies, .wc-block-checkout__terms-and-conditions",
          )
          return {
            hasCheckoutForm,
            hasPrivacyNotice: !!privacyEl,
          }
        })
        checkoutExists = checkoutInfo.hasCheckoutForm
        hasPrivacyPolicyOnCheckout = checkoutInfo.hasPrivacyNotice
      }
    } catch (e) {
      logger.warn("Checkout page not accessible or failed to load")
    }

    // 3. Check Full Privacy Policy Page
    if (onProgress)
      await onProgress(70, "Scanning full Privacy Policy content...")

    // Resolve the privacy page across all common WORDINGS/slugs — the client's
    // page may live at /privacy, /privacy-notice, etc. Prefer the actual footer
    // link's href, then fall back to the common slugs. We stop at the first
    // candidate that has real content.
    const baseUrl = siteUrl.replace(/\/$/, "")
    const candidateUrls: string[] = []
    const pushUrl = (u: string) => {
      try {
        const abs = new URL(u, `${baseUrl}/`).toString()
        if (!candidateUrls.includes(abs)) candidateUrls.push(abs)
      } catch {}
    }
    if (privacyHref) pushUrl(privacyHref)
    for (const slug of [
      "privacy-policy",
      "privacy",
      "privacy-notice",
      "privacy-statement",
      "data-privacy",
      "privacy-policy-2",
    ])
      pushUrl(`${baseUrl}/${slug}`)

    let fullPolicyScreenshotUrl = ""
    let isContentMatch = false
    let actualPolicyText = ""
    let policyUrl = candidateUrls[0] || `${baseUrl}/privacy-policy`
    // Whether the privacy page actually exists AND carries real policy content
    // (not a 404, not an empty/near-empty page). A footer link that points to a
    // blank page is still a failure — the client has no usable policy.
    let policyHasContent = false

    const normalizeStr = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()
    const templateStr = PRIVACY_TEMPLATE
    const regexPattern = normalizeStr(templateStr)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\[.*?\\\]/g, ".*?")
      .replace(/<<.*?>>/g, ".*?")

    for (const url of candidateUrls) {
      try {
        const policyResp = await page.goto(url, {
          waitUntil: "networkidle",
          timeout: 15000,
        })
        const policyStatus = policyResp ? policyResp.status() : 0

        // Measure the page's MAIN content region (not header/footer chrome), so
        // a page that only renders site navigation counts as empty.
        const mainText = await page.evaluate(() => {
          const el = document.querySelector(
            "main, article, .entry-content, .wp-block-post-content, .site-main",
          )
          return (el as HTMLElement)?.innerText || document.body.innerText || ""
        })
        const contentLen = mainText.replace(/\s+/g, " ").trim().length
        const thisHasContent =
          policyStatus >= 200 && policyStatus < 400 && contentLen >= 200

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

        // Remember this attempt; a later candidate with content will overwrite.
        if (thisHasContent || !actualPolicyText) {
          policyUrl = url
          actualPolicyText = policyText
          isContentMatch = new RegExp(regexPattern, "i").test(normalizeStr(policyText))
          const screenshotBuffer = await page.screenshot({ fullPage: true }).catch(() => null)
          if (screenshotBuffer) {
            const compressed = await sharp(screenshotBuffer).jpeg({ quality: 85 }).toBuffer()
            const storagePath = `evidence/privacy_policy/${runId}-full-policy-${Date.now()}.jpg`
            fullPolicyScreenshotUrl = await uploadScreenshot(compressed, storagePath, {
              bucket: "evidence",
              isPublic: true,
            }).catch(() => "")
          }
        }
        if (thisHasContent) {
          policyHasContent = true
          break // found a real policy page — stop probing other slugs
        }
      } catch (e) {
        logger.warn({ url }, "Privacy policy candidate not accessible")
      }
    }

    await browser.close()

    // Combine URLs for the UI thumbnails
    if (onProgress) await onProgress(90, "Finalizing findings...")

    const finalScreenshotUrl = [screenshotUrl, fullPolicyScreenshotUrl]
      .filter(Boolean)
      .join(",")

    // 3. Generate the General Finding.
    // The checkout notice is only REQUIRED when the site actually has a
    // WooCommerce checkout. Brochure/non-ecommerce sites pass on the footer
    // link alone (they have no checkout to carry a notice).
    const checkoutRequirementMet = !checkoutExists || hasPrivacyPolicyOnCheckout
    const checkoutStatus = !checkoutExists
      ? "N/A (no WooCommerce checkout)"
      : hasPrivacyPolicyOnCheckout
        ? "Found"
        : "Missing"
    const contentStatus = policyHasContent ? "Found" : "Missing/Empty"

    // Pass only when the policy is linked, the checkout requirement is met, AND
    // the linked page actually carries content. A link to a blank/404 page
    // fails — the client still has no usable Privacy Policy.
    if (footerHasLink && checkoutRequirementMet && policyHasContent) {
      // Content-match is advisory only: the policy passes on link + content, but
      // if the page text does NOT match the standard Growth99 template we append
      // a soft note so a human eyeballs it (a valid custom policy still passes —
      // we never fail on template mismatch, which would be a false positive).
      const matchAdvisory = isContentMatch
        ? ""
        : " Warning: this is NOT the standard Growth99 privacy policy template — a custom/third-party policy is in place. Passing on presence + content, but please have a human review the wording."
      return [
        {
          check_factor: "privacy_policy",
          title: "Privacy Policy Verified",
          description: (checkoutExists
            ? "The Privacy Policy link was successfully found in the footer, the page has content, and the WooCommerce checkout privacy notice is present."
            : "The Privacy Policy link was successfully found in the footer and the page has content. This site has no WooCommerce checkout, so a checkout privacy notice is not applicable.") + matchAdvisory,
          context_text: `Footer Link: Found\nCheckout Notice: ${checkoutStatus}\nPage Content: ${contentStatus}\nContent Match: ${isContentMatch ? "Yes" : "No"}\n\n===ACTUAL POLICY TEXT===\n${actualPolicyText}`,
          screenshot_url: finalScreenshotUrl,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    } else {
      // Distinguish "no page/link at all" from "linked but the page is empty" —
      // the latter is the case the fix populates.
      const emptyButLinked = footerHasLink && !policyHasContent
      return [
        {
          check_factor: "privacy_policy",
          title: emptyButLinked
            ? "Privacy Policy page is empty"
            : "Privacy Policy Missing",
          description: emptyButLinked
            ? `Privacy Policy check failed. A Privacy Policy link is present, but the page has no content (Page Content: ${contentStatus}). Checkout Notice: ${checkoutStatus}.`
            : `Privacy Policy check failed. Footer Link: ${footerHasLink ? "Found" : "Missing"}. Page Content: ${contentStatus}. Checkout Notice: ${checkoutStatus}.`,
          context_text: `Footer Link: ${footerHasLink ? "Found" : "Missing"}\nCheckout Notice: ${checkoutStatus}\nPage Content: ${contentStatus}\nContent Match: ${isContentMatch ? "Yes" : "No"}\n\n===ACTUAL POLICY TEXT===\n${actualPolicyText}`,
          screenshot_url: finalScreenshotUrl,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }
  } catch (err: any) {
    logger.error({ error: err.message }, "Error during privacy policy check")
    await browser.close().catch(() => null)
    // Surface (do NOT swallow as a silent tool lapse): the report should show
    // that the Privacy Policy check could not complete so a human reviews it.
    // Worded to avoid the lapse-filter phrases ("check failed", "encountered an
    // error", "process aborted") so it renders as a needs-review item.
    return [
      {
        check_factor: "privacy_policy",
        title: "Privacy Policy — check encountered an unknown error",
        description: `The Privacy Policy check could not complete for this page due to an unknown error, so it needs manual review. Please verify the footer link, the /privacy-policy page content, and (for ecommerce) the checkout notice by hand. Detail: ${err.message}`,
        context_text: "Needs manual review — check did not complete.",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}
