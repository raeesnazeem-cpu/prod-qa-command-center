// Store a run's section-wise report in `run_reports`, so TED's Site Audit page
// can show the full report of every run, read through
// GET /webhooks/ted/runs/:runId/report. The same builder makes the report TED
// tasks receive (buildSectionedReport), so both read alike; this copy keeps
// screenshots as links instead of inline images, to stay small.
//
// Two writers, one per phase, like runResults.ts:
//   • scan — when a scan completes (crawlPageJob, stuckRunSweeper)
//   • fix  — when the AI-fix pass completes (aiFixRunJob), with the fixes made
//
// Best-effort: a failure here must never break the scan, the fix or the TED
// report — it only leaves the Site Audit page without a detailed report.
import { supabase } from "./supabase"
import { buildSectionedReport, FRIENDLY, type FixReportInfo, type ImageFixInfo } from "./tedSync"

const logger = {
  warn: (obj: any, msg: string) => console.warn(msg, obj),
}

export async function persistRunReport(
  runId: string,
  phase: "scan" | "fix",
  opts: {
    findings?: any[]
    fixMap?: Map<string, FixReportInfo>
    imageFix?: Map<string, ImageFixInfo>
    summaryHeaderHtml?: string
  } = {},
): Promise<void> {
  try {
    const { data: runMeta } = await supabase
      .from("qa_runs")
      .select("enabled_checks, project_id, site_url, run_type")
      .eq("id", runId)
      .single()

    let findings = opts.findings
    if (!findings) {
      const { data } = await supabase.from("findings").select("*").eq("run_id", runId)
      findings = data || []
    }

    const report = await buildSectionedReport({
      runId,
      findings,
      runMeta,
      fixMap: opts.fixMap,
      imageFix: opts.imageFix,
      imageBudgetBytes: 0,
    })

    const html =
      report.titleHtml +
      report.overview +
      (opts.summaryHeaderHtml || "") +
      report.sections.map((s) => s.html).join("<br><br>")

    const { error } = await supabase.from("run_reports").upsert(
      {
        run_id: runId,
        phase,
        html,
        // The check's display name rides along, so TED shows the same names as the task report.
        sections: report.sections.map((s) => ({ ...s, label: FRIENDLY[s.factor] || s.factor })),
        tally: report.tally,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,phase" },
    )
    if (error) logger.warn({ runId, phase, error: error.message }, "run report: save failed")
  } catch (e: any) {
    logger.warn({ runId, phase, error: e?.message }, "run report: build failed")
  }
}
