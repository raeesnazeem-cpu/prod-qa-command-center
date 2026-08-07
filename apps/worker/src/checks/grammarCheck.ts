import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"
import { completeText } from "../lib/aiFallback"

/**
 * Grammar Check (all pages). Extracts the page's visible text and asks the
 * fallback-loop AI for clear grammar / spelling / punctuation mistakes.
 * Shared-page check: (page, pageRecord). check_factor "grammar".
 */
export async function checkGrammar(
  page: PlaywrightPage,
  _pageRecord: any,
): Promise<Finding[]> {
  const pageUrl = page.url()
  try {
    const text: string = await page.evaluate(() =>
      (document.body?.innerText || "").replace(/\s+/g, " ").trim(),
    )
    if (!text || text.length < 40) return []
    const snippet = text.slice(0, 4000)

    const system =
      "You are a meticulous website copy editor. Report only CLEAR grammar, spelling, and punctuation mistakes in the copy. Ignore brand/product names, proper nouns, and stylistic choices."
    const user = `Page: ${pageUrl}\n\nCopy:\n"""${snippet}"""\n\nReturn STRICT JSON only: {"issues":[{"excerpt":"<short quote>","issue":"<what is wrong>","suggestion":"<the fix>"}]}. Empty array if the copy is clean. Max 15 issues.`

    let issues: any[] = []
    try {
      const { text: resp } = await completeText(system, user)
      const m = resp.match(/\{[\s\S]*\}/)
      if (m) {
        const o = JSON.parse(m[0])
        if (Array.isArray(o.issues)) issues = o.issues
      }
    } catch {}

    if (issues.length === 0) {
      return [
        {
          check_factor: "grammar",
          severity: "low",
          title: "No grammar issues found",
          description: "No clear grammar, spelling, or punctuation issues were detected in this page's copy.",
          context_text: `URL: ${pageUrl}`,
          screenshot_url: null,
          status: "open",
          ai_generated: true,
        } as Finding,
      ]
    }

    return issues.slice(0, 15).map(
      (it) =>
        ({
          check_factor: "grammar",
          severity: "medium",
          title: `Grammar: ${String(it.issue || "issue").slice(0, 80)}`,
          description: `"${it.excerpt || ""}" — ${it.issue || ""}${it.suggestion ? `. Suggestion: ${it.suggestion}` : ""}`,
          context_text: `URL: ${pageUrl}`,
          screenshot_url: null,
          status: "open",
          ai_generated: true,
        }) as Finding,
    )
  } catch (e: any) {
    return [
      {
        check_factor: "grammar",
        severity: "medium",
        title: "Grammar Check Failed",
        description: `The grammar check encountered an error: ${e.message}.`,
        context_text: `URL: ${pageUrl}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}
