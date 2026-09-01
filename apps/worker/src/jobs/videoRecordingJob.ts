import { Job } from "bullmq"
import pino from "pino"
import { supabase } from "../lib/supabase"
import { qaQueue } from "../lib/queue"
import {
  postTedComment,
  postTedStatus,
  postQaccInternalNote,
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
const TED_STATUS_IN_PROGRESS = "In Progress"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// How long to wait for the cloud recorder to signal an ACTUAL start (the
// recordingWorker flips recording_status → 'recording' at boot). Timeout is a
// terminal state — the subtask is never left hanging.
const START_POLL_MS = parseInt(process.env.VIDEO_START_POLL_MS || "6000", 10)
// How many times to re-check the DB for a real "recording has started" signal
// before giving up and closing the video subtask as failed+Completed.
const START_CONFIRM_ATTEMPTS = parseInt(process.env.VIDEO_START_ATTEMPTS || "5", 10)

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

// Which non-video sibling subtasks have NOT yet reached a FINAL state for this
// run? A sibling is "finalized" once the report set its terminal status — either
// Completed (passed / fixed / no-result) or In Progress (failed and not fixed).
// The report writes a distinct status row (source="status", event_key
// `status:<id>:<status>:<runId>`) in both preview and real mode, so that row is
// the authoritative proof. This barrier is enqueued AFTER the report finalizes
// every sibling, so this is a belt-and-suspenders ordering guard. Read-only.
function isFinalizedStatusKey(eventKey: string): boolean {
  const k = String(eventKey || "")
  return (
    k.includes(`:${TED_STATUS_COMPLETED}:`) ||
    k.includes(`:${TED_STATUS_IN_PROGRESS}:`)
  )
}
async function openSiblingSubtasks(
  runId: string,
  map: Record<string, any>,
  videoSet: Set<string>,
): Promise<string[]> {
  const otherIds = new Set<string>()
  for (const [factor, raw] of Object.entries(map)) {
    if (factor === VIDEO_FACTOR) continue
    for (const id of flattenIds(raw)) if (!videoSet.has(id)) otherIds.add(id)
  }
  if (otherIds.size === 0) return []
  const ids = [...otherIds]
  const { data: rows } = await supabase
    .from("ted_comments")
    .select("ted_task_id, event_key")
    .eq("qa_run_id", runId)
    .eq("source", "status")
    .in("ted_task_id", ids)
  const finalized = new Set(
    (rows || [])
      .filter((r: any) => isFinalizedStatusKey(r.event_key))
      .map((r: any) => String(r.ted_task_id)),
  )
  return ids.filter((id) => !finalized.has(id))
}

// =====================================================================
// BARRIER: video_recording_check
// ---------------------------------------------------------------------
// Runs once every OTHER subtask has reached a FINAL state (In Progress or
// Completed) — enqueued from the closeout funnel (markAllTedTasksCompleted).
// Video is the LAST check. Unlike every other check, its subtask is NOT closed
// on start: it stays In Progress until the recording URLs are actually posted
// back. It has NO auto-fix, so:
//   • ≥1 other check still has an unresolved defect → "not possible … incomplete
//     fixes" → video left In Progress, parent left open.
//   • all clean → "in progress …" → trigger cloud recording → confirm a real
//     start via the DB flip:
//        - started  → schedule video_url_verify; subtask stays In Progress.
//        - not started → "Video recording encountered an error" (client) +
//          QACC-internal note → FAIL: subtask left In Progress, parent left open.
// PASS = the recording URLs post back (video_url_verify): only then does the
// video subtask close Completed and the parent close Completed (last of all).
// Any failure leaves the subtask In Progress and the parent open for a person —
// the parent closes ONLY when the video succeeds.
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
    // THROW (don't silently return): the parent close is deferred to this barrier,
    // so a swallowed failure here would leave the parent open forever. Throwing
    // lets BullMQ retry (attempts: 5).
    logger.error({ runId, error: error?.message }, "video_recording_check: run fetch failed; will retry.")
    throw new Error(`video_recording_check: run fetch failed for ${runId}: ${error?.message || "no row"}`)
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

  // ---- Gate: ONLY a broken run blocks recording. Unfixed check defects do NOT
  // block: the video captures the site's FINAL state regardless of individual
  // check verdicts. All that's required is that every sibling has been ATTEMPTED
  // and finalized (In Progress or Completed) — enforced by the sibling gate
  // below. A run marked failed/cancelled/timed_out at the RUN level is an infra
  // failure, NOT a merely-failed check (failed checks still leave the run
  // "completed"), so there is nothing worth recording.
  const runBroken = ["failed", "cancelled", "timed_out"].includes(String(run.status))
  if (runBroken) {
    const body = `<p>❌ <strong>Video recording not possible</strong> (the QA run did not complete successfully).</p>`
    for (const subId of videoSubtaskIds) {
      await postTedComment(subId, body, `ext:video-blocked-${runId}-${subId}`, { ...ctxBase }).catch(() => {})
      // Video has no fix → leave its subtask In Progress and DO NOT close the
      // parent; the parent closes only when the video subtask succeeds.
      await postTedStatus(subId, TED_STATUS_IN_PROGRESS, runId).catch(() => {})
    }
    logger.info({ runId }, "Video recording blocked: QA run did not complete successfully; video left In Progress, parent left open.")
    return
  }

  // ---- Start gate (part 2): every sibling subtask must ALSO be finalized
  // (In Progress or Completed). Passed AND all siblings finalized → start. A
  // sibling not yet finalized is a timing case (the report normally finalizes
  // them before this barrier is enqueued): don't start and don't blame — throw
  // so BullMQ retries (attempts: 5).
  const openSiblings = await openSiblingSubtasks(runId, map, new Set(videoSubtaskIds))
  if (openSiblings.length > 0) {
    logger.warn(
      { runId, openSiblings },
      "video_recording_check: siblings passed but not all finalized yet; will retry.",
    )
    throw new Error(
      `video_recording_check: ${openSiblings.length} sibling subtask(s) not yet finalized for ${runId}`,
    )
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
    "<p>🎬 <strong>Video Recording — in progress</strong>. Recording result appears in ~30 min.</p>"
  for (const subId of videoSubtaskIds) {
    await postTedComment(subId, startingBody, `ext:video-starting-${runId}-${subId}`, { ...ctxBase }).catch(() => {})
    // Keep the video subtask In Progress while recording runs — it closes only
    // once the recording URLs post back (video_url_verify), never on start.
    await postTedStatus(subId, TED_STATUS_IN_PROGRESS, runId).catch(() => {})
  }

  let started = false
  let failDetail = ""
  if (!claimed) {
    // recording_status was already 'triggering'/'recording' — a prior attempt (or
    // a manual trigger) already fired the cloud job. Do NOT trigger again, but we
    // STILL require a real DB start indication below (never assume it started).
    logger.info(
      { runId, recording_status: run.recording_status },
      "video_recording_check: recording already in-flight; verifying start from DB.",
    )
  } else {
    try {
      const trigger = await triggerFullProjectRecording(runId)
      if (!trigger.triggered) {
        failDetail = `cloud trigger rejected: ${trigger.errors.join(" | ") || "unknown error"}`
      } else if (trigger.simulated) {
        // Local/testing: no real cloud, treat as a successful start so the
        // comment/verdict flow can be exercised end-to-end.
        started = true
      }
    } catch (e: any) {
      failDetail = `trigger threw: ${e?.message || String(e)}`
    }
  }

  // Require a REAL "recording has started" indication in the DB, re-checked up to
  // START_CONFIRM_ATTEMPTS (5) times. A simulated/local start skips this; a hard
  // trigger error skips straight to the failure path.
  if (!started && !failDetail) {
    started = await confirmStart(runId, START_CONFIRM_ATTEMPTS)
    if (!started)
      failDetail = `no recording-start indication in DB after ${START_CONFIRM_ATTEMPTS} checks`
  }

  // ---- PATH 2b: no start indication (hung / no DB signal) → failed + Completed.
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
      // FAIL: the DB never signalled a start. Video has no fix → leave the
      // subtask In Progress and DO NOT close the parent (parent closes only on
      // video success — URLs posted back).
      await postTedStatus(subId, TED_STATUS_IN_PROGRESS, runId).catch(() => {})
    }
    await supabase
      .from("qa_runs")
      .update({ recording_status: "error", recording_updated_at: new Date().toISOString() })
      .eq("id", runId)
    logger.error({ runId, failDetail }, "Video recording failed to start; video left In Progress, parent left open.")
    return
  }

  // ---- PATH 2c: recording started. Do NOT close anything yet — the video
  // subtask stays In Progress and the parent stays open until the recording URLs
  // post back. video_url_verify closes both on success (or leaves them for a
  // person if no URL ever arrives).
  await qaQueue
    .add(
      "video_url_verify",
      { runId, tedTaskId, videoSubtaskIds, attempt: 1 },
      { delay: URL_VERIFY_FIRST_DELAY_MS, removeOnComplete: true, attempts: 2 },
    )
    .catch((e) => logger.error({ runId, error: e?.message }, "Failed to enqueue video_url_verify."))
  logger.info({ runId }, "Video recording started; subtask kept In Progress, URL verify scheduled. Parent stays open until URLs post.")
}

// Re-check the DB for a real "recording has started" signal, up to `attempts`
// times (START_POLL_MS between checks). Returns true on the first positive
// indication, false if none appears — the caller then closes the subtask as
// failed+Completed so nothing hangs.
async function confirmStart(runId: string, attempts: number): Promise<boolean> {
  for (let i = 1; i <= attempts; i++) {
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
    if (i < attempts) await sleep(START_POLL_MS)
  }
  return false
}

// Called ONLY on video SUCCESS (the recording URLs posted back). Video is the
// LAST subtask to close: it CONFIRMS every other subtask is already finalized,
// then closes ITSELF Completed, then the parent (main thread) — in that order. It
// NEVER closes the other subtasks: postSectionedReport already set each one's
// terminal status per-check, before this barrier was even enqueued.
//
// "Finalized" = the subtask reached a terminal STATUS from the report — Completed
// (passed / fixed / no-result) or In Progress (failed and not fixed). We confirm
// the actual status, NOT merely that the subtask has comments — a subtask can
// accrue several comments while still open. Confirmation source is QACC's own
// `ted_comments`: the report writes a distinct status row (source="status",
// event_key `status:<id>:<status>:<runId>`) in BOTH preview and real mode
// (postTedStatus ledgers it). A subtask is confirmed finalized ONLY when a
// Completed or In Progress status row exists; otherwise the parent is left open.
async function finalizeRunCloseout(opts: {
  runId: string
  tedTaskId?: string
  map: Record<string, any>
  videoSubtaskIds: string[]
}): Promise<void> {
  const { runId, tedTaskId, map, videoSubtaskIds } = opts
  const videoSet = new Set(videoSubtaskIds.map(String))

  // Every non-video subtask id in this run's map.
  const otherIds = new Set<string>()
  for (const [factor, raw] of Object.entries(map)) {
    if (factor === VIDEO_FACTOR) continue
    for (const id of flattenIds(raw)) if (!videoSet.has(id)) otherIds.add(id)
  }

  // Confirm (read-only) that each other subtask has a finalized STATUS row for
  // this run — the report's terminal status, not just any comment.
  const open: string[] = []
  if (otherIds.size > 0) {
    const ids = [...otherIds]
    const { data: rows } = await supabase
      .from("ted_comments")
      .select("ted_task_id, event_key")
      .eq("qa_run_id", runId)
      .eq("source", "status")
      .in("ted_task_id", ids)
    const finalized = new Set(
      (rows || [])
        .filter((r: any) => isFinalizedStatusKey(r.event_key))
        .map((r: any) => String(r.ted_task_id)),
    )
    for (const id of ids) if (!finalized.has(id)) open.push(id)
  }

  if (open.length > 0) {
    // Not every other subtask is confirmed finalized yet — do NOT close the video
    // subtask or the parent. Leaving the parent open is correct; marking it
    // Completed while a subtask is still To-Do is the exact bug we're preventing.
    // (Expected empty: the report finalizes them before this barrier is enqueued.)
    logger.warn(
      { runId, tedTaskId, open },
      "Video barrier: some other subtasks not confirmed finalized — parent left open.",
    )
    return
  }

  // All other subtasks confirmed finalized → video subtask closes ITSELF...
  for (const subId of videoSubtaskIds) {
    await postTedStatus(subId, TED_STATUS_COMPLETED, runId).catch(() => {})
  }
  // ...then the parent (main thread) is marked Completed — last of all.
  if (tedTaskId) {
    await postTedStatus(tedTaskId, TED_STATUS_COMPLETED, runId).catch(() => {})
  }
  logger.info(
    { runId, tedTaskId, others: otherIds.size },
    "All other subtasks confirmed finalized — video subtask + parent Completed.",
  )
}

// =====================================================================
// DEFERRED: video_url_verify
// ---------------------------------------------------------------------
// Recording runs ~30 min on the cloud provider. This pass posts each viewport's
// recording URL to the VIDEO SUBTASK as it becomes available. It is the ONLY
// success path: once a URL has posted back (all viewports, or ≥1 by the final
// deadline), it closes the video subtask (Completed) and then the parent — last
// of all. If NO URL is retrievable by the final deadline, it FAILS: the subtask
// is left In Progress and the parent is left open for a person (video has no
// auto-fix). Bounded retries guarantee it never loops forever.
// =====================================================================
export async function processVideoUrlVerifyJob(job: Job): Promise<void> {
  const { runId } = job.data
  const tedTaskId = job.data.tedTaskId as string | undefined
  const videoSubtaskIds: string[] = job.data.videoSubtaskIds || []
  const attempt: number = job.data.attempt || 1
  if (!runId) return

  const { data: run } = await supabase
    .from("qa_runs")
    .select("id, project_id, recording_video_urls, recording_status, ted_subtask_map, ted_task_id")
    .eq("id", runId)
    .single()
  const projectId = run?.project_id as string | undefined
  const urls = (run?.recording_video_urls as Record<string, string>) || {}
  // Needed to close the video subtask + parent on success (this job is the only
  // path that closes them now — the barrier no longer closes on start).
  const map: Record<string, any> = (run?.ted_subtask_map as any) || {}
  const parentId = tedTaskId || (run?.ted_task_id as string | undefined)

  // Which viewports have a retrievable URL right now?
  const available: { viewport: string; url: string }[] = []
  for (const viewport of RECORDING_VIEWPORTS) {
    const url = urls[viewport]
    if (url && (await isRetrievable(url))) available.push({ viewport, url })
  }

  // Post each available viewport to the video subtask once (stable key dedupes).
  if (videoSubtaskIds.length && available.length) {
    for (const subId of videoSubtaskIds) {
      for (const { viewport, url } of available) {
        const body = `<p>🎥 <strong>${cap(viewport)} recording</strong> ready: <a href="${escapeHtml(
          url,
        )}">${escapeHtml(url)}</a></p>`
        await postTedComment(subId, body, `ext:video-url-${runId}-${viewport}-${subId}`, {
          runId,
          projectId,
          targetKind: "subtask",
          checkFactor: VIDEO_FACTOR,
        }).catch(() => {})
      }
    }
  }

  const allDone = available.length >= RECORDING_VIEWPORTS.length
  if (allDone) {
    // PASS: every viewport URL posted back → NOW close the video subtask
    // (Completed) and the parent (last of all). This is the ONLY success path.
    await finalizeRunCloseout({ runId, tedTaskId: parentId, map, videoSubtaskIds })
    logger.info({ runId }, "video_url_verify: all viewport URLs posted; video subtask + parent Completed.")
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
  if (available.length > 0) {
    // PASS (partial): at least one viewport URL posted back = the recording is
    // available → close the video subtask (Completed) and the parent.
    await finalizeRunCloseout({ runId, tedTaskId: parentId, map, videoSubtaskIds })
    logger.warn(
      { runId, available: available.length },
      "video_url_verify: deadline with partial URLs; posted available, video subtask + parent Completed.",
    )
    return
  }

  // FAIL: nothing posted back within the window. Video has no fix → leave the
  // subtask In Progress and DO NOT close the parent (parent closes only on
  // video success — URLs posted).
  const body =
    "<p>⚠️ <strong>Video recording verification failed</strong> — no video URL was posted or it was not retrievable within the expected window.</p>"
  for (const subId of videoSubtaskIds) {
    await postTedComment(subId, body, `ext:video-url-failed-${runId}-${subId}`, {
      runId,
      projectId,
      targetKind: "subtask",
      checkFactor: VIDEO_FACTOR,
    }).catch(() => {})
    await postTedStatus(subId, TED_STATUS_IN_PROGRESS, runId).catch(() => {})
  }
  logger.error({ runId }, "video_url_verify: no retrievable URL by deadline; video left In Progress, parent left open.")
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
