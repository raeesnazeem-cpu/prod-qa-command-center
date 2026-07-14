import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"

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
    const googleUrl = encodeURIComponent(
      `https://www.google.com/search?q=site:${domain}&num=100&filter=0`,
    )
    const scraperUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${googleUrl}&premium=true`
    await newPage.goto(scraperUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })

    if (onProgress) await onProgress(70, "Waiting for results to load...")

    const serps: any[] = []
    let hasNextPage = true
    let pagesChecked = 0

    while (hasNextPage && pagesChecked < 15) {
      pagesChecked++

      await newPage.waitForTimeout(3000)

      if (onProgress)
        await onProgress(
          70 + pagesChecked * 5,
          `Scrolling page ${pagesChecked}...`,
        )
      // Scroll down in case of lazy loaded images or continuous scroll
      for (let i = 0; i < 4; i++) {
        await newPage.evaluate(() => window.scrollBy(0, window.innerHeight * 2))
        await newPage.waitForTimeout(1000)
      }

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

      // Deduplicate and push
      pageSerps.forEach((s: any) => {
        if (!serps.find((r) => r.url === s.url)) {
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

      if (nextUrl && pagesChecked < 5) {
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
      return [
        {
          check_factor: "gsr_check",
          severity: "high",
          title: "Google Search Results (Failed)",
          description:
            "Failed to fetch Google Search results. The request was either blocked by Google or a CAPTCHA was encountered. Please try again.",
          context_text: "Scraping failed or returned 0 results.",
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        },
      ]
    }

    return [
      {
        check_factor: "gsr_check",
        severity: "low",
        title: `${serps.length} SERPs Found`,
        description: JSON.stringify(serps),
        context_text: `Found ${serps.length} SERPs for site:${domain}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      },
    ]
  } catch (error: any) {
    return [
      {
        check_factor: "gsr_check",
        severity: "high",
        title: "GSR Check Failed",
        description: "[]",
        context_text: `Error: ${error.message}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      },
    ]
  }
}
