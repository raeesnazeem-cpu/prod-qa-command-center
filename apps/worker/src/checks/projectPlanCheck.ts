import { chromium } from "playwright"
import { Finding } from "@qacc/shared"
import { describeImage } from "../lib/aiFallback"
import sharp from "sharp"
import { uploadScreenshot } from "../lib/supabaseStorage"
import {
  getClient,
  getClientNotesText,
  getClientDomain,
  parsePlan,
} from "../lib/tedClient"
import { resolveHubspotClientData } from "../lib/hubspotClient"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

// Markers that prove the reviews-widget embed is present in the page markup.
// The footer embed loads reviews.js and mounts an <iframe id="ReviewsWidget">
// pointing at reviews.growth99.com/widget — any one of these is proof.
const WIDGET_MARKERS = [
  /reviews\.growth99\.com\/reviews\.js/i,
  /reviews\.growth99\.com\/widget/i,
  /id=["']?ReviewsWidget/i,
]

/** True when "somewhat equal to" the Accelerator plan (fuzzy, case-insensitive). */
function isAcceleratorPlan(plan: string): boolean {
  return /accelerat/i.test(plan)
}

/**
 * Project Plan check.
 *
 * Plan resolution precedence (unchanged):
 *   1. HubSpot company `growth99_plan` (joined by domain)
 *   2. TED client.plan
 *   3. "Growth99 Plan: <plan>" line in TED notes
 *   4. None -> FAIL ("plan not available in notes to check"), no fix possible.
 *
 * Then, keyed on the plan:
 *   • ACCELERATOR plan → the site must have a /reviews page with the reviews
 *     widget active. We assert this two ways:
 *       (a) widget code present in the rendered /reviews markup, and
 *       (b) vision confirmation on a screenshot of that page.
 *     - code + vision confirmed              → PASS
 *     - code present, vision unconfirmed/no-shot → PASS, flag "check manually"
 *     - no code                              → FAIL, fix: inject widget in footer
 *   • ANY OTHER plan → PASS (plan-confirmation only; no reviews requirement).
 *
 * Findings are phrased so the report's pass/fail derivation (tedSync
 * isCleanPassFinding) reads PASS cases as clean and FAIL cases as real defects.
 * The themeType is accepted for parity with the theme-aware fix but the check
 * itself is front-end and theme-agnostic.
 */
export async function checkProjectPlan(
  clientName: string,
  pageRecord?: {
    id?: string
    siteUrl?: string
    desktopUrl?: string
    themeType?: string
  },
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  if (onProgress) await onProgress(20, "Reading project plan...")

  let planRaw = ""
  let planSource = ""
  let hs: Awaited<ReturnType<typeof resolveHubspotClientData>> = null
  try {
    // 1. HubSpot (joined by domain from the TED client record).
    const domain = await getClientDomain(clientName).catch(() => null)
    hs = await resolveHubspotClientData(domain, clientName).catch(() => null)
    if (hs?.plan) {
      planRaw = hs.plan
      planSource = "HubSpot"
    }

    // 2-3. TED plan, then the notes line.
    if (!planRaw) {
      const client = await getClient(clientName)
      planRaw = (client?.plan || "").trim()
      if (planRaw) planSource = "TED"
    }
    if (!planRaw) {
      const notes = await getClientNotesText(clientName)
      const m = notes.match(/Growth99\s+Plan:\s*([^\n\r<]+)/i)
      if (m && m[1]) {
        planRaw = m[1].trim()
        planSource = "TED notes"
      }
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "TED read failed for project plan")
    return [
      {
        check_factor: "project_plan",
        title: "Project Plan — could not reach TED",
        description: `Failed to read the plan from TED for client "${clientName}": ${error.message}`,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // Scenario 4 — plan not found. FAIL, no fix possible.
  if (!planRaw) {
    return [
      {
        check_factor: "project_plan",
        title: "Project Plan not set",
        description:
          "No record for the project plan was found. NO fix possible — plan not available in notes to check. Please add the plan to the client notes.",
        context_text: `Client: ${clientName} — checked HubSpot growth99_plan (by domain), TED client.plan, and the "Growth99 Plan:" line in client notes.`,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const parsed = parsePlan(planRaw)
  const accelerator = isAcceleratorPlan(planRaw)
  logger.info({ planRaw, parsed, accelerator }, "Resolved project plan from TED")

  const addOnLine = parsed?.addOns.length
    ? ` Add-ons: ${parsed.addOns.join(", ")}.`
    : ""
  // HubSpot client details folded into every finding for the report/UI.
  const d = hs?.details
  const detailBits = d
    ? [
        d.projectManager && `PM: ${d.projectManager}`,
        d.supportLevel && `Support: ${d.supportLevel}`,
        d.onboardingLevel && `Onboarding: ${d.onboardingLevel}`,
        d.websiteReleaseDate && `Release: ${d.websiteReleaseDate}`,
        d.contactEmail && `Contact: ${d.contactEmail}`,
        d.phone && `Phone: ${d.phone}`,
        d.industry && `Industry: ${d.industry}`,
      ].filter(Boolean)
    : []
  const detailLine = detailBits.length
    ? `\n\nClient details (HubSpot): ${detailBits.join(" · ")}.`
    : ""
  const ctx = `${planRaw}${d ? `\n${JSON.stringify(d)}` : ""}`

  // Scenario 5 — any non-Accelerator plan. PASS (plan confirmation only).
  if (!accelerator) {
    return [
      {
        check_factor: "project_plan",
        title: `Project Plan confirmed: ${planRaw}`,
        description: `Plan "${planRaw}" confirmed from ${planSource || "TED"} for "${clientName}". This plan has no reviews-widget requirement — plan-confirmation only, no issues found. No fix needed.${addOnLine}${detailLine}`,
        context_text: ctx,
        screenshot_url: pageRecord?.desktopUrl || null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // ---- Accelerator plan → verify the /reviews page + widget. -------------
  if (onProgress) await onProgress(60, "Checking reviews widget...")

  let codePresent = false
  let screenshotOk = false
  let visionConfirmed = false
  let screenshotUrl: string | null = pageRecord?.desktopUrl || null
  let reviewsUrl = ""

  if (pageRecord?.siteUrl) {
    const base = pageRecord.siteUrl.replace(/\/$/, "")
    reviewsUrl = `${base}/reviews`
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    })
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
      page.setDefaultNavigationTimeout(25000)
      try {
        await page.goto(reviewsUrl, { waitUntil: "networkidle", timeout: 25000 })
      } catch {
        await page.goto(reviewsUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
      }
      await page.waitForTimeout(4000)

      // (a) Widget code present in the rendered markup.
      const html = await page.content().catch(() => "")
      codePresent = WIDGET_MARKERS.some((re) => re.test(html))

      // (b) Vision confirmation on a screenshot of the page.
      const buf = await page.screenshot({ fullPage: true }).catch(() => null)
      if (buf) {
        screenshotOk = true
        const jpg = await sharp(buf).jpeg({ quality: 85 }).toBuffer()
        const url = await uploadScreenshot(
          jpg,
          `evidence/project-plan/${pageRecord?.id || "run"}-reviews-${Date.now()}.jpg`,
          { bucket: "evidence", isPublic: true },
        ).catch(() => "")
        if (url) screenshotUrl = url
        if (onProgress) await onProgress(80, "Analyzing reviews widget (vision)...")
        const answer = await describeImage(
          jpg,
          "This is a screenshot of a medical/aesthetic practice website's reviews page. Does the page display a customer REVIEWS or TESTIMONIALS widget — e.g. star ratings, review cards, patient testimonials, or an embedded reviews feed? Answer strictly with a single word: YES or NO.",
        ).catch(() => "")
        visionConfirmed = /\byes\b/i.test(answer)
        logger.info({ codePresent, visionConfirmed, answer: answer.slice(0, 40) }, "reviews widget vision result")
      }
    } catch (e: any) {
      logger.warn({ error: e.message }, "reviews page probe failed (non-fatal)")
    } finally {
      await browser.close().catch(() => {})
    }
  }

  const sourceLine = reviewsUrl ? `\n\nURL: ${reviewsUrl}` : ""

  // Scenario 3 — Accelerator plan, no widget code. FAIL + fix.
  if (!codePresent) {
    return [
      {
        check_factor: "project_plan",
        title: "Reviews widget missing (Accelerator plan)",
        description: `Plan "${planRaw}" is an Accelerator plan, which requires an active reviews widget on the /reviews page, but the reviews-widget embed was not detected in the page markup. Fix: add the Growth99 reviews widget script to the site footer.${addOnLine}${detailLine}${sourceLine}`,
        context_text: ctx,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // Scenario 1 — Accelerator, code + vision confirmed. PASS.
  if (screenshotOk && visionConfirmed) {
    return [
      {
        check_factor: "project_plan",
        title: `Project Plan: ${planRaw} — reviews widget present`,
        description: `Accelerator plan "${planRaw}" confirmed. The reviews widget code is present and vision confirmed the widget is rendering on the /reviews page — no issues found. No fix needed.${addOnLine}${detailLine}${sourceLine}`,
        context_text: ctx,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // Scenario 2 — Accelerator, code present but no screenshot / vision unconfirmed.
  // PASS (code is present) but flag for a manual eyeball.
  return [
    {
      check_factor: "project_plan",
      title: `Project Plan: ${planRaw} — reviews widget code present`,
      description: `Accelerator plan "${planRaw}" confirmed. The reviews widget code is present in the page, but ${screenshotOk ? "vision could not visually confirm the widget is rendering" : "a screenshot for vision verification could not be captured"} — please check the /reviews page manually once. Passing because the code is present; no blocking issues found. No fix needed.${addOnLine}${detailLine}${sourceLine}`,
      context_text: ctx,
      screenshot_url: screenshotUrl,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
