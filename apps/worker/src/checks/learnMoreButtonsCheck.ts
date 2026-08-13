import { Finding } from "@qacc/shared"
import got from "got"
import * as cheerio from "cheerio"
import pino from "pino"

const logger = pino({ level: process.env.LOG_LEVEL || "info" })

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
      const response = await got.get(pageUrl, {
        headers: BROWSER_HEADERS,
        timeout: { request: 15000 },
        retry: { limit: 2 },
      })

      const $ = cheerio.load(response.body)
      if (onProgress)
        await onProgress(50, "Parsing HTML for generic CTA buttons...")

      $("a, button, [role='button']").each((_, el) => {
        const text = $(el).text().trim().toLowerCase()
        if (TARGET_TEXTS.some((target) => text.includes(target))) {
          foundOccurrences.push({
            text: $(el).text().trim(),
            tag: el.tagName.toLowerCase(),
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
