/**
 * Canonical Privacy Policy template — single source of truth shared by:
 *   • checks/privacyPolicyCheck.ts (builds a match regex from PRIVACY_TEMPLATE
 *     to decide whether a live page's content is the standard policy), and
 *   • jobs/aiFixRunJob.ts (renders the same text, with the client's company
 *     name + site URL swapped in, and seeds it as a WordPress page).
 *
 * PRIVACY_TEMPLATE keeps its `[…]` / `<<…>>` placeholders verbatim — the check
 * turns those into `.*?` wildcards, so the matcher must see the raw form.
 * renderPrivacyPolicy() fills them in for the actual page content.
 */
export const PRIVACY_TEMPLATE = `[Your Business Name] Privacy Policy

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

/** Escape HTML entities for safe embedding in page content. */
function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Fill the template's placeholders for a specific client. Only the two things
 * that vary per client change: the company name and the site URL (used for the
 * effective date and the contact/address line). Returns both a plain-text form
 * and a WordPress-ready HTML form (paragraphs + section headings).
 */
export function renderPrivacyPolicy(opts: {
  company: string
  url: string
  email?: string
  effectiveDate?: string
}): { text: string; html: string } {
  const company = (opts.company || "").trim() || "Our Company"
  const url = (opts.url || "").trim()
  const email = (opts.email || "").trim()
  const effectiveDate = (opts.effectiveDate || "").trim()

  // Keep the rendered text deterministic (no volatile timestamp) so the seeded
  // blueprint doesn't churn a fresh diff on every run.
  const text = PRIVACY_TEMPLATE.replace(/\[Your Business Name\]/g, company)
    .replace(/\[Current Date\]/g, effectiveDate || "the date of publication")
    .replace(/<<your email address>>/g, email || "us through our website")
    .replace(/\[Address\]/g, url || company)

  // Render to simple HTML: blank-line-separated blocks become <p>. The first
  // line ("<Company> Privacy Policy") and the two bare section headings are
  // promoted to headings so the page reads cleanly; everything else is a
  // paragraph. Deliberately plain markup — WordPress renders it as-is and a
  // human reviews the PR before merge.
  const HEADINGS = new Set([
    `${company} Privacy Policy`,
    "Our Commitment to Your Privacy",
  ])
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const html = blocks
    .map((b) => {
      if (HEADINGS.has(b)) return `<h2>${escHtml(b)}</h2>`
      return `<p>${escHtml(b)}</p>`
    })
    .join("\n")

  return { text, html }
}
