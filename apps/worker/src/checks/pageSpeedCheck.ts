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
  let res: any
  try {
    res = await got(`${PSI_ENDPOINT}?${qs.toString()}`, {
      // A Lighthouse run on a slow site often takes 40-70s server-side.
      timeout: { request: 90000 },
      // Retry only transient server errors. A 429 (quota) retry just burns more
      // quota, and a 400 (Lighthouse could not load the page) fails the same way.
      retry: { limit: 1, statusCodes: [500, 502, 503, 504] },
    }).json()
  } catch (e: any) {
    throw new Error(psiErrorReason(e))
  }
  const lh = res?.lighthouseResult
  const score = typeof lh?.categories?.performance?.score === "number"
    ? lh.categories.performance.score
    : null
  // Lighthouse ran but could not measure the page (e.g. NO_FCP, page blocked
  // Lighthouse). No score means nothing was measured — not a pass.
  if (score == null) {
    const rt = lh?.runtimeError
    throw new Error(
      rt?.message || rt?.code
        ? `Lighthouse could not measure the page (${String(rt.message || rt.code).slice(0, 200)})`
        : "PageSpeed Insights returned no performance score",
    )
  }
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

// One plain reason from a failed PSI request: quota, timeout, or the API's own
// error message (e.g. "Lighthouse returned error: FAILED_DOCUMENT_REQUEST").
function psiErrorReason(e: any): string {
  const code = e?.response?.statusCode
  let apiMsg = ""
  try {
    const body = typeof e?.response?.body === "string" ? JSON.parse(e.response.body) : e?.response?.body
    apiMsg = String(body?.error?.message || "").slice(0, 300)
  } catch {}
  if (code === 429 || /quota|rate limit/i.test(apiMsg))
    return `PageSpeed Insights quota exceeded (HTTP ${code ?? 429})${API_KEY ? "" : " — no PAGESPEED_API_KEY set"}`
  if (/timeout/i.test(e?.name || "") || /timeout|timed out/i.test(e?.message || ""))
    return "PageSpeed Insights did not respond within 90 seconds"
  if (apiMsg) return `PageSpeed Insights error (HTTP ${code ?? "?"}): ${apiMsg}`
  return String(e?.message || e)
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
    /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)$/i.test(host) ||
    /\.(local|localhost|test|internal)$/i.test(host) ||
    /^127\./.test(host) ||
    /^169\.254\./.test(host) ||
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

  // Not a public URL (local / private) → PageSpeed can't reach it. Nothing was
  // measured, so this is a skip (could not run), never a pass or a defect.
  if (isNonPublicUrl(url)) {
    return [
      {
        check_factor: "page_speed",
        title: "Page Speed Check Skipped: URL not publicly reachable",
        description: `The URL is not publicly reachable (local/private host), so Google PageSpeed Insights cannot test it. Re-run against the public live URL to get a score. This is not a problem with the website.`,
        context_text: `URL: ${url}`,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  if (onProgress) await onProgress(20, "Requesting PageSpeed Insights (mobile + desktop)...")
  // Run both strategies independently: one failing (quota, a Lighthouse
  // timeout) must not throw away the other's score.
  const [m, dsk] = await Promise.allSettled([runPsi(url, "mobile"), runPsi(url, "desktop")])
  if (m.status === "rejected" && dsk.status === "rejected") {
    const reason = String(m.reason?.message || m.reason)
    logger.error({ url, error: reason }, "PageSpeed Insights request failed")
    return [
      {
        check_factor: "page_speed",
        title: "Page Speed Check Failed",
        description: `Could not retrieve PageSpeed Insights for the page: ${reason}. Process aborted gracefully; QACC will retry on the next run. This is not a problem with the website.`,
        context_text: `URL: ${url}\nMobile: ${reason}\nDesktop: ${String(dsk.reason?.message || dsk.reason)}`,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
  const failed = (strategy: "mobile" | "desktop", r: PromiseRejectedResult): PsiResult => {
    logger.warn({ url, strategy, error: String(r.reason?.message || r.reason) }, "PageSpeed strategy failed")
    return { strategy, score: null, metrics: {} }
  }
  const mobile = m.status === "fulfilled" ? m.value : failed("mobile", m)
  const desktop = dsk.status === "fulfilled" ? dsk.value : failed("desktop", dsk)

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

  // FAIL when the mobile performance score is below target. If only the
  // desktop run succeeded, gate on desktop and say so.
  const gate = mobile.score != null ? mobile : desktop
  const gateNote =
    gate === desktop ? "\nMobile could not be measured this run, so the desktop score was used." : ""
  if (gate.score != null && gate.score < FAIL_BELOW) {
    return [
      {
        check_factor: "page_speed",
        title: `Page Speed needs optimization — ${gate.strategy} ${pct(gate.score)}`,
        description:
          `The ${gate.strategy} PageSpeed performance score is ${pct(gate.score)} (below the 50/100 target). ${summary}${detail}${gateNote}` +
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
      description: `No page speed issues found. ${summary}${detail}${gateNote}`,
      context_text: ctx,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
