import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"
import got from "got"
import pLimit from "p-limit"

export async function checkBrokenLinks(
  page: PlaywrightPage,
  pageRecord: any,
): Promise<Finding[]> {
  const links = await page.$$eval("a[href]", (els) =>
    els.map((el) => ({
      href: (el as HTMLAnchorElement).href,
      text: el.textContent?.trim() || "No text content",
    })),
  )

  // Filter for unique, valid HTTP/HTTPS URLs on the same domain or external
  const uniqueLinks = Array.from(new Set(links.map((l) => l.href)))
    .filter((href) => href.startsWith("http"))
    .map((href) => links.find((l) => l.href === href)!)

  if (uniqueLinks.length === 0) return []

  // Increased concurrency from 10 to 50 for blazing fast dead-link checks
  const limit = pLimit(25)
  const brokenLinks: { url: string; status: number; text: string }[] = []

  const tasks = uniqueLinks.map((link) =>
    limit(async () => {
      try {
        const response = await got.head(link.href, {
          timeout: { request: 5000 }, // Reduced timeout to 5 seconds
          retry: { limit: 0 }, // Disable retries for maximum speed
          followRedirect: true,
        })

        if (response.statusCode >= 400) {
          brokenLinks.push({
            url: link.href,
            status: response.statusCode,
            text: link.text,
          })
        }
      } catch (error: any) {
        const statusCode = error.response?.statusCode || 0
        // Only flag if it's a 4xx or 5xx, or a complete failure (0)
        if (statusCode >= 400 || statusCode === 0) {
          brokenLinks.push({
            url: link.href,
            status: statusCode,
            text: link.text,
          })
        }
      }
    }),
  )

  await Promise.all(tasks)

  if (brokenLinks.length === 0) return []

  const count = brokenLinks.length
  let severity: "medium" | "high" | "critical" = "medium"
  if (count >= 10) severity = "critical"
  else if (count >= 5) severity = "high"

  return [
    {
      check_factor: "broken_links",
      severity,
      title: `${count} broken link${count > 1 ? "s" : ""} found`,
      description: `The following URLs returned 4xx/5xx errors:\n${brokenLinks.map((l) => `- ${l.url} (${l.status === 0 ? "Failed" : l.status})`).join("\n")}`,
      context_text: brokenLinks
        .map((l) => `Link Text: "${l.text}" | URL: ${l.url}`)
        .join("\n"),
      screenshot_url: pageRecord.desktopUrl,
      status: "open",
      ai_generated: false,
    },
  ]
}
