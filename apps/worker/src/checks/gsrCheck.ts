import { Page as PlaywrightPage } from "playwright"
import { Finding, serpBadReason } from "@qacc/shared"

const NOT_SITE = "This is not a problem with the website."

/**
 * Why the Google results could not be read, in plain words, from what the
 * search service (ScraperAPI) actually returned. Exported for tests.
 * Returns "" when nothing identifies a failure.
 */
export function describeGsrFailure(
  httpStatus: number | null,
  bodyText: string,
  domain: string,
): string {
  const body = (bodyText || "").slice(0, 4000)
  const svc = "The Google search service (ScraperAPI)"
  if (/exhausted the api credits|out of credits|credit limit/i.test(body))
    return `${svc} has used up its monthly request credits, so Google could not be searched. Top up the plan or wait for the monthly reset, then rerun. ${NOT_SITE}`
  if (httpStatus === 401 || /invalid api key|api key.*(invalid|missing|required)|unauthori[sz]ed/i.test(body))
    return `${svc} rejected the API key, so Google could not be searched. Check the key, then rerun. ${NOT_SITE}`
  if (httpStatus === 429 || /too many (concurrent )?requests|rate limit/i.test(body))
    return `${svc} hit its request rate limit, so Google could not be searched. Rerun in a few minutes. ${NOT_SITE}`
  if (/unusual traffic|\/sorry\/|captcha|not a robot/i.test(body))
    return `Google blocked the search request with a CAPTCHA / unusual-traffic check. Rerun later. ${NOT_SITE}`
  if (/did not match any documents|no results found for/i.test(body))
    return `Google has no indexed results for site:${domain} yet, so there were no search results to check. This is normal for a new or beta site hidden from search engines.`
  if (httpStatus !== null && httpStatus >= 500)
    return `${svc} could not fetch Google's results (HTTP ${httpStatus} after its own retries). Rerun later. ${NOT_SITE}`
  if (httpStatus !== null && httpStatus >= 400)
    return `${svc} refused the request (HTTP ${httpStatus}${body.trim() ? `: ${body.trim().slice(0, 160)}` : ""}). ${NOT_SITE}`
  return ""
}

function couldNotRun(reason: string, detail: string): Finding {
  return {
    check_factor: "gsr_check",
    // "Skipped" marks it as could-not-run in the shared verdict (never a defect).
    title: "GSR Check Skipped — could not run",
    description: reason,
    context_text: detail,
    screenshot_url: null,
    status: "open",
    ai_generated: false,
  } as Finding
}

// How many SERP pages to walk. Previously the while-loop said 15 while the
// pagination guard said 5, so 5 was the real bound and 15 was misleading.
const MAX_SERP_PAGES = 5

export async function checkGsr(
  page: PlaywrightPage,
  pageRecord: any,
  onProgress?: (progress: number, step: string) => Promise<void>,
): Promise<Finding[]> {
  try {
    if (onProgress) await onProgress(10, "Initializing search...")
    const urlObj = new URL(pageRecord.url)
    const domain = urlObj.hostname.replace(/^www\./, "")

    // Create a new page so we don't mess up the original page's state
    const context = page.context()
    const newPage = await context.newPage()

    if (onProgress)
      await onProgress(40, `Searching Google for site:${domain}...`)
    // Navigate to google
    const apiKey = process.env.SCRAPER_API_KEY
    if (!apiKey) {
      await newPage.close().catch(() => {})
      return [
        couldNotRun(
          `The Google search service (ScraperAPI) has no API key configured, so Google could not be searched. ${NOT_SITE}`,
          "SCRAPER_API_KEY not set",
        ),
      ]
    }
    const googleUrl = encodeURIComponent(
      `https://www.google.com/search?q=site:${domain}&num=100&filter=0`,
    )
    const scraperUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${googleUrl}&premium=true`
    // Keep the first response so a failure can be explained exactly.
    let firstStatus: number | null = null
    let firstBody = ""
    try {
      const resp = await newPage.goto(scraperUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      })
      firstStatus = resp ? resp.status() : null
    } catch (e: any) {
      await newPage.close().catch(() => {})
      const timedOut = /timeout/i.test(e?.message || "")
      return [
        couldNotRun(
          timedOut
            ? `The Google search service (ScraperAPI) did not respond within 60 seconds. Rerun later. ${NOT_SITE}`
            : `The Google search service (ScraperAPI) could not be reached (${e?.message || e}). Rerun later. ${NOT_SITE}`,
          `site:${domain}`,
        ),
      ]
    }
    firstBody = await newPage
      .evaluate(() => (document.body?.innerText || "").slice(0, 4000))
      .catch(() => "")
    const earlyReason =
      firstStatus !== null && firstStatus >= 400
        ? describeGsrFailure(firstStatus, firstBody, domain)
        : ""
    if (earlyReason) {
      await newPage.close().catch(() => {})
      return [couldNotRun(earlyReason, `HTTP ${firstStatus} for site:${domain}`)]
    }

    if (onProgress) await onProgress(70, "Waiting for results to load...")

    const serps: any[] = []
    const seenSerpUrls = new Set<string>()
    let hasNextPage = true
    let pagesChecked = 0

    while (hasNextPage && pagesChecked < MAX_SERP_PAGES) {
      pagesChecked++

      // OPT: This SERP page is a static ScraperAPI-rendered HTML snapshot, so all
      // results already exist at domcontentloaded and scrolling loads nothing new.
      // Replace the blind 3s wait + the 4×1s scroll-wait loop (~7s/page) with a
      // single real load signal: wait for the first result <h3> to appear, capped
      // at 4s (well under the ~7s it replaces). `.catch(() => {})` makes a timeout
      // fall through and proceed, so it never throws and never hangs — worst case
      // is the same as the old sleep. The "0 results ⇒ blocked/CAPTCHA" branch
      // below still evaluates on whatever the page parsed.
      await newPage.waitForSelector("h3", { timeout: 4000 }).catch(() => {})

      if (onProgress)
        await onProgress(
          70 + pagesChecked * 5,
          `Scrolling page ${pagesChecked}...`,
        )

      if (onProgress)
        await onProgress(
          80 + pagesChecked,
          `Parsing page ${pagesChecked} results...`,
        )

      const pageSerps = await newPage.evaluate(() => {
        const results: any[] = []
        const titleElements = document.querySelectorAll("h3")

        titleElements.forEach((h3) => {
          const linkEl = h3.closest("a")
          if (!linkEl || !linkEl.href) return
          if (linkEl.href.includes("google.com/search")) return

          let block = h3.closest(
            "div.g, div.MjjYud, div.yuRUbf, div.jGGQ5e, .tF2Cxc",
          )
          if (!block) {
            // Fallback: grab the 3rd parent up
            block = h3.parentElement?.parentElement
              ?.parentElement as Element | null
          }

          let desc = ""
          if (block) {
            const descEl = block.querySelector(
              'div[style*="-webkit-line-clamp"], div[data-sncf="1"], .VwiC3b, .yXK7lf, .MUxGbd, .lyLwlc, .aCOpRe, span.st',
            )
            if (descEl) {
              desc = descEl.textContent?.trim() || ""
            } else {
              // Fallback: extract text and remove title/url text
              let allText = block.textContent || ""
              allText = allText.replace(h3.textContent || "", "").trim()
              const cite = block.querySelector("cite")
              if (cite)
                allText = allText.replace(cite.textContent || "", "").trim()
              // Remove date strings like "May 15, 2024 — "
              allText = allText
                .replace(/^[A-Z][a-z]{2} \d{1,2}, \d{4} — /, "")
                .trim()
              // Trim some common Google UI artifacts
              allText = allText
                .replace(/^Cached\s*/i, "")
                .replace(/^Similar\s*/i, "")
                .trim()
              // Take first 300 chars if it's too long
              desc =
                allText.length > 300
                  ? allText.substring(0, 300) + "..."
                  : allText
            }
          }

          results.push({
            title: h3.textContent?.trim() || "",
            url: linkEl.href,
            description: desc,
          })
        })

        return results
      })

      // Deduplicate and push. Membership is a Set of URLs rather than a
      // `serps.find(...)` scan per result — with up to 5 pages of ~100 results
      // the old form ran on the order of 125k comparisons.
      pageSerps.forEach((s: any) => {
        if (!seenSerpUrls.has(s.url)) {
          seenSerpUrls.add(s.url)
          serps.push(s)
        }
      })

      // Check for classic pagination "Next" button
      const nextUrl = await newPage.evaluate(() => {
        const getGoogleUrl = (href: string) => {
          try {
            const url = new URL(href, window.location.href)
            return `https://www.google.com${url.pathname}${url.search}`
          } catch (e) {
            return href
          }
        }
        
        const nextBtn = document.querySelector(
          'a#pnnext, a[aria-label="Next page"], a[aria-label="Next"]',
        ) as HTMLAnchorElement
        if (nextBtn) return getGoogleUrl(nextBtn.href)

        const allLinks = Array.from(document.querySelectorAll("a"))
        const nextLink = allLinks.find((a) =>
          a.querySelector("span")?.textContent?.includes("Next"),
        )
        return nextLink ? getGoogleUrl(nextLink.href) : null
      })

      if (nextUrl && pagesChecked < MAX_SERP_PAGES) {
        if (onProgress) await onProgress(85, `Loading next page...`)
        const scraperNextUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(nextUrl)}&premium=true`
        await newPage.goto(scraperNextUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        })
      } else {
        hasNextPage = false
      }
    }

    await newPage.close()

    if (serps.length === 0) {
      const reason =
        describeGsrFailure(firstStatus, firstBody, domain) ||
        `Google returned a page with no readable search results for site:${domain}. Rerun later. ${NOT_SITE}`
      return [couldNotRun(reason, `0 results for site:${domain}`)]
    }

    // Verdict is decided here with the SAME rule the report and the live count
    // use (@qacc/shared serpBadReason), so the saved title can't contradict it.
    // The results stay in `description` — the web GSR card reads them there.
    const bad = serps.reduce((n, s) => (serpBadReason(s) ? n + 1 : n), 0)
    return [
      {
        check_factor: "gsr_check",
        title: bad
          ? `${bad} of ${serps.length} Google search results contain invalid characters`
          : `${serps.length} Google search results checked — no issues found`,
        description: JSON.stringify(serps),
        context_text: `Found ${serps.length} search results for site:${domain}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      },
    ]
  } catch (error: any) {
    return [
      {
        check_factor: "gsr_check",
        title: "GSR Check Failed",
        // NOT "[]": on success `description` carries JSON.stringify(serps), so a
        // consumer parsing it would read "[]" as a valid, empty "0 SERPs found"
        // result — a crash masquerading as a clean empty pass. Use a plain
        // human-readable error string instead.
        description: `The Google search result check stopped with an error (${error.message}). Rerun to try again.`,
        context_text: `Error: ${error.message}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      },
    ]
  }
}
