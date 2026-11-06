// Persist a per-check result snapshot for a run into `run_check_results`, so the
// TED Site Audit history can be rendered per client/run without re-deriving
// pass/fail (which is otherwise ephemeral) or reading per-check timings (which
// otherwise live only in worker memory).
//
// Two writers, one per phase:
//   • persistScanCheckResults — at scan completion, BEFORE saveTimingReport()
//     clears the in-memory timings.
//   • persistFixCheckResults  — at fix completion, BEFORE saveAiFixTimingReport()
//     clears the in-memory ai-fix timings.
//
// Both are best-effort: a failure here must never break the scan/fix or the TED
// report — it only degrades the history view.
import { supabase } from "./supabase"
import { getRunTimings, getAiFixTimings } from "./timingCollector"
import { aiLapseBlocksPass, aiLapseSummary } from "@qacc/shared"
import { FRIENDLY, isRealDefect, isToolLapseFinding } from "./tedSync"
import { parseCroContext } from "./croReport"

const logger = {
  warn: (obj: any, msg: string) => console.warn(msg, obj),
}

/**
 * Scan phase: one row per check in the run's roster, aggregated across pages.
 *   status  'failed'  — the check produced at least one real defect
 *           'errored' — the check only produced tool lapses (QACC-internal error)
 *           'passed'  — the check ran and found nothing actionable
 */
// Checks that write a row only on the pages they apply to (service pages, blog
// posts). No row at all means no such page was reached: nothing was verified.
const NO_ROW_MESSAGE: Record<string, string> = {
  image_relevance: "Could not complete: no service pages were identified in this scan",
  blog_sidebar: "Could not complete: no blog post pages were found in this scan",
  // CRO always writes one row per checked page (result or "could not complete"),
  // so no row means the CRO job never ran for this scan.
  cro_audit: "Could not complete: no CRO result was recorded for this scan",
}

/**
 * CRO's message for TED's Site Audit page: every checked page with its score,
 * then the issues found, fixes recommended and high-impact failed checks — for
 * a pass too. TED shows `message` as the check's text, so this is where the
 * WebAudit detail has to live. Exported for tests.
 */
export function croSiteAuditMessage(group: any[], urlById: Map<string, string>): string | null {
  const pages = group
    .filter((f) => !isToolLapseFinding(f))
    .map((f) => ({ f, rep: parseCroContext(f.context_text) }))
    .filter((p) => p.rep)
  if (pages.length === 0) return null
  // Poor (failed) pages first.
  pages.sort((a, b) => Number(isRealDefect(b.f)) - Number(isRealDefect(a.f)))
  const out: string[] = []
  for (const { f, rep } of pages) {
    const r = rep!
    const url = urlById.get(f.page_id) || r.url
    out.push(`${isRealDefect(f) ? "❌" : "✅"} ${url} — Score ${r.score}/100 (${r.band})`)
    if (r.issues.length) out.push("Issues found:", ...r.issues.map((s) => `• ${s}`))
    if (r.fixes.length) out.push("Fixes recommended:", ...r.fixes.map((s) => `• ${s}`))
    out.push(
      ...(r.failedChecks.length
        ? ["High-impact failed checks:", ...r.failedChecks.map((c) => `• [${c.impact}] ${c.name}${c.fix ? ` — ${c.fix}` : ""}`)]
        : ["High-impact failed checks: none"]),
    )
    if (r.reportUrl) out.push(`Full report: ${r.reportUrl}`)
    out.push("")
  }
  const lapsed = group.filter(isToolLapseFinding).length
  if (lapsed) out.push(`Could not check ${lapsed} page${lapsed > 1 ? "s" : ""}.`)
  return out.join("\n").trim()
}

export async function persistScanCheckResults(runId: string): Promise<void> {
  try {
    const { data: run } = await supabase
      .from("qa_runs")
      .select("enabled_checks")
      .eq("id", runId)
      .single()
    const roster: string[] = (run?.enabled_checks as string[]) || []

    const { data: findings } = await supabase
      .from("findings")
      .select("check_factor, title, description, context_text, screenshot_url, severity, page_id")
      .eq("run_id", runId)

    const { data: pages } = await supabase
      .from("pages")
      .select("id, url")
      .eq("run_id", runId)
    const urlById = new Map<string, string>(
      (pages || []).map((p: any) => [p.id, p.url]),
    )

    // Per-check durations from the in-memory timing collector (the timing `name`
    // mirrors the check_factor). Still populated at this point — this runs before
    // saveTimingReport() clears it.
    const durByCheck = new Map<string, number>()
    for (const t of getRunTimings(runId)) {
      durByCheck.set(t.name, (durByCheck.get(t.name) || 0) + t.durationMs)
    }

    // Group findings by check, then ensure every rostered check has an entry.
    const byCheck = new Map<string, any[]>()
    for (const f of findings || []) {
      const arr = byCheck.get(f.check_factor) || []
      arr.push(f)
      byCheck.set(f.check_factor, arr)
    }
    for (const c of roster) if (!byCheck.has(c)) byCheck.set(c, [])

    const rows: any[] = []
    for (const [factor, group] of byCheck) {
      const real = group.filter(isRealDefect)
      const lapses = group.filter(isToolLapseFinding)
      let status: "failed" | "errored" | "passed"
      if (real.length > 0) status = "failed"
      else if (group.length > 0 && lapses.length === group.length) status = "errored"
      else if (group.length === 0 && NO_ROW_MESSAGE[factor]) status = "errored"
      // AI-backed checks: a page the AI never read blocks a pass.
      else if (aiLapseBlocksPass(factor, group)) status = "errored"
      else status = "passed"

      const first = real[0] || null
      if (factor === "cro_audit") {
        const lapseWhy = String(lapses[0]?.description || "")
          .replace(/^The cro_audit check encountered an unexpected error:\s*/i, "")
          .replace(/\.?\s*Process aborted gracefully\.?$/i, "")
          .trim()
        rows.push({
          run_id: runId,
          phase: "scan",
          check_factor: factor,
          label: FRIENDLY[factor] || factor,
          status,
          duration_ms: durByCheck.get(factor) ?? null,
          message:
            status !== "errored"
              ? croSiteAuditMessage(group, urlById)
              : group.length === 0
                ? NO_ROW_MESSAGE.cro_audit
                : `Could not complete: ${lapseWhy || "G99 WebAudit did not return a result"}`,
          page_url: urlById.get((first || group[0])?.page_id) || null,
          screenshot_url: null,
          severity: first ? first.severity || null : null,
        })
        continue
      }
      rows.push({
        run_id: runId,
        phase: "scan",
        check_factor: factor,
        label: FRIENDLY[factor] || factor,
        status,
        duration_ms: durByCheck.get(factor) ?? null,
        message: first
          ? first.title || first.description || null
          : status === "errored" && aiLapseBlocksPass(factor, group)
            ? `Could not complete: ${aiLapseSummary(group)}`
            : status === "errored" && group.length === 0 && NO_ROW_MESSAGE[factor]
              ? NO_ROW_MESSAGE[factor]
              : null,
        page_url: first ? urlById.get(first.page_id) || null : null,
        screenshot_url: first ? first.screenshot_url || null : null,
        severity: first ? first.severity || null : null,
      })
    }

    if (rows.length) {
      await supabase
        .from("run_check_results")
        .upsert(rows, { onConflict: "run_id,phase,check_factor" })
    }
  } catch (e: any) {
    logger.warn({ runId, error: e?.message }, "persistScanCheckResults failed")
  }
}

/**
 * Fix phase: one row per check the fix worked on, from the fix job's `analysis`
 * array (one entry per finding it processed).
 *   status  'fixed'     — an edit was applied for this check
 *           'not_fixed' — real defect, no edit applied (manual / no repo access)
 * Lapses are skipped (never a defect). Duration comes from the ai-fix timings
 * (labelled `finding:<factor>`), still buffered at call time.
 */
export async function persistFixCheckResults(
  runId: string,
  analysis: Array<{
    check_factor: string
    title?: string
    pageUrl?: string
    fix?: string
    applied?: boolean
    lapse?: boolean
  }>,
): Promise<void> {
  try {
    // Sum ai-fix durations per check (label "finding:<factor>").
    const durByCheck = new Map<string, number>()
    for (const t of getAiFixTimings(runId)) {
      const factor = t.name.startsWith("finding:") ? t.name.slice("finding:".length) : t.name
      durByCheck.set(factor, (durByCheck.get(factor) || 0) + t.durationMs)
    }

    // Collapse to one row per check: fixed wins if ANY finding for that check was
    // applied; otherwise not_fixed. Skip pure lapses.
    const byCheck = new Map<string, { applied: boolean; message: string; pageUrl: string }>()
    for (const a of analysis || []) {
      if (a.lapse) continue
      const cur = byCheck.get(a.check_factor) || { applied: false, message: "", pageUrl: "" }
      cur.applied = cur.applied || !!a.applied
      if (!cur.message) cur.message = a.fix || a.title || ""
      if (!cur.pageUrl) cur.pageUrl = a.pageUrl || ""
      byCheck.set(a.check_factor, cur)
    }

    const rows: any[] = []
    for (const [factor, v] of byCheck) {
      rows.push({
        run_id: runId,
        phase: "fix",
        check_factor: factor,
        label: FRIENDLY[factor] || factor,
        status: v.applied ? "fixed" : "not_fixed",
        duration_ms: durByCheck.get(factor) ?? null,
        message: v.message || null,
        page_url: v.pageUrl || null,
        screenshot_url: null,
        severity: null,
      })
    }

    if (rows.length) {
      await supabase
        .from("run_check_results")
        .upsert(rows, { onConflict: "run_id,phase,check_factor" })
    }
  } catch (e: any) {
    logger.warn({ runId, error: e?.message }, "persistFixCheckResults failed")
  }
}
