// Resume a QA run that died midway when TED triggers the same task again.
//
// A run can die at any stage (worker crash, redeploy, an uncaught error).
// Before this, a retrigger either got skipped as a "duplicate" (dead run still
// looked active) or started a brand-new run from zero, leaving the dead one
// "running" forever. Now the retrigger finishes the dead run where it stopped.
//
// Never resumed — the person or QACC stopped these on purpose:
//   • cancelled (Stop button) and paused runs
//   • aborted runs (QACC refused to start, e.g. no site URL): status "failed"
//     with an empty site_url
// Those, finished runs, and anything else not listed below start a fresh run
// exactly as before.
//
// "Dead" is read from the job queue, not timestamps: a live run always has a
// job queued or running (start_run incl. waiting for the run slot, a page
// scan, an API check, finalize inside the last page job, the AI fix).

import { supabase } from "./supabase"
import { qaQueue } from "./queue"

export type ResumeStage = "discover" | "pages" | "finalize" | "ai_fix"

export interface ResumeRunRow {
  id: string
  status: string | null
  run_type: string | null
  site_url: string | null
  created_at: string | null
  updated_at: string | null
  ted_task_id: string | null
  ted_report_posted_at: string | null
  ted_completed_at: string | null
  ai_fix_status: string | null
}

export interface PageCounts {
  /** Page rows the run has (0 = it died while finding pages). */
  rows: number
  /** Pages not yet done or failed. */
  unfinished: number
}

export interface ResumeOpts {
  now: number
  /** Runs older than this are never resumed (the site may have changed). */
  maxAgeHours: number
  /** A run touched more recently than this is never resumed (start-up race). */
  minIdleSeconds: number
  aiFixEnabled: boolean
}

const RESUMABLE_STATUSES = new Set(["pending", "running", "failed", "timed_out", "completed"])

/** Pure rule: the stage to resume from, or null to start fresh / do nothing. */
export function resumeStageFor(run: ResumeRunRow, pages: PageCounts, opts: ResumeOpts): ResumeStage | null {
  const status = run.status || ""
  if (!RESUMABLE_STATUSES.has(status)) return null // cancelled, paused, unknown
  if (status === "failed" && !(run.site_url || "").trim()) return null // aborted on purpose

  const created = run.created_at ? new Date(run.created_at).getTime() : NaN
  if (!Number.isFinite(created) || opts.now - created > opts.maxAgeHours * 3600_000) return null
  const touched = run.updated_at ? new Date(run.updated_at).getTime() : created
  if (opts.now - touched < opts.minIdleSeconds * 1000) return null

  if (pages.rows === 0) return status === "completed" ? null : "discover"
  if (pages.unfinished > 0) return "pages"
  if (run.ted_task_id && !run.ted_report_posted_at) return "finalize"
  if (
    opts.aiFixEnabled &&
    run.ted_report_posted_at &&
    !run.ted_completed_at &&
    (run.ai_fix_status === "queued" || run.ai_fix_status === "running")
  )
    return "ai_fix"
  return null
}

const LIVE_JOB_STATES = ["active", "waiting", "delayed", "prioritized", "paused", "waiting-children"] as const

/** True when any queued or running job belongs to this run. */
export async function hasLiveJobs(runId: string): Promise<boolean> {
  const jobs = await qaQueue.getJobs([...LIVE_JOB_STATES] as any, 0, 2000)
  return jobs.some((j) => j?.data?.runId === runId)
}

const hostPath = (u: string | null | undefined) =>
  String(u || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")

export interface Resumable {
  run: ResumeRunRow
  stage: ResumeStage
  pages: PageCounts
}

/**
 * The latest run for this TED task + run type, when it died midway and can be
 * finished. Null → follow the normal path (duplicate check, then a fresh run).
 * `siteUrl` is the URL this trigger resolved: a run for a different URL is
 * never resumed.
 */
export async function findResumableRun(
  tedTaskId: string,
  runType: string,
  siteUrl: string | null,
): Promise<Resumable | null> {
  if (process.env.TED_RUN_RESUME_ENABLED === "false") return null
  try {
    const { data: latest } = await supabase
      .from("qa_runs")
      .select(
        "id, status, run_type, site_url, created_at, updated_at, ted_task_id, ted_report_posted_at, ted_completed_at, ai_fix_status",
      )
      .eq("ted_task_id", tedTaskId)
      .order("created_at", { ascending: false })
      .limit(1)
    const run = latest?.[0] as ResumeRunRow | undefined
    if (!run || run.run_type !== runType) return null
    if (siteUrl && hostPath(siteUrl) !== hostPath(run.site_url)) return null

    const { data: pageRows } = await supabase.from("pages").select("status").eq("run_id", run.id)
    const pages: PageCounts = {
      rows: pageRows?.length || 0,
      unfinished: (pageRows || []).filter((p: any) => p.status !== "done" && p.status !== "failed").length,
    }
    const stage = resumeStageFor(run, pages, {
      now: Date.now(),
      maxAgeHours: Number(process.env.TED_RUN_RESUME_MAX_HOURS || 72),
      minIdleSeconds: Number(process.env.TED_RUN_RESUME_MIN_IDLE_SECONDS || 120),
      aiFixEnabled: process.env.AI_FIX_MODULE_ENABLED === "true",
    })
    if (!stage) return null
    if (await hasLiveJobs(run.id)) return null // still working → duplicate path
    return { run, stage, pages }
  } catch (e: any) {
    console.error("⚠️ Resume lookup failed (starting fresh instead):", e?.message || e)
    return null
  }
}

/** One plain line for TED and the run log. */
export function resumeMessage(r: Resumable): string {
  switch (r.stage) {
    case "discover":
      return `Resuming the unfinished test run ${r.run.id} from the start (it stopped while finding the site's pages).`
    case "pages":
      return `Resuming the unfinished test run ${r.run.id}: ${r.pages.unfinished} of ${r.pages.rows} pages left to scan. Finished pages are kept.`
    case "finalize":
      return `Resuming the unfinished test run ${r.run.id}: all pages were scanned, finishing the report.`
    case "ai_fix":
      return `Resuming the unfinished test run ${r.run.id}: restarting the AI fix.`
  }
}

/** Queue the worker's resume job. */
export async function queueResume(r: Resumable): Promise<void> {
  await qaQueue.add(
    "resume_run",
    { runId: r.run.id, stage: r.stage },
    { removeOnComplete: true, attempts: 1 },
  )
}
