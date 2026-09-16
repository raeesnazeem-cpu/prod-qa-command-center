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
 * A QACC-side failure — the check could not complete (missing credential, API
 * key, timeout, upstream error). Neither a site defect nor a pass: nothing about
 * the site was established either way.
 */
export function isToolLapseFinding(f: any): boolean {
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
