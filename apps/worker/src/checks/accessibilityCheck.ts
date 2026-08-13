import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"

/**
 * Accessibility Check (all pages) — deterministic WCAG spot-checks via DOM:
 * images missing alt, missing <html lang>, missing <title>, unlabeled form
 * fields, controls with no accessible name, skipped heading levels.
 * Shared-page check: (page, pageRecord). check_factor "accessibility_check".
 * (Distinct from the legacy `accessibility` bundle key.)
 */
export async function checkAccessibility(
  page: PlaywrightPage,
  _pageRecord: any,
): Promise<Finding[]> {
  const pageUrl = page.url()
  try {
    const issues: { type: string; detail: string }[] = await page.evaluate(() => {
      const out: { type: string; detail: string }[] = []

      const imgs = Array.from(document.querySelectorAll("img"))
      const noAlt = imgs.filter((i) => !i.hasAttribute("alt"))
      if (noAlt.length) out.push({ type: "Images missing alt", detail: `${noAlt.length} image(s) have no alt attribute.` })

      if (!document.documentElement.getAttribute("lang"))
        out.push({ type: "Missing lang", detail: "The <html> element has no lang attribute." })

      if (!document.title || !document.title.trim())
        out.push({ type: "Missing title", detail: "The document has no <title>." })

      const fields = Array.from(
        document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea"),
      )
      const unlabeled = fields.filter((el) => {
        const id = el.getAttribute("id")
        const hasLabel = !!(id && document.querySelector(`label[for="${id}"]`))
        const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")
        return !hasLabel && !aria
      })
      if (unlabeled.length) out.push({ type: "Unlabeled form fields", detail: `${unlabeled.length} form field(s) have no associated label.` })

      const controls = Array.from(document.querySelectorAll("button, a[href]"))
      const noName = controls.filter((el) => {
        const txt = (el.textContent || "").trim()
        const aria = el.getAttribute("aria-label") || el.getAttribute("title")
        const imgAlt = el.querySelector("img[alt]")?.getAttribute("alt")?.trim()
        return !txt && !aria && !imgAlt
      })
      if (noName.length) out.push({ type: "Controls without a name", detail: `${noName.length} button(s)/link(s) have no accessible name.` })

      const levels = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) => parseInt(h.tagName[1]))
      let skip = false
      let prev = 0
      for (const lvl of levels) {
        if (prev && lvl - prev > 1) {
          skip = true
          break
        }
        prev = lvl
      }
      if (skip) out.push({ type: "Heading order", detail: "Heading levels skip a level (e.g. h2 → h4)." })

      return out
    })

    if (!issues || issues.length === 0) {
      return [
        {
          check_factor: "accessibility_check",
          title: "No accessibility issues found",
          description: "No common WCAG issues (alt text, form labels, lang, title, control names, heading order) were detected on this page.",
          context_text: `URL: ${pageUrl}`,
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    return issues.map(
      (r) =>
        ({
          check_factor: "accessibility_check",
          title: `Accessibility: ${r.type}`,
          description: r.detail,
          context_text: `URL: ${pageUrl}`,
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        }) as Finding,
    )
  } catch (e: any) {
    return [
      {
        check_factor: "accessibility_check",
        title: "Accessibility Check Failed",
        description: `The accessibility check encountered an error: ${e.message}.`,
        context_text: `URL: ${pageUrl}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}
