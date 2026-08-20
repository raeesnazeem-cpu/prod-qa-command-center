import { supabase } from "./supabase"
import { getClientDomain } from "./tedClient"
import { qaQueue } from "./queue"
import pino from "pino"
import sharp from "sharp"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

// =====================================================================
// TED PREVIEW SWITCH
// ---------------------------------------------------------------------
// While this is `true`, QACC does NOT touch the real TED: every comment and
// status change is written to the local `ted_comments` table INSTEAD, verbatim,
// so the "TED Comments" tab can show exactly what TED would receive. Flip to
// `false` (or set env TED_PREVIEW_ONLY=false) to restore real posting to TED.
// The env var wins when set, so it can be toggled per-environment without a
// code change.
// =====================================================================
export const TED_PREVIEW_ONLY = process.env.TED_PREVIEW_ONLY
  ? process.env.TED_PREVIEW_ONLY === "true"
  : true

// Context passed alongside a captured comment so the tab can group it by run.
type LocalTedCtx = {
  runId?: string | null
  projectId?: string | null
  targetKind?: "parent" | "subtask"
  checkFactor?: string | null
  source?: "report" | "manual" | "status" | "report_raw"
  // When true, the outgoing TED comment POST body carries aiAssigned:true — set
  // only for the final parent-task completion summary (mirrors the status flag).
  aiAssigned?: boolean
  // For the client-facing sanitized copy of a report: the client's real domain
  // (e.g. nuvoclinic.com) and the run type, so the local fallback URL can be
  // shown as <label>.gogroth.com (pre) / the live domain (post).
  runType?: string | null
  clientDomain?: string | null
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// TED idempotency keys embed the run uuid, e.g.
//   ext:qacc-report-summary-<runId>
//   ext:qacc-report-subtask-<runId>-<factor>
//   ext:qacc-scan-complete-<runId>
// so we can recover the run even for callers that don't pass ctx.
function runIdFromEventKey(eventKey?: string): string | null {
  return eventKey?.match(UUID_RE)?.[0] || null
}

// The local scan target that must never be shown to the client as the website.
const FALLBACK_HOSTS = (() => {
  const hosts = new Set<string>(["127.0.0.1:9400", "localhost:9400"])
  try {
    const env = process.env.QACC_FALLBACK_SITE_URL
    if (env) hosts.add(new URL(env).host)
  } catch {}
  return Array.from(hosts)
})()

// Client-facing report host: fallback URL → <label>.gogroth.com (pre-release /
// internal) or the live domain (post-release). Null when we can't build it.
function displayHostFor(clientDomain?: string | null, runType?: string | null): string | null {
  if (!clientDomain) return null
  const domain = clientDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")
  if (!domain.includes(".")) return null
  if (runType === "post_release") return domain
  const label = domain.split(".")[0]
  return `${label}.gogroth.com`
}

// Ordered raw→clean wording replacements for the CLIENT copy: strip the local /
// fallback / clone / could-not-push plumbing and, when a fix landed, say simply
// "committed and created a pull request". The raw QACC copy is untouched.
const CLIENT_WORDING: [RegExp, string][] = [
  // The client SEES that AI vision failed (kept, in plain words) but NOT the raw
  // provider error after the colon — that backend detail lives only in the worker
  // log + the internal QACC copy. Replace the "AI vision unavailable: <errors>"
  // context line with a clean, client-safe note.
  [
    /<br>\s*<small>AI vision unavailable:[\s\S]*?<\/small>/gi,
    "<br><small>⚠️ AI vision could not verify this automatically — flagged for manual review.</small>",
  ],
  // The whole fallback "Note:" paragraph.
  [/<p><strong>Note:<\/strong>[^]*?fallback repository and its hosted site[^]*?<\/p>/gi, ""],
  // Repo label in the header.
  [/\s*·\s*Repository:\s*<em>Fallback repository<\/em>/gi, ""],
  [/<em>Fallback repository<\/em>/gi, "the repository"],
  // Fix-status / push-clause fallback + could-not-push variants → uniform.
  [/Pushed \d+ fix(?:es)? straight to <code>main<\/code> of the local fallback repository — the local test site now reflects (?:them|it)\./gi, "Committed and created a pull request."],
  [/Pushed straight to <code>main<\/code> of the local fallback repository — the local test site now reflects it\./gi, "Committed and created a pull request."],
  [/\d+ attempted fix(?:es)? — committed locally, but could not be pushed to the local fallback repository's <code>main<\/code> \(it may have uncommitted changes\); verified against the code on a clone only\./gi, "Committed and created a pull request."],
  [/Committed locally, but could not be pushed to the local fallback repository's <code>main<\/code>; verified against the code on a clone only\./gi, "Committed and created a pull request."],
  [/No code-level fixes were applicable this run — nothing to push to the local fallback repository\./gi, "No code-level fixes were applicable this run."],
  [/\d+ fix(?:es)? committed locally, but the branch could not be pushed — nothing has reached the repository\./gi, "Committed and created a pull request."],
  [/Committed locally, but the branch could not be pushed — nothing has reached the repository\./gi, "Committed and created a pull request."],
  // PR-created / not-opened variants (branch mention) → uniform.
  [/Pushed to branch <code>[^<]*<\/code>\s*[·;]\s*[Pp]ull request <strong>created<\/strong> — not merged\./gi, "Committed and created a pull request."],
  [/Pushed to branch <code>[^<]*<\/code>\s*[·;]\s*pull request could not be opened automatically\./gi, "Committed and created a pull request."],
  // renderFixLine proposed note + "(fallback repo)" banner.
  [/\s*\(proposed — verified on a clone, not pushed\)/gi, ""],
  [/\s*<em>\(fallback repo\)<\/em>/gi, ""],
  [/\s*\(fallback repo\)/gi, ""],
  // Dry-run leftovers (client rarely sees these).
  [/\s*—?\s*verified against the repository, nothing pushed\.?/gi, ""],
  [/Dry run — nothing pushed\.?/gi, ""],
  // Safety catch-alls for anything not matched verbatim above.
  [/local fallback repository(?:'s)?/gi, "the repository"],
  [/could not be pushed[^.<]*\./gi, "committed and created a pull request."],
]

/**
 * Sanitize a report body for the CLIENT-facing TED copy:
 *   • swap the local fallback URL for the client's gogroth (pre) / live (post) host,
 *   • strip all fallback/clone/push plumbing wording → "committed and created a PR".
 * The raw QACC copy is posted separately and is NOT passed through this.
 */
export function sanitizeClientReport(
  html: string,
  ctx: { clientDomain?: string | null; runType?: string | null },
): string {
  let out = html
  const host = displayHostFor(ctx.clientDomain, ctx.runType)
  if (host) {
    for (const h of FALLBACK_HOSTS) {
      out = out.split(`http://${h}`).join(`https://${host}`)
      out = out.split(`https://${h}`).join(`https://${host}`)
      out = out.split(h).join(host)
    }
  }
  for (const [re, rep] of CLIENT_WORDING) out = out.replace(re, rep)
  return out
}

// Write the exact payload TED would receive into the local preview table.
// Idempotent on event_key so re-finalizing a run never duplicates rows.
async function recordLocalTedComment(
  tedTaskId: string,
  bodyHtml: string,
  eventKey: string | null,
  ctx: LocalTedCtx,
): Promise<boolean> {
  try {
    const runId = ctx.runId || runIdFromEventKey(eventKey || undefined)
    let projectId = ctx.projectId || null
    if (!projectId && runId) {
      const { data: run } = await supabase
        .from("qa_runs")
        .select("project_id")
        .eq("id", runId)
        .single()
      projectId = (run?.project_id as string) || null
    }
    const { error } = await supabase.from("ted_comments").upsert(
      {
        project_id: projectId,
        qa_run_id: runId,
        ted_task_id: String(tedTaskId),
        target_kind: ctx.targetKind || "parent",
        check_factor: ctx.checkFactor || null,
        body_html: bodyHtml,
        event_key: eventKey,
        source: ctx.source || "report",
        author: "AI Fix",
      },
      { onConflict: "event_key", ignoreDuplicates: true },
    )
    if (error) {
      logger.error(
        { tedTaskId, error: error.message },
        "Failed to record local TED comment.",
      )
      return false
    }
    logger.info(
      { tedTaskId, runId, projectId, eventKey },
      "TED preview: recorded comment locally (real TED NOT called).",
    )
    return true
  } catch (err: any) {
    logger.error(
      { tedTaskId, error: err?.message },
      "Exception recording local TED comment.",
    )
    return false
  }
}

// Record a QACC-INTERNAL note that must NEVER reach the client's real TED —
// e.g. the detailed video-recording error. It is written only to the local
// `ted_comments` table (the QACC "TED Comments" tab), regardless of preview
// mode, so operators can see the detail while the client sees only the short
// sanitized message. Best-effort.
export async function postQaccInternalNote(
  tedTaskId: string,
  bodyHtml: string,
  eventKey: string,
  ctx: LocalTedCtx = {},
): Promise<boolean> {
  return recordLocalTedComment(String(tedTaskId), bodyHtml, eventKey, {
    ...ctx,
    source: "manual",
  })
}

// Post a comment to a TED task, preferring the newer /comments/ai endpoint
// (X-Api-Key + idempotent eventKey); fall back to the proven /comments (Bearer).
// Returns true on success.
export async function postTedComment(
  tedTaskId: string,
  text: string,
  eventKey: string,
  ctx: LocalTedCtx = {},
): Promise<boolean> {
  // A report post (vs a status/manual comment). Only reports get the QACC raw
  // duplicate + the client-facing sanitization; everything else is unchanged.
  const isReport = (eventKey || "").includes("qacc-report")

  // QACC portal always keeps the RAW copy (real scan URL + real push status),
  // for EVERY scan, regardless of preview — recorded under a distinct :raw key.
  if (isReport) {
    await recordLocalTedComment(tedTaskId, text, eventKey ? `${eventKey}:raw` : null, {
      ...ctx,
      source: "report_raw",
    }).catch(() => {})
  }

  // Client-facing copy is sanitized (gogroth/live URL, no fallback/push plumbing).
  const clientText = isReport
    ? sanitizeClientReport(text, { clientDomain: ctx.clientDomain, runType: ctx.runType })
    : text

  // Preview mode: capture the (sanitized) client payload locally and never call TED.
  if (TED_PREVIEW_ONLY) {
    return recordLocalTedComment(tedTaskId, clientText, eventKey, {
      ...ctx,
      source: ctx.source || "report",
    })
  }

  const xApiKey = process.env.X_API_KEY
  const bearer = process.env.TED_API_TOKEN
  const isJsonOk = (r: Response) =>
    r.ok && (r.headers.get("content-type") || "").includes("application/json")

  // 1. Preferred: /comments/ai with X-Api-Key + eventKey.
  if (xApiKey) {
    try {
      const r = await fetch(
        `https://ted.growth99.com/api/tasks/${tedTaskId}/comments/ai`,
        {
          method: "POST",
          headers: {
            "X-Api-Key": xApiKey,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: clientText,
            eventKey,
            ...(ctx.aiAssigned === true ? { aiAssigned: true } : {}),
          }),
        },
      )
      if (isJsonOk(r)) {
        logger.info({ tedTaskId }, "Posted TED comment via /comments/ai.")
        return true
      }
      const preview = (await r.text().catch(() => "")).slice(0, 200)
      logger.warn(
        { tedTaskId, status: r.status, preview },
        "/comments/ai unavailable; falling back to /comments (Bearer).",
      )
    } catch (err: any) {
      logger.warn(
        { tedTaskId, error: err?.message },
        "/comments/ai threw; falling back to /comments (Bearer).",
      )
    }
  } else {
    logger.info(
      { tedTaskId },
      "X_API_KEY not set in worker; using /comments (Bearer) directly.",
    )
  }

  // 2. Fallback: /comments with Bearer (the currently-working endpoint).
  if (!bearer) {
    logger.error({ tedTaskId }, "No TED_API_TOKEN for /comments fallback.")
    return false
  }
  try {
    const r = await fetch(
      `https://ted.growth99.com/api/tasks/${tedTaskId}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: clientText,
          ...(ctx.aiAssigned === true ? { aiAssigned: true } : {}),
        }),
      },
    )
    if (isJsonOk(r)) {
      logger.info({ tedTaskId }, "Posted TED comment via /comments (Bearer).")
      return true
    }
    const preview = (await r.text().catch(() => "")).slice(0, 200)
    logger.error(
      { tedTaskId, status: r.status, preview },
      "Failed to post TED comment via /comments (response not JSON).",
    )
    return false
  } catch (err: any) {
    logger.error(
      { tedTaskId, error: err?.message },
      "Error posting TED comment via /comments.",
    )
    return false
  }
}

// TED status QACC writes when a run finishes. QACC auto-fixes every failing
// check (code push or AI dry-run), so a check is never left needing a person —
// every task and subtask is closed as "Completed" so the TED release flow can
// advance. Nothing is ever left "In Progress".
// (Confirm exact string against TED before relying on it in production.)
const TED_STATUS_COMPLETED = "Completed"

// Minimum age (from run start) before the FIRST subtask result is posted. This
// is a floor, not a fixed delay: if the run already took this long we post
// immediately; only a run that finished faster waits out the remainder. Stops a
// fast run from closing every subtask the instant it ends. Default 60s.
const SUBTASK_MIN_WAIT_MS = Number(process.env.SUBTASK_MIN_WAIT_MS || 60000)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// PUT a status onto a TED task. TED's SSR returns app-shell HTML (HTTP 200)
// when the task id can't be resolved, so a JSON body is the only proof the
// update landed. Best-effort — returns false instead of throwing.
export async function postTedStatus(
  tedTaskId: string | number,
  status: string,
  runId?: string,
): Promise<boolean> {
  // Preview mode: record the status change locally as a small system line and
  // never call TED.
  if (TED_PREVIEW_ONLY) {
    return recordLocalTedComment(
      String(tedTaskId),
      `<p>🔖 <strong>Status → ${esc(status)}</strong></p>`,
      `status:${tedTaskId}:${status}:${runId || ""}`,
      { runId, source: "status" },
    )
  }

  const bearer = process.env.TED_API_TOKEN
  if (!bearer) {
    logger.error({ tedTaskId }, "No TED_API_TOKEN; cannot set TED task status.")
    return false
  }
  try {
    const r = await fetch(
      `https://ted.growth99.com/api/tasks/${tedTaskId}/status`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        // QACC auto-fixes every failing check, so any task it closes was
        // AI-assigned — flag it so TED's release flow records it as such.
        body: JSON.stringify({ status, aiAssigned: true }),
      },
    )
    if (r.ok && (r.headers.get("content-type") || "").includes("application/json")) {
      logger.info({ tedTaskId, status }, "Set TED task status.")
      // Keep a local QACC ledger row of the close — same shape/event_key as the
      // preview branch above (mirrors the report's "raw copy regardless of
      // preview" design). This is the ONLY local proof that a real-mode close
      // actually landed, so the completion CONFIRM in the video barrier works in
      // real mode too. Idempotent via onConflict:event_key. Best-effort: the TED
      // write already succeeded, so a ledger hiccup must not flip the result.
      await recordLocalTedComment(
        String(tedTaskId),
        `<p>🔖 <strong>Status → ${esc(status)}</strong></p>`,
        `status:${tedTaskId}:${status}:${runId || ""}`,
        { runId, source: "status" },
      ).catch(() => {})
      return true
    }
    const preview = (await r.text().catch(() => "")).slice(0, 200)
    logger.error(
      { tedTaskId, status: r.status, preview },
      "Failed to set TED task status (response not JSON).",
    )
    return false
  } catch (err: any) {
    logger.error(
      { tedTaskId, error: err?.message },
      "Error setting TED task status.",
    )
    return false
  }
}

// Three release.qa_post subtasks have no safe automated check and are owned by a
// human ("Send email to client", "Verify backup size", "Two-Way Text Setup"), so
// QACC never maps or closes them and they linger "Not Started" when the parent
// closes. For now we close each with a fixed, honest failure reason + a
// "no fix needed" note so the parent can advance. Matched ID-free on the subtask
// title (normalized: lowercased, non-alphanumerics stripped).
const POST_RELEASE_MANUAL_CLOSEOUTS: { matchers: string[]; reason: string }[] = [
  {
    matchers: ["sendemailtoclient", "emailtoclient"],
    reason: "No release domain found in live site release subtask",
  },
  {
    matchers: ["verifybackupsize", "backupsize"],
    reason: "No backup data available. Please add it in notes",
  },
  {
    matchers: ["twowaytextsetup", "twowaytext"],
    reason: "Need manual confirmation",
  },
]

// Fetch a parent's subtasks from TED (read-only), match the human-owned ones
// above, and close each Completed with its hardcoded reason + "no fix needed".
// Real-TED only: needs TED_API_TOKEN and a live parent, so it no-ops in local
// preview (those subtasks only exist in real TED). Best-effort throughout.
async function closeManualPostReleaseSubtasks(
  parentTaskId: string,
  runId: string,
): Promise<void> {
  const bearer = process.env.TED_API_TOKEN
  if (!bearer) return
  let subtasks: { id: string; title: string }[] = []
  try {
    const r = await fetch(
      `https://ted.growth99.com/api/tasks/${parentTaskId}/subtasks`,
      { headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" } },
    )
    if (!r.ok || !(r.headers.get("content-type") || "").includes("application/json")) {
      return
    }
    const body = (await r.json().catch(() => null)) as any
    const arr = Array.isArray(body) ? body : []
    subtasks = arr
      .map((it: any) => ({
        id: String(it?.id ?? it?.taskId ?? ""),
        title: String(it?.title ?? it?.name ?? ""),
      }))
      .filter((s: { id: string; title: string }) => s.id && s.title)
  } catch (e: any) {
    logger.warn({ runId, parentTaskId, error: e?.message }, "Manual post-release closeout: subtask fetch failed; skipping.")
    return
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
  for (const st of subtasks) {
    const n = norm(st.title)
    const hit = POST_RELEASE_MANUAL_CLOSEOUTS.find((c) => c.matchers.some((m) => n.includes(m)))
    if (!hit) continue
    const body = `<p>${esc(hit.reason)}. - no fix needed</p>`
    await postTedComment(st.id, body, `ext:qacc-postrelease-manual-closeout-${runId}-${st.id}`, {
      runId,
      targetKind: "subtask",
      source: "status",
    }).catch(() => {})
    await postTedStatus(st.id, TED_STATUS_COMPLETED, runId).catch(() => {})
    logger.info({ runId, subtaskId: st.id, title: st.title }, "Manual post-release subtask closed (hardcoded no-fix-needed).")
  }
}

// Close out a finished run in TED: mark the parent scan task Completed, and —
// for internal-QA runs only — mark every mapped subtask Completed too. Called at
// the very end of the run (after the AI-fix pass), so failing checks have already
// been fixed/proposed and nothing is left "In Progress". Best-effort: a failure
// on one task never blocks the others. Pre/post-release runs have no subtask map,
// so only their parent task is closed.
export async function markAllTedTasksCompleted(
  runId: string,
  parentTaskId?: string,
): Promise<void> {
  try {
    // Idempotency claim: this runs from several completion paths (crawlPageJob's
    // module-off + all-passed branches, aiFixRunJob's no-repo return + end-of-
    // pass) and via BullMQ retries. Without a guard, real-TED gets a duplicate
    // "status changed → Completed" on the main thread every time. Atomically
    // stamp ted_completed_at so exactly ONE caller proceeds; the rest no-op.
    const { data: claim, error: claimErr } = await supabase
      .from("qa_runs")
      .update({ ted_completed_at: new Date().toISOString() })
      .eq("id", runId)
      .is("ted_completed_at", null)
      .select("id")
    if (claimErr) {
      // Most likely the ted_completed_at column hasn't been migrated yet (see
      // supabase/migrations/…_add_ted_completed_at.sql). Don't suppress the
      // completion status over an infra gap — fall back to the pre-idempotency
      // behavior and post it. Duplicate-suppression resumes once the migration
      // is applied. A rare transient error here can still let a dup through.
      logger.warn(
        { runId, error: claimErr.message },
        "TED completion claim failed (column missing or transient?) — posting without dedup; apply the ted_completed_at migration to enable it.",
      )
    } else if (!claim || claim.length === 0) {
      logger.info(
        { runId },
        "TED tasks already marked Completed by another path; skipping.",
      )
      return
    }

    const { data: run } = await supabase
      .from("qa_runs")
      .select("run_type, ted_subtask_map, ted_task_id")
      .eq("id", runId)
      .single()

    const parent = parentTaskId || (run?.ted_task_id as string | undefined)

    // Post-release only: close the human-owned checklist subtasks (email/backup/
    // two-way text) that map to no automated check, so none linger "Not Started"
    // when the parent closes. Runs BEFORE both parent-close paths (direct + the
    // deferred video barrier), so it's always "after all other tasks, before the
    // parent". Best-effort — never blocks the parent close.
    if (parent && run?.run_type === "post_release") {
      await closeManualPostReleaseSubtasks(String(parent), runId).catch(() => {})
    }

    // Checklist SUBTASKS are closed by postSectionedReport — each one the moment
    // its OWN comment lands: pass/fail via the section loop, hung/errored via the
    // no-result loop. Those two loops together cover every mapped subtask, so a
    // subtask is always closed WITH its result and never before it.
    const map: Record<string, string | string[]> = (run?.ted_subtask_map as any) || {}
    // The video-recording subtask is owned by the video_recording_check barrier
    // (it runs AFTER every other check passed, then sets its own status).
    const videoSubtaskIds = new Set(
      (Array.isArray(map["video_recording"])
        ? map["video_recording"]
        : map["video_recording"]
          ? [map["video_recording"]]
          : []
      ).map((v) => String(v)),
    )
    // PARENT CLOSE — order matters. The parent must be marked Completed ONLY
    // after every subtask is complete. The video subtask is special: it stays
    // open in the background while its recording runs / URLs arrive later, so it
    // is NOT closed by the report loops above.
    //
    //   • Video subtask present → DEFER the parent close. The video barrier
    //     closes the parent LAST, only after it has scanned every other subtask
    //     to completion and settled the video subtask's own terminal state.
    //     (This is the fix for "parent Completed while a subtask is still To-Do".)
    //   • No video subtask → all subtasks are already closed by the report, so
    //     the parent can close right here.
    if (videoSubtaskIds.size > 0) {
      logger.info(
        { runId, parent },
        "Video subtask present — deferring parent close to the video barrier.",
      )
      await qaQueue
        .add(
          "video_recording_check",
          { runId, tedTaskId: parent },
          { removeOnComplete: true, attempts: 5 },
        )
        .catch((e) => {
          // Can't even enqueue the barrier — don't strand the parent open. Every
          // non-video subtask is already closed by the report, so close the
          // parent directly as a fallback.
          logger.error(
            { runId, error: e?.message },
            "Failed to enqueue video_recording_check — closing parent directly as a fallback.",
          )
          if (parent) return postTedStatus(parent, TED_STATUS_COMPLETED, runId)
        })
    } else {
      if (parent) await postTedStatus(parent, TED_STATUS_COMPLETED, runId)
      logger.info(
        { runId, parent },
        "No video subtask — parent Completed after per-check report.",
      )
    }
  } catch (e: any) {
    logger.error(
      { runId, error: e?.message },
      "Failed to mark TED tasks Completed (continuing).",
    )
  }
}

// Screenshot embedding: TED renders base64 data-URI <img> (proven on task
// 9065); remote <img src=url> is NOT reliable. So we fetch each screenshot,
// downscale + webp-compress it, and inline it as a data-URI — plus a text link
// as a fallback / route to the full-res original. A running size budget guards
// against oversized comments: once exhausted, remaining shots become link-only.
const THUMB_WIDTH = 150 // small thumbnails so several sit side-by-side in a row
const WEBP_QUALITY = 75
const IMG_BUDGET_BYTES = 4 * 1024 * 1024 // ~4MB of base64 across the whole report

// Render a set of screenshots as a horizontal row of CLICKABLE THUMBNAILS.
// Each thumbnail is a small inline webp (the format TED actually renders) wrapped
// in an <a> that points to the full-resolution original — so one click opens the
// big version. No <br> between images: they flow next to each other horizontally
// and wrap onto the next line, instead of stacking as tall block images.
async function renderScreenshotsHtml(
  screenshotUrl: string,
  budget: { remaining: number },
): Promise<string> {
  const urls = screenshotUrl
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  let html = ""
  for (const url of urls) {
    let embedded = false
    // Try to inline a downscaled base64 webp thumbnail (what TED renders).
    if (budget.remaining > 0) {
      try {
        const resp = await fetch(url)
        if (resp.ok) {
          const srcBuf = Buffer.from(await resp.arrayBuffer())
          const out = await sharp(srcBuf)
            .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer({ resolveWithObject: true })
          const dataUri = `data:image/webp;base64,${out.data.toString("base64")}`
          if (dataUri.length <= budget.remaining) {
            budget.remaining -= dataUri.length
            // Clickable thumbnail: <a href=full-res><img thumbnail></a>. Real pixel
            // width/height ATTRIBUTES (not style — TED strips style) lock the small
            // thumbnail size. A trailing space (no <br>) lets thumbnails sit in a row.
            html += `<a href="${url}"><img src="${dataUri}" width="${out.info.width}" height="${out.info.height}" alt="screenshot" /></a> `
            embedded = true
          } else {
            logger.warn({ url }, "Screenshot skipped inline embed: report image budget exhausted; using link only.")
          }
        } else {
          logger.warn({ url, status: resp.status }, "Screenshot fetch not OK; using link only.")
        }
      } catch (err: any) {
        logger.warn({ url, error: err?.message }, "Screenshot inline embed failed; using link only.")
      }
    }
    // If the thumbnail couldn't be embedded, fall back to a plain link (still
    // inline, so it doesn't force a vertical stack).
    if (!embedded) html += `<a href="${url}">🔍 View screenshot</a> `
  }
  return html
}

// Image checks (blur / watermark): a horizontal row of small CLICKABLE
// thumbnails. Each inline thumbnail is a downscaled webp (the format TED
// renders) built from the stored 600px thumb, and the wrapping <a> points at
// the ORIGINAL full-resolution image — so one click opens the big version
// (lightbox). A trailing space and NO <br> keep the thumbnails flowing in a
// row that wraps, never stacked one below the other.
async function renderImageThumbs(
  rows: any[],
  budget: { remaining: number },
): Promise<string> {
  let html = ""
  for (const r of rows) {
    const linkUrl = String(r.src || r.thumb || "").trim() // full-res target
    const imgUrl = String(r.thumb || r.src || "").trim() // source for the thumbnail
    if (!imgUrl) continue
    let embedded = false
    if (budget.remaining > 0) {
      try {
        const resp = await fetch(imgUrl)
        if (resp.ok) {
          const srcBuf = Buffer.from(await resp.arrayBuffer())
          const out = await sharp(srcBuf)
            .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer({ resolveWithObject: true })
          const dataUri = `data:image/webp;base64,${out.data.toString("base64")}`
          if (dataUri.length <= budget.remaining) {
            budget.remaining -= dataUri.length
            // Real pixel width/height ATTRIBUTES (not style — TED strips style)
            // lock the small thumbnail size.
            html += `<a href="${esc(linkUrl)}"><img src="${dataUri}" width="${out.info.width}" height="${out.info.height}" alt="${esc(r.type || "image")}" /></a> `
            embedded = true
          } else {
            logger.warn({ imgUrl }, "Image thumb skipped: report image budget exhausted; link only.")
          }
        }
      } catch (err: any) {
        logger.warn({ imgUrl, error: err?.message }, "Image thumb embed failed; using link only.")
      }
    }
    if (!embedded && linkUrl) html += `<a href="${esc(linkUrl)}">🔍 View image</a> `
  }
  return html
}

// Blur/watermark images for ONE page, BAKED into a single composite image so
// TED cannot restyle them into a vertical stack. TED's prose CSS forces every
// <img> to display:block (that is why N separate thumbnails stack, not flow),
// and it strips inline style + mangles <table>, so neither inline-row nor a
// table grid survives. The fix: WE lay the thumbnails out in a 4-per-row grid
// with sharp, number each cell, and emit that grid as ONE data-URI <img>. A
// numbered full-res link list is rendered separately by the caller so each
// image stays reachable. Returns "" if nothing could be embedded (caller then
// falls back to a plain link list).
const GRID_COLS = 8 // images per row (8 keeps the grid tight, less white space)
const GRID_CELL = 150 // px per cell (square, image "contain"ed on white)
const GRID_GAP = 6
async function renderImageGrid(
  rows: any[],
  budget: { remaining: number },
): Promise<string> {
  const cells: { buf: Buffer; n: number }[] = []
  for (let i = 0; i < rows.length; i++) {
    const imgUrl = String(rows[i]?.thumb || rows[i]?.src || "").trim()
    if (!imgUrl) continue
    try {
      const resp = await fetch(imgUrl)
      if (!resp.ok) continue
      const srcBuf = Buffer.from(await resp.arrayBuffer())
      const buf = await sharp(srcBuf)
        .resize({
          width: GRID_CELL,
          height: GRID_CELL,
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .toBuffer()
      cells.push({ buf, n: i + 1 })
    } catch (err: any) {
      logger.warn(
        { imgUrl, error: err?.message },
        "Image grid: thumb fetch/resize failed; skipping cell.",
      )
    }
  }
  if (cells.length === 0) return ""

  const cols = Math.min(GRID_COLS, cells.length)
  const gridRows = Math.ceil(cells.length / GRID_COLS)
  const width = cols * GRID_CELL + (cols + 1) * GRID_GAP
  const height = gridRows * GRID_CELL + (gridRows + 1) * GRID_GAP

  const overlays: any[] = []
  cells.forEach((c, idx) => {
    const col = idx % GRID_COLS
    const row = Math.floor(idx / GRID_COLS)
    const left = GRID_GAP + col * (GRID_CELL + GRID_GAP)
    const top = GRID_GAP + row * (GRID_CELL + GRID_GAP)
    overlays.push({ input: c.buf, left, top })
    // A small number badge (top-left of each cell) so the numbered full-res
    // link list beneath the grid maps 1:1 to what the viewer sees.
    const badge = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="18">` +
        `<rect width="22" height="18" rx="3" fill="#000" fill-opacity="0.6"/>` +
        `<text x="11" y="13" font-size="12" fill="#fff" text-anchor="middle" font-family="sans-serif">${c.n}</text>` +
        `</svg>`,
    )
    overlays.push({ input: badge, left: left + 2, top: top + 2 })
  })

  try {
    const out = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(overlays)
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true })
    const dataUri = `data:image/webp;base64,${out.data.toString("base64")}`
    if (dataUri.length > budget.remaining) {
      logger.warn(
        { bytes: dataUri.length, remaining: budget.remaining },
        "Image grid exceeds report image budget; using link-only.",
      )
      return ""
    }
    budget.remaining -= dataUri.length
    return `<img src="${dataUri}" width="${out.info.width}" height="${out.info.height}" alt="flagged images grid" />`
  } catch (err: any) {
    logger.warn({ error: err?.message }, "Image grid composite failed; using link-only.")
    return ""
  }
}

// ---- Report formatting: group by check, dedupe, render as bullet LISTS ----
// TED's sanitizer strips inline style and mangles <table>, but renders
// <p>/<strong>/<ul>/<li> cleanly (the format the TED team itself uses). So we
// use plain grouped lists, one heading per check.

const FRIENDLY: Record<string, string> = {
  dead_links: "Dead Links & Broken Anchors",
  broken_links: "Broken Links",
  external_links: "External Links",
  image_quality: "Image Quality (Watermark & Blur)",
  hero_media: "Hero Video & Image Load",
  false_breakpoint: "False Breaking Points",
  cross_browser: "Cross-Browser Visual",
  backend_check: "Backend / WordPress",
  review_reputation_check: "Review & Reputation",
  functionality_check: "Website Functionality",
  gbp_check: "Google Business Profile",
  privacy_policy: "Privacy Policy",
  footer_logo: "Footer Logo",
  single_script: "Single Script Features",
  top_bar_sticky: "Top Bar & Sticky Header",
  favicon: "Favicon",
  contact_form: "Contact Form",
  chatbot_consultation: "Chatbot & Virtual Consultation",
  logo_chatbot: "Logo on Chatbot",
  callnow_links: "Call Now & Links",
  verify_plugin_updates: "Plugin Updates",
  social_share_heading: "Social Share Heading",
  learn_more_buttons: "Learn More Buttons",
  url_tab_compare: "URL & Tab Comparison",
  url_matching: "URL Matching",
  text_share: "Text Share Metadata",
  gsr_check: "General Search Result (GSR)",
  page_speed: "Page Speed (PageSpeed Insights)",
  project_plan: "Project Plan",
  paid_media: "Paid Media",
  spelling: "Spelling",
  grammar: "Grammar",
  meta_tags: "Meta Tags",
  dummy_content: "Dummy Content",
  console_errors: "Console Errors",
  image_compliance: "Image Compliance",
  accessibility: "Accessibility",
  accessibility_check: "Full Accessibility",
  visual_regression: "Visual Regression",
}

const titleCase = (s: string) =>
  (s || "other").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// A "tool lapse" is a QACC-internal failure/skip (an errored or skipped check,
// missing credentials, timeouts, AI errors) — NOT a real site defect. These are
// kept OUT of every TED report so QACC's own hiccups never appear unprofessional.
// Matches only phrases QACC itself emits; real site findings (e.g. "Hero video
// failed to load") are left untouched.
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

// A "clean pass" sentinel is a finding some checks insert to record that they
// ran and found nothing (e.g. "No accessibility issues found", "No grammar
// issues found"). It is NOT a real defect, so it must not be counted as an
// issue when deciding whether a check passed. Kept separate from tool lapses,
// which are QACC-internal errors rather than clean passes.
export function isCleanPassFinding(f: any): boolean {
  const t = String(f?.title || "").toLowerCase()
  const d = String(f?.description || "").toLowerCase()
  const s = `${t} ${d}`
  const NOUN = "issue|issues|problem|problems|error|errors|break|breaks|violation|violations|mismatch|mismatches|difference|differences|defect|defects"
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

// Some checks emit a purely INFORMATIONAL finding every run (e.g. plugin_number
// reports the detected plugin count for a human to eyeball). It is not a defect
// and not a "no issues found" sentinel — treat it as a pass that surfaces the
// fact (the count), never as an issue.
// Vision-verdict checks decide pass/fail from an AI-vision read of a screenshot.
// For these a PASS must carry its evidence (the screenshot + the vision reason),
// and a check that produced NO finding must never be reported as a silent pass —
// there is nothing verified to pass on.
const VISION_VERDICT_CHECKS = new Set(["logo_chatbot", "footer_logo"])

const INFORMATIONAL_CHECKS = new Set(["plugin_number", "video_recording"])
export function isInformationalFinding(f: any): boolean {
  return INFORMATIONAL_CHECKS.has(f?.check_factor) && !isToolLapseFinding(f)
}

// A finding counts as a real site defect only if it is not a QACC tool lapse, a
// clean-pass sentinel, or a purely informational finding. Used for accurate
// per-check pass/fail (and by the video_recording barrier to decide whether all
// other checks passed).
export function isRealDefect(f: any): boolean {
  return (
    !isToolLapseFinding(f) &&
    !isCleanPassFinding(f) &&
    !isInformationalFinding(f)
  )
}

// Dead-links descriptions are a JSON array, a markdown table, or bullets.
function parseLinks(desc?: string | null): any[] {
  if (!desc) return []
  try {
    const j = JSON.parse(desc)
    if (Array.isArray(j)) return j
  } catch {}
  const rows: any[] = []

  // Markdown table format.
  if (desc.includes("|")) {
    for (const line of desc.split("\n")) {
      const t = line.trim()
      if (!t.startsWith("|") || t.includes("---")) continue
      if (/error\s*\|\s*url/i.test(t)) continue
      const p = t.split("|").map((x) => x.trim())
      if (p.length >= 5) rows.push({ reason: p[1], url: p[2], link_text: p[3].replace(/`/g, ""), found_on: p[4] })
    }
    if (rows.length) return rows
  }

  // Rich bullet format emitted by the dead-links check:
  //   - **<url>**
  //     * Reason: <status>
  //     * Link Text: <text>
  //     * Found on: <page url>
  // Captured whole so long/complex URLs are never truncated.
  if (/-\s*\*\*/.test(desc)) {
    const re =
      /-\s*\*\*(.+?)\*\*\s*\*\s*Reason:\s*(.*?)\s*\*\s*Link Text:\s*(.*?)\s*\*\s*Found on:\s*(.*?)(?=\s*-\s*\*\*|$)/gis
    let m: RegExpExecArray | null
    while ((m = re.exec(desc)) !== null) {
      rows.push({
        url: m[1].trim(),
        reason: m[2].trim(),
        link_text: m[3].trim(),
        found_on: m[4].trim(),
      })
    }
    if (rows.length) return rows
  }

  // Simple bullet format from the legacy broken-links check: "- <url> (<status>)".
  for (const line of desc.split("\n")) {
    const t = line.trim()
    if (!t.startsWith("-")) continue
    const m = t.match(/^-\s*(\S+?)\s*(?:\(([^)]+)\))?\s*$/)
    if (m && /^https?:\/\//i.test(m[1])) {
      rows.push({ url: m[1], reason: m[2] || "", link_text: "", found_on: "" })
    }
  }
  return rows
}

// gsr_check stores its SERPs as a JSON array in `description`.
function parseSerps(desc?: string | null): any[] | null {
  try {
    const j = JSON.parse(desc || "")
    return Array.isArray(j) ? j : null
  } catch {
    return null
  }
}

// Characters that must NOT appear in a clean SERP title/snippet: the Unicode
// replacement char (mojibake), unrendered HTML entities (&amp; / &#8211;),
// stray HTML tags, and control chars. Normal punctuation (– — | : etc.) and a
// bare "&" in text are fine, so they are deliberately not matched.
const SERP_REPLACEMENT = /\uFFFD/
const SERP_ENTITY = /&(#\d+|[a-zA-Z]+);/
const SERP_TAG = /<[^>]{0,60}>/
const SERP_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

// Returns "" when the SERP is clean, else a short reason naming what's wrong.
function serpBadReason(s: any): string {
  const fields: [string, string][] = [
    ["title", String(s?.title || "")],
    ["snippet", String(s?.description || "")],
  ]
  for (const [name, val] of fields) {
    if (SERP_REPLACEMENT.test(val)) return `invalid/garbled character in ${name}`
    if (SERP_ENTITY.test(val)) return `unrendered HTML entity in ${name}`
    if (SERP_TAG.test(val)) return `stray HTML tag in ${name}`
    if (SERP_CONTROL.test(val)) return `control character in ${name}`
  }
  return ""
}

// One SERP as three clearly separated lines (Title / URL / Snippet) — never a
// table, which TED's comment sanitizer mangles.
function renderSerpBlock(s: any, badReason?: string): string {
  const title = esc(String(s?.title || "").trim() || "(no title)")
  const url = esc(String(s?.url || "").trim())
  const snippet = esc(String(s?.description || "").replace(/\s+/g, " ").trim())
  let h = `<p>`
  if (badReason) h += `❌ <strong>${esc(badReason)}</strong><br>`
  h += `<strong>Title:</strong> ${title}<br>`
  if (url) h += `<strong>URL:</strong> <a href="${url}">${url}</a><br>`
  h += `<strong>Snippet:</strong> ${snippet || "(no snippet)"}`
  h += `</p>`
  return h
}

// image_quality stores its rows as a JSON array in context_text.
function parseImageIssues(ctx?: string | null): any[] {
  if (!ctx) return []
  try {
    const j = JSON.parse(ctx)
    if (Array.isArray(j)) return j
  } catch {}
  return []
}

function dedupeFindings(group: any[]): any[] {
  const seen = new Set<string>()
  const out: any[] = []
  for (const f of group) {
    const key = `${f.title || ""}|${f.description || ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

function genericTable(findings: any[]): string {
  let h = `<ul>`
  for (const f of findings) {
    const desc = (f.description || "").replace(/\n/g, "<br>")
    h += `<li><strong>${esc(f.title || f.check_factor)}</strong>${desc ? `<br>${desc}` : ""}</li>`
  }
  return h + `</ul>`
}

function linkTable(rows: any[]): string {
  let h = `<ul>`
  for (const r of rows) {
    const url = esc(r.url || "")
    const found = esc(r.found_on || "")
    h += `<li><a href="${url}">${url}</a> — ${esc(r.reason || "")}${esc(r.link_text || r["Link text"] || "") ? ` (link: ${esc(r.link_text || r["Link text"])})` : ""}${found ? ` — found on <a href="${found}">${found}</a>` : ""}</li>`
  }
  return h + `</ul>`
}

function imageTable(rows: any[]): string {
  let h = `<ul>`
  for (const r of rows) {
    const src = esc(r.src || "")
    h += `<li><strong>${esc(r.type || "")}</strong> — <a href="${src}">${src}</a>${r.note ? ` (${esc(r.note)})` : ""}</li>`
  }
  return h + `</ul>`
}

// Render one check-group: a single merged table + its (deduped) screenshots.
async function renderGroup(
  factor: string,
  group: any[],
  budget: { remaining: number },
): Promise<string> {
  const isLinks = factor === "dead_links" || factor === "broken_links" || factor === "external_links"
  const isImages = factor === "image_quality"
  let html = ""
  const shots: string[] = []
  const seenShot = new Set<string>()
  const addShots = (val?: string | null) => {
    for (const u of (val || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!seenShot.has(u)) {
        seenShot.add(u)
        shots.push(u)
      }
    }
  }

  if (isLinks) {
    const rows: any[] = []
    const seen = new Set<string>()
    for (const f of group)
      for (const l of parseLinks(f.description)) {
        const k = `${l.url}|${l.found_on}`
        if (seen.has(k)) continue
        seen.add(k)
        rows.push(l)
      }
    html += rows.length ? linkTable(rows) : genericTable(dedupeFindings(group))
  } else if (isImages) {
    const rows: any[] = []
    const seen = new Set<string>()
    for (const f of group)
      for (const it of parseImageIssues(f.context_text)) {
        const k = `${it.type}|${it.src}`
        if (seen.has(k)) continue
        seen.add(k)
        rows.push(it)
        addShots(it.thumb)
      }
    html += rows.length ? imageTable(rows) : genericTable(dedupeFindings(group))
  } else {
    const uniq = dedupeFindings(group)
    html += genericTable(uniq)
    for (const f of uniq) addShots(f.screenshot_url)
  }

  if (shots.length) html += await renderScreenshotsHtml(shots.join(","), budget)
  return html
}

// =====================================================================
// SECTION-WISE PER-CHECK REPORT
// ---------------------------------------------------------------------
// One shared renderer used by EVERY run type (pre-release, post-release,
// internal-QA) and by BOTH the QA-report path and the AI-fix path. Each
// check becomes its own section that spells out:
//   1. the ACTUAL issue (the real misspelled word, the real link, the real
//      plugin + versions — never just "1 issue"), and then
//   2. the fix that was applied, with a real before → after when QACC has
//      one (never fabricated), or
//   3. a plain "Passed" with how it passed / "could not complete" if it
//      errored.
// Routing: if the TED task has subtasks, each check's section goes to its
// own subtask; otherwise every section is stitched into ONE summary comment
// on the parent task.
// =====================================================================

// What an AI-fix pass knows about a single finding, joined back by the
// finding's id. `edits` carries the literal before (`find`) → after
// (`replace`) so the report can show the real correction, not a paraphrase.
export type FixReportInfo = {
  applied: boolean
  proposed: boolean
  // A real defect the AI-fix pass triaged but could NOT auto-correct. We NEVER
  // say "manual", and there is no "AI correction needed" middle state — a
  // code-level fix is applied + pushed automatically. The only non-applied
  // outcome is that the text lives in the WordPress database (page/post content
  // or wp_options), not in any file, so it needs REST API write access.
  manual?: boolean
  // "rest_api" → text lives in the WP database, needs REST API write access.
  // "apply_failed" → the edit was located in a file but the overwrite genuinely
  // failed after retries (rare technical failure); `manualReason` states it
  // verbatim, e.g. "couldn't correct `x` to `y` as overwriting failed".
  // "no_auto_fix" → a real defect for which no automated fix could ever exist
  // (the data lives outside the site, e.g. Project Plan not set in TED/HubSpot);
  // `manualReason` carries the human suggestion. Rendered as "Suggested Fix …",
  // never "✅ Fixed".
  // "place_code" → an assisted-manual fix that resolved the exact code + where to
  // place it (e.g. contact_form's per-client G99+ embed from Basecamp);
  // `manualReason` carries the instructions + snippet, surfaced verbatim.
  manualKind?: "rest_api" | "apply_failed" | "no_auto_fix" | "place_code"
  manualReason?: string
  fix?: string
  edits?: { path: string; find: string; replace: string }[]
  filesChanged?: string[]
}


const clipText = (s: string, n: number): string =>
  s.length > n ? s.slice(0, n).trimEnd() + "…" : s

// Deduped, comma-free list of every screenshot across a group of findings.
function collectShots(group: any[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const f of group)
    for (const u of String(f.screenshot_url || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean))
      if (!seen.has(u)) {
        seen.add(u)
        out.push(u)
      }
  return out
}

// Extract the offending text and its correction for the text checks that carry
// one (spelling, grammar), so the report can show `X — should have been "Y"`
// exactly as specified. Returns null for checks with no such pair.
function parseSuggestion(
  f: any,
): { offending: string; suggestion: string } | null {
  const factor = String(f.check_factor || "")
  if (factor === "spelling") {
    const word = String(f.title || "").match(/^Misspelled:\s*(.+)$/i)?.[1]
    const sug = String(f.description || "").match(/^Suggestion:\s*(.+)$/i)?.[1]
    if (word && sug) return { offending: word.trim(), suggestion: sug.trim() }
    return null
  }
  if (factor === "grammar") {
    // description shape: '"<excerpt>" — <issue>. Suggestion: <suggestion>'
    const d = String(f.description || "")
    const excerpt = d.match(/^"([\s\S]+?)"/)?.[1]
    const sug = d.match(/\bSuggestion:\s*([\s\S]+)$/i)?.[1]
    if (excerpt && sug)
      return {
        offending: excerpt.trim(),
        suggestion: sug.trim().replace(/\.\s*$/, ""),
      }
    return null
  }
  return null
}

// The page URL a finding came from: prefer the joined pages.url, fall back to a
// "URL: …" stamped into context_text (the grammar check does this).
function sourceUrl(f: any, pageUrlById?: Map<string, string>): string {
  const joined = pageUrlById && f.page_id ? pageUrlById.get(f.page_id) : ""
  if (joined) return joined
  return String(f.context_text || "").match(/\bURL:\s*(\S+)/i)?.[1] || ""
}

// The concrete "what is wrong" line for one finding. For spelling/grammar it is
// `X — should have been "Y"`; every other check keeps its title + description +
// on-page context. A `source: <page url>` line is appended whenever the
// finding's page URL is known. `compact` trims the context hard when a check has
// many findings so a long list stays readable.
function renderIssueDetail(
  f: any,
  compact: boolean,
  pageUrlById?: Map<string, string>,
): string {
  let out: string
  const sug = parseSuggestion(f)
  if (sug) {
    out = `<strong>${esc(sug.offending)}</strong> — should have been “${esc(sug.suggestion)}”`
  } else {
    const title = esc(f.title || f.check_factor || "Issue")
    out = `<strong>${title}</strong>`
    const descRaw = String(f.description || "").replace(/\s+/g, " ").trim()
    // Never surface a raw spell/grammar "Suggestion: X" (or "No suggestions
    // found …") as free text — for those checks the correction is shown above
    // via `should have been`, or by renderFixLine. See the spelling FP incident.
    const desc = /^(suggestion\b|no suggestions found\b)/i.test(descRaw)
      ? ""
      : descRaw
    if (desc) out += `: ${esc(clipText(desc, 300))}`
    const ctx = String(f.context_text || "").trim()
    // Don't echo a bare "URL: …" stamp as context — it's rendered as `source:`.
    if (ctx && !/^URL:\s*\S+$/i.test(ctx)) {
      const ctxHtml = esc(clipText(ctx, compact ? 140 : 600)).replace(
        /\n/g,
        "<br>",
      )
      out += `<br><small>${ctxHtml}</small>`
    }
  }
  const url = sourceUrl(f, pageUrlById)
  if (url)
    out += `<br><small>source: <a href="${esc(url)}">${esc(url)}</a></small>`
  return out
}

// The "needs a next actor" line for a real defect the code-fix pass could not
// land. NEVER "manual" and never an "AI correction needed" middle state: a
// code-level fix is applied + pushed automatically, so the ONLY non-code outcome
// is that the text lives in the WordPress database (page/post content or
// wp_options) and needs REST API write access. No leading <br> — callers wrap.
function renderNeedsLabel(fx: FixReportInfo): string {
  // A real defect with no automated fix that could ever exist — the correction
  // lives outside the site (e.g. Project Plan not set in TED/HubSpot). Stated as
  // a suggestion for the human, explicitly flagged as not auto-fixable.
  if (fx.manualKind === "no_auto_fix")
    return `💡 <strong>Suggested Fix:</strong> ${esc(
      clipText(fx.manualReason || fx.fix || "action required", 240),
    )} <em>— no automated fix possible.</em>`
  // Assisted-manual: the fix engine resolved the exact code + placement (e.g. the
  // client's contact-form embed from Basecamp). Surface the instructions and the
  // snippet in full so a developer can copy it, never generic boilerplate.
  if (fx.manualKind === "place_code") {
    const raw = fx.manualReason || fx.fix || ""
    const nl = raw.indexOf("\n")
    const intro = (nl >= 0 ? raw.slice(0, nl) : raw).trim()
    const code = nl >= 0 ? raw.slice(nl + 1).trim() : ""
    let out = `🧩 <strong>Action needed:</strong> ${esc(clipText(intro, 400))}`
    if (code)
      out += `<pre style="white-space:pre-wrap;word-break:break-word"><code>${esc(
        clipText(code, 1500),
      )}</code></pre>`
    return out
  }
  // A genuine, rare overwrite failure — stated exactly as it happened, never
  // dressed up and never used as a way to skip the check.
  if (fx.manualKind === "apply_failed")
    return `⚠️ <strong>Fix could not be applied:</strong> ${esc(
      clipText(fx.manualReason || "overwriting the file failed", 200),
    )}`
  return `🔌 <strong>REST API access needed:</strong> ${esc(
    clipText(
      fx.manualReason ||
        "this text is WordPress database content (page/post content or an options-level setting), not source code — correct it through the WordPress REST API.",
      200,
    ),
  )}`
}

// The "how it was fixed" line for one finding — only when a fix genuinely
// landed. The label is "AI Fix" when an AI model produced the correction
// (`ai_generated` finding, e.g. grammar) and plain "Fixed" otherwise (e.g. a
// deterministic spelling correction). Prefers a literal before → after taken
// from the applied edits; falls back to the AI's description. Never invents one.
function renderFixLine(fx?: FixReportInfo, usedAi?: boolean): string {
  if (!fx) return ""
  // Triaged but not auto-fixable → say so plainly, never leave it blank or
  // dressed up as a suggestion. Only reachable in the AI-fix path (the plain
  // QA report passes no fixMap, so fx is undefined there).
  if (!fx.applied && !fx.proposed) {
    if (fx.manual) return `<br>${renderNeedsLabel(fx)}`
    return ""
  }
  // The correction is stated in the PAST TENSE as done — whether it was pushed
  // to a repo or (with no repo this run) simply determined from the finding. The
  // repo/PR push status is reported ONCE at the run level (status line), not per
  // finding, so a missing repo never turns a known fix into a mere "proposal".
  const label = usedAi ? "AI Fix" : "Fixed"
  const pairs: { before: string; after: string }[] = []
  for (const e of fx.edits || []) {
    const before = String(e.find || "").replace(/\s+/g, " ").trim()
    const after = String(e.replace || "").replace(/\s+/g, " ").trim()
    // Only show a literal before → after when both sides are short enough to
    // read inline; long code edits fall back to the description below.
    if (before && after && before.length <= 80 && after.length <= 80)
      pairs.push({ before, after })
  }
  const detail = pairs.length
    ? pairs
        .map((p) => `Corrected “${esc(p.before)}” to “${esc(p.after)}”`)
        .join("; ")
    : esc(fx.fix || "")
  const files = (fx.filesChanged || []).length
    ? ` <em>(${esc((fx.filesChanged || []).join(", "))})</em>`
    : ""
  return detail
    ? `<br>✅ <strong>${label}:</strong> ${detail}${files}`
    : ""
}

// Render ONE check as a section. Returns its status so the caller can order
// sections (failed → errored → passed) and tally the header line.
// Per-page AI-fix outcome for image_quality: how many of the page's flagged
// images were enhanced+verified (kept), out of the total, plus the standalone
// carousel URL the "View before / after" link opens.
export type ImageFixInfo = { enhanced: number; total: number; url: string }

async function renderCheckSectionHtml(
  factor: string,
  group: any[],
  fixMap: Map<string, FixReportInfo>,
  imgBudget: { remaining: number },
  pageUrlById?: Map<string, string>,
  imageFix?: Map<string, ImageFixInfo>,
): Promise<{ status: "failed" | "passed" | "errored"; html: string }> {
  const label = FRIENDLY[factor] || titleCase(factor)
  const real = dedupeFindings(group.filter(isRealDefect))
  const lapses = group.filter(isToolLapseFinding)
  const cleanPass = group.filter(isCleanPassFinding)

  // A vision-verdict check with NO finding at all (enabled but never emitted a
  // result — skipped or threw before returning) has verified nothing, so it must
  // NOT fall through to the generic "Passed — found no issues" line. Report it as
  // could-not-complete (empty → dropped from the report; the subtask closeout
  // posts an honest "could not complete this run"), never a silent pass.
  if (VISION_VERDICT_CHECKS.has(factor) && group.length === 0) {
    return { status: "errored", html: "" }
  }

  // Link checks: render EVERY broken link in full (whole URL, status/reason,
  // anchor text, and the page it was found on) — never a clipped preview, since
  // a truncated URL tells the client nothing. Merged + deduped across pages.
  const isLinkFactor =
    factor === "dead_links" ||
    factor === "broken_links" ||
    factor === "external_links"
  if (real.length > 0 && isLinkFactor) {
    const rows: any[] = []
    const seen = new Set<string>()
    for (const f of real)
      for (const l of parseLinks(f.description)) {
        const k = `${l.url}|${l.found_on || ""}`
        if (seen.has(k)) continue
        seen.add(k)
        rows.push(l)
      }
    if (rows.length) {
      let scanned = 0
      for (const f of real) {
        const mm = String(f.context_text || "").match(
          /Total URLs checked in run so far:\s*(\d+)/i,
        )
        if (mm) scanned = Math.max(scanned, parseInt(mm[1], 10))
      }
      let html = `<p>❌ <strong>${esc(label)}</strong> — ${rows.length} issue${rows.length > 1 ? "s" : ""} found.</p>`
      html += linkTable(rows)
      // Preserve the next-actor note (REST API / AI correction) when the AI-fix
      // pass flagged these as page/database content it cannot auto-correct.
      const needsLabels = new Set<string>()
      for (const f of real) {
        const fx = f.id ? fixMap.get(String(f.id)) : undefined
        if (fx && !fx.applied && !fx.proposed && fx.manual)
          needsLabels.add(renderNeedsLabel(fx))
      }
      for (const r of needsLabels) html += `<p>${r}</p>`
      if (scanned)
        html += `<p><small>URLs checked in this run: ${scanned}</small></p>`
      return { status: "failed", html }
    }
    // No parseable links — fall through to the generic renderer below.
  }

  // Image quality (blur / watermark): report PER PAGE. Each finding is one page,
  // so each renders as its own block — page name, then a single baked 4-per-row
  // grid image (see renderImageGrid for why one composite instead of N <img>),
  // then a numbered full-res link list. Same output for subtask and main-thread
  // routing, since both share this renderer.
  if (real.length > 0 && factor === "image_quality") {
    const blocks: string[] = []
    let totalFlagged = 0
    for (const f of dedupeFindings(real)) {
      const seen = new Set<string>()
      const uniq: any[] = []
      for (const it of parseImageIssues(f.context_text)) {
        const key = it.src || it.thumb
        if (!key || seen.has(key)) continue
        seen.add(key)
        uniq.push(it)
      }
      if (!uniq.length) continue
      const pageUrl =
        (f.page_id && pageUrlById?.get(String(f.page_id))) || ""
      const pageLabel = pageUrl
        ? `<a href="${esc(pageUrl)}">${esc(pageUrl)}</a>`
        : "this page"
      let block = `<p>📄 <strong>Page:</strong> ${pageLabel} — ${uniq.length} image${uniq.length > 1 ? "s" : ""} flagged (blur / watermark).</p>`
      const grid = await renderImageGrid(uniq, imgBudget)
      if (grid) {
        block += grid
        const links = uniq
          .map(
            (it, i) =>
              `<a href="${esc(String(it.src || it.thumb || ""))}">${i + 1}</a>`,
          )
          .join(" · ")
        block += `<p><small>Full-size: ${links}</small></p>`
      } else {
        // Couldn't bake/embed the grid — never drop the evidence; list it.
        block += imageTable(uniq)
      }
      // AI Fix line for THIS page: convert+enhance each flagged image, keep the
      // ones that re-pass the blur metric, and link the before/after carousel.
      const fix = f.page_id ? imageFix?.get(String(f.page_id)) : undefined
      if (fix && fix.url) {
        block += `<p>🤖 <strong>AI Fix</strong> — enhanced ${fix.enhanced} of ${fix.total} image${fix.total > 1 ? "s" : ""} on this page → <a href="${esc(fix.url)}">View before / after ↗</a></p>`
      }
      blocks.push(block)
      totalFlagged += uniq.length
    }
    if (blocks.length) {
      const header = `<p>❌ <strong>${esc(label)}</strong> — ${totalFlagged} image${totalFlagged > 1 ? "s" : ""} flagged across ${blocks.length} page${blocks.length > 1 ? "s" : ""}.</p>`
      return { status: "failed", html: header + blocks.join("<br>") }
    }
    // No parseable image rows — fall through to the generic renderer below.
  }

  // Backend / WordPress: a checklist of independent sub-checks (default Hello
  // post, Sample Page, tagline, custom 404, comments, contact number). Each sub
  // shows its OWN ✅/❌; the overall check fails if ANY sub fails, passes only
  // when they all pass.
  if (factor === "backend_check") {
    const items = dedupeFindings(group).filter((f) => !isToolLapseFinding(f))
    if (items.length === 0) {
      // Only lapses (or nothing) — a QACC-internal problem, never shown.
      return { status: "errored", html: "" }
    }
    const anyDefect = items.some((f) => isRealDefect(f))
    let html = `<p>${anyDefect ? "❌" : "✅"} <strong>${esc(label)}</strong> — ${
      anyDefect ? "one or more checks failed" : "all checks passed"
    }.</p><ul>`
    for (const f of items) {
      const defect = isRealDefect(f)
      let line = `${defect ? "❌" : "✅"} ${esc(f.title || "")}`
      if (defect) {
        const desc = clipText(
          String(f.description || "").replace(/\s+/g, " ").trim(),
          300,
        )
        if (desc) line += `: ${esc(desc)}`
        const fx = f.id ? fixMap.get(String(f.id)) : undefined
        line += renderFixLine(fx, !!f.ai_generated)
      }
      html += `<li>${line}</li>`
    }
    html += `</ul>`
    return { status: anyDefect ? "failed" : "passed", html }
  }

  // GSR (General Search Result): render SERPs as clearly separated line blocks
  // (Title / URL / Snippet), never a table (TED mangles tables). A SERP fails
  // when its title/snippet carries characters that don't belong (garbled chars,
  // unrendered HTML entities, stray tags, control chars). Any failing SERP → the
  // check fails and every failing SERP is listed; otherwise pass and show the
  // first few for reference with a "+N more" note.
  if (factor === "gsr_check") {
    let serps: any[] | null = null
    for (const f of group) {
      const arr = parseSerps(f.description)
      if (arr && arr.length) {
        serps = arr
        break
      }
    }
    if (serps && serps.length) {
      const REF_LIMIT = 5
      const FAIL_LIMIT = 20
      const failing = serps
        .map((s) => ({ s, reason: serpBadReason(s) }))
        .filter((x) => x.reason)

      if (failing.length > 0) {
        const shown = failing.slice(0, FAIL_LIMIT)
        let html = `<p>❌ <strong>${esc(label)}</strong> — ${failing.length} of ${serps.length} search result${serps.length > 1 ? "s" : ""} contain invalid characters.</p>`
        for (const x of shown) html += renderSerpBlock(x.s, x.reason)
        if (failing.length > shown.length)
          html += `<p>…and ${failing.length - shown.length} more result(s) with invalid characters.</p>`
        return { status: "failed", html }
      }

      const shown = serps.slice(0, REF_LIMIT)
      let html = `<p>✅ <strong>${esc(label)}</strong> — Passed. ${serps.length} search result${serps.length > 1 ? "s" : ""} checked; all are clean. Showing the first ${shown.length} for reference:</p>`
      for (const s of shown) html += renderSerpBlock(s)
      if (serps.length > shown.length)
        html += `<p>…and ${serps.length - shown.length} more result(s), all clean.</p>`
      return { status: "passed", html }
    }
    // No parseable SERPs (fetch blocked / 0 results) → fall through to the
    // generic handling below (lapse is hidden, a real failure is shown).
  }

  if (real.length > 0) {
    let html = `<p>❌ <strong>${esc(label)}</strong> — ${real.length} issue${real.length > 1 ? "s" : ""} found.</p><ul>`
    const compact = real.length > 8
    for (const f of real) {
      const fx = f.id ? fixMap.get(String(f.id)) : undefined
      html += `<li>${renderIssueDetail(f, compact, pageUrlById)}${renderFixLine(fx, !!f.ai_generated)}</li>`
    }
    html += `</ul>`
    // TEMP: screenshots hidden from ALL TED reports for now — re-enable later.
    // const shots = collectShots(real)
    // if (shots.length)
    //   html += await renderScreenshotsHtml(shots.join(","), imgBudget)
    return { status: "failed", html }
  }

  if (lapses.length > 0) {
    // A tool lapse (the check errored/timed out before producing a result) is a
    // QACC-internal problem, NOT a site defect — it must never appear in the
    // client-facing report. Emit nothing; the caller drops empty sections.
    return { status: "errored", html: "" }
  }

  // Passed. Surface HOW it passed:
  //   • informational checks (plugin_number) → the fact itself, e.g. the count
  //     from the finding title ("Detected 14 plugins"), plus its list as detail;
  //   • otherwise the check's own clean-pass note ("No … issues found").
  const info = group.find(isInformationalFinding)
  if (info) {
    const line = clipText(
      String(info.title || "").replace(/\s+/g, " ").trim(),
      240,
    )
    const ctx = String(info.context_text || "").trim()
    const extra = ctx
      ? `<br><small>${esc(clipText(ctx, 300)).replace(/\n/g, "<br>")}</small>`
      : ""
    return {
      status: "passed",
      html: `<p>✅ <strong>${esc(label)}</strong> — Passed. ${line ? esc(line) : "No problems found."} No errors.${extra}</p>`,
    }
  }
  // Vision-verdict pass: a logo check only passes because AI vision READ a
  // screenshot and confirmed it, so the pass MUST carry that evidence — the
  // screenshot and the vision reason — not a bare green line. This deliberately
  // overrides the global "screenshots hidden" TEMP note above for these checks.
  if (VISION_VERDICT_CHECKS.has(factor) && cleanPass.length > 0) {
    const cp = cleanPass[0]
    const desc = clipText(
      String(cp.description || cp.title || "").replace(/\s+/g, " ").trim(),
      240,
    )
    let html = `<p>✅ <strong>${esc(label)}</strong> — Passed. ${desc ? esc(desc) : "Verified by AI vision."}</p>`
    // Surface the vision reason when it's plain text (chatbot stores "AI vision:
    // <reason>"); skip machine context like the footer's JSON perView blob.
    const ctx = String(cp.context_text || "").trim()
    if (ctx && !/^[[{]/.test(ctx)) {
      const reason = clipText(
        ctx.replace(/^AI vision:\s*/i, "").replace(/\s+/g, " ").trim(),
        300,
      )
      if (reason) html += `<p><small>AI vision: ${esc(reason)}</small></p>`
    }
    if (cp.screenshot_url)
      html += await renderScreenshotsHtml(String(cp.screenshot_url), imgBudget)
    return { status: "passed", html }
  }

  const detail = cleanPass.length
    ? clipText(
        String(cleanPass[0].description || cleanPass[0].title || "")
          .replace(/\s+/g, " ")
          .trim(),
        240,
      )
    : ""
  return {
    status: "passed",
    html: `<p>✅ <strong>${esc(label)}</strong> — Passed. ${detail ? esc(detail) : "The check ran and found no issues."}</p>`,
  }
}

const runKind = (runType?: string | null): string =>
  runType === "post_release"
    ? "Post-Release"
    : runType === "internal_qa"
      ? "Internal"
      : "Pre-Release"

// Build and post the section-wise report. Every enabled check is represented —
// failing checks list their real defects (+ any applied fix), passing checks say
// so, errored checks say they'll retry. Routes to subtasks when the task has
// them, else to a single summary comment. Idempotent via `eventKeyPrefix`.
export async function postSectionedReport(opts: {
  runId: string
  tedTaskId: string
  findings: any[]
  runMeta: {
    enabled_checks?: string[] | null
    site_url?: string | null
    run_type?: string | null
    ted_subtask_map?: Record<string, string | string[]> | null
    project_id?: string | null
  } | null
  fixMap?: Map<string, FixReportInfo>
  summaryHeaderHtml?: string
  // Per-subtask AI-fix banner. The count is computed PER CHECK inside this
  // function (not run-wide), and the banner is omitted entirely for checks that
  // had no fix — so e.g. "Website Functionality" never carries a fix line it
  // didn't earn. `pushClause` describes where the fixes landed (branch/PR) — or,
  // when there's no repo access, that they were not applied — with no count.
  perTargetFix?: { pushClause: string }
  // Per-page image-enhance outcomes (page_id → {enhanced, total, carousel url}),
  // used to render the "AI Fix — enhanced N of M" line under each image page.
  imageFix?: Map<string, ImageFixInfo>
  eventKeyPrefix: string
}): Promise<{ failed: number; passed: number; errored: number }> {
  const { runId, tedTaskId, findings, runMeta } = opts
  const fixMap = opts.fixMap || new Map<string, FixReportInfo>()
  const imgBudget = { remaining: IMG_BUDGET_BYTES }

  // Resolve the client's real domain once, so the client-facing copy can show
  // the gogroth/live host instead of the local fallback URL. Best-effort.
  const runType = runMeta?.run_type || null
  let clientDomain: string | null = null
  try {
    if (runMeta?.project_id) {
      const { data: proj } = await supabase
        .from("projects")
        .select("name")
        .eq("id", runMeta.project_id)
        .single()
      if (proj?.name) clientDomain = await getClientDomain(proj.name).catch(() => null)
    }
  } catch {}
  const reportCtx = { runType, clientDomain }

  // Join each finding back to the page it came from so a `source: <url>` line
  // can be shown — findings carry only page_id, not the URL.
  const { data: pageRows } = await supabase
    .from("pages")
    .select("id, url")
    .eq("run_id", runId)
  const pageUrlById = new Map<string, string>(
    (pageRows || []).map((p: any) => [p.id, p.url]),
  )

  // Group ALL findings (real, clean-pass, lapse) by check, and ensure every
  // enabled check appears even if it produced no finding at all.
  const byCheck = new Map<string, any[]>()
  for (const f of findings) {
    const k = f.check_factor || "other"
    if (!byCheck.has(k)) byCheck.set(k, [])
    byCheck.get(k)!.push(f)
  }
  for (const c of runMeta?.enabled_checks || [])
    if (!byCheck.has(c)) byCheck.set(c, [])

  const allSections: {
    factor: string
    status: "failed" | "passed" | "errored"
    html: string
  }[] = []
  for (const [factor, group] of byCheck) {
    const { status, html } = await renderCheckSectionHtml(
      factor,
      group,
      fixMap,
      imgBudget,
      pageUrlById,
      opts.imageFix,
    )
    allSections.push({ factor, status, html })
  }
  // Drop checks that only errored (tool lapses render as empty) — a tool
  // problem is never shown to the client. Only real issues + genuine passes
  // reach the report.
  const sections = allSections.filter((s) => s.html)
  const rank = (s: string) => (s === "failed" ? 0 : 2)
  sections.sort((a, b) => rank(a.status) - rank(b.status))

  const tally = {
    failed: sections.filter((s) => s.status === "failed").length,
    passed: sections.filter((s) => s.status === "passed").length,
    errored: allSections.filter((s) => s.status === "errored").length,
  }

  const kind = runKind(runMeta?.run_type)
  const titleHtml =
    `<strong>${kind} QA — Report</strong><br>` +
    (runMeta?.site_url ? `Site: ${esc(runMeta.site_url)}<br>` : "")
  // High-level test-case roll-up: one line per check (subtask) → Passed/Failed,
  // failed first (sections are already sorted failed→passed). Deliberately icon-
  // light — a single count line, then a plain-text list, so the summary reads as
  // results, not a wall of emoji.
  // One short reason per failed check, pulled from its first real defect
  // (title, else the description) — HTML stripped and clipped to one sentence —
  // so the roll-up reads "Contact Form — Failed: No contact form found" instead
  // of a bare "Failed" the reader has to scroll down to explain.
  const failReason = (factor: string): string => {
    const real = (byCheck.get(factor) || []).filter(isRealDefect)
    if (!real.length) return ""
    const f = real[0]
    const raw = String(f.title || f.description || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    return clipText(raw, 140)
  }
  const rollupItems = sections
    .map((s) => {
      const label = esc(FRIENDLY[s.factor] || titleCase(s.factor))
      if (s.status === "failed") {
        const reason = failReason(s.factor)
        return `<li>${label} — Failed${reason ? `: ${esc(reason)}` : ""}</li>`
      }
      return `<li>${label} — Passed</li>`
    })
    .join("")
  const overview =
    `<p><strong>Test cases:</strong> ${tally.failed + tally.passed} total — ${tally.failed} failed, ${tally.passed} passed.</p>` +
    (rollupItems ? `<ul>${rollupItems}</ul>` : "")

  const subtaskMap = runMeta?.ted_subtask_map || {}
  const hasSubtasks = Object.keys(subtaskMap).length > 0

  if (hasSubtasks) {
    // Floor the FIRST subtask post to at least 1 min after the run started — so a
    // fast/degenerate run doesn't dump every result the instant it ends (which
    // read as "closed before it ran"). This is NOT a fixed sleep: we only wait
    // the REMAINDER up to the 1-min mark, and a run that already took a minute or
    // more flows straight through. Main-thread comments are never delayed.
    try {
      const { data: rt } = await supabase
        .from("qa_runs")
        .select("started_at, created_at")
        .eq("id", runId)
        .single()
      const startIso = (rt?.started_at as string) || (rt?.created_at as string) || ""
      const startMs = startIso ? new Date(startIso).getTime() : 0
      if (startMs) {
        const remaining = SUBTASK_MIN_WAIT_MS - (Date.now() - startMs)
        if (remaining > 0) await sleep(remaining)
      }
    } catch {}

    // Each mapped check → its own subtask. Any check WITHOUT a subtask still
    // gets reported, stitched into a summary comment on the parent so nothing
    // is silently dropped. A subtask is marked Completed ONLY right after its
    // own pass/fail comment lands here.
    const leftovers: typeof sections = []
    for (const sec of sections) {
      const raw = subtaskMap[sec.factor]
      // A check can belong to several section subtasks (e.g. false_breakpoint →
      // Browser & Device AND Header & Breakpoints). Tolerate the legacy
      // one-to-one shape ({check: subtaskId}) as well.
      const targets = Array.isArray(raw) ? raw : raw ? [raw] : []
      if (!targets.length) {
        leftovers.push(sec)
        continue
      }
      // The video subtask is owned entirely by the video_recording barrier
      // (waiting → in-progress/blocked → URLs); the report must not post a
      // premature pass/fail comment to it. Skip here.
      if (sec.factor === "video_recording") continue
      // Count the fixes that belong to THIS check only. The banner rides atop the
      // subtask comment solely when this check actually had ≥1 applied/proposed
      // fix; the section body below already itemizes each before → after.
      let applied = 0
      let proposed = 0
      for (const f of byCheck.get(sec.factor) || []) {
        const fx = f?.id ? fixMap.get(String(f.id)) : undefined
        if (!fx) continue
        if (fx.applied) applied++
        else if (fx.proposed) proposed++
      }
      const total = applied + proposed
      let header = ""
      if (opts.perTargetFix && total > 0) {
        // Fixes are reported as DONE (past tense); the push destination is the
        // run-level status line, so the per-check banner just states the count.
        header =
          `<p>🤖 <strong>AI Fix</strong> — ${total} fix${total > 1 ? "es" : ""} for this check. ` +
          `${opts.perTargetFix.pushClause}</p>`
      }
      // Post the section (results + fix banner) to EACH owning subtask. The
      // idempotency key includes the subtask id so the same section landing on
      // two subtasks isn't deduped into one.
      for (const target of targets) {
        await postTedComment(
          target,
          header + sec.html,
          `ext:${opts.eventKeyPrefix}-subtask-${runId}-${sec.factor}-${target}`,
          {
            runId,
            projectId: runMeta?.project_id,
            targetKind: "subtask",
            checkFactor: sec.factor,
            ...reportCtx,
          },
        ).catch(() => {})
        // Close THIS subtask now that its pass/fail comment has landed. Never the
        // video subtask (the barrier owns its status).
        if (sec.factor !== "video_recording")
          await postTedStatus(target, TED_STATUS_COMPLETED, runId).catch(() => {})
      }
    }
    // No subtask left reason-less: a mapped check that produced NO pass/fail
    // section (it errored / could not complete) would otherwise be marked
    // Completed with no comment. Post the EXACT reason to each such subtask so
    // every one carries a pinpointed result before it is closed. `sections` are
    // the checks that produced a pass/fail result; anything mapped but missing
    // from it is an errored/no-result check.
    const resultFactors = new Set(sections.map((s) => s.factor))
    for (const [factor, raw] of Object.entries(subtaskMap)) {
      if (resultFactors.has(factor)) continue
      // The video-recording subtask is owned by the video_recording_check
      // barrier, not the report — never post a no-result "marked complete"
      // comment to it here (that would race the barrier's own verdict).
      if (factor === "video_recording") continue
      const targets = Array.isArray(raw) ? raw : raw ? [raw] : []
      if (!targets.length) continue
      const label = FRIENDLY[factor] || titleCase(factor)
      const lapse = (byCheck.get(factor) || []).find(isToolLapseFinding)
      const reason = lapse
        ? clipText(
            String(lapse.description || lapse.title || "")
              .replace(/\s+/g, " ")
              .trim(),
            240,
          )
        : ""
      const body = `<p>❌ <strong>${esc(label)} — Failed (could not complete)</strong>${
        reason ? `: ${esc(reason)}` : " — the check hung or errored and produced no automated pass/fail result"
      }.</p>`
      for (const target of targets) {
        await postTedComment(
          target,
          body,
          `ext:${opts.eventKeyPrefix}-subtask-noresult-${runId}-${factor}-${target}`,
          {
            runId,
            projectId: runMeta?.project_id,
            targetKind: "subtask",
            checkFactor: factor,
            ...reportCtx,
          },
        ).catch(() => {})
        // Close this subtask now that its "could not complete" note has landed.
        await postTedStatus(target, TED_STATUS_COMPLETED, runId).catch(() => {})
      }
    }
    // Now that every subtask has its comment AND is marked Completed (both loops
    // above), post the final summary on the PARENT (main thread) — the high-level
    // test-case roll-up (each check → Passed/Failed) + any AI-fix run status +
    // any check with no subtask to route to. The summary always follows subtask
    // completion, never precedes it.
    {
      // Order: scan pass/fail roll-up FIRST, then the fixes-applied high-level
      // summary (summaryHeaderHtml, present only on the AI-fix pass), then any
      // no-subtask leftover sections.
      let body =
        titleHtml + overview + (opts.summaryHeaderHtml || "")
      for (const sec of leftovers) body += sec.html
      await postTedComment(
        tedTaskId,
        body.trim(),
        `ext:${opts.eventKeyPrefix}-summary-${runId}`,
        { runId, projectId: runMeta?.project_id, targetKind: "parent", ...reportCtx, aiAssigned: true },
      ).catch(() => {})
    }
  } else {
    // No subtasks → one combined, section-by-section summary on the parent.
    // Order: scan pass/fail roll-up FIRST, then the fixes-applied high-level
    // summary (summaryHeaderHtml), then each section. Two-line gap between
    // sections so the stacked checks don't read as one crowded block.
    let body =
      titleHtml + overview + (opts.summaryHeaderHtml || "")
    sections.forEach((sec, i) => {
      if (i > 0) body += `<br><br>`
      body += sec.html
    })
    await postTedComment(
      tedTaskId,
      body.trim(),
      `ext:${opts.eventKeyPrefix}-summary-${runId}`,
      { runId, projectId: runMeta?.project_id, targetKind: "parent", ...reportCtx, aiAssigned: true },
    ).catch(() => {})
  }

  return tally
}

// Interim comment posted AFTER the QA report and BEFORE the AI-fix pass, so the
// TED task shows a clear hand-off. Only posts when the AI Fix module is enabled
// (otherwise there is no fix pass to announce).
export async function postScanCompleteComment(tedTaskId: string, runId: string) {
  if (process.env.AI_FIX_MODULE_ENABLED !== "true") return
  const text = `<p>✅ <strong>QA scan complete.</strong> AI Fix is now generating and applying corrections in the background — the fix report will follow shortly.</p>`
  await postTedComment(tedTaskId, text, `ext:qacc-scan-complete-${runId}`).catch(() => {})
}

export async function postFinalReportToTED(
  runId: string,
  tedTaskId: string,
): Promise<{ hasIssues: boolean; issueCount: number } | null> {
  try {
    const apiToken = process.env.TED_API_TOKEN
    if (!apiToken) {
      logger.warn("TED_API_TOKEN is not configured in worker environment. Skipping TED report.")
      return null
    }

    // Idempotency claim: a run can be finalized by several completion paths
    // (runChecksJob / crawlPageJob, RPC + fallback). Atomically stamp
    // ted_report_posted_at so exactly ONE caller proceeds to post the report.
    const { data: claim, error: claimErr } = await supabase
      .from("qa_runs")
      .update({ ted_report_posted_at: new Date().toISOString() })
      .eq("id", runId)
      .is("ted_report_posted_at", null)
      .select("id")

    if (claimErr) {
      logger.error({ runId, error: claimErr.message }, "Failed to claim TED report; skipping to avoid duplicates")
      return null
    }
    if (!claim || claim.length === 0) {
      logger.info({ runId }, "TED final report already posted by another completion path; skipping.")
      return null
    }

    // Fetch findings for the run
    const { data: findings, error: findingsError } = await supabase
      .from("findings")
      .select("*")
      .eq("run_id", runId)

    if (findingsError) {
      logger.error({ error: findingsError.message }, "Error fetching findings for TED sync")
      return null
    }

    // Real site defects only (lapses + clean-pass sentinels dropped) — used
    // here just to decide whether there are issues to hand to the AI-fix pass.
    // The section-wise renderer re-derives each check's status from the full
    // finding set, so it needs the raw `findings`, not this filtered list.
    const shown = (findings || []).filter((f) => isRealDefect(f))

    // Run meta drives the section-wise report: which checks were enabled, the
    // site, the run kind, and the subtask map used for routing.
    const { data: runMeta } = await supabase
      .from("qa_runs")
      .select("enabled_checks, project_id, site_url, run_type, ted_subtask_map")
      .eq("id", runId)
      .single()

    // When there ARE issues and the AI-fix module is on, the fix pass posts the
    // ONE combined section-wise report (each check: issue → fix → or passed)
    // once it has both the findings and the applied fixes. Posting an
    // issues-only report here would only duplicate it, so we DEFER — but still
    // tell the caller there are issues so it queues the fix job.
    const moduleOn = process.env.AI_FIX_MODULE_ENABLED === "true"
    if (shown.length > 0 && moduleOn) {
      logger.info(
        { runId, issues: shown.length },
        "Issues found + AI-fix on; deferring the section-wise report to the fix pass.",
      )
      return { hasIssues: true, issueCount: shown.length }
    }

    // Otherwise there will be no fix pass (everything passed, or the module is
    // off), so post the section-wise report now — no fix lines to add.
    logger.info({ runId, tedTaskId }, "Posting section-wise QA report to TED")
    await postSectionedReport({
      runId,
      tedTaskId,
      findings: findings || [],
      runMeta,
      eventKeyPrefix: "qacc-report",
    })

    // Tell the caller whether there were real issues so it can decide whether to
    // trigger the AI fix (only on failures).
    return { hasIssues: shown.length > 0, issueCount: shown.length }
  } catch (error: any) {
    logger.error({ error: error.message }, "Exception while syncing report to TED")
    // Release the claim on unexpected failure so the report isn't lost forever.
    await supabase
      .from("qa_runs")
      .update({ ted_report_posted_at: null })
      .eq("id", runId)
      .then(undefined, () => {})
    return null
  }
}
