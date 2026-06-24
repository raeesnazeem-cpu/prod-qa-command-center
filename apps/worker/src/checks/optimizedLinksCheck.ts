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
//       severity: brokenLinks.length > 5 ? "critical" : "medium",
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

// Global caches — keyed by runId so they survive across multiple jobs in a single run
const runCheckedLinks = new Map<string, Set<string>>()
const runBrokenLinks = new Map<
  string,
  { url: string; reason: string; text: string; statusCode?: number }[]
>()

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
  // Clear stale in-memory caches when this is a retry so links are re-checked fresh
  const runId = pageRecord.run_id
  if (runId && pageRecord.isRetry) {
    runCheckedLinks.delete(runId)
    runBrokenLinks.delete(runId)
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
      return []
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
      sourceUrl: string
      text: string
    }[] = []
    const checkLimit = pLimit(50)
    const runId = pageRecord.run_id

    if (!runCheckedLinks.has(runId)) runCheckedLinks.set(runId, new Set())
    if (!runBrokenLinks.has(runId)) runBrokenLinks.set(runId, [])

    const checkedLinks = runCheckedLinks.get(runId)!
    const knownBrokenLinks = runBrokenLinks.get(runId)!

    const checkPromises = extractedLinks.map(
      ({ url: urlToCheck, text: linkText }) =>
        checkLimit(async () => {
          // --- CACHE CHECK: skip if we already checked this URL in this run ---
          if (checkedLinks.has(urlToCheck)) {
            // We do not add it to brokenLinks again to prevent massive UI duplication
            return
          }
          checkedLinks.add(urlToCheck)

          try {
            const response = await got.head(urlToCheck, {
              headers: BROWSER_HEADERS,
              timeout: { request: 10000 },
              retry: { limit: 1 },
              followRedirect: true,
            })

            if (response.statusCode >= 400) {
              brokenLinks.push({
                url: urlToCheck,
                status: response.statusCode,
                sourceUrl: pageUrl,
                text: linkText,
              })
              knownBrokenLinks.push({
                url: urlToCheck,
                reason: `Status ${response.statusCode}`,
                text: linkText,
                statusCode: response.statusCode,
              })
            }
          } catch (error: any) {
            const statusCode = error.response?.statusCode || 0
            if (statusCode >= 400 || statusCode === 0) {
              brokenLinks.push({
                url: urlToCheck,
                status: statusCode,
                sourceUrl: pageUrl,
                text: linkText,
              })
              knownBrokenLinks.push({
                url: urlToCheck,
                reason:
                  statusCode === 0
                    ? "Connection Failed"
                    : `Status ${statusCode}`,
                text: linkText,
                statusCode,
              })
            }
          }
        }),
    )
    await Promise.all(checkPromises)

    if (brokenLinks.length === 0) return []
    if (onProgress) await onProgress(90, "Finalizing dead link findings...")
    return [
      {
        check_factor: "dead_links",
        severity: brokenLinks.length > 5 ? "critical" : "medium",
        title: `${brokenLinks.length} broken link${brokenLinks.length === 1 ? "" : "s"} found`,
        description: brokenLinks
          .map(
            (b) =>
              `- **${b.url}**\n  * Reason: ${b.status || "Failed"}\n  * Link Text: ${b.text}\n  * Found on: ${b.sourceUrl}`,
          )
          .join("\n"),
        status: "open",
        ai_generated: false,
        screenshot_url: null,
        context_text: `URLs scanned on this page: ${extractedLinks.length} | Total unique URLs checked in run so far: ${runCheckedLinks.get(runId)!.size}`,
      },
    ]
  } catch (error: any) {
    return [
      {
        check_factor: "dead_links",
        severity: "high",
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
