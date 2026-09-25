import { gsrVerdict } from "./gsrVerdict"

/**
 * How a finding, and then a whole check, is judged pass or fail.
 *
 * These classifiers used to live in `apps/worker/src/lib/tedSync.ts`, where only
 * the report renderer could reach them. The TED-facing progress endpoint in
 * `apps/api` needs exactly the same judgement — if the two ever drift, the live
 * per-check counts and the final report disagree about the same run, and there
 * is no way to tell which one is lying. Shared, they cannot drift.
 *
 * Findings are not all defects. Checks also insert "clean pass" sentinels to
 * record that they ran and found nothing, informational rows, and tool-lapse
 * rows when QACC itself failed. Counting raw rows as issues would make a clean
 * site look broken.
 */

/**
 * Checks whose verdict comes from an AI-vision read of a screenshot. For these,
 * NO finding at all is not a pass: nothing was verified, so there is nothing to
 * pass on. Everywhere else an empty result at the end of a run means the check
 * ran clean.
 */
export const VISION_VERDICT_CHECKS = new Set(["logo_chatbot", "footer_logo"])

/**
 * Checks that emit a purely informational row every run (e.g. `plugin_number`
 * reports the detected plugin count for a human to eyeball). Not a defect, and
 * not a "no issues found" sentinel either.
 */
const INFORMATIONAL_CHECKS = new Set(["plugin_number", "video_recording"])

/**
 * Checks whose per-page verdict depends on an AI (text or vision) call. For
 * these, a lapse on ANY page stops the check from passing: pages the AI never
 * read are not evidence the site is fine, so a mix of clean pages and lapsed
 * pages is "could not complete", not a pass. A real defect still fails it.
 */
export const AI_VERDICT_CHECKS = new Set(["grammar", "image_quality", "project_plan"])

// The honest, specific reasons an AI-backed check could not complete. Checks
// put one of these in their lapse description so the report can say WHY.
export const AI_REASON_LIMIT = "AI limit exhausted"
export const AI_REASON_UNAVAILABLE = "AI service unavailable"
export const AI_REASON_UNREADABLE = "AI reply could not be read"
export const AI_REASON_NOT_CONFIGURED = "no AI provider configured"
const AI_REASONS = [
  AI_REASON_LIMIT,
  AI_REASON_UNREADABLE,
  AI_REASON_NOT_CONFIGURED,
  AI_REASON_UNAVAILABLE,
]

/**
 * Map a raw AI error message to one honest reason. Only a real rate-limit /
 * quota / credits signal is called "limit exhausted"; timeouts and server
 * errors are "unavailable", so nobody waits on a limit reset for a missing key.
 */
export function aiFailureReason(error: string): string {
  const e = String(error || "").toLowerCase()
  if (/no ai providers available|no vision provider configured|no key/.test(e))
    return AI_REASON_NOT_CONFIGURED
  if (/\b(429|402)\b|quota|rate.?limit|resource_exhausted|too many requests|credits?\b/.test(e))
    return AI_REASON_LIMIT
  if (/could not be read|unreadable/.test(e)) return AI_REASON_UNREADABLE
  return AI_REASON_UNAVAILABLE
}

/**
 * True when an AI-verdict check has no real defect but at least one page
 * lapsed — so it must be "could not complete", never a pass.
 */
export function aiLapseBlocksPass(checkFactor: string, findings: any[]): boolean {
  return (
    AI_VERDICT_CHECKS.has(checkFactor) &&
    (findings || []).some(isToolLapseFinding) &&
    !(findings || []).some(isRealDefect)
  )
}

/**
 * One line saying why an AI-verdict check could not complete, and how much of
 * the site it did cover, e.g. "AI limit exhausted (checked 3 of 20 pages)".
 */
export function aiLapseSummary(findings: any[]): string {
  const all = findings || []
  const lapses = all.filter(isToolLapseFinding)
  const text = lapses.map((f) => `${f?.title || ""} ${f?.description || ""}`).join(" ")
  // The most common named reason wins; a lapse that names none is "unavailable".
  const counts = AI_REASONS.map((r) => ({
    r,
    n: text.split(r).length - 1,
  })).sort((a, b) => b.n - a.n)
  // No named AI reason: use the check's own "Could not complete: <why>" text.
  const own = text.match(/could not complete:\s*([^.(]+)/i)?.[1]?.trim()
  const reason = counts[0].n > 0 ? counts[0].r : own || AI_REASON_UNAVAILABLE
  const pageKey = (f: any, i: number) => (f?.page_id ? String(f.page_id) : `row-${i}`)
  const pages = new Set(all.map(pageKey))
  const lapsed = new Set(all.map((f, i) => (isToolLapseFinding(f) ? pageKey(f, i) : null)).filter(Boolean))
  const checked = [...pages].filter((p) => !lapsed.has(p)).length
  return pages.size > 1 ? `${reason} (checked ${checked} of ${pages.size} pages)` : reason
}

/**
 * A QACC-side failure — the check could not complete (missing credential, API
 * key, timeout, upstream error). Neither a site defect nor a pass: nothing about
 * the site was established either way.
 */
export function isToolLapseFinding(f: any): boolean {
  if (f?.check_factor === "gsr_check") return gsrVerdict(f) === "lapse"
  const t = String(f?.title || "").toLowerCase()
  const d = String(f?.description || "").toLowerCase()
  const s = `${t} ${d}`
  return (
    /check (failed|error)\b/.test(t) ||
    /failed or timed out/.test(t) ||
    /(check )?skipped/.test(t) ||
    /not configured|no password|was not provided/.test(s) ||
    /process aborted gracefully/.test(d) ||
    /encountered an (unexpected )?error/.test(d) ||
    /encountered a timeout/.test(d) ||
    /request failed with status code/.test(d) ||
    /google_places_api_key/.test(s) ||
    /could not obtain|ai triage failed/.test(s)
  )
}

/**
 * A sentinel some checks insert to record that they ran and found nothing (e.g.
 * "No accessibility issues found"). Kept distinct from a tool lapse, which is
 * QACC failing rather than the site being clean.
 */
export function isCleanPassFinding(f: any): boolean {
  if (f?.check_factor === "gsr_check") return gsrVerdict(f) === "pass"
  const t = String(f?.title || "").toLowerCase()
  const d = String(f?.description || "").toLowerCase()
  const s = `${t} ${d}`
  const NOUN =
    "issue|issues|problem|problems|error|errors|break|breaks|violation|violations|mismatch|mismatches|difference|differences|defect|defects"
  const VERB = "found|detected|triggered|present|identified|were|was"
  return (
    // "no <noun> ... <verb>" — e.g. "no issues found", "no ... errors ... were triggered"
    new RegExp(`\\bno\\b[^.!?]{0,80}\\b(${NOUN})\\b[^.!?]{0,40}\\b(${VERB})\\b`).test(s) ||
    /\bno common\b[^.!?]{0,80}\b(detected|found)\b/.test(s) ||
    /\bnone (found|detected)\b/.test(s) ||
    // pass-style TITLES stating absence without a trailing verb, e.g.
    // "Functionality: no interaction errors or breaks"
    new RegExp(`\\bno\\b[^.!?]{0,40}\\b(${NOUN})\\b(\\s+or\\s+\\w+)?\\s*$`).test(t)
  )
}

/** Informational row from a check that always reports one. Treated as a pass that states a fact. */
export function isInformationalFinding(f: any): boolean {
  return INFORMATIONAL_CHECKS.has(f?.check_factor) && !isToolLapseFinding(f)
}

/**
 * A real site defect: not a tool lapse, not a clean-pass sentinel, not purely
 * informational. This is the set the fix module works from.
 */
export function isRealDefect(f: any): boolean {
  return (
    !isToolLapseFinding(f) && !isCleanPassFinding(f) && !isInformationalFinding(f)
  )
}

/**
 * How one check came out. `lapsed` (QACC could not run the check) and `notRun`
 * (mid-scan, the check has not produced anything yet) are kept distinct from
 * pass/fail so the live per-check board never blames the client for our outage
 * and never shows green for a check that has not started.
 */
export type CheckResult = "pass" | "fail" | "lapsed" | "notRun"

/**
 * How one check came out, given every finding it produced.
 *
 * `runComplete` matters because an empty result means different things at
 * different times: mid-scan the check simply has not run yet, while at the end
 * of a completed run it means the check ran and found nothing. Reporting
 * "pass" for a check that has not started would show a green board for a scan
 * that has barely begun.
 */
export function resultForCheck(
  checkFactor: string,
  findings: any[],
  runComplete: boolean,
): CheckResult {
  if (!findings || findings.length === 0) {
    if (!runComplete) return "notRun"
    // A vision-verdict check that emitted nothing verified nothing, so it cannot
    // be called a pass — same rule the report renderer applies.
    return VISION_VERDICT_CHECKS.has(checkFactor) ? "lapsed" : "pass"
  }
  // Any real defect fails the check, even alongside lapses — mirrors the report,
  // where a non-empty `real` set is what makes a section "failed".
  if (findings.some(isRealDefect)) return "fail"
  // Only lapses: the check never established anything. The client-facing report
  // currently renders this as a pass; we report it separately instead, because a
  // check that could not run is not evidence that the site is fine. It is
  // counted in neither `passed` nor `failed`.
  if (findings.every(isToolLapseFinding)) return "lapsed"
  // AI-backed checks: any page the AI never read blocks a pass.
  if (aiLapseBlocksPass(checkFactor, findings)) return "lapsed"
  return "pass"
}

export interface CheckBreakdownRow {
  check: string
  result: CheckResult
  /** Real defects only — never clean-pass sentinels, lapses or informational rows. */
  issues: number
}

export interface CheckBreakdown {
  summary: { total: number; passed: number; failed: number; lapsed: number; notRun: number }
  list: CheckBreakdownRow[]
}

/**
 * Roll every enabled check up into the per-check board.
 *
 * Driven by `enabledChecks`, not by the findings present: a check that has
 * produced nothing yet still has to appear, otherwise the board grows rows as
 * the scan proceeds and the total keeps changing under the reader.
 */
export function rollupChecks(
  enabledChecks: string[],
  findings: any[],
  runComplete: boolean,
): CheckBreakdown {
  const byCheck = new Map<string, any[]>()
  for (const f of findings || []) {
    const k = f?.check_factor || "other"
    if (!byCheck.has(k)) byCheck.set(k, [])
    byCheck.get(k)!.push(f)
  }
  // Findings can carry a check that is not in enabled_checks (a retry, or a
  // check renamed since the run started). Showing them is more honest than
  // silently dropping results the scan actually produced.
  const checks = [...new Set([...(enabledChecks || []), ...byCheck.keys()])]

  const list: CheckBreakdownRow[] = checks.map((check) => {
    const group = byCheck.get(check) || []
    return {
      check,
      result: resultForCheck(check, group, runComplete),
      issues: group.filter(isRealDefect).length,
    }
  })

  const count = (r: CheckResult) => list.filter((c) => c.result === r).length
  return {
    summary: {
      total: list.length,
      passed: count("pass"),
      failed: count("fail"),
      lapsed: count("lapsed"),
      notRun: count("notRun"),
    },
    list,
  }
}
