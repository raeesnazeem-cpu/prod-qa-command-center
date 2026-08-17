/**
 * ONE-CLICK end-to-end test for the video-recording barrier.
 *
 *   pnpm --filter worker exec ts-node testVideoRecordingBarrier.ts
 *   (or from repo root:  bash test-video-flow.sh)
 *
 * It sets every test env override IN-PROCESS (nothing in prod.env is touched):
 *   TED_PREVIEW_ONLY=true         → all TED writes go to the local ted_comments table
 *   VIDEO_RECORDING_ENABLED=false → cloud trigger is simulated (no GCP/AWS)
 *   AI_FIX_MODULE_ENABLED=false   → gate uses raw findings
 *   VIDEO_* timeouts/delays shortened so the URL-verify path runs instantly
 *
 * It seeds five isolated runs against the "1397" test project, drives the real
 * job processors, and prints the ted_comments timeline (waiting → verdict →
 * status) with PASS/FAIL assertions. Re-runnable: it purges its own rows first.
 */
import { config } from "dotenv"
import path from "path"

// 1) Load prod.env, THEN apply test-only overrides (dotenv never overrides
//    values already set, and our explicit assignments below always win).
config({ path: path.join(__dirname, "prod.env") })
process.env.TED_PREVIEW_ONLY = "true"
process.env.VIDEO_RECORDING_ENABLED = "false"
process.env.AI_FIX_MODULE_ENABLED = "false"
process.env.VIDEO_START_TIMEOUT_MS = "3000"
process.env.VIDEO_START_POLL_MS = "500"
process.env.VIDEO_URL_VERIFY_FIRST_DELAY_MS = "1000"
process.env.VIDEO_URL_VERIFY_RETRY_DELAY_MS = "1000"
process.env.VIDEO_URL_VERIFY_MAX_ATTEMPTS = "2"

const MARKER = "QACCTEST-VID"
// A public, always-retrievable URL to stand in for a recorded video.
const FAKE_VIDEO_URL = "https://www.google.com/robots.txt"

const strip = (h: string) =>
  String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()

async function main() {
  // 2) Import AFTER env is set (these modules read env at import time).
  const { supabase } = await import("./src/lib/supabase")
  const queueMod = await import("./src/lib/queue")
  // Neutralize BullMQ enqueues so the test needs no running worker and writes
  // nothing to real Redis. The processors are driven directly below.
  ;(queueMod.qaQueue as any).add = async () => ({ id: "noop" })
  ;(queueMod.qaQueue as any).addBulk = async () => []
  const { processStartRunJob } = await import("./src/jobs/startRunJob")
  const { processVideoRecordingJob, processVideoUrlVerifyJob } = await import(
    "./src/jobs/videoRecordingJob"
  )

  const results: { name: string; ok: boolean; detail: string }[] = []
  const runIds: string[] = []

  // --- resolve the test project (prefer the "1397" local test project) --------
  let projectId: string | null = null
  {
    const { data: p1397 } = await supabase
      .from("projects")
      .select("id, name")
      .ilike("name", "%1397%")
      .limit(1)
    if (p1397 && p1397.length) {
      projectId = p1397[0].id
      console.log(`Using test project: ${p1397[0].name} (${projectId})`)
    } else {
      const { data: any } = await supabase.from("projects").select("id, name").limit(1)
      if (any && any.length) {
        projectId = any[0].id
        console.log(`⚠️  No "1397" project found — using "${any[0].name}" (${projectId})`)
      }
    }
  }
  if (!projectId) throw new Error("No project row exists in this DB to attach the test run to.")

  // --- purge rows from a previous run (idempotent / re-runnable) --------------
  {
    const { data: old } = await supabase
      .from("qa_runs")
      .select("id")
      .ilike("ted_task_id", `${MARKER}%`)
    const oldIds = (old || []).map((r) => r.id)
    if (oldIds.length) await supabase.from("qa_runs").delete().in("id", oldIds) // cascades pages/findings
    await supabase.from("ted_comments").delete().ilike("ted_task_id", `${MARKER}%`)
    console.log(`Purged ${oldIds.length} prior test run(s).`)
  }

  // Helper: create a seeded qa_run and return its id.
  async function makeRun(opts: {
    scen: string
    status: string
    enabledChecks: string[]
    map: Record<string, string>
    recordingVideoUrls?: Record<string, string>
  }): Promise<string> {
    const tedTaskId = `${MARKER}-${opts.scen}-parent`
    const { data, error } = await supabase
      .from("qa_runs")
      .insert({
        project_id: projectId,
        run_type: "pre_release",
        status: opts.status,
        site_url: "http://127.0.0.1:9400",
        enabled_checks: opts.enabledChecks,
        ted_task_id: tedTaskId,
        ted_subtask_map: opts.map,
        recording_video_urls: opts.recordingVideoUrls || {},
      })
      .select("id")
      .single()
    if (error || !data) throw new Error(`makeRun(${opts.scen}) failed: ${error?.message}`)
    runIds.push(data.id)
    return data.id
  }

  // Helper: fetch the local ted_comments for a given ted_task_id substring.
  async function commentsFor(taskLike: string) {
    const { data } = await supabase
      .from("ted_comments")
      .select("ted_task_id, target_kind, check_factor, source, body_html, created_at")
      .ilike("ted_task_id", `${taskLike}%`)
      .order("created_at", { ascending: true })
    return data || []
  }

  // ======================================================================
  // Scenario A — "Waiting" comment at run start (processStartRunJob)
  // ======================================================================
  {
    const runId = await makeRun({
      scen: "A",
      status: "pending",
      enabledChecks: [], // no page/API checks → no crawl, no queue
      map: { video_recording: `${MARKER}-A-vid` },
    })
    try {
      await processStartRunJob({ data: { runId } } as any)
    } catch (e: any) {
      console.log(`(scenario A: startRunJob threw, non-fatal for this assertion) ${e?.message}`)
    }
    const c = await commentsFor(`${MARKER}-A-vid`)
    const ok = c.some((r) => /waiting for all other checks/i.test(strip(r.body_html)))
    results.push({ name: "A waiting-comment posted", ok, detail: `${c.length} comment(s)` })
  }

  // ======================================================================
  // Scenario B — all clean → start (simulated) → pass+Completed → URLs to parent
  // ======================================================================
  {
    const runId = await makeRun({
      scen: "B",
      status: "completed",
      enabledChecks: ["video_recording", "favicon"],
      map: { video_recording: `${MARKER}-B-vid`, favicon: `${MARKER}-B-other` },
    })
    await processVideoRecordingJob({ data: { runId, tedTaskId: `${MARKER}-B-parent` } } as any)

    // Now simulate the cloud recorder having produced all three videos.
    await supabase
      .from("qa_runs")
      .update({
        recording_video_urls: {
          desktop: FAKE_VIDEO_URL,
          tablet: FAKE_VIDEO_URL,
          mobile: FAKE_VIDEO_URL,
        },
      })
      .eq("id", runId)
    await processVideoUrlVerifyJob({
      data: {
        runId,
        tedTaskId: `${MARKER}-B-parent`,
        videoSubtaskIds: [`${MARKER}-B-vid`],
        attempt: 2,
      },
    } as any)

    const vid = await commentsFor(`${MARKER}-B-vid`)
    const parent = await commentsFor(`${MARKER}-B-parent`)
    const started = vid.some((r) => /starting video recording/i.test(strip(r.body_html)))
    const completed = vid.some(
      (r) => r.source === "status" && /Completed/.test(strip(r.body_html)),
    )
    const urlsPosted = parent.filter((r) => /recording.*ready/i.test(strip(r.body_html))).length
    results.push({
      name: "B started + pass+Completed + URLs on main thread",
      ok: started && completed && urlsPosted >= 3,
      detail: `starting=${started} completed=${completed} urlComments=${urlsPosted}`,
    })
  }

  // ======================================================================
  // Scenario C — recording started but NO URL by deadline → flip to failed
  // ======================================================================
  {
    const runId = await makeRun({
      scen: "C",
      status: "completed",
      enabledChecks: ["video_recording"],
      map: { video_recording: `${MARKER}-C-vid` },
    })
    // Directly drive the final URL-verify attempt with no URLs present.
    await processVideoUrlVerifyJob({
      data: {
        runId,
        tedTaskId: `${MARKER}-C-parent`,
        videoSubtaskIds: [`${MARKER}-C-vid`],
        attempt: 2, // == VIDEO_URL_VERIFY_MAX_ATTEMPTS → final
      },
    } as any)
    const c = await commentsFor(`${MARKER}-C-vid`)
    const failed = c.some((r) => /verification failed/i.test(strip(r.body_html)))
    const completed = c.some((r) => r.source === "status" && /Completed/.test(strip(r.body_html)))
    results.push({
      name: "C no-URL-by-deadline → failed+Completed",
      ok: failed && completed,
      detail: `failed=${failed} completed=${completed}`,
    })
  }

  // ======================================================================
  // Scenario D — another check has an unresolved defect → not possible
  // ======================================================================
  {
    const runId = await makeRun({
      scen: "D",
      status: "completed",
      enabledChecks: ["video_recording", "dead_links"],
      map: { video_recording: `${MARKER}-D-vid`, dead_links: `${MARKER}-D-other` },
    })
    // Seed a real, unresolved defect on another check.
    const { data: page } = await supabase
      .from("pages")
      .insert({ run_id: runId, url: "http://127.0.0.1:9400/", status: "done" })
      .select("id")
      .single()
    await supabase.from("findings").insert({
      page_id: page!.id,
      run_id: runId,
      check_factor: "dead_links",
      severity: "high",
      title: "Broken link found: /contact returns 404",
      description: "The link /contact returned HTTP 404.",
      status: "open",
      ai_generated: false,
    })
    await processVideoRecordingJob({ data: { runId, tedTaskId: `${MARKER}-D-parent` } } as any)
    const c = await commentsFor(`${MARKER}-D-vid`)
    const blocked = c.some((r) => /not possible as there are incomplete fixes/i.test(strip(r.body_html)))
    const completed = c.some((r) => r.source === "status" && /Completed/.test(strip(r.body_html)))
    results.push({
      name: "D incomplete-fixes → failed+Completed",
      ok: blocked && completed,
      detail: `blocked=${blocked} completed=${completed}`,
    })
  }

  // ======================================================================
  // Scenario E — all clean but recording won't start → exact error string
  // ======================================================================
  {
    const runId = await makeRun({
      scen: "E",
      status: "completed",
      enabledChecks: ["video_recording"],
      map: { video_recording: `${MARKER}-E-vid` },
    })
    // Force a real cloud-trigger failure: enable + point at an unreachable URL.
    process.env.VIDEO_RECORDING_ENABLED = "true"
    process.env.RECORDING_TRIGGER_URL = "http://127.0.0.1:9/none"
    try {
      await processVideoRecordingJob({ data: { runId, tedTaskId: `${MARKER}-E-parent` } } as any)
    } finally {
      process.env.VIDEO_RECORDING_ENABLED = "false"
      delete process.env.RECORDING_TRIGGER_URL
    }
    const c = await commentsFor(`${MARKER}-E-vid`)
    // Client-facing copy must be EXACTLY this (source 'report', not 'manual').
    const exact = c.some(
      (r) => r.source !== "manual" && strip(r.body_html) === "Video recording encountered an error",
    )
    const internal = c.some(
      (r) => r.source === "manual" && /QACC-internal/i.test(strip(r.body_html)),
    )
    const completed = c.some((r) => r.source === "status" && /Completed/.test(strip(r.body_html)))
    results.push({
      name: "E not-started → exact client error + internal detail + Completed",
      ok: exact && internal && completed,
      detail: `exactClientMsg=${exact} internalDetail=${internal} completed=${completed}`,
    })
  }

  // ======================================================================
  // Print the full timeline + assertions
  // ======================================================================
  console.log("\n================= ted_comments TIMELINE (local preview) =================")
  const all = await commentsFor(MARKER)
  for (const r of all) {
    const who = r.target_kind === "parent" ? "PARENT " : "subtask"
    const src = (r.source || "").padEnd(6)
    console.log(
      `[${r.ted_task_id}] ${who} ${src} ${r.check_factor || ""} :: ${strip(r.body_html).slice(0, 120)}`,
    )
  }

  console.log("\n================= ASSERTIONS =================")
  let allOk = true
  for (const r of results) {
    allOk = allOk && r.ok
    console.log(`${r.ok ? "✅ PASS" : "❌ FAIL"}  ${r.name}   (${r.detail})`)
  }
  console.log(`\nSeeded runs: ${runIds.join(", ")}`)
  console.log(allOk ? "\n🎉 ALL SCENARIOS PASSED" : "\n💥 SOME SCENARIOS FAILED")

  // Close connections so the process exits cleanly.
  try {
    await (queueMod.qaQueue as any).close?.()
    await (queueMod as any).connection?.quit?.()
  } catch {}
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => {
  console.error("Test harness crashed:", e)
  process.exit(2)
})
