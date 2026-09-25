import { chromium } from "playwright"
import { Finding, aiFailureReason } from "@qacc/shared"
import { describeImageResult } from "../lib/aiFallback"
import sharp from "sharp"
import { uploadScreenshot } from "../lib/supabaseStorage"
import {
  getClientNotesText,
  getClientDomain,
  getClientPlanField,
  resolveClient,
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

// Measured (non-AI) render check: the reviews.growth99.com widget frame must be
// visible, tall enough, and hold real text (reviews), not an empty shell.
const WIDGET_MIN_HEIGHT = 100 // px
const WIDGET_MIN_TEXT = 40 // chars of text inside the widget frame
const WIDGET_WAIT_MS = 8000

const VISION_PROMPT =
  "This is a screenshot of a medical/aesthetic practice website's reviews page. Does the page display a customer REVIEWS or TESTIMONIALS widget — e.g. star ratings, review cards, patient testimonials, or an embedded reviews feed? Answer strictly with a single word: YES or NO."

/** True when "somewhat equal to" the Accelerator plan (fuzzy, case-insensitive). */
function isAcceleratorPlan(plan: string): boolean {
  return /accelerat/i.test(plan)
}

/**
 * Project Plan check.
 *
 * Plan resolution precedence:
 *   1. TED client record `plan` field — the "main page" value shown on the TED
 *      client dashboard (ted.growth99.com/dashboard/clients/{id}). Resolved by
 *      the real ted_client_id when available, else the client name, else a host
 *      match against the record's beta/website URL (so URL-only full scans work).
 *   2. HubSpot company `growth99_plan` (joined by domain)
 *   3. "Growth99 Plan: <plan>" line in TED notes
 *   4. None -> FAIL ("plan not available to check"), no fix possible.
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
  // OPTIONAL: the real TED client id stored on the run (qa_runs.ted_client_id).
  // The project name is synthetic for full scans ("Full Scan — <url>") and never
  // matches a TED client, so the id is the reliable handle to the client record.
  tedClientId?: string | number | null,
  // OPTIONAL trailing param: when the caller already owns a warm chromium it can
  // pass it in to skip the ~1-2s cold launch per Accelerator run. Callers that
  // omit it (the existing 3-arg call site) get the old self-launch behavior.
  sharedBrowser?: any,
): Promise<Finding[]> {
  if (onProgress) await onProgress(20, "Reading project plan...")

  let planRaw = ""
  let planSource = ""
  let hs: Awaited<ReturnType<typeof resolveHubspotClientData>> = null
  // The handle used for every TED read: prefer the real ted_client_id, fall back
  // to the (possibly synthetic) project/client name.
  const clientKey =
    tedClientId != null && String(tedClientId).trim()
      ? String(tedClientId).trim()
      : clientName
  try {
    // 1. TED client record `plan` — the main-page value on the client dashboard.
    //    Resolve the client by id/name, else by a host match against the record's
    //    beta/website URL (covers URL-only full scans where the name is synthetic).
    const client = await resolveClient(clientKey, pageRecord?.siteUrl)
    planRaw = getClientPlanField(client)
    if (planRaw) planSource = "TED client page"

    // 2. HubSpot (joined by domain from the TED client record).
    const domain = await getClientDomain(clientKey).catch(() => null)
    hs = await resolveHubspotClientData(domain, clientName).catch(() => null)
    if (!planRaw && hs?.plan) {
      planRaw = hs.plan
      planSource = "HubSpot"
    }

    // 3. The "Growth99 Plan:" line in TED notes.
    if (!planRaw) {
      const notes = await getClientNotesText(clientKey)
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
          "No record for the project plan was found. NO fix possible — plan not available to check. Please set the plan on the TED client page.",
        context_text: `Client: ${clientName} (id: ${clientKey}) — checked the TED client page \`plan\` field, HubSpot growth99_plan (by domain), and the "Growth99 Plan:" line in client notes.`,
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
  // Measured, non-AI signal: the widget mount is visible with real height.
  let rendered = false
  // Vision verdict: "yes" / "no", or "unavailable" when vision could not answer.
  let vision: "yes" | "no" | "unavailable" = "unavailable"
  let visionError = ""
  let screenshotOk = false
  let screenshotUrl: string | null = pageRecord?.desktopUrl || null
  let reviewsUrl = ""

  if (pageRecord?.siteUrl) {
    const base = pageRecord.siteUrl.replace(/\/$/, "")
    reviewsUrl = `${base}/reviews`
    // Reuse a caller-supplied browser when present; otherwise cold-launch our
    // own. Skipping the launch saves the ~1-2s chromium cold start per
    // Accelerator run. Behavior-identical: same page/probe logic either way,
    // and we only close what we launched (below).
    const browser =
      sharedBrowser ||
      (await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      }))
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
      page.setDefaultNavigationTimeout(25000)
      try {
        await page.goto(reviewsUrl, { waitUntil: "networkidle", timeout: 25000 })
      } catch {
        await page.goto(reviewsUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
      }

      // (a) Widget code present in the rendered markup.
      const html = await page.content().catch(() => "")
      codePresent = WIDGET_MARKERS.some((re) => re.test(html))

      // (b) Measured render check: wait (up to WIDGET_WAIT_MS) for the widget
      // frame to be visible AND to have real content inside it. Height alone is
      // not enough — a blank iframe is 150px by default. The iframe loads async,
      // so the old fixed 1.5s wait was too short to judge.
      if (codePresent) {
        const deadline = Date.now() + WIDGET_WAIT_MS
        while (!rendered && Date.now() < deadline) {
          for (const fr of page.frames()) {
            if (!/reviews\.growth99\.com/i.test(fr.url())) continue
            const el = await fr.frameElement().catch(() => null)
            const box = el ? await el.boundingBox().catch(() => null) : null
            const visible = el ? await el.isVisible().catch(() => false) : false
            const textLen = await fr
              .evaluate(() => (document.body?.innerText || "").trim().length)
              .catch(() => 0)
            if (visible && box && box.height >= WIDGET_MIN_HEIGHT && textLen >= WIDGET_MIN_TEXT) {
              rendered = true
              break
            }
          }
          if (!rendered) await page.waitForTimeout(500)
        }
      } else {
        await page.waitForTimeout(1500)
      }

      // (c) Vision confirmation on a screenshot — only needed when the measured
      // check could not confirm the widget. A NO is re-asked on a fresh
      // screenshot before it is trusted.
      const shoot = async (): Promise<Buffer | null> => {
        const buf = await page.screenshot({ fullPage: true }).catch(() => null)
        return buf ? await sharp(buf).jpeg({ quality: 85 }).toBuffer() : null
      }
      const jpg = await shoot()
      if (jpg) {
        screenshotOk = true
        const url = await uploadScreenshot(
          jpg,
          `evidence/project-plan/${pageRecord?.id || "run"}-reviews-${Date.now()}.jpg`,
          { bucket: "evidence", isPublic: true },
        ).catch(() => "")
        if (url) screenshotUrl = url
        if (codePresent && !rendered) {
          if (onProgress) await onProgress(80, "Analyzing reviews widget (vision)...")
          const ask = async (img: Buffer) => {
            const vr = await describeImageResult(img, VISION_PROMPT)
            if (!vr.ok) {
              visionError = vr.error || "vision unavailable"
              return "unavailable" as const
            }
            if (/\byes\b/i.test(vr.text)) return "yes" as const
            if (/\bno\b/i.test(vr.text)) return "no" as const
            visionError = "vision reply could not be read"
            return "unavailable" as const
          }
          vision = await ask(jpg)
          if (vision === "no") {
            await page.waitForTimeout(3000)
            const again = await shoot()
            if (again) vision = await ask(again)
          }
          logger.info({ codePresent, rendered, vision }, "reviews widget vision result")
        }
      }
    } catch (e: any) {
      logger.warn({ error: e.message }, "reviews page probe failed (non-fatal)")
    } finally {
      // Only tear down the browser we launched; a shared one is owned by the caller.
      if (!sharedBrowser) await browser.close().catch(() => {})
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

  // Scenario 1 — Accelerator, code present and the widget shows (measured, or
  // vision confirmed). PASS.
  if (rendered || vision === "yes") {
    return [
      {
        check_factor: "project_plan",
        title: `Project Plan: ${planRaw} — reviews widget present`,
        description: `Accelerator plan "${planRaw}" confirmed. The reviews widget code is present and the widget is showing on the /reviews page (${rendered ? "measured on the page" : "confirmed by vision"}) — no issues found. No fix needed.${addOnLine}${detailLine}${sourceLine}`,
        context_text: ctx,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // Scenario 2 — code present, but neither the page measurement nor vision
  // (asked twice) sees the widget. FAIL — manual (wrong id/bid, blocked script).
  if (vision === "no") {
    return [
      {
        check_factor: "project_plan",
        title: "Reviews widget not rendering (Accelerator plan)",
        description: `Plan "${planRaw}" is an Accelerator plan. The reviews widget code is on the /reviews page, but the widget does not show: its frame never reached a visible size and vision saw no reviews on the page. Check the widget id/bid against the Basecamp "Review and Reputation Code".${addOnLine}${detailLine}${sourceLine}`,
        context_text: ctx,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // Scenario 4 — code present, the widget could not be measured, and vision
  // could not answer (or no screenshot). Nothing verified → could not complete.
  const why = screenshotOk
    ? aiFailureReason(visionError)
    : "a screenshot of the /reviews page could not be captured"
  return [
    {
      check_factor: "project_plan",
      title: "Project Plan Check Failed",
      description: `Could not complete: ${why}. Plan "${planRaw}" is an Accelerator plan and the reviews widget code is present, but the widget could not be confirmed as showing. Process aborted gracefully.${sourceLine}`,
      context_text: `${ctx}${visionError ? `\nVision error: ${visionError.slice(0, 300)}` : ""}`,
      screenshot_url: screenshotUrl,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
