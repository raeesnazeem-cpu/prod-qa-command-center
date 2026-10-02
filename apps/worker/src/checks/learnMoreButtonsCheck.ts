import { Finding } from "@qacc/shared"
import got from "got"
import * as cheerio from "cheerio"
import pino from "pino"
import {
  DESKTOP_UA,
  launchStealthBrowser,
  newRealContext,
  gotoResilient,
  looksBlocked,
} from "../lib/browserContext"

const logger = pino({ level: process.env.LOG_LEVEL || "info" })

const BROWSER_HEADERS = {
  "User-Agent": DESKTOP_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
}

// Raw HTML that a browser would show very differently: a bot-challenge page,
// or a client-rendered app shell (React/Next/Vue SPA) whose buttons only exist
// after its JavaScript runs.
function needsBrowser(html: string): boolean {
  const $ = cheerio.load(html || "")
  const title = $("title").first().text()
  $("script, style, noscript, template").remove()
  const text = $("body").text().replace(/\s+/g, " ").trim()
  if (/just a moment|attention required|verify you are human|checking your browser/i.test(`${title} ${text.slice(0, 500)}`))
    return true
  return text.length < 200
}

/** The page's HTML after a real (stealth) browser has rendered it. "" on failure. */
async function renderedHtml(pageUrl: string): Promise<string> {
  let browser: any = null
  try {
    browser = await launchStealthBrowser()
    const context = await newRealContext(browser)
    const page = await context.newPage()
    const nav = await gotoResilient(page, pageUrl, { timeout: 30000 })
    if (!nav.ok) return ""
    await page.waitForTimeout(1500)
    if (await looksBlocked(page)) {
      // Cloudflare's JS challenge usually clears itself within a few seconds.
      await page.waitForTimeout(5000)
      if (await looksBlocked(page)) return ""
    }
    return (await page.content()) || ""
  } catch {
    return ""
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

export async function checkLearnMoreButtons(
  pageUrl: string,
  runId: string,
  pageId: string,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const TARGET_TEXTS = ["learn more", "read more", "know more", "see more"]
  const foundOccurrences: { text: string; tag: string }[] = []

  try {
    try {
      if (onProgress)
        await onProgress(10, "Fetching HTML for Learn More Buttons check...")
      // Plain HTTP first (fast path, what WP sites have always used). Fall
      // back to a rendered browser page when that is refused or the HTML is
      // an empty SPA shell / challenge page.
      let html = ""
      let fetchError: any = null
      try {
        const response = await got.get(pageUrl, {
          headers: BROWSER_HEADERS,
          timeout: { request: 15000 },
          retry: { limit: 2 },
          https: { rejectUnauthorized: false },
        })
        html = response.body || ""
      } catch (e: any) {
        fetchError = e
      }
      if (fetchError || needsBrowser(html)) {
        if (onProgress) await onProgress(30, "Rendering page in a browser...")
        const rendered = await renderedHtml(pageUrl)
        if (rendered) html = rendered
        else if (fetchError) throw fetchError
      }

      const $ = cheerio.load(html)
      if (onProgress)
        await onProgress(50, "Parsing HTML for generic CTA buttons...")

      $("a, button, [role='button'], input[type='submit'], input[type='button']").each((_, el) => {
        const tag = (el as any).tagName ? String((el as any).tagName).toLowerCase() : ""
        const raw = tag === "input" ? $(el).attr("value") || "" : $(el).text()
        const text = raw.replace(/\s+/g, " ").trim().toLowerCase()
        if (TARGET_TEXTS.some((target) => text.includes(target))) {
          foundOccurrences.push({
            text: raw.replace(/\s+/g, " ").trim().slice(0, 120),
            tag: tag || "element",
          })
        }
      })
    } catch (error: any) {
      logger.error(
        { pageUrl, error: error.message },
        "Failed to fetch HTML for Learn More Buttons check",
      )
      // A fetch failure means the page was never scanned. Returning [] here is
      // reported as a clean pass ("check ran, nothing to report"). Surface the
      // failure instead — mirror the outer catch's shape.
      return [
        {
          check_factor: "learn_more_buttons",
          title: "Learn More Buttons Check Failed",
          description: `Could not fetch the page to scan its buttons: ${error.message}. Process aborted gracefully; QACC will retry on the next run.`,
          context_text: "System Error",
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    if (foundOccurrences.length === 0) {
      if (onProgress)
        await onProgress(90, "Finalizing Learn More Buttons findings...")
      return [
        {
          check_factor: "learn_more_buttons",
          title: "No generic See More/Learn More buttons found",
          description:
            "No issues found. No buttons/links with text 'Learn More', 'Read More', 'Know More', or 'See More' were found on this page.",
          status: "open",
          ai_generated: false,
          screenshot_url: null,
          context_text: "Checked a, button, and role='button' elements.",
        },
      ]
    }

    if (onProgress)
      await onProgress(90, "Finalizing Learn More Buttons findings...")
    // A generic CTA IS present -> this is the failing case. Show exactly which
    // button text was found and on which page it occurred. (`source: <pageUrl>`
    // is added by the report from the finding's page; each bullet names the
    // element + its exact text so a human can locate it.)
    return [
      {
        check_factor: "learn_more_buttons",
        title: `${foundOccurrences.length} generic CTA button(s) found`,
        description: foundOccurrences
          .map((b) => `- “${b.text}” (in a <${b.tag}> element)`)
          .join("\n"),
        status: "open",
        ai_generated: false,
        screenshot_url: null,
        context_text: `Page: ${pageUrl}\nGeneric CTA text should be more descriptive for SEO and accessibility.`,
      },
    ]
  } catch (error: any) {
    return [
      {
        check_factor: "learn_more_buttons",
        title: "Learn More Buttons Check Failed",
        description: `The check encountered an unexpected error: ${error.message}. Process aborted gracefully.`,
        context_text: "System Error",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}
