import { Page as PlaywrightPage } from "playwright"
import { Finding, aiFailureReason, AI_REASON_UNREADABLE } from "@qacc/shared"
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

    // Read the reply ONLY when it is valid JSON with an `issues` array. Anything
    // else is unreadable — never an empty list, which would be a false pass.
    const readIssues = (resp: string): any[] | null => {
      const m = String(resp || "").match(/\{[\s\S]*\}/)
      if (!m) return null
      try {
        const o = JSON.parse(m[0])
        return Array.isArray(o?.issues) ? o.issues : null
      } catch {
        return null
      }
    }

    let issues: any[] | null = null
    let aiError: Error | null = null
    try {
      issues = readIssues((await completeText(system, user)).text)
      // One retry with a stricter instruction before giving up on the reply.
      if (issues === null)
        issues = readIssues(
          (
            await completeText(
              system,
              `${user}\n\nIMPORTANT: reply with the JSON object ONLY — no prose, no code fences.`,
            )
          ).text,
        )
    } catch (e: any) {
      aiError = e
    }

    // The AI failed or its reply could not be read: DO NOT report a clean pass —
    // that would be a false "no issues found". Surface it as a tool lapse with
    // the honest reason (limit exhausted / unavailable / unreadable).
    if (aiError || issues === null) {
      const reason = aiError ? aiFailureReason(aiError.message) : AI_REASON_UNREADABLE
      return [
        {
          check_factor: "grammar",
          title: "Grammar Check Failed",
          description: `Could not complete: ${reason}${aiError ? ` (${aiError.message})` : ""}. Process aborted gracefully.`,
          context_text: `URL: ${pageUrl}`,
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    if (issues.length === 0) {
      return [
        {
          check_factor: "grammar",
          title: "No grammar issues found",
          description: `No clear grammar, spelling, or punctuation issues were detected in this page's copy${text.length > snippet.length ? ` (checked the first ${snippet.length} characters)` : ""}.`,
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
