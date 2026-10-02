import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"

/**
 * Accessibility Features — for NON-Growth99 sites (full scans with no repo).
 *
 * The Growth99 accessibility check (accessibilityCheck.ts) only looks for the
 * UserWay widget. A non-Growth99 site has no UserWay plan, so this check reads
 * the page itself for real accessibility problems instead:
 *   • <html> has no lang attribute
 *   • page has no <title>
 *   • zoom is blocked (viewport user-scalable=no / maximum-scale < 2)
 *   • images with no alt attribute
 *   • form fields with no label
 *   • links and buttons with no accessible name
 *   • no <h1> heading, or heading levels that skip (h2 → h4)
 *   • duplicate id attributes
 *
 * Runs on every page. One finding per page that has problems; a clean page
 * writes nothing (an empty check is a pass). check_factor is
 * "accessibility_features".
 */

const MAX_EXAMPLES = 5

interface A11yProblem {
  rule: string
  count: number
  examples: string[]
}

export async function checkAccessibilityFeatures(page: PlaywrightPage): Promise<Finding[]> {
  const pageUrl = page.url()
  const factor = "accessibility_features"
  try {
    const problems: A11yProblem[] = await page.evaluate((maxExamples) => {
      const out: { rule: string; count: number; examples: string[] }[] = []
      const visible = (el: Element) => {
        const s = window.getComputedStyle(el)
        if (s.display === "none" || s.visibility === "hidden") return false
        const r = (el as HTMLElement).getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      const hiddenFromAT = (el: Element) => !!el.closest("[aria-hidden='true']")
      const short = (el: Element) => {
        const tag = el.tagName.toLowerCase()
        const id = el.id ? `#${el.id}` : ""
        const src = (el as HTMLImageElement).getAttribute?.("src") || ""
        const href = el.getAttribute("href") || ""
        const name = el.getAttribute("name") || ""
        const extra = src || href || name
        return `<${tag}${id}>${extra ? " " + extra.slice(0, 80) : ""}`
      }
      const add = (rule: string, els: Element[]) => {
        if (els.length) out.push({ rule, count: els.length, examples: els.slice(0, maxExamples).map(short) })
      }
      const textOf = (el: Element) => (el.textContent || "").replace(/\s+/g, " ").trim()
      const labelledByText = (el: Element) =>
        (el.getAttribute("aria-labelledby") || "")
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => textOf(document.getElementById(id) || document.createElement("span")))
          .join(" ")
          .trim()
      const accName = (el: Element) =>
        (el.getAttribute("aria-label") || "").trim() ||
        labelledByText(el) ||
        (el.getAttribute("title") || "").trim() ||
        textOf(el) ||
        Array.from(el.querySelectorAll("img[alt], svg title, [aria-label]"))
          .map((c) => (c.getAttribute("alt") || c.getAttribute("aria-label") || c.textContent || "").trim())
          .join(" ")
          .trim()

      // Page-level
      if (!(document.documentElement.getAttribute("lang") || "").trim())
        out.push({ rule: "Missing lang attribute on <html>", count: 1, examples: [] })
      if (!(document.title || "").trim()) out.push({ rule: "Missing page <title>", count: 1, examples: [] })
      const vp = document.querySelector("meta[name='viewport']")?.getAttribute("content") || ""
      const maxScale = Number((vp.match(/maximum-scale\s*=\s*([\d.]+)/i) || [])[1])
      if (/user-scalable\s*=\s*(no|0)\b/i.test(vp) || (!isNaN(maxScale) && maxScale < 2))
        out.push({ rule: "Zoom is blocked by the viewport meta tag", count: 1, examples: [vp.slice(0, 120)] })

      // Images without alt (alt="" is fine: it marks a decorative image)
      add(
        "Images missing alt text",
        Array.from(document.querySelectorAll("img:not([alt])")).filter(
          (el) => visible(el) && !hiddenFromAT(el) && el.getAttribute("role") !== "presentation",
        ),
      )

      // Form fields without a label
      const fields = Array.from(
        document.querySelectorAll(
          "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image']), select, textarea",
        ),
      ).filter((el) => visible(el) && !hiddenFromAT(el))
      add(
        "Form fields missing a label",
        fields.filter((el) => {
          const id = el.id
          const hasFor = id && document.querySelector(`label[for="${CSS.escape(id)}"]`)
          return !(hasFor || el.closest("label") || (el.getAttribute("aria-label") || "").trim() || labelledByText(el) || (el.getAttribute("title") || "").trim())
        }),
      )

      // Links and buttons without an accessible name
      add(
        "Links missing an accessible name",
        Array.from(document.querySelectorAll("a[href]")).filter((el) => visible(el) && !hiddenFromAT(el) && !accName(el)),
      )
      add(
        "Buttons missing an accessible name",
        Array.from(document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")).filter(
          (el) =>
            visible(el) &&
            !hiddenFromAT(el) &&
            !accName(el) &&
            !((el as HTMLInputElement).value || "").trim(),
        ),
      )

      // Headings
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).filter(
        (el) => visible(el) && !hiddenFromAT(el),
      )
      if (!headings.some((h) => h.tagName === "H1"))
        out.push({ rule: "Missing <h1> heading", count: 1, examples: [] })
      const skips: Element[] = []
      let prev = 0
      for (const h of headings) {
        const level = Number(h.tagName[1])
        if (prev && level > prev + 1) skips.push(h)
        prev = level
      }
      if (skips.length)
        out.push({
          rule: "Heading levels skip, like h2 straight to h4",
          count: skips.length,
          examples: skips.slice(0, maxExamples).map((h) => `<${h.tagName.toLowerCase()}> ${textOf(h).slice(0, 60)}`),
        })

      // Duplicate ids
      const seen = new Map<string, number>()
      for (const el of Array.from(document.querySelectorAll("[id]"))) {
        const id = el.id.trim()
        if (id) seen.set(id, (seen.get(id) || 0) + 1)
      }
      const dupes = Array.from(seen.entries()).filter(([, n]) => n > 1)
      if (dupes.length)
        out.push({
          rule: "Duplicate id attributes",
          count: dupes.length,
          examples: dupes.slice(0, maxExamples).map(([id, n]) => `#${id} (${n}×)`),
        })

      return out
    }, MAX_EXAMPLES)

    if (!problems.length) return []

    const lines = problems.map(
      (p) => `${p.rule}${p.count > 1 ? ` (${p.count})` : ""}${p.examples.length ? `: ${p.examples.join(", ")}` : ""}`,
    )
    return [
      {
        check_factor: factor,
        title: `Accessibility: ${problems.length} accessibility problem${problems.length > 1 ? "s" : ""} on this page`,
        description: `This page has accessibility problems that make it harder to use with a screen reader or keyboard:\n• ${lines.join("\n• ")}`,
        context_text: `URL: ${pageUrl}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } catch (e: any) {
    return [
      {
        check_factor: factor,
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
