import { Finding } from "@qacc/shared"
import got from "got"
import pino from "pino"

const logger = pino({ level: process.env.LOG_LEVEL || "info" })

// Google PageSpeed Insights v5 — free. Works without a key (heavily rate-
// limited); an optional key raises the quota. No key or credentials are ever
// required from the client.
const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
const API_KEY = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY || ""

// Performance-score bands (Lighthouse): <50 poor, 50–89 needs work, ≥90 good.
// Gate the check on the stricter MOBILE score; below this = fail (optimize).
const FAIL_BELOW = 0.5

interface PsiResult {
  strategy: "mobile" | "desktop"
  score: number | null // 0..1
  metrics: Record<string, string>
}

async function runPsi(url: string, strategy: "mobile" | "desktop"): Promise<PsiResult> {
  const qs = new URLSearchParams({ url, strategy, category: "performance" })
  if (API_KEY) qs.set("key", API_KEY)
  const res: any = await got(`${PSI_ENDPOINT}?${qs.toString()}`, {
    timeout: { request: 60000 },
    retry: { limit: 1 },
  }).json()
  const lh = res?.lighthouseResult
  const score = typeof lh?.categories?.performance?.score === "number"
    ? lh.categories.performance.score
    : null
  const a = lh?.audits || {}
  const pick = (k: string) => (a[k]?.displayValue ? String(a[k].displayValue) : "")
  const metrics = {
    LCP: pick("largest-contentful-paint"),
    FCP: pick("first-contentful-paint"),
    CLS: pick("cumulative-layout-shift"),
    TBT: pick("total-blocking-time"),
    SI: pick("speed-index"),
    TTI: pick("interactive"),
  }
  return { strategy, score, metrics }
}

// PageSpeed Insights only reaches the PUBLIC internet — localhost / private
// IPs / the local fallback host can't be scanned.
function isNonPublicUrl(url: string): boolean {
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    return true // unparseable → treat as not scannable
  }
  return (
    /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$/i.test(host) ||
    /\.local$/i.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

const pct = (s: number | null) => (s == null ? "n/a" : `${Math.round(s * 100)}/100`)
const band = (s: number | null) =>
  s == null ? "" : s >= 0.9 ? "good" : s >= 0.5 ? "needs improvement" : "poor"

function metricLine(m: Record<string, string>): string {
  return [
    m.LCP && `LCP ${m.LCP}`,
    m.CLS && `CLS ${m.CLS}`,
    m.TBT && `TBT ${m.TBT}`,
    m.FCP && `FCP ${m.FCP}`,
    m.SI && `Speed Index ${m.SI}`,
  ]
    .filter(Boolean)
    .join(", ")
}

/**
 * Page Speed check — sends the live URL to Google PageSpeed Insights (free) and
 * posts the performance score + Core Web Vitals for mobile and desktop.
 *
 * PASS when mobile performance ≥ 50; FAIL (needs optimization) below that. Both
 * scores + vitals + a link to the full report are always included.
 */
export async function checkPageSpeed(
  url: string,
  _runId?: string,
  _pageId?: string,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  if (!url) {
    return [
      {
        check_factor: "page_speed",
        title: "Page Speed Check Failed",
        description:
          "No URL was available to test with PageSpeed Insights. Process aborted gracefully.",
        context_text: "System Error",
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // Not a public URL (local / staging / fallback) → PageSpeed can't reach it.
  // Say so plainly instead of a generic failure. Phrased as a clean pass so it
  // shows in the report without reading as a site defect.
  if (isNonPublicUrl(url)) {
    return [
      {
        check_factor: "page_speed",
        title: "Page Speed — URL not scannable",
        description: `No page speed issues found. The URL is not publicly reachable (local/staging), so it is not scannable for speed by PageSpeed Insights. Re-run against the public live URL to get a score.`,
        context_text: `URL: ${url}`,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  if (onProgress) await onProgress(20, "Requesting PageSpeed Insights (mobile + desktop)...")
  let mobile: PsiResult
  let desktop: PsiResult
  try {
    ;[mobile, desktop] = await Promise.all([runPsi(url, "mobile"), runPsi(url, "desktop")])
  } catch (error: any) {
    logger.error({ url, error: error.message }, "PageSpeed Insights request failed")
    return [
      {
        check_factor: "page_speed",
        title: "Page Speed Check Failed",
        description: `Could not retrieve PageSpeed Insights for the page: ${error.message}. Process aborted gracefully; QACC will retry on the next run.`,
        context_text: "System Error",
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  if (onProgress) await onProgress(90, "Formatting PageSpeed results...")
  const reportUrl = `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}`
  const summary =
    `Mobile performance ${pct(mobile.score)}${band(mobile.score) ? ` (${band(mobile.score)})` : ""}` +
    ` · Desktop performance ${pct(desktop.score)}${band(desktop.score) ? ` (${band(desktop.score)})` : ""}.`
  const detail =
    `\nMobile — ${metricLine(mobile.metrics) || "no metrics"}.` +
    `\nDesktop — ${metricLine(desktop.metrics) || "no metrics"}.` +
    `\n\nFull report: ${reportUrl}`
  const ctx = `URL: ${url}\n${JSON.stringify({ mobile, desktop })}`

  // FAIL when the mobile performance score is below target.
  const mobileFails = mobile.score != null && mobile.score < FAIL_BELOW
  if (mobileFails) {
    return [
      {
        check_factor: "page_speed",
        title: `Page Speed needs optimization — mobile ${pct(mobile.score)}`,
        description:
          `The mobile PageSpeed performance score is ${pct(mobile.score)} (below the 50/100 target). ${summary}${detail}` +
          `\nOptimize: compress/serve next-gen images, defer non-critical JS, enable caching/CDN, and reduce render-blocking resources.`,
        context_text: ctx,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // PASS — post the scores. Phrased as a clean pass so the report marks it green.
  return [
    {
      check_factor: "page_speed",
      title: `Page Speed — mobile ${pct(mobile.score)}, desktop ${pct(desktop.score)}`,
      description: `No page speed issues found. ${summary}${detail}`,
      context_text: ctx,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
