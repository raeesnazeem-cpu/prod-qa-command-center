/**
 * GSR (General Search Result) verdict — the ONE place gsr_check pass / fail /
 * could-not-run is decided. The TED report, run_check_results and the live
 * issuesFound count all reach it through findingVerdict, so they cannot
 * disagree.
 *
 * A gsr_check row stores its search results as a JSON array in `description`
 * (the web GSR card reads it from there). That text is DATA, so the generic
 * title+description keyword rules must never judge it — a snippet saying
 * "not configured" or "no issues found" would flip the verdict.
 */

// Characters that must NOT appear in a clean result title/snippet: the Unicode
// replacement char (mojibake), unrendered HTML entities (&amp; / &#8211;),
// stray HTML tags, and control chars. Normal punctuation (– — | : etc.) and a
// bare "&" in text are fine, so they are deliberately not matched.
const SERP_REPLACEMENT = /�/
const SERP_ENTITY = /&(#\d+|[a-zA-Z]+);/
const SERP_TAG = /<[^>]{0,60}>/
const SERP_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/** "" when the result is clean, else a short reason naming what's wrong. */
export function serpBadReason(s: any): string {
  const fields: [string, string][] = [
    ["title", String(s?.title || "")],
    ["snippet", String(s?.description || "")],
  ]
  for (const [name, val] of fields) {
    if (SERP_REPLACEMENT.test(val)) return `invalid/garbled character in ${name}`
    if (SERP_ENTITY.test(val)) return `unrendered HTML entity in ${name}`
    if (SERP_TAG.test(val)) return `stray HTML tag in ${name}`
    if (SERP_CONTROL.test(val)) return `control character in ${name}`
  }
  return ""
}

/** The stored search results, or null when the row carries none. */
export function parseSerps(desc?: string | null): any[] | null {
  if (!desc || desc[0] !== "[") return null // cheap reject before JSON.parse
  try {
    const j = JSON.parse(desc)
    return Array.isArray(j) && j.length ? j : null
  } catch {
    return null
  }
}

export type GsrVerdict = "pass" | "fail" | "lapse"

// Memo per finding object: the classifiers run several times per row per
// report, and the JSON parse + scan is the only non-trivial cost. WeakMap, so
// nothing is retained after the row is dropped.
const memo = new WeakMap<object, GsrVerdict>()

/**
 * pass  = search results were read and none has invalid characters
 * fail  = at least one result has invalid characters
 * lapse = no results could be read (service out of credits, Google blocked the
 *         request, site not indexed, timeout …). Never a website defect.
 * Rows with no readable results — including legacy "Google Search Results
 * (Failed)" rows — are lapses: nothing about the site was established.
 */
export function gsrVerdict(f: any): GsrVerdict {
  const cacheable = f !== null && typeof f === "object"
  if (cacheable) {
    const hit = memo.get(f)
    if (hit) return hit
  }
  const serps = parseSerps(f?.description)
  let v: GsrVerdict
  if (!serps) v = "lapse"
  else v = serps.some((s) => serpBadReason(s)) ? "fail" : "pass"
  if (cacheable) memo.set(f, v)
  return v
}
