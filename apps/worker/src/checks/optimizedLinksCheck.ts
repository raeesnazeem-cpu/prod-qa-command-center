// import { Finding } from "@qacc/shared"
// import got from "got"
// import pLimit from "p-limit"
// import pino from "pino"

// const logger = pino({
//   level: process.env.LOG_LEVEL || "info",
//   transport: {
//     target: "pino-pretty",
//     options: { colorize: true },
//   },
// })

// // Global caches — keyed by runId so they survive across multiple jobs in a single run
// const runCheckedLinks = new Map<string, Set<string>>()
// const runBrokenLinks = new Map<
//   string,
//   { url: string; reason: string; text: string; statusCode?: number }[]
// >()

// const BROWSER_HEADERS = {
//   "User-Agent":
//     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
//   Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
//   "Accept-Language": "en-US,en;q=0.9",
// }

// /**
//  * Extract ALL URLs from rendered HTML — matches what deadlinkchecker.com does.
//  * Pulls URLs from: <a href>, <img src>, <img srcset>, <script src>, <link href>,
//  * <source src>, <video src>, <audio src>, <iframe src>, <embed src>, <object data>,
//  * and CSS url() references.
//  */
// function extractUrlsFromHTML(html: string, baseUrl: string): string[] {
//   const urls: Set<string> = new Set()

//   // 1. Extract href="..." from <a>, <link>, <area> tags
//   const hrefRegex =
//     /(?:href|src|data|action|poster)=["']([^"'#\s][^"']*?)["']/gi
//   let match: RegExpExecArray | null
//   while ((match = hrefRegex.exec(html)) !== null) {
//     urls.add(match[1])
//   }

//   // 2. Extract srcset="..." (responsive images have comma-separated URLs)
//   const srcsetRegex = /srcset=["']([^"']+?)["']/gi
//   while ((match = srcsetRegex.exec(html)) !== null) {
//     const srcsetValue = match[1]
//     // srcset format: "url1 1x, url2 2x" or "url1 300w, url2 600w"
//     const entries = srcsetValue.split(",")
//     for (const entry of entries) {
//       const url = entry.trim().split(/\s+/)[0]
//       if (url) urls.add(url)
//     }
//   }

//   // 3. Extract CSS url(...) references (background images, fonts, etc.)
//   const cssUrlRegex = /url\(["']?([^"')]+?)["']?\)/gi
//   while ((match = cssUrlRegex.exec(html)) !== null) {
//     urls.add(match[1])
//   }

//   // 4. Normalize all URLs to absolute
//   const absoluteUrls: Set<string> = new Set()
//   // Remove trailing slash from baseUrl for consistent joining
//   const cleanBase = baseUrl.replace(/\/$/, "")

//   let baseOrigin: string
//   try {
//     baseOrigin = new URL(baseUrl).origin
//   } catch {
//     baseOrigin = cleanBase
//   }

//   for (const raw of urls) {
//     try {
//       let absolute: string

//       if (raw.startsWith("http://") || raw.startsWith("https://")) {
//         absolute = raw
//       } else if (raw.startsWith("//")) {
//         absolute = "https:" + raw
//       } else if (raw.startsWith("/")) {
//         absolute = baseOrigin + raw
//       } else if (
//         raw.startsWith("data:") ||
//         raw.startsWith("mailto:") ||
//         raw.startsWith("tel:") ||
//         raw.startsWith("javascript:")
//       ) {
//         continue // Skip non-HTTP URLs
//       } else {
//         // Relative URL like "page.html" or "../page.html"
//         absolute = cleanBase + "/" + raw
//       }

//       // Remove fragment identifiers
//       absolute = absolute.split("#")[0]

//       if (absolute) {
//         absoluteUrls.add(absolute)
//       }
//     } catch {
//       // Skip malformed URLs
//     }
//   }

//   return [...absoluteUrls]
// }

// export async function checkOptimizedLinks(
//   page: any,
//   pageRecord: any,
// ): Promise<Finding[]> {
//   const siteUrl = pageRecord.site_url
//   const pageUrl = page ? page.url() : pageRecord.url
//   let extractedLinks: string[] = []

//   try {
//     // 1. Fetch the rendered HTML of the page (same approach as deadlinkchecker.com)
//     logger.info({ pageUrl }, "Fetching rendered HTML for dead link extraction")
//     const response = await got.get(pageUrl, {
//       headers: BROWSER_HEADERS,
//       timeout: { request: 15000 },
//       retry: { limit: 1 },
//       followRedirect: true,
//     })

//     // 2. Extract ALL URLs from the rendered HTML
//     extractedLinks = extractUrlsFromHTML(response.body, pageUrl)

//     logger.info(
//       { pageUrl, linkCount: extractedLinks.length },
//       "Extracted links from rendered HTML",
//     )
//   } catch (error) {
//     logger.error(
//       { pageUrl, error },
//       "Failed to fetch page HTML for dead link check",
//     )
//     return []
//   }

//   // 3. Now we check the status of each link concurrently
//   const brokenLinks: { url: string; status: number; sourceUrl: string }[] = []
//   const checkLimit = pLimit(50) // Check 50 links at once (HEAD requests are lightweight)
//   const runId = pageRecord.run_id
//   if (!runCheckedLinks.has(runId)) runCheckedLinks.set(runId, new Set())
//   if (!runBrokenLinks.has(runId)) runBrokenLinks.set(runId, [])

//   const checkedLinks = runCheckedLinks.get(runId)!
//   const knownBrokenLinks = runBrokenLinks.get(runId)!

//   const checkPromises = extractedLinks.map((urlToCheck) =>
//     checkLimit(async () => {
//       // Skip non-http URLs
//       if (
//         !urlToCheck.startsWith("http://") &&
//         !urlToCheck.startsWith("https://")
//       ) {
//         return
//       }

//       // --- CACHE CHECK: skip if we already checked this URL in this run ---
//       if (checkedLinks.has(urlToCheck)) {
//         // We do not add it to brokenLinks again.
//         // The UI consolidates all dead links run-wide, so reporting it on the first page prevents duplication.
//         return
//       }
//       checkedLinks.add(urlToCheck)

//       try {
//         // First try HEAD (fast, lightweight)
//         const headResponse = await got.head(urlToCheck, {
//           headers: BROWSER_HEADERS,
//           throwHttpErrors: false,
//           timeout: { request: 8000 },
//           retry: { limit: 0 },
//           followRedirect: true,
//         })

//         if (headResponse.statusCode >= 400) {
//           // Some servers reject HEAD, confirm with GET
//           const getResponse = await got.get(urlToCheck, {
//             headers: BROWSER_HEADERS,
//             throwHttpErrors: false,
//             timeout: { request: 8000 },
//             retry: { limit: 0 },
//             followRedirect: true,
//           })

//           if (getResponse.statusCode >= 400) {
//             brokenLinks.push({
//               url: urlToCheck,
//               status: getResponse.statusCode,
//               sourceUrl: pageUrl,
//             })
//             knownBrokenLinks.push({
//               url: urlToCheck,
//               reason: `HTTP ${getResponse.statusCode}`,
//               text: "",
//               statusCode: getResponse.statusCode,
//             })
//           }
//         }
//       } catch (e) {
//         // Network error / timeout = broken
//         brokenLinks.push({ url: urlToCheck, status: 0, sourceUrl: pageUrl })
//         knownBrokenLinks.push({
//           url: urlToCheck,
//           reason: "Connection failed",
//           text: "",
//           statusCode: 0,
//         })
//       }
//     }),
//   )
//   await Promise.all(checkPromises)

//   // 4. Return the final report to the UI
//   if (brokenLinks.length === 0) return []
//   return [
//     {
//       check_factor: "dead_links",
//       title: `${brokenLinks.length} broken link${brokenLinks.length === 1 ? "" : "s"} found`,
//       // IMPORTANT: The UI's RunDetailPage.tsx expects the string "- **" to parse and count dead links!
//       // Do not change the "- **" prefix, or the UI heading will say "0 dead link found".
//       description: brokenLinks
//         .map(
//           (b) =>
//             `- **${b.url}** (Status: ${b.status || "Connection Failed"} | Found on: ${b.sourceUrl})`,
//         )
//         .join("\n"),
//       status: "open",
//       ai_generated: false,
//       screenshot_url: null,
//       context_text: `URLs scanned on this page: ${extractedLinks.length} | Total unique URLs checked in run so far: ${runCheckedLinks.get(runId)!.size}`,
//     },
//   ]
// }

import { Finding } from "@qacc/shared"
import got from "got"
import pLimit from "p-limit"
import pino from "pino"
import * as cheerio from "cheerio"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

// Global caches — keyed by runId so they survive across multiple jobs in a single run.
//
// These MUST be released when a run finishes: the worker is long-lived, so an
// entry left behind holds every probed URL's promise (and result) for that run
// forever. releaseLinkCaches() is called from the run-completion path; the
// age-based sweep below is the backstop for runs that die without completing.
const runLinkPromises = new Map<string, Map<string, Promise<LinkCheckResult>>>()
const runCacheMetadata = new Map<string, { createdAt: number }>()
const runTotalExtractedLinks = new Map<string, number>()

/** Drop a finished run's link caches. Idempotent; safe to call more than once. */
export function releaseLinkCaches(runId: string): void {
  runLinkPromises.delete(runId)
  runCacheMetadata.delete(runId)
  runTotalExtractedLinks.delete(runId)
}

/**
 * Backstop for runs that never reached the completion path (crash, kill, lost
 * job). Anything older than the TTL is dropped regardless of run state.
 */
const LINK_CACHE_MAX_AGE_MS = Math.max(
  60_000,
  Number(process.env.LINK_CACHE_MAX_AGE_MS || 30 * 60 * 1000),
)

/** Concurrent link probes. Sized for the 2 vCPU / 4 GB production box. */
const LINK_PROBE_CONCURRENCY = Math.max(
  1,
  Number(process.env.LINK_PROBE_CONCURRENCY || 12),
)

export function sweepStaleLinkCaches(now = Date.now()): number {
  let dropped = 0
  for (const [runId, meta] of runCacheMetadata) {
    if (now - meta.createdAt > LINK_CACHE_MAX_AGE_MS) {
      releaseLinkCaches(runId)
      dropped++
    }
  }
  return dropped
}

// A probed link is either broken (a real defect), or could not be verified —
// the target refused to answer an automated check (LinkedIn's 999, a 429 rate
// limit, a 401/403 bot block, a Cloudflare challenge, a timeout). Unverified
// links are NOT defects: they are kept for the QACC dashboard only, never the
// TED report or the fix module. null = healthy.
type LinkCheckResult =
  | { status: number; reason: string; kind: "broken" | "unverified" }
  | null

// Sites that answer every automated request with a block (LinkedIn → 999,
// the Meta/X family → login walls / 4xx). Probing them only produces noise, so
// they are recorded as unverified without a request.
const BOT_BLOCKING_HOSTS =
  /(^|\.)(linkedin\.com|lnkd\.in|instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com)$/i

// Resource hints point at a bare host (e.g. fonts.gstatic.com), not a page, so
// requesting them 404s on healthy sites. Real stylesheets/scripts still count.
const HINT_RELS = /\b(preconnect|dns-prefetch)\b/i

// Marker line in context_text carrying the unverified links (JSON) for the
// dashboard. Parsed by apps/web DeadLinksFindingCard; ignored by TED + fixes.
export const UNVERIFIED_LINKS_MARKER = "Could not verify (not counted as broken):"

const MAX_RETRY_AFTER_MS = 10_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait the server's Retry-After (seconds or HTTP date), capped; default 3s. */
function retryAfterMs(headers: any): number {
  const raw = headers?.["retry-after"]
  if (!raw) return 3000
  const secs = Number(raw)
  const ms = Number.isFinite(secs) ? secs * 1000 : new Date(String(raw)).getTime() - Date.now()
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms || 0))
}

/** A Cloudflare bot challenge, not a real server error. */
function isCloudflareChallenge(res: any): boolean {
  const h = res?.headers || {}
  return !!h["cf-mitigated"] || (/cloudflare/i.test(String(h.server || "")) && [403, 503].includes(res?.statusCode))
}

type Probe = { res: any | null; error: any | null }

async function probe(url: string, method: "head" | "get", timeoutMs: number): Promise<Probe> {
  try {
    const res = await got(url, {
      method: method === "head" ? "HEAD" : "GET",
      headers: BROWSER_HEADERS,
      timeout: { request: timeoutMs },
      retry: { limit: 0 },
      followRedirect: true,
      throwHttpErrors: false,
    })
    return { res, error: null }
  } catch (error: any) {
    return { res: null, error }
  }
}

const isTimeout = (e: any) =>
  e?.name === "TimeoutError" || /ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(`${e?.code || ""} ${e?.message || ""}`)

/** Classify one link: healthy (null), broken, or unverified. */
export async function checkLink(url: string): Promise<LinkCheckResult> {
  try {
    if (BOT_BLOCKING_HOSTS.test(new URL(url).hostname))
      return { status: 0, reason: "Not checked — site blocks automated checks", kind: "unverified" }
  } catch {
    return { status: 0, reason: "Malformed URL", kind: "broken" }
  }

  // HEAD first (cheap). Anything but a clean answer is confirmed with GET —
  // many servers mishandle HEAD.
  const head = await probe(url, "head", 10000)
  if (head.res && head.res.statusCode < 400) return null
  if (head.res?.statusCode === 429) await sleep(retryAfterMs(head.res.headers))

  let get = await probe(url, "get", 15000)
  // One more try for the transient cases: rate limit (after Retry-After), 5xx,
  // and a timeout (with a longer budget).
  if (get.res?.statusCode === 429) {
    await sleep(retryAfterMs(get.res.headers))
    get = await probe(url, "get", 15000)
  } else if (get.res && get.res.statusCode >= 500 && !isCloudflareChallenge(get.res)) {
    await sleep(2000)
    get = await probe(url, "get", 15000)
  } else if (get.error && isTimeout(get.error)) {
    get = await probe(url, "get", 25000)
  }

  if (get.res) {
    const code = get.res.statusCode
    if (code < 400) return null
    if (code === 429) return { status: 429, reason: "Rate limited (429)", kind: "unverified" }
    if (code === 999) return { status: 999, reason: "Blocked automated check (999)", kind: "unverified" }
    if (isCloudflareChallenge(get.res))
      return { status: code, reason: `Cloudflare bot challenge (${code})`, kind: "unverified" }
    if (code === 401 || code === 403)
      return { status: code, reason: `Access denied to automated check (${code})`, kind: "unverified" }
    return { status: code, reason: `Status ${code}`, kind: "broken" }
  }

  const e = get.error
  if (isTimeout(e)) return { status: 0, reason: "Timed out", kind: "unverified" }
  const code = String(e?.code || "")
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return { status: 0, reason: "Domain not found", kind: "broken" }
  return { status: 0, reason: code ? `Connection failed (${code})` : "Connection Failed", kind: "broken" }
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
}

interface ExtractedLink {
  url: string
  text: string
}

function extractUrlsFromHTML(html: string, baseUrl: string): ExtractedLink[] {
  const $ = cheerio.load(html)
  const linksMap = new Map<string, string>()

  // 1. Anchor tags
  $("a[href]").each((_, el) => {
    const url = $(el).attr("href")
    if (url) {
      linksMap.set(
        url,
        $(el).text().trim().substring(0, 50) || "No text content",
      )
    }
  })

  // 2. Images, scripts, links
  $("[src]").each((_, el) => {
    const url = $(el).attr("src")
    if (url && !linksMap.has(url)) {
      linksMap.set(url, `[Image/Media]`)
    }
  })

  $("[href]:not(a)").each((_, el) => {
    if (HINT_RELS.test($(el).attr("rel") || "")) return
    const url = $(el).attr("href")
    if (url && !linksMap.has(url)) {
      linksMap.set(url, `[Resource]`)
    }
  })

  const absoluteUrls = new Map<string, string>()
  const cleanBase = baseUrl.replace(/\/$/, "")
  let baseOrigin: string
  try {
    baseOrigin = new URL(baseUrl).origin
  } catch {
    baseOrigin = cleanBase
  }

  for (const [raw, text] of linksMap.entries()) {
    try {
      let absolute: string
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        absolute = raw
      } else if (raw.startsWith("//")) {
        absolute = "https:" + raw
      } else if (raw.startsWith("/")) {
        absolute = baseOrigin + raw
      } else if (
        raw.startsWith("data:") ||
        raw.startsWith("mailto:") ||
        raw.startsWith("tel:") ||
        raw.startsWith("javascript:")
      ) {
        continue
      } else {
        absolute = cleanBase + "/" + raw
      }

      absolute = absolute.split("#")[0]
      if (absolute && !absoluteUrls.has(absolute)) {
        absoluteUrls.set(absolute, text)
      }
    } catch {
      // Skip malformed
    }
  }

  return Array.from(absoluteUrls.entries()).map(([url, text]) => ({
    url,
    text,
  }))
}

export async function checkOptimizedLinks(
  page: any,
  pageRecord: any,
  mcpClient?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const pageUrl = pageRecord.url
  const runId = pageRecord.run_id

  // Drop caches left by runs that never completed. Cheap (a scan of a map that
  // should normally hold one or two entries) and it bounds worst-case growth
  // even if a completion path is ever missed.
  sweepStaleLinkCaches()

  // Clear stale in-memory caches when this is a retry, but avoid race conditions
  if (runId && pageRecord.isRetry) {
    const meta = runCacheMetadata.get(runId)
    // Only clear if the cache is older than 5 minutes (meaning it's from the original run, not a concurrent retry job)
    if (meta && Date.now() - meta.createdAt > 5 * 60 * 1000) {
      releaseLinkCaches(runId)
    }
  }

  let extractedLinks: ExtractedLink[] = []
  try {
    try {
      if (onProgress) await onProgress(10, "Extracting links from page HTML...")
      const response = await got.get(pageUrl, {
        headers: BROWSER_HEADERS,
        timeout: { request: 15000 },
        retry: { limit: 2 },
      })

      extractedLinks = extractUrlsFromHTML(response.body, pageUrl)

      logger.info(
        { pageUrl, linkCount: extractedLinks.length },
        "Extracted links from rendered HTML",
      )
    } catch (error: any) {
      logger.error(
        { pageUrl, error: error.message },
        "Failed to fetch HTML for link extraction",
      )
      // A fetch failure means the page was never scanned. Returning [] here
      // would be reported as "no broken links" — a false clean pass. Surface it
      // as a check failure instead.
      return [
        {
          check_factor: "dead_links",
          title: "Dead Links Check Failed",
          description: `Could not fetch the page to scan its links: ${error.message}. Process aborted gracefully; QACC will retry on the next run.`,
          context_text: "System Error",
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    if (extractedLinks.length === 0) return []
    if (onProgress)
      await onProgress(
        40,
        `Checking status of ${extractedLinks.length} extracted links...`,
      )
      
    const brokenLinks: {
      url: string
      status: number
      reason: string
      sourceUrl: string
      text: string
    }[] = []
    // Links the target would not let us verify — dashboard-only, not defects.
    const unverifiedLinks: { url: string; reason: string; text: string; found_on: string }[] = []
    
    // Link probes are I/O-bound, but each one still costs a TLS handshake, and
    // production runs qa-api + qa-worker on a single 2 vCPU / 4 GB box with
    // WORKER_CONCURRENCY=3 — so 50 in flight here can mean 150 process-wide,
    // alongside live browser contexts. 12 keeps the fan-out worthwhile without
    // starving the browsers (override per-environment if the box grows).
    const checkLimit = pLimit(LINK_PROBE_CONCURRENCY)

    if (!runLinkPromises.has(runId)) {
      runLinkPromises.set(runId, new Map())
      runCacheMetadata.set(runId, { createdAt: Date.now() })
      runTotalExtractedLinks.set(runId, 0)
    }
    
    const currentTotal = runTotalExtractedLinks.get(runId) || 0
    runTotalExtractedLinks.set(runId, currentTotal + extractedLinks.length)
    
    const linkPromises = runLinkPromises.get(runId)!

    const checkPromises = extractedLinks.map(
      ({ url: urlToCheck, text: linkText }) => {
        // OPT: Resolve the shared per-URL promise SYNCHRONOUSLY in the map body.
        // The get / create / set below is await-free, so it stays atomic exactly
        // as before — each unique URL is probed exactly once run-wide. The change:
        // a cache HIT now reuses the existing promise WITHOUT taking a checkLimit
        // slot (previously a duplicate link queued behind the limiter just to
        // await an already-resolved promise). Only a brand-NEW URL wraps its
        // network work in checkLimit, so bounded parallelism is preserved for the
        // 2 vCPU / 4 GB box. Every page still awaits and reports its own broken
        // links below — output is identical.
        let checkPromise = linkPromises.get(urlToCheck)

        if (!checkPromise) {
          checkPromise = checkLimit(() => checkLink(urlToCheck))

          linkPromises.set(urlToCheck, checkPromise)
        }

        // Awaiting the shared promise is free of a limiter slot; only the newly
        // created probe above holds one while its network work runs.
        return (async () => {
          const result = await checkPromise
          if (result?.kind === "unverified") {
            unverifiedLinks.push({
              url: urlToCheck,
              reason: result.reason,
              text: linkText,
              found_on: pageUrl,
            })
          } else if (result) {
            brokenLinks.push({
              url: urlToCheck,
              status: result.status,
              reason: result.reason,
              sourceUrl: pageUrl,
              text: linkText,
            })
          }
        })()
      },
    )
    await Promise.all(checkPromises)

    const countLine = `URLs extracted from this page: ${extractedLinks.length} | Total URLs checked in run so far: ${runTotalExtractedLinks.get(runId)}`
    const unverifiedLine = unverifiedLinks.length
      ? `\n${UNVERIFIED_LINKS_MARKER} ${JSON.stringify(unverifiedLinks)}`
      : ""

    if (brokenLinks.length === 0) {
      if (!unverifiedLinks.length) return []
      // Clean page, but keep the unverified list for the dashboard. The TED
      // report only ever shows this sentinel's description (a plain pass).
      return [
        {
          check_factor: "dead_links",
          title: "No dead link issues found",
          description: "No broken links found on this page.",
          status: "open",
          ai_generated: false,
          screenshot_url: null,
          context_text: countLine + unverifiedLine,
        } as Finding,
      ]
    }
    if (onProgress) await onProgress(90, "Finalizing dead link findings...")
    return [
      {
        check_factor: "dead_links",
        title: `${brokenLinks.length} broken link${brokenLinks.length === 1 ? "" : "s"} found`,
        description: brokenLinks
          .map(
            (b) =>
              `- **${b.url}**\n  * Reason: ${b.status || b.reason || "Failed"}\n  * Link Text: ${b.text}\n  * Found on: ${b.sourceUrl}`,
          )
          .join("\n"),
        status: "open",
        ai_generated: false,
        screenshot_url: null,
        context_text: countLine + unverifiedLine,
      },
    ]
  } catch (error: any) {
    return [
      {
        check_factor: "dead_links",
        title: "Dead Links Check Failed",
        description: `The check encountered an unexpected error: ${error.message}. Process aborted gracefully.`,
        context_text: "System Error",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}
