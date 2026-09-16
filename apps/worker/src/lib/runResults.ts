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
import { FRIENDLY, isRealDefect, isToolLapseFinding } from "./tedSync"

const logger = {
  warn: (obj: any, msg: string) => console.warn(msg, obj),
}

/**
 * Scan phase: one row per check in the run's roster, aggregated across pages.
 *   status  'failed'  — the check produced at least one real defect
 *           'errored' — the check only produced tool lapses (QACC-internal error)
 *           'passed'  — the check ran and found nothing actionable
 */
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
      .select("check_factor, title, description, screenshot_url, severity, page_id")
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
      else status = "passed"

      const first = real[0] || null
      rows.push({
        run_id: runId,
        phase: "scan",
        check_factor: factor,
        label: FRIENDLY[factor] || factor,
        status,
        duration_ms: durByCheck.get(factor) ?? null,
        message: first ? first.title || first.description || null : null,
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
