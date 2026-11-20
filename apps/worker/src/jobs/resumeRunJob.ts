import { Job } from "bullmq"
import { gapKeysByScope } from "@qacc/shared"
import { supabase } from "../lib/supabase"
import { qaQueue } from "../lib/queue"
import { postTedComment } from "../lib/tedSync"
import { logRunEvent } from "../lib/runEvents"
import { acquireRunSlot, releaseRunSlot } from "../lib/runSlot"
import { armReportGate } from "../lib/reportGate"
import { resetAiBreakers } from "../lib/aiFallback"
import { enabledApiChecksFor, enqueuePageJobs, enqueueApiCheckJobs } from "./startRunJob"
import { finalizeRun } from "./crawlPageJob"
import pino from "pino"

const logger = pino({ level: process.env.LOG_LEVEL || "info" })

// Finish a QA run that died midway, from the stage the API picked when TED
// retriggered the task (apps/api/src/lib/runResume.ts decides; this job only
// acts). Same run row, same run slot, same jobs a normal run queues:
//   discover → start the run over (it never found its pages)
//   pages    → scan only the unfinished pages; finished pages are kept
//   finalize → all pages scanned: run-end checks, TED report, then AI fix
//   ai_fix   → restart the AI fix
// Cancelled / paused runs are never touched (checked again here in case the
// person stopped the run after the trigger).

export type ResumeStage = "discover" | "pages" | "finalize" | "ai_fix"

type RunRow = {
  id: string
  project_id: string
  status: string
  site_url: string
  enabled_checks: string[] | null
  run_type: string | null
  ted_task_id: string | null
}

// Run-end findings are written by finalizeRun; drop any half-written ones so a
// second finalize doesn't duplicate them.
const RUN_END_FACTORS = [...gapKeysByScope("run"), "cross_browser"]

const inChunks = <T>(arr: T[], n = 100): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function resumeDiscover(run: RunRow): Promise<void> {
  // Died before (or while) inserting pages: start the same run over.
  await supabase.from("pages").delete().eq("run_id", run.id)
  await supabase
    .from("qa_runs")
    .update({ status: "running", pages_total: 0, pages_processed: 0, completed_at: null })
    .eq("id", run.id)
  await qaQueue.add(
    "start_run",
    { runId: run.id },
    { removeOnComplete: true, attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  )
}

async function resumePages(run: RunRow): Promise<void> {
  const { data: pages } = await supabase.from("pages").select("id, url, status").eq("run_id", run.id)
  const all = pages || []
  const unfinished = all.filter((p: any) => p.status !== "done" && p.status !== "failed")
  if (unfinished.length === 0) return resumeFinalize(run)

  // Half-written findings from pages the crash interrupted.
  for (const ids of inChunks(unfinished.map((p: any) => p.id)))
    await supabase.from("findings").delete().eq("run_id", run.id).in("page_id", ids)

  // API checks run again in full (they are quick and their gate part may be gone).
  const apiChecks = enabledApiChecksFor(run)
  if (apiChecks.length)
    await supabase.from("findings").delete().eq("run_id", run.id).in("check_factor", apiChecks)

  for (const ids of inChunks(unfinished.map((p: any) => p.id)))
    await supabase.from("pages").update({ status: "pending", progress: 0, current_step: null }).in("id", ids)

  // Completion RPC counts done/failed pages, so the run completes once these finish.
  await supabase
    .from("qa_runs")
    .update({ status: "running", completed_at: null, pages_processed: all.length - unfinished.length })
    .eq("id", run.id)

  await armReportGate(run.id, apiChecks)
  await enqueuePageJobs(run, unfinished.map((p: any) => ({ id: p.id, url: p.url })))
  await enqueueApiCheckJobs(run.id, run.project_id, apiChecks)
}

async function resumeFinalize(run: RunRow): Promise<void> {
  await supabase.from("findings").delete().eq("run_id", run.id).in("check_factor", RUN_END_FACTORS)
  if (run.status !== "completed")
    await supabase
      .from("qa_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", run.id)
  await finalizeRun(run.id)
}

async function resumeAiFix(run: RunRow): Promise<void> {
  if (!run.ted_task_id) throw new Error("AI fix resume needs a TED task id")
  await supabase.from("qa_runs").update({ ai_fix_status: "queued" }).eq("id", run.id)
  await qaQueue.add("ai_fix_run", { runId: run.id, tedTaskId: run.ted_task_id })
}

export async function processResumeRunJob(job: Job): Promise<void> {
  const { runId, stage } = job.data as { runId: string; stage: ResumeStage }
  if (!runId || !stage) throw new Error("resume_run needs runId and stage")

  const { data: run } = await supabase
    .from("qa_runs")
    .select("id, project_id, status, site_url, enabled_checks, run_type, ted_task_id")
    .eq("id", runId)
    .single()
  if (!run) throw new Error(`resume_run: run ${runId} not found`)
  if (run.status === "cancelled" || run.status === "paused") {
    logger.info({ runId, status: run.status }, "resume_run: run was stopped on purpose; not resuming.")
    return
  }

  // One run at a time. The slot is re-entrant, so a dead run that still holds
  // it gets it straight back.
  if (!(await acquireRunSlot(runId))) {
    const delay = Math.max(1000, Number(process.env.RUN_SLOT_RETRY_DELAY_MS || 15000))
    await qaQueue.add("resume_run", job.data, { delay, removeOnComplete: true, attempts: 1 })
    if (!job.data.slotWaitLogged) {
      job.data.slotWaitLogged = true
      await logRunEvent({
        runId,
        tedTaskId: run.ted_task_id,
        kind: "run.waiting_slot",
        status: "running",
        message: "Waiting for another QA run to finish (one run at a time)",
      })
    }
    return
  }

  resetAiBreakers()
  await logRunEvent({
    runId,
    tedTaskId: run.ted_task_id,
    kind: "run.resuming",
    status: "running",
    message: `Resuming from: ${stage === "discover" ? "the start" : stage === "pages" ? "the page scan" : stage === "finalize" ? "the report" : "the AI fix"}`,
    detail: { stage },
  })
  logger.info({ runId, stage }, "Resuming run")

  try {
    if (stage === "discover") await resumeDiscover(run)
    else if (stage === "pages") await resumePages(run)
    else if (stage === "finalize") await resumeFinalize(run)
    else if (stage === "ai_fix") await resumeAiFix(run)
    else throw new Error(`unknown resume stage ${stage}`)
  } catch (error: any) {
    const reason = String(error?.message || error).slice(0, 200)
    logger.error({ runId, stage, error: reason }, "resume_run failed")
    await logRunEvent({
      runId,
      tedTaskId: run.ted_task_id,
      kind: "run.failed",
      status: "failed",
      message: `Could not resume the run: ${reason}`,
    })
    if (run.ted_task_id)
      await postTedComment(
        String(run.ted_task_id),
        `<p>❌ <strong>Could not resume the test run.</strong> ${reason.replace(/</g, "&lt;")}</p><p>To fix: press Trigger manually again.</p>`,
        `ext:qacc-resume-failed-${runId}-${Date.now()}`,
        { runId, projectId: run.project_id },
      ).catch(() => {})
    await releaseRunSlot(runId)
    await supabase
      .from("qa_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", runId)
  }
}
