import { Job } from "bullmq"
import pino from "pino"
import { supabase } from "../lib/supabase"
import { qaQueue } from "../lib/queue"
import {
  postTedComment,
  postTedStatus,
  postQaccInternalNote,
  isRealDefect,
} from "../lib/tedSync"
import {
  triggerFullProjectRecording,
  RECORDING_VIEWPORTS,
} from "../lib/recordingTrigger"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

const VIDEO_FACTOR = "video_recording"
const TED_STATUS_COMPLETED = "Completed"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// How long to wait for the cloud recorder to signal an ACTUAL start (the
// recordingWorker flips recording_status → 'recording' at boot). Timeout is a
// terminal state — the subtask is never left hanging.
const START_TIMEOUT_MS = parseInt(process.env.VIDEO_START_TIMEOUT_MS || "120000", 10)
const START_POLL_MS = parseInt(process.env.VIDEO_START_POLL_MS || "6000", 10)

// The deferred URL-verify pass. First look ~35 min after start (recording takes
// ~30 min), then re-check a few times before giving up. Overridable for testing.
const URL_VERIFY_FIRST_DELAY_MS = parseInt(
  process.env.VIDEO_URL_VERIFY_FIRST_DELAY_MS || `${35 * 60 * 1000}`,
  10,
)
const URL_VERIFY_RETRY_DELAY_MS = parseInt(
  process.env.VIDEO_URL_VERIFY_RETRY_DELAY_MS || `${15 * 60 * 1000}`,
  10,
)
const URL_VERIFY_MAX_ATTEMPTS = parseInt(process.env.VIDEO_URL_VERIFY_MAX_ATTEMPTS || "4", 10)

function flattenIds(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : []
  return [...new Set(arr.map((v: any) => String(v)))]
}

// =====================================================================
// BARRIER: video_recording_check
// ---------------------------------------------------------------------
// Runs once every OTHER subtask has reached its final state (enqueued from the
// closeout funnel — markAllTedTasksCompleted). Decides the video subtask's fate:
//   • ≥1 other check still has an unresolved defect → "not possible … incomplete
//     fixes" → fail + Completed.
//   • all clean → "starting … check back in ~30 min" → trigger cloud recording →
//     confirm a real start via the DB flip:
//        - started  → pass + Completed → schedule video_url_verify.
//        - not started → "Video recording encountered an error" (client) +
//          detailed backend log + QACC-internal note → fail + Completed.
// Every path ends Completed so nothing hangs; the verdict lives in the comment.
// =====================================================================
export async function processVideoRecordingJob(job: Job): Promise<void> {
  const { runId } = job.data
  const tedTaskIdArg = job.data.tedTaskId as string | undefined
  if (!runId) {
    logger.warn("video_recording_check: no runId in job data; skipping.")
    return
  }

  const { data: run, error } = await supabase
    .from("qa_runs")
    .select("id, project_id, status, ted_task_id, ted_subtask_map, recording_status")
    .eq("id", runId)
    .single()
  if (error || !run) {
    logger.error({ runId, error: error?.message }, "video_recording_check: run fetch failed.")
    return
  }

  const map: Record<string, any> = (run.ted_subtask_map as any) || {}
  const videoSubtaskIds = flattenIds(map[VIDEO_FACTOR])
  if (!videoSubtaskIds.length) {
    logger.info({ runId }, "video_recording_check: no video subtask mapped; nothing to do.")
    return
  }
  const tedTaskId = tedTaskIdArg || (run.ted_task_id as string | undefined)
  const projectId = run.project_id as string | undefined
  const ctxBase = { runId, projectId, targetKind: "subtask" as const, checkFactor: VIDEO_FACTOR }

  // ---- Gate: are there any UNRESOLVED real defects? (final state after AI Fix)
  const { data: findings } = await supabase
    .from("findings")
    .select("id, check_factor, title, description")
    .eq("run_id", runId)
  const real = (findings || []).filter(isRealDefect)

  // A defect is RESOLVED only if AI Fix actually APPLIED a fix for it. Proposed /
  // dry-run / manual / not-possible all count as INCOMPLETE and block recording.
  const { data: aiFixRows } = await supabase
    .from("ai_fix_runs")
    .select("data, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: false })
    .limit(1)
  const analysis: any[] = (aiFixRows?.[0]?.data as any)?.findings || []
  const appliedIds = new Set(
    analysis.filter((a) => a?.applied && a?.findingId).map((a) => String(a.findingId)),
  )
  const unresolved = real.filter((f) => !appliedIds.has(String(f.id)))

  const runBroken = ["failed", "cancelled", "timed_out"].includes(String(run.status))
  const gatePassed = !runBroken && unresolved.length === 0

  // ---- PATH 1: something else failed → recording not possible.
  if (!gatePassed) {
    const blockers = [...new Set(unresolved.map((f) => f.check_factor).filter(Boolean))]
    const reason = runBroken
      ? " (the QA run did not complete successfully)"
      : blockers.length
        ? ` (${blockers.length} check${blockers.length > 1 ? "s" : ""} with incomplete fixes: ${blockers
            .slice(0, 8)
            .join(", ")})`
        : ""
    const body = `<p>❌ <strong>Video recording not possible as there are incomplete fixes</strong>${reason}.</p>`
    for (const subId of videoSubtaskIds) {
      await postTedComment(subId, body, `ext:video-blocked-${runId}-${subId}`, { ...ctxBase }).catch(() => {})
      await postTedStatus(subId, TED_STATUS_COMPLETED, runId).catch(() => {})
    }
    logger.info({ runId, blockers }, "Video recording blocked by incomplete fixes; subtask closed as failed.")
    return
  }

  // ---- PATH 2: everything passed → start recording.
  // Idempotency: claim recording_status so a retried/duplicated barrier job does
  // not trigger the cloud twice.
  const { data: claim } = await supabase
    .from("qa_runs")
    .update({ recording_status: "triggering", recording_updated_at: new Date().toISOString() })
    .eq("id", runId)
    .or("recording_status.is.null,recording_status.eq.error,recording_status.eq.completed")
    .select("id")
  const claimed = !!claim && claim.length > 0

  const startingBody =
    "<p>🎬 <strong>Starting video recording</strong> — check back in approximately 30 minutes.</p>"
  for (const subId of videoSubtaskIds) {
    await postTedComment(subId, startingBody, `ext:video-starting-${runId}-${subId}`, { ...ctxBase }).catch(() => {})
  }

  let started = false
  let failDetail = ""
  if (!claimed) {
    // recording_status was already 'triggering'/'recording' — a prior attempt (or
    // a manual trigger) already fired the cloud job. Do NOT trigger again; treat
    // it as in-flight so URL verification still runs and the subtask still closes.
    logger.info(
      { runId, recording_status: run.recording_status },
      "video_recording_check: recording already in-flight; not re-triggering.",
    )
    started = true
  } else {
    try {
      const trigger = await triggerFullProjectRecording(runId)
      if (!trigger.triggered) {
        failDetail = `cloud trigger rejected: ${trigger.errors.join(" | ") || "unknown error"}`
      } else if (trigger.simulated) {
        // Local/testing: no real cloud, treat as a successful start so the
        // comment/verdict flow can be exercised end-to-end.
        started = true
      } else {
        started = await pollForStart(runId)
        if (!started) failDetail = `no cloud start signal within ${Math.round(START_TIMEOUT_MS / 1000)}s`
      }
    } catch (e: any) {
      failDetail = `trigger threw: ${e?.message || String(e)}`
    }
  }

  // ---- PATH 2b: recording did not start → error (terminal).
  if (!started) {
    // Client-facing copy is EXACTLY this string — no internal detail leaks out.
    const clientBody = "<p>Video recording encountered an error</p>"
    const internalBody = `<p>🔧 <strong>Video recording error (QACC-internal)</strong>: ${escapeHtml(
      failDetail || "unknown",
    )}</p>`
    for (const subId of videoSubtaskIds) {
      await postTedComment(subId, clientBody, `ext:video-error-${runId}-${subId}`, { ...ctxBase }).catch(() => {})
      await postQaccInternalNote(subId, internalBody, `video-error-internal-${runId}-${subId}`, {
        ...ctxBase,
      }).catch(() => {})
      await postTedStatus(subId, TED_STATUS_COMPLETED, runId).catch(() => {})
    }
    await supabase
      .from("qa_runs")
      .update({ recording_status: "error", recording_updated_at: new Date().toISOString() })
      .eq("id", runId)
    logger.error({ runId, failDetail }, "Video recording failed to start.")
    return
  }

  // ---- PATH 2c: recording started → pass + Completed. URLs verified later.
  for (const subId of videoSubtaskIds) {
    await postTedStatus(subId, TED_STATUS_COMPLETED, runId).catch(() => {})
  }
  await qaQueue
    .add(
      "video_url_verify",
      { runId, tedTaskId, videoSubtaskIds, attempt: 1 },
      { delay: URL_VERIFY_FIRST_DELAY_MS, removeOnComplete: true, attempts: 2 },
    )
    .catch((e) => logger.error({ runId, error: e?.message }, "Failed to enqueue video_url_verify."))
  logger.info({ runId }, "Video recording started; subtask closed as passed. URL verify scheduled.")
}

// Poll qa_runs for a real "recording has begun" signal from the cloud recorder.
async function pollForStart(runId: string): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from("qa_runs")
      .select("recording_status, recording_progress")
      .eq("id", runId)
      .single()
    const status = String(data?.recording_status || "")
    if (status === "recording" || status === "completed") return true
    if (status === "error") return false
    const progress = (data?.recording_progress as Record<string, any>) || {}
    if (Object.values(progress).some((v) => Number(v) > 0)) return true
    await sleep(START_POLL_MS)
  }
  return false
}

// =====================================================================
// DEFERRED: video_url_verify
// ---------------------------------------------------------------------
// Recording runs ~30 min on the cloud provider. This pass posts each viewport's
// video URL to the PARENT task (main thread) "as and when available", and — only
// if no URL ever posts / is retrievable by the final deadline — flips the video
// subtask's verdict to failed. Bounded retries guarantee it never loops forever.
// =====================================================================
export async function processVideoUrlVerifyJob(job: Job): Promise<void> {
  const { runId } = job.data
  const tedTaskId = job.data.tedTaskId as string | undefined
  const videoSubtaskIds: string[] = job.data.videoSubtaskIds || []
  const attempt: number = job.data.attempt || 1
  if (!runId) return

  const { data: run } = await supabase
    .from("qa_runs")
    .select("id, project_id, recording_video_urls, recording_status")
    .eq("id", runId)
    .single()
  const projectId = run?.project_id as string | undefined
  const urls = (run?.recording_video_urls as Record<string, string>) || {}

  // Which viewports have a retrievable URL right now?
  const available: { viewport: string; url: string }[] = []
  for (const viewport of RECORDING_VIEWPORTS) {
    const url = urls[viewport]
    if (url && (await isRetrievable(url))) available.push({ viewport, url })
  }

  // Post each available viewport to the main thread once (stable key dedupes).
  if (tedTaskId && available.length) {
    for (const { viewport, url } of available) {
      const body = `<p>🎥 <strong>${cap(viewport)} recording</strong> ready: <a href="${escapeHtml(
        url,
      )}">${escapeHtml(url)}</a></p>`
      await postTedComment(tedTaskId, body, `ext:video-url-${runId}-${viewport}`, {
        runId,
        projectId,
        targetKind: "parent",
        checkFactor: VIDEO_FACTOR,
      }).catch(() => {})
    }
  }

  const allDone = available.length >= RECORDING_VIEWPORTS.length
  if (allDone) {
    logger.info({ runId }, "video_url_verify: all viewport URLs posted to main thread.")
    return
  }

  // Not all URLs yet — retry until the deadline.
  if (attempt < URL_VERIFY_MAX_ATTEMPTS) {
    await qaQueue
      .add(
        "video_url_verify",
        { runId, tedTaskId, videoSubtaskIds, attempt: attempt + 1 },
        { delay: URL_VERIFY_RETRY_DELAY_MS, removeOnComplete: true, attempts: 2 },
      )
      .catch(() => {})
    logger.info(
      { runId, attempt, available: available.length },
      "video_url_verify: partial/none — re-scheduled.",
    )
    return
  }

  // Final deadline reached.
  if (available.length === 0) {
    // No URL ever posted / retrievable → flip the video subtask verdict to failed.
    const body =
      "<p>⚠️ <strong>Video recording verification failed</strong> — no video URL was posted or it was not retrievable within the expected window.</p>"
    for (const subId of videoSubtaskIds) {
      await postTedComment(subId, body, `ext:video-url-failed-${runId}-${subId}`, {
        runId,
        projectId,
        targetKind: "subtask",
        checkFactor: VIDEO_FACTOR,
      }).catch(() => {})
      await postTedStatus(subId, TED_STATUS_COMPLETED, runId).catch(() => {})
    }
    logger.error({ runId }, "video_url_verify: no retrievable URL by deadline; subtask flipped to failed.")
  } else {
    logger.warn(
      { runId, available: available.length },
      "video_url_verify: deadline reached with partial URLs; posted what was available.",
    )
  }
}

async function isRetrievable(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: "HEAD" })
    if (head.ok) return true
  } catch {
    /* fall through to range GET */
  }
  try {
    const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } })
    return r.ok || r.status === 206
  } catch {
    return false
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const escapeHtml = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
