import { Router, Request, Response } from "express"
import { Webhook } from "svix"
import { supabase } from "../lib/supabase"
import { logger } from "../lib/logger"
import { randomUUID } from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"
import { transitionRunStatus } from "../lib/runControl"

const execFileAsync = promisify(execFile)

export const webhookRouter: Router = Router()

// =====================================================================
// TED PREVIEW SWITCH (API side)
// ---------------------------------------------------------------------
// Mirrors apps/worker/src/lib/tedSync.ts's TED_PREVIEW_ONLY, but that switch
// only covers the worker's AI-fix report. The webhook handlers below post a
// confirmation comment and flip task status to "In Progress" SYNCHRONOUSLY
// the instant a real TED webhook is received — independent of the worker —
// so they need their own copy of the same guard. While true, every write in
// this file is captured in `ted_comments` instead of ever reaching
// ted.growth99.com. The env var wins when set, same as the worker's switch.
// =====================================================================
const TED_PREVIEW_ONLY = process.env.TED_PREVIEW_ONLY
  ? process.env.TED_PREVIEW_ONLY === "true"
  : true

async function recordLocalTedWrite(
  tedTaskId: string | number,
  bodyHtml: string,
  eventKey: string | null,
  source: "report" | "manual" | "status",
  runId?: string | null,
): Promise<boolean> {
  try {
    let projectId: string | null = null
    if (runId) {
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
        qa_run_id: runId || null,
        ted_task_id: String(tedTaskId),
        target_kind: "parent",
        body_html: bodyHtml,
        event_key: eventKey,
        source,
        author: "AI Fix",
      },
      { onConflict: "event_key", ignoreDuplicates: true },
    )
    if (error) {
      console.error(`❌ Failed to record local TED write for #${tedTaskId}:`, error.message)
      return false
    }
    console.log(`👀 TED preview: recorded locally for #${tedTaskId} (real TED NOT called).`)
    return true
  } catch (err) {
    console.error(`❌ Exception recording local TED write for #${tedTaskId}:`, err)
    return false
  }
}

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || ""

// Fallback scan URL, used only when beta_site.env has no betaSiteUrl. This MUST
// be a site backed by the AI-fix repo (AI_FIX_LOCAL_REPO) so the scan runs REAL
// checks against a real site AND the fix pass edits the same codebase — that's
// the whole point of a fallback. QACC_FALLBACK_SITE_URL is set to the local WP
// Playground (http://127.0.0.1:9400), which serves my-blank-theme straight off
// that repo. The default below is that same local port — there is intentionally
// NO external default (a bare public URL with no matching repo can't be fixed,
// so it would never be a valid fallback).
const TED_FALLBACK_SITE_URL =
  process.env.QACC_FALLBACK_SITE_URL || "http://127.0.0.1:9400"

// ===========================================================================
// TED-FIRST SCAN-URL RESOLUTION (LIVE).
//
// PREMISE: a complete QA→fix→push cycle needs BOTH (a) a site URL to scan AND
// (b) a repo that is actually clonable to apply + push fixes. So the scan URL
// is resolved from TED first, and used ONLY when it forms a usable pair with a
// clonable repo; otherwise we fall back to the local pair
// (QACC_FALLBACK_SITE_URL + AI_FIX_LOCAL_REPO) for site AND repo together.
//
//   internal_qa + pre_release → site source: beta_site.env (resolveBetaSiteUrlFromTED)
//                               repo check:  resolveBetaSiteRepoFromTED + isRepoClonable
//   post_release              → site source: release.security released URL
//                               repo check:  resolveBetaSiteRepoFromTED + isRepoClonable
//
// The run's scan URL is therefore `tedSiteUrl || TED_FALLBACK_SITE_URL` (where
// tedSiteUrl is non-null only for a usable pair). The project's stored site_url
// is NOT consulted — what gets scanned is what THIS webhook resolves, so it no
// longer matters which URL happens to be saved under the project's name.
//
// COHERENCE (no migration needed): the worker keys its repo choice off the run's
// site_url — if site_url === QACC_FALLBACK_SITE_URL it uses AI_FIX_LOCAL_REPO,
// otherwise it clones the real betaSiteRepo. So the scan target and the fix
// target always match (both real, or both local). See aiFixRunJob.ts.
// ===========================================================================

// Resolve the beta site URL that QACC should scan, from TED.
//
// The URL lives on the client's `beta_site.env` task, in `automation.payload`
// as a "betaSiteUrl=<url>" token (NOT in the webhook payload, the client notes,
// or automation.siteUrl). We find that task client-agnostically:
//   1. GET /api/clients/{clientId}/timeline  -> lists the client's tasks (with ids)
//   2. pick the beta_site.env task (by automation.templateKey when present,
//      else by the "Create beta site environment" title)
//   3. GET /api/tasks/{id} -> verify automation.templateKey === "beta_site.env"
//      and parse betaSiteUrl out of automation.payload
// clientId comes from the webhook payload, so no task IDs are hardcoded.
// Returns the URL string, or null if it can't be resolved.

// A task's URL/repo may be written into automation.payload OR typed as a comment
// on the same task page. This reads the task's comments into one searchable
// string so the resolvers below can fall back to them. Tolerates the shapes the
// comments endpoint may return; returns "" on any miss.
async function fetchTedTaskCommentsText(
  taskId: string | number | null | undefined,
): Promise<string> {
  const apiToken = process.env.TED_API_TOKEN
  if (!apiToken || taskId == null) return ""
  try {
    const r = await fetch(
      `https://ted.growth99.com/api/tasks/${taskId}/comments`,
      { headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" } },
    )
    const ct = r.headers.get("content-type") || ""
    if (!r.ok || !ct.includes("application/json")) return ""
    const c: any = await r.json().catch(() => null)
    const arr: any[] = Array.isArray(c) ? c : c?.comments || c?.data || c?.items || []
    if (!Array.isArray(arr)) return ""
    return arr
      .map((x: any) =>
        typeof x === "string" ? x : x?.text || x?.body || x?.content || x?.comment || "",
      )
      .filter(Boolean)
      .join("\n")
  } catch {
    return ""
  }
}

async function resolveBetaSiteUrlFromTED(
  clientId?: string | number | null,
): Promise<string | null> {
  const apiToken = process.env.TED_API_TOKEN
  if (!apiToken) {
    console.log("⚠️ TED_API_TOKEN missing — cannot resolve beta site URL.")
    return null
  }
  if (clientId == null) {
    console.log("⚠️ No clientId in payload — cannot resolve beta site URL.")
    return null
  }

  const getJson = async (url: string): Promise<any | null> => {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
    })
    const ct = r.headers.get("content-type") || ""
    if (!r.ok || !ct.includes("application/json")) {
      console.error(
        `❌ TED ${url} did not return JSON (HTTP ${r.status}, content-type "${ct}").`,
      )
      return null
    }
    return r.json().catch(() => null)
  }

  try {
    const tl = await getJson(
      `https://ted.growth99.com/api/clients/${clientId}/timeline`,
    )
    if (!tl) return null

    // Collect candidate task ids for the beta_site.env task.
    const ids = new Set<string>()
    for (const t of tl.activeTasks || []) {
      if (String(t?.automation?.templateKey || "") === "beta_site.env" && t?.id)
        ids.add(String(t.id))
    }
    // Completed tasks appear in `timeline` without templateKey — match by title.
    for (const t of tl.timeline || []) {
      if (/beta site environment/i.test(t?.title || "") && t?.id)
        ids.add(String(t.id))
    }

    if (ids.size === 0) {
      console.log(
        `⚠️ No beta_site.env task found in client ${clientId}'s timeline.`,
      )
      return null
    }

    for (const id of ids) {
      const task = await getJson(`https://ted.growth99.com/api/tasks/${id}`)
      // Authoritative check: the task must actually be the beta_site.env template.
      if (String(task?.automation?.templateKey || "") !== "beta_site.env") continue
      const payload: string = task?.automation?.payload || ""
      // Payload first, then the task's comments (the URL is sometimes typed as a
      // comment rather than baked into the payload).
      const matchUrl = (text: string) => {
        const m = text.match(/betaSiteUrl=(\S+)/i)
        return m && m[1] ? m[1].replace(/[.,;)]+$/, "") : null
      }
      const fromPayload = matchUrl(payload)
      if (fromPayload) {
        console.log(`✅ Resolved beta site URL from TED payload (task #${id}): ${fromPayload}`)
        return fromPayload
      }
      const fromComment = matchUrl(await fetchTedTaskCommentsText(id))
      if (fromComment) {
        console.log(`✅ Resolved beta site URL from TED comment (task #${id}): ${fromComment}`)
        return fromComment
      }
      console.log(
        `⚠️ beta_site.env task #${id} has no betaSiteUrl in payload or comments yet.`,
      )
    }
    return null
  } catch (err) {
    console.error("❌ Error resolving beta site URL from TED:", err)
    return null
  }
}

// Resolve the beta site's REPO (betaSiteRepo=<url>) from the same beta_site.env
// task's automation.payload (right next to betaSiteUrl). Client-agnostic, same
// lookup path as resolveBetaSiteUrlFromTED. Returns the repo URL, or null.
//
// NOTE: this is part of the TED-first resolution that is COMMENTED OUT at the
// call sites for the demo (see "DEMO OVERRIDE" / "TED-FIRST" markers). It's kept
// as live, typechecked code so restoring TED-first after the demo is just an
// uncomment — the function it references already exists and compiles.
async function resolveBetaSiteRepoFromTED(
  clientId?: string | number | null,
): Promise<string | null> {
  const apiToken = process.env.TED_API_TOKEN
  if (!apiToken || clientId == null) return null

  const getJson = async (url: string): Promise<any | null> => {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
    })
    const ct = r.headers.get("content-type") || ""
    if (!r.ok || !ct.includes("application/json")) return null
    return r.json().catch(() => null)
  }

  try {
    const tl = await getJson(
      `https://ted.growth99.com/api/clients/${clientId}/timeline`,
    )
    if (!tl) return null

    const ids = new Set<string>()
    for (const t of tl.activeTasks || []) {
      if (String(t?.automation?.templateKey || "") === "beta_site.env" && t?.id)
        ids.add(String(t.id))
    }
    for (const t of tl.timeline || []) {
      if (/beta site environment/i.test(t?.title || "") && t?.id)
        ids.add(String(t.id))
    }
    if (ids.size === 0) return null

    for (const id of ids) {
      const task = await getJson(`https://ted.growth99.com/api/tasks/${id}`)
      if (String(task?.automation?.templateKey || "") !== "beta_site.env") continue
      const payload: string = task?.automation?.payload || ""
      // Payload first, then the task's comments. Accept the explicit
      // betaSiteRepo= token or a bare GitHub URL written in a comment.
      const matchRepo = (text: string) => {
        const m = text.match(/betaSiteRepo=(\S+)/i)
        if (m && m[1]) return m[1].replace(/[.,;)]+$/, "")
        const g = text.match(/https?:\/\/(?:www\.)?github\.com\/\S+/i)
        return g ? g[0].replace(/[.,;)]+$/, "") : null
      }
      const fromPayload = matchRepo(payload)
      if (fromPayload) {
        console.log(`✅ Resolved beta site REPO from TED payload (task #${id}): ${fromPayload}`)
        return fromPayload
      }
      const fromComment = matchRepo(await fetchTedTaskCommentsText(id))
      if (fromComment) {
        console.log(`✅ Resolved beta site REPO from TED comment (task #${id}): ${fromComment}`)
        return fromComment
      }
    }
    return null
  } catch (err) {
    console.error("❌ Error resolving beta site repo from TED:", err)
    return null
  }
}

// Test whether a git repo URL is actually clonable with the current fix token.
// Uses `git ls-remote` (no checkout) with a short timeout. Part of the (commented)
// TED-first resolution: a complete cycle needs a site URL AND a clonable repo.
// Kept live/typechecked so restore is a clean uncomment.
async function isRepoClonable(repoUrl: string | null): Promise<boolean> {
  if (!repoUrl) return false
  const token = process.env.GIT_FIX_TOKEN
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/i)
  const authUrl =
    token && m
      ? `https://${token}@github.com/${m[1]}/${m[2]}.git`
      : repoUrl
  try {
    await execFileAsync("git", ["ls-remote", authUrl, "HEAD"], {
      timeout: 20000,
    })
    return true
  } catch {
    return false
  }
}

// Resolve the client's LIVE/production site URL from TED for POST-RELEASE runs.
//
// Post-release scans the client's real live site, whose URL lives in the client
// record's `clientDetails.notes` after a "Client Domain/Website URL:" label
// (e.g. "…Website URL: nuvoaestheticsclinic.com"). We look the client up in
// GET /api/clients by clientId (preferred) or name — both from the payload — so
// this stays client-agnostic. Returns a normalized https URL, or null.
async function resolveClientNotesSiteUrlFromTED(
  clientId?: string | number | null,
  clientName?: string | null,
): Promise<string | null> {
  const apiToken = process.env.TED_API_TOKEN
  if (!apiToken) {
    console.log("⚠️ TED_API_TOKEN missing — cannot resolve live site URL.")
    return null
  }
  if (clientId == null && !clientName) return null

  try {
    const res = await fetch("https://ted.growth99.com/api/clients", {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
    })
    const ct = res.headers.get("content-type") || ""
    if (!res.ok || !ct.includes("application/json")) {
      console.error(
        `❌ TED /api/clients did not return JSON (HTTP ${res.status}, content-type "${ct}"). Cannot resolve live site URL.`,
      )
      return null
    }

    const body = (await res.json()) as any
    const clients: any[] = Array.isArray(body)
      ? body
      : body?.clients || body?.data || body?.items || []

    const wantId = clientId != null ? String(clientId) : null
    const wantName = clientName ? clientName.trim().toLowerCase() : null
    const client =
      (wantId && clients.find((c) => String(c?.id) === wantId)) ||
      (wantName &&
        clients.find(
          (c) => String(c?.name || "").trim().toLowerCase() === wantName,
        )) ||
      null

    if (!client) {
      console.log(
        `⚠️ Client (id="${wantId}", name="${clientName}") not found among the ${clients.length} clients TED returned. Live site URL not resolved.`,
      )
      return null
    }

    const notes: string = client?.clientDetails?.notes || ""
    if (!notes) return null

    const text = notes
      .replace(/&nbsp;/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    const m =
      text.match(/(?:domain\s*\/?\s*)?website\s*url\s*:?\s*([^\s,;]+)/i) ||
      text.match(/\bdomain\s*url\s*:?\s*([^\s,;]+)/i) ||
      text.match(/\burl\s*:?\s*(https?:\/\/[^\s,;]+)/i)

    let url = m?.[1]?.trim()
    if (!url) {
      console.log(
        `⚠️ Could not find a "Website URL:" value in client "${client?.name}" notes.`,
      )
      return null
    }

    url = url.replace(/[.,;)]+$/, "")
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    if (!/\.[a-z]{2,}/i.test(url)) return null

    console.log(`✅ Resolved client live site URL from TED: ${url}`)
    return url
  } catch (err) {
    console.error("❌ Error resolving client live site URL from TED:", err)
    return null
  }
}

// Resolve the RELEASED site URL from the TED `release.security` task's
// automation.payload. The webhook payload doesn't carry automation.payload, so
// we re-GET the task by id (same pattern as resolveBetaSiteUrlFromTED). We match
// a set of likely payload keys, then fall back to the first raw URL in the
// payload. Returns the released URL, or null.
async function resolveReleasedUrlFromReleaseSecurity(
  taskId?: string | number | null,
): Promise<string | null> {
  const apiToken = process.env.TED_API_TOKEN
  if (!apiToken) {
    console.log("⚠️ TED_API_TOKEN missing — cannot resolve released site URL.")
    return null
  }
  if (taskId == null) {
    console.log(
      "⚠️ No release.security task id — cannot resolve released site URL.",
    )
    return null
  }

  try {
    const r = await fetch(`https://ted.growth99.com/api/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    })
    const ct = r.headers.get("content-type") || ""
    if (!r.ok || !ct.includes("application/json")) {
      console.error(
        `❌ TED /api/tasks/${taskId} did not return JSON (HTTP ${r.status}, content-type "${ct}").`,
      )
      return null
    }
    const task = (await r.json().catch(() => null)) as any
    if (!task) return null

    const payload: string = task?.automation?.payload || ""
    // The released URL may be in the payload OR typed as a comment on the
    // release.security task page. Search payload first, then comments.
    const findUrl = (text: string): string => {
      // Prefer an explicit released/live/site/production URL token.
      const keyed = text.match(
        /(?:releaseUrl|releasedUrl|liveUrl|liveSiteUrl|siteUrl|productionUrl|prodUrl|domainUrl|websiteUrl)=(\S+)/i,
      )
      // Fall back to the first raw http(s) URL anywhere in the text.
      const raw = text.match(/https?:\/\/\S+/i)
      return (keyed?.[1] || raw?.[0] || "").trim()
    }
    let url = findUrl(payload)
    let source = "payload"
    if (!url) {
      url = findUrl(await fetchTedTaskCommentsText(taskId))
      source = "comment"
    }
    if (!url) {
      console.log(
        `⚠️ release.security task #${taskId} has no released URL in payload or comments yet.`,
      )
      return null
    }
    console.log(`ℹ️ Released URL resolved from ${source} (task #${taskId}).`)
    url = url.replace(/[.,;)]+$/, "")
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    if (!/\.[a-z]{2,}/i.test(url)) return null

    console.log(
      `✅ Resolved released site URL from TED release.security (task #${taskId}): ${url}`,
    )
    return url
  } catch (err) {
    console.error("❌ Error resolving released site URL from TED:", err)
    return null
  }
}

// Resolve a client's task id for a given template key from TED, client-agnostic.
// TED webhook payloads don't reliably carry sibling task ids, so we look the
// client's tasks up via GET /api/clients/{clientId}/timeline and pick the task
// matching `templateKey` (verified via GET /api/tasks/{id}.automation.templateKey;
// completed tasks in the timeline lack templateKey, so `titleRegex` seeds candidates).
// Returns the task id string, or null.
async function resolveTaskIdByTemplateKeyFromTED(
  clientId: string | number | null | undefined,
  templateKey: string,
  titleRegex: RegExp,
): Promise<string | null> {
  const apiToken = process.env.TED_API_TOKEN
  if (!apiToken || clientId == null) return null

  const getJson = async (url: string): Promise<any | null> => {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
    })
    const ct = r.headers.get("content-type") || ""
    if (!r.ok || !ct.includes("application/json")) return null
    return r.json().catch(() => null)
  }

  try {
    const tl = await getJson(
      `https://ted.growth99.com/api/clients/${clientId}/timeline`,
    )
    if (!tl) return null

    const ids = new Set<string>()
    for (const t of tl.activeTasks || []) {
      if (String(t?.automation?.templateKey || "") === templateKey && t?.id)
        ids.add(String(t.id))
    }
    for (const t of tl.timeline || []) {
      if (titleRegex.test(t?.title || "") && t?.id) ids.add(String(t.id))
    }

    if (ids.size === 0) {
      console.log(
        `⚠️ No task matching templateKey "${templateKey}" found in client ${clientId}'s timeline.`,
      )
      return null
    }

    for (const id of ids) {
      const task = await getJson(`https://ted.growth99.com/api/tasks/${id}`)
      if (String(task?.automation?.templateKey || "") === templateKey) {
        console.log(
          `✅ Resolved "${templateKey}" task from TED: #${id}`,
        )
        return id
      }
    }
    return null
  } catch (err) {
    console.error(
      `❌ Error resolving "${templateKey}" task from TED:`,
      err,
    )
    return null
  }
}

// Post a comment to a TED task, preferring the newer /comments/ai endpoint
// (X-Api-Key + idempotent eventKey). If that endpoint is unavailable/errors,
// fall back to the proven /comments endpoint (Bearer). Returns true on success.
async function postTedComment(
  taskId: string | number,
  text: string,
  eventKey: string,
  runId?: string | null,
): Promise<boolean> {
  if (TED_PREVIEW_ONLY) {
    return recordLocalTedWrite(taskId, text, eventKey, "report", runId)
  }

  const xApiKey = process.env.X_API_KEY
  const bearer = process.env.TED_API_TOKEN

  const isJsonOk = (r: globalThis.Response) =>
    r.ok && (r.headers.get("content-type") || "").includes("application/json")

  // 1. Preferred: /comments/ai with X-Api-Key + eventKey (idempotent).
  if (xApiKey) {
    try {
      const r = await fetch(
        `https://ted.growth99.com/api/tasks/${taskId}/comments/ai`,
        {
          method: "POST",
          headers: {
            "X-Api-Key": xApiKey,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text, eventKey }),
        },
      )
      if (isJsonOk(r)) {
        console.log(`✅ Posted comment to TED #${taskId} via /comments/ai.`)
        return true
      }
      const preview = (await r.text().catch(() => "")).slice(0, 200)
      console.warn(
        `⚠️ /comments/ai unavailable for #${taskId} (HTTP ${r.status}, content-type "${r.headers.get("content-type") || ""}"). Falling back to /comments. Body: ${preview}`,
      )
    } catch (err) {
      console.warn(
        `⚠️ /comments/ai threw for #${taskId}; falling back to /comments:`,
        err,
      )
    }
  } else {
    console.log("ℹ️ X_API_KEY not set; using /comments (Bearer) directly.")
  }

  // 2. Fallback: /comments with Bearer (the currently-working endpoint).
  if (!bearer) {
    console.error(
      `❌ Cannot post comment to #${taskId}: neither X_API_KEY succeeded nor TED_API_TOKEN is set.`,
    )
    return false
  }
  try {
    const r = await fetch(
      `https://ted.growth99.com/api/tasks/${taskId}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    )
    if (isJsonOk(r)) {
      console.log(`✅ Posted comment to TED #${taskId} via /comments (Bearer).`)
      return true
    }
    const preview = (await r.text().catch(() => "")).slice(0, 200)
    console.error(
      `❌ Failed to post comment to TED #${taskId} via /comments (HTTP ${r.status}, content-type "${r.headers.get("content-type") || ""}"). Body: ${preview}`,
    )
    return false
  } catch (err) {
    console.error(`❌ Error posting comment to TED #${taskId} via /comments:`, err)
    return false
  }
}

webhookRouter.post("/clerk", async (req: Request, res: Response) => {
  console.log("=== WEBHOOK DEBUG ===")
  // console.log("Headers:", req.headers) // disabled: full headers leak x-ted-webhook-secret into logs
  console.log("Body type:", typeof req.body)
  console.log("Body is Buffer:", Buffer.isBuffer(req.body))

  if (!CLERK_WEBHOOK_SECRET) {
    console.error("CLERK_WEBHOOK_SECRET is not set")
    logger.error("CLERK_WEBHOOK_SECRET is not set")
    return res.status(500).json({ error: "Webhook secret not configured" })
  }

  // Get headers for verification
  const svix_id = req.headers["svix-id"] as string
  const svix_timestamp = req.headers["svix-timestamp"] as string
  const svix_signature = req.headers["svix-signature"] as string

  console.log("Svix headers:", {
    svix_id,
    svix_timestamp,
    svix_signature: svix_signature ? "present" : "missing",
  })

  if (!svix_id || !svix_timestamp || !svix_signature) {
    console.error("Missing svix headers")
    return res.status(400).json({ error: "Missing svix headers" })
  }

  // Clerk sends raw body for signature verification.
  // Since we use express.raw() in index.ts, req.body is a Buffer.
  const payload = req.body
  console.log("Payload length:", payload?.length || "undefined")

  const wh = new Webhook(CLERK_WEBHOOK_SECRET)

  let evt: any

  try {
    evt = wh.verify(payload, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    })
    console.log("Webhook verified successfully")
  } catch (err) {
    console.error("Webhook verification failed:", err)
    logger.error(err, "Webhook signature verification failed")
    return res.status(400).json({ error: "Invalid signature" })
  }

  const { id, type, data } = evt
  console.log("Webhook event:", { id, type })
  logger.info({ type, id }, "Received Clerk webhook event")

  try {
    if (type === "user.created") {
      console.log("Processing user.created event")
      const { id: clerk_id, email_addresses, first_name, last_name } = data
      const email = email_addresses[0]?.email_address
      const full_name = `${first_name || ""} ${last_name || ""}`.trim()

      console.log("User data:", { clerk_id, email, full_name })

      // Check if this is the first user in the system
      const { count } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true })

      console.log("Current user count:", count)
      const role = count === 0 ? "super_admin" : "developer"
      console.log("Assigned role:", role)

      // 1. Ensure an organization exists
      let { data: org } = await supabase
        .from("organizations")
        .select("id")
        .limit(1)
        .maybeSingle()

      if (!org) {
        const { data: newOrg, error: orgError } = await supabase
          .from("organizations")
          .insert({ name: "Default Organization" })
          .select()
          .single()

        if (orgError || !newOrg) {
          console.error("Error creating default organization:", orgError)
          throw orgError || new Error("Failed to create default organization")
        }
        org = newOrg
      }

      if (!org) {
        throw new Error("Critical: No organization found or created")
      }

      console.log("Using organization:", org.id)

      const { error } = await supabase.from("users").insert({
        id: randomUUID(), // Generate UUID for the required id field
        clerk_user_id: clerk_id, // Store Clerk user ID in clerk_user_id column
        clerk_id: clerk_id, // Also store in clerk_id for reference
        email,
        full_name,
        role,
        org_id: org.id,
      })

      if (error) {
        console.error("Supabase insert error:", error)
        throw error
      }
      console.log("User successfully created in Supabase")
      logger.info({ clerk_id, role }, "User created in Supabase via webhook")
    }

    if (type === "user.updated") {
      const { id: clerk_id, email_addresses, first_name, last_name } = data
      const email = email_addresses[0]?.email_address
      const full_name = `${first_name || ""} ${last_name || ""}`.trim()

      const { error } = await supabase
        .from("users")
        .update({
          email,
          full_name,
        })
        .eq("clerk_id", clerk_id)

      if (error) throw error
      logger.info({ clerk_id }, "User updated in Supabase via webhook")
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    logger.error(error, `Error processing webhook event: ${type}`)
    return res.status(500).json({ error: "Database sync failed" })
  }
})

// --- TED Webhook Receiver ---
// This endpoint will be available at POST /webhooks/ted
webhookRouter.post("/ted", async (req: Request, res: Response) => {
  console.log("\n--- INCOMING TED WEBHOOK ---")
  // console.log("Headers:", JSON.stringify(req.headers, null, 2)) // disabled: full headers leak x-ted-webhook-secret into logs

  // Hoisted so the catch block can record the outcome/error on the audit row.
  let webhookEventId: string | null = null
  let createdRunId: string | null = null

  try {
    // 1. Handle the body safely depending on how Express parsed it
    let payloadText = ""

    if (Buffer.isBuffer(req.body)) {
      payloadText = req.body.toString()
    } else if (
      typeof req.body === "object" &&
      Object.keys(req.body).length > 0
    ) {
      payloadText = JSON.stringify(req.body)
    } else {
      payloadText = String(req.body || "")
    }

    if (!payloadText || payloadText.trim() === "" || payloadText === "{}") {
      console.error(
        "❌ Error: Received empty body from TED (payloadText is empty)",
      )
      return res.status(400).json({ error: "Failed: No body received." })
    }

    console.log("Raw Payload Received:", payloadText.substring(0, 300) + "...")

    const payload = JSON.parse(payloadText)

    // 1b. Normalize the TED payload shape.
    // Newer TED webhooks (Task Automation Routing / template-key routing) send:
    //   - payload.trigger          -> the task whose status changed (the source task)
    //   - payload.target           -> optional sibling task details (id & status)
    //   - payload.targetTemplateKey/payload.source/payload.event at the top level
    // Older TED webhooks sent the task directly under payload.data.
    // We accept BOTH so nothing breaks. Everything downstream reads from `task`.
    const task = payload.trigger || payload.data || {}
    const targetTask = payload.target || null
    const eventType = payload.event

    // TED sends `target` (the sibling QA task, e.g. "Complete QA pre-release
    // testing") specifically so QACC can operate on / talk back to it directly.
    // Prefer the target task for talk-back; fall back to the trigger task
    // (and to the old `data.id` for backward compatibility).
    const actionableTaskId = targetTask?.id || task.id || null

    // Client name can live in a few places depending on TED's payload variant.
    const clientName =
      task.clientName ||
      task.client_name ||
      task.client?.name ||
      payload.clientName ||
      payload.client?.name ||
      payload.client_name ||
      null

    // 2. We extract the secret password. TED might send it in the real HTTP headers, or inside the JSON body.
    // We check both places just to be absolutely sure!
    const secretFromHeader =
      req.headers["x-ted-webhook-secret"] || req.headers["x-webhook-secret"]
    const secretFromBody = payload?.headers?.["X-TED-Webhook-Secret"]
    const secret = secretFromHeader || secretFromBody

    // 3. We define the exact password we expect
    const expectedSecret = process.env.TED_WEBHOOK_SECRET

    // 4. We check if the password provided matches our expected password.
    if (!expectedSecret) {
      console.log(
        "❌ SERVER ERROR: TED_WEBHOOK_SECRET is missing from your .env file!",
      )
      return res.status(500).json({ error: "Server misconfigured" })
    }

    if (secret !== expectedSecret) {
      console.log(
        `❌ Unauthorized TED webhook attempt. Received secret: ${secret} | Expected: ${expectedSecret}`,
      )
      return res.status(401).json({ error: "Unauthorized: Invalid secret" })
    }

    // Health-check pings (TED's "Test Webhook" / preview test) carry no task —
    // just a generic `data` blob and event PING_TEST. Acknowledge cleanly and
    // skip task logging / auditing so they don't clutter the history.
    if (eventType === "PING_TEST") {
      console.log("🏓 Received TED PING_TEST — connection is healthy. Responding pong.")
      return res.status(200).json({
        status: 200,
        statusText: "OK",
        message: "pong: QACC webhook endpoint is alive",
        timestamp: new Date().toISOString(),
        data: { acknowledged: true, event: "PING_TEST" },
      })
    }

    console.log(
      `📥 Received TED Event: ${eventType} | Task: ${task.title || "?"} (#${task.id}) | TemplateKey: ${task.templateKey || "?"} | Status: ${task.previousStatus || "?"} -> ${task.status} | Target: #${targetTask?.id || "none"}`,
    )

    // 4b. Persist an audit record of this event (full raw payload + parsed
    // context) so QACC keeps a permanent, queryable history of what TED sent.
    // Wrapped so a logging failure can never break webhook processing.
    // `createdRunId` is filled in later if this event starts a QA run.
    try {
      const { data: logRow, error: logErr } = await supabase
        .from("ted_webhook_events")
        .insert({
          event_type: eventType || null,
          source: payload.source || null,
          ted_task_id: task.id ? String(task.id) : null,
          template_key: task.templateKey || null,
          task_title: task.title || null,
          assignee: task.assignee || null,
          status: task.status || null,
          previous_status: task.previousStatus || null,
          target_task_id: targetTask?.id ? String(targetTask.id) : null,
          target_template_key: payload.targetTemplateKey || null,
          client_name: clientName,
          raw_payload: payload,
        })
        .select("id")
        .single()

      if (logErr) {
        console.error(
          "⚠️ Failed to persist TED webhook event (continuing):",
          logErr,
        )
      } else {
        webhookEventId = logRow?.id || null
      }
    } catch (logErr) {
      console.error(
        "⚠️ Failed to persist TED webhook event (continuing):",
        logErr,
      )
    }

    // 5. If the password is correct, we check what kind of event happened.
    if (eventType === "TASK_UPDATED" || eventType === "TASK_STATUS_CHANGED") {
      // Gate: act on the release.pre_dev trigger task → Complete/Completed
      // (the old trigger, now scoped to its template key to match internal QA
      // and post-release), OR on the release.qa_pre target task itself while
      // still "Not Started" — a manual/test kick-off (direct run trigger).
      // The target is scoped to release.qa_pre so a random Not Started task
      // never launches a pre-release run.
      const isPreDevTrigger = task.templateKey === "release.pre_dev"
      const isComplete =
        task.status === "Complete" || task.status === "Completed"
      const isPreQaTarget = task.templateKey === "release.qa_pre"
      const isNotStarted = task.status === "Not Started"
      if (
        (isPreDevTrigger && isComplete) ||
        (isPreQaTarget && isNotStarted)
      ) {
        console.log(
          isPreQaTarget && isNotStarted
            ? "✅ release.qa_pre direct trigger (Not Started)! Triggering QACC pre-release workflow..."
            : "✅ release.pre_dev is Complete! Triggering QACC pre-release workflow...",
        )
        console.log("Task Data:", task)

        // --- MATCH PROJECT & START QA RUN ---
        if (clientName) {
          console.log(
            `🔍 Looking up QACC project matching name: "${clientName}"`,
          )

          // TED-first resolution (pre-release): scan the REAL beta site only when
          // beta_site.env yields BOTH a betaSiteUrl and a clonable betaSiteRepo
          // (either may be in the payload OR a task comment). Otherwise fall back
          // to the forced demo site (QACC_FALLBACK_SITE_URL + AI_FIX_LOCAL_REPO).
          const betaUrl = await resolveBetaSiteUrlFromTED(task.clientId)
          const betaRepo = await resolveBetaSiteRepoFromTED(task.clientId)
          const usablePair = !!betaUrl && (await isRepoClonable(betaRepo))
          const tedSiteUrl: string | null = usablePair ? betaUrl : null
          if (!usablePair)
            console.log(
              `ℹ️ pre-release: beta_site.env pair not usable (url=${betaUrl || "none"}, repo=${betaRepo || "none"}) → forcing demo site.`,
            )

          // 1. Look for a project in QACC where the name exactly matches the TED clientName
          let { data: project } = await supabase
            .from("projects")
            .select("*")
            .ilike("name", clientName) // Case-insensitive match
            .single()

          if (!project) {
            console.log(
              `⚠️ Could not find a QACC project named "${clientName}". Creating a new one automatically from TED details...`,
            )

            // Since this is a company tool, the org_id is always QACC.
            // We just grab the first valid org_id from the database to attach the project to.
            const { data: orgData } = await supabase
              .from("users")
              .select("org_id")
              .not("org_id", "is", null)
              .limit(1)
              .single()

            if (!orgData?.org_id) {
              console.log(
                `❌ Cannot auto-create project: Could not determine a default org_id in QACC.`,
              )
            } else {
              const insertPayload: any = {
                name: clientName,
                client_name: clientName,
                org_id: orgData.org_id,
                status: "active",
                site_url: tedSiteUrl || TED_FALLBACK_SITE_URL,
                // release.pre_dev completed → this project is now in the
                // pre-release QA stage.
                is_pre_release: true,
              }

              const { data: newProject, error: createError } = await supabase
                .from("projects")
                .insert(insertPayload)
                .select()
                .single()

              if (createError) {
                console.error(
                  "❌ Failed to auto-create project in database:",
                  createError,
                )
              } else {
                project = newProject
                console.log(
                  `✅ Successfully auto-created new QACC project: ${project.name} (ID: ${project.id})`,
                )
              }
            }
          }

          if (project) {
            console.log(
              `✅ Proceeding with QACC project: ${project.name} (ID: ${project.id})`,
            )

            // 1b. Backfill the project's site URL from TED when it's still on
            // the placeholder (or empty). We only overwrite the fallback so a
            // URL a human set intentionally in QACC is never clobbered.
            if (tedSiteUrl) {
              const current = (project.site_url || "").trim()
              const isPlaceholder =
                !current || /qacctest\.gogroth\.com/i.test(current)
              if (isPlaceholder && current !== tedSiteUrl) {
                const { data: upd, error: updErr } = await supabase
                  .from("projects")
                  .update({ site_url: tedSiteUrl })
                  .eq("id", project.id)
                  .select()
                  .single()
                if (updErr) {
                  console.error(
                    "❌ Failed to backfill project site_url:",
                    updErr,
                  )
                } else if (upd) {
                  project = upd
                  console.log(
                    `✅ Backfilled project site_url: "${current || "(empty)"}" -> "${tedSiteUrl}"`,
                  )
                }
              }
            }

            // 1c. Mark the project as pre-release (release.pre_dev is complete,
            // so the project is now in the pre-release QA stage). Also clears
            // the internal-QA sub-stage flag if it was set, since the project
            // has now advanced past internal QA. Only write when something
            // actually changes, to avoid a redundant update.
            if (!project.is_pre_release || project.is_internal_qa) {
              const { data: preUpd, error: preErr } = await supabase
                .from("projects")
                .update({ is_pre_release: true, is_internal_qa: false })
                .eq("id", project.id)
                .select()
                .single()
              if (preErr) {
                console.error(
                  "❌ Failed to mark project as pre-release:",
                  preErr,
                )
              } else if (preUpd) {
                project = preUpd
                console.log(
                  `✅ Marked project "${project.name}" as pre-release.`,
                )
              }
            }

            // 2. Try to find the TED assignee in the users table, or auto-create a ghost user so their name appears on the QA Run
            let runCreatorId = null
            const assigneeName = task.assignee || "TED System"

            const { data: existingUser } = await supabase
              .from("users")
              .select("id")
              .ilike("full_name", assigneeName)
              .eq("org_id", project.org_id)
              .limit(1)
              .single()

            if (existingUser?.id) {
              runCreatorId = existingUser.id
            } else {
              console.log(
                `👤 Assignee "${assigneeName}" not found in QACC. Auto-creating a ghost user...`,
              )
              const safeEmail = `${assigneeName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "ted"}-${Date.now()}@ted.internal`
              const { data: newUser, error: createError } = await supabase
                .from("users")
                .insert({
                  id: randomUUID(), // Required by the users table schema
                  clerk_user_id: `ghost_${Date.now()}`, // Required to bypass NOT NULL constraints
                  clerk_id: `ghost_${Date.now()}`,
                  full_name: assigneeName,
                  email: safeEmail,
                  org_id: project.org_id,
                  role: "qa_engineer",
                })
                .select("id")
                .single()

              if (createError) {
                console.error(
                  "❌ Ghost user creation failed in Supabase:",
                  createError,
                )
              } else if (newUser?.id) {
                runCreatorId = newUser.id
              }
            }

            // Fallback to admin if ghost user creation failed for any reason
            if (!runCreatorId) {
              const { data: adminUser } = await supabase
                .from("users")
                .select("id")
                .eq("org_id", project.org_id)
                .limit(1)
                .single()
              runCreatorId = adminUser?.id || null
            }

            // Dedupe guard: skip if a run for this TED task was created very
            // recently. QACC writes "In Progress" back to TED, which re-fires
            // this webhook (status is in the accept list) — without this, that
            // re-entry spawns a duplicate run, report, AI-fix pass and PR.
            // Window via TED_RUN_DEDUPE_HOURS (default 6).
            if (actionableTaskId) {
              const dedupeHours = Number(process.env.TED_RUN_DEDUPE_HOURS || 6)
              const since = new Date(
                Date.now() - dedupeHours * 3600 * 1000,
              ).toISOString()
              const { data: recentRuns } = await supabase
                .from("qa_runs")
                .select("id, created_at")
                .eq("ted_task_id", String(actionableTaskId))
                .gte("created_at", since)
                .limit(1)
              if (recentRuns && recentRuns.length > 0) {
                console.log(
                  `[TED webhook] Duplicate suppressed: run ${recentRuns[0].id} already exists for TED task ${actionableTaskId} within ${dedupeHours}h`,
                )
                return res.status(200).json({
                  status: "duplicate_suppressed",
                  existingRunId: recentRuns[0].id,
                })
              }
            }

            // 3. Create the new QA Run in the database
            const { data: run, error: runError } = await supabase
              .from("qa_runs")
              .insert({
                project_id: project.id,
                run_type: "pre_release",
                // Scan target = the TED beta_site.env URL when its URL+repo pair
                // is usable, else the local fallback (:9400 + AI_FIX_LOCAL_REPO).
                // The project's stored site_url is deliberately NOT consulted —
                // what gets scanned is what THIS webhook resolves, independent of
                // whatever URL happens to be saved under the project's name.
                site_url: tedSiteUrl || TED_FALLBACK_SITE_URL,
                enabled_checks: [
                  "project_plan",
                  "hero_media",
                  "dead_links",
                  "learn_more_buttons",
                  "paid_media",
                  "privacy_policy",
                  "footer_logo",
                  "single_script",
                  "url_tab_compare",
                  "top_bar_sticky",
                  "favicon",
                  "contact_form",
                  "chatbot_consultation",
                  "logo_chatbot",
                  "callnow_links",
                  "verify_plugin_updates",
                  "social_share_heading",
                  // New QACC checks (added to the automated pre-release suite)
                  "false_breakpoint",
                  "backend_check",
                  "review_reputation_check",
                  "functionality_check",
                  "gbp_check",
                  "image_quality",
                  "cross_browser",
                ],
                device_matrix: ["desktop", "mobile"],
                status: "running",
                created_by: runCreatorId, // Assigns to the actual person from TED, or the Ghost User
                ted_task_id: actionableTaskId ? String(actionableTaskId) : null,
              })
              .select()
              .single()

            if (runError) {
              console.error("❌ Failed to create QA Run in database:", runError)
            } else if (run) {
              createdRunId = run.id
              console.log(
                `🚀 Successfully created QA Run ${run.id}! Adding to worker queue...`,
              )
              try {
                // 4. Add the run to BullMQ so the worker starts scanning the site immediately
                const { addRunJob } = require("../lib/queue")
                await addRunJob(run.id)
                console.log(
                  `✅ Automated QA Run for ${project.name} is now officially STARTING in the background!`,
                )
              } catch (queueErr) {
                console.error(
                  "❌ Failed to add QA run to worker queue:",
                  queueErr,
                )
              }
            }
          }
        }

        // Talk back to the target QA task (e.g. release.qa_pre / 9081) when TED
        // provided one, otherwise the trigger task itself.
        const taskId = actionableTaskId
        const apiToken = process.env.TED_API_TOKEN

        // --- MARK THE TARGET QA TASK "In Progress" ---
        // Only when the scan actually started (createdRunId set). QACC never
        // marks it Complete — a human closes it out after the remaining manual
        // work, so it deliberately stays "In Progress" once the scan finishes.
        if (createdRunId && taskId && apiToken) {
          console.log(
            `🔄 Marking TED Task #${taskId} as "In Progress" (QACC scan started)...`,
          )
          await setTedTaskStatus(taskId, "In Progress", apiToken, createdRunId)
        }

        if (taskId) {
          console.log(
            `💬 Sending confirmation comment back to TED Task #${taskId}...`,
          )
          await postTedComment(
            taskId,
            "Successfully received the release request — the automated QA connection is active!",
            `ext:qacc-prerelease-received-${taskId}`,
            createdRunId,
          )
        } else {
          console.log(
            "⚠️ Could not post comment to TED: taskId is missing from payload.",
          )
        }
      }
    }

    // 6b. Record the outcome on the audit row (whether a QA run started).
    if (webhookEventId) {
      try {
        await supabase
          .from("ted_webhook_events")
          .update({
            triggered_run: !!createdRunId,
            qa_run_id: createdRunId,
          })
          .eq("id", webhookEventId)
      } catch (updErr) {
        console.error(
          "⚠️ Failed to update TED webhook event outcome (continuing):",
          updErr,
        )
      }
    }

    // 6. We send a successful 200 OK response back to TED in their exact expected format
    console.log("✅ Webhook successfully processed")

    return res.status(200).json({
      status: 200,
      statusText: "OK",
      message: "Webhook payload received and processed successfully",
      timestamp: new Date().toISOString(),
      data: {
        acknowledged: true,
        workflowId: "qacc-ted-pre-release",
        executionId: actionableTaskId || "unknown",
        // The QACC run this trigger started (null if no run was created). TED
        // stores this to later pause/resume/cancel the run via /webhooks/ted/*.
        qaRunId: createdRunId,
      },
    })
  } catch (error) {
    console.error("❌ Error parsing TED webhook payload:", error)

    // Record the failure on the audit row if we managed to create one.
    if (webhookEventId) {
      try {
        await supabase
          .from("ted_webhook_events")
          .update({ error: String((error as Error)?.message || error) })
          .eq("id", webhookEventId)
      } catch {
        /* never let audit logging mask the original error */
      }
    }

    return res.status(400).json({ error: "Invalid payload format" })
  }
})

// --- TED Webhook Receiver: INTERNAL QA ---
// POST /webhooks/ted/internal-qa
// Configured in TED via Task Automation Routing (template-key routing, so it
// works for every client with no hardcoded task IDs):
//   • Trigger on Task Template Key : beta_site.seo   ("Complete beta site SEO")
//   • When status becomes          : Completed
//   • Include Sibling Task (target): beta_site.internal_test
//                                    ("Complete internal beta site testing")
//   • Event                        : Task Status Changed
// When beta_site.seo completes, QACC starts an internal QA scan of the beta
// site and talks back to the beta_site.internal_test target task (marks it
// In Progress + posts a confirmation comment). It never marks that task
// Complete — a human closes it out after the remaining manual work.
const INTERNAL_QA_TRIGGER_TEMPLATE_KEY = "beta_site.seo"
const INTERNAL_QA_TARGET_TEMPLATE_KEY = "beta_site.internal_test"

// The internal-QA check suite, used as the fallback when we can't discover the
// parent task's subtasks (so the scan still runs the intended checks).
const INTERNAL_QA_DEFAULT_CHECKS = [
  "functionality_check",
  "hamburger_menu",
  "spelling",
  "grammar",
  "accessibility_check",
  "image_quality",
  "false_breakpoint",
  "cross_browser",
]

// The 7 Internal QA SECTION subtasks → the QACC checks that report into each.
// Subtasks have no template key and their ids vary per client, so we match on
// the normalized title (lowercased, all non-alphanumerics stripped, e.g.
// "Functional & UI Testing" -> "functionaluitesting"). A check may belong to
// more than one section (e.g. false_breakpoint → Browser&Device AND Header&
// Breakpoints), so a single check can post back to MULTIPLE subtasks. Only
// login-free checks appropriate for a beta-site scan are listed here
// (backend_check etc. that need the WP admin password are intentionally omitted).
const INTERNAL_QA_SECTIONS: { matchers: string[]; checks: string[] }[] = [
  {
    matchers: ["browserdeviceview", "browserdevice", "deviceview", "browser"],
    checks: ["cross_browser", "false_breakpoint"],
  },
  {
    matchers: ["functionaluitesting", "functionalui", "functional"],
    checks: [
      "functionality_check",
      "hamburger_menu",
      "spelling",
      "grammar",
      "accessibility_check",
      "image_quality",
      "dead_links",
      "learn_more_buttons",
      "favicon",
      "callnow_links",
      "top_bar_sticky",
      "privacy_policy",
      "footer_logo",
    ],
  },
  {
    matchers: ["urlmetadatasharing", "urlmetadata", "metadata", "sharing"],
    checks: ["url_tab_compare", "text_share", "meta"],
  },
  { matchers: ["blogverification", "blog"], checks: ["url_tab_compare"] },
  { matchers: ["mapaddress", "map"], checks: ["gbp_check"] },
  { matchers: ["herosection", "hero"], checks: ["hero_media"] },
  {
    matchers: ["headerbreakpoints", "headerbreakpoint", "breakpoint"],
    checks: ["false_breakpoint"],
  },
]

const normalizeTitle = (s: unknown): string =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "")

// Normalize a raw subtask object (TED shapes vary) into { id, title, status }.
function normalizeSubtask(
  raw: any,
): { id: string; title: string; status: string | null } | null {
  if (!raw || typeof raw !== "object") return null
  const id = raw.id ?? raw.taskId ?? raw.task_id ?? raw._id ?? null
  const title = raw.title ?? raw.name ?? raw.subject ?? raw.label ?? ""
  const status = raw.status ?? raw.state ?? null
  if (id == null || !title) return null
  return { id: String(id), title: String(title), status: status ? String(status) : null }
}

// Shape-agnostic: walk any object and return the largest array whose items look
// like subtasks (each has an id AND a title-ish field). TED's key name for the
// subtask collection isn't guaranteed, so we don't hardcode it — we find it.
function findSubtaskArray(root: any): any[] | null {
  let best: any[] = []
  const seen = new Set<any>()
  const visit = (node: any, depth: number) => {
    if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      const valid = node.filter((it) => normalizeSubtask(it))
      if (valid.length > best.length) best = node
      for (const it of node) visit(it, depth + 1)
      return
    }
    for (const k of Object.keys(node)) visit(node[k], depth + 1)
  }
  visit(root, 0)
  return best.length ? best : null
}

// Resolve the subtasks of the beta_site.internal_test parent, client-agnostic.
// Primary: scan the webhook payload (TED's "Include all subtasks in payload"
// toggle). Fallback: GET /api/tasks/{parentTaskId} and scan that. When nothing
// is found we log the actual shape (truncated) so the payload key can be seen.
async function resolveInternalTestSubtasksFromTED(
  payload: any,
  parentTaskId: string | null,
): Promise<{ id: string; title: string; status: string | null }[]> {
  // 1. Primary — scan the webhook payload for a subtask-shaped array (any key).
  const fromPayload = findSubtaskArray(payload)
  if (fromPayload) {
    const subs = fromPayload.map(normalizeSubtask).filter(Boolean) as {
      id: string
      title: string
      status: string | null
    }[]
    if (subs.length) {
      console.log(
        `📋 Found ${subs.length} internal-test subtask(s) in the webhook payload: ${subs
          .map((s) => `#${s.id} "${s.title}"`)
          .join(", ")}`,
      )
      return subs
    }
  }
  console.log(
    "🔎 No subtasks found in the webhook payload. payload.target shape (truncated):",
    JSON.stringify(payload?.target ?? payload ?? {}).slice(0, 1000),
  )

  // 2. Fallback — fetch the dedicated subtasks sub-resource. TED does NOT put
  // the subtasks in the webhook payload (subtasks:[]) nor in the plain task GET;
  // GET /api/tasks/{id}/subtasks returns them (verified against parent #9075).
  const apiToken = process.env.TED_API_TOKEN
  if (!apiToken || !parentTaskId) {
    console.log(
      "⚠️ Cannot fetch subtasks (missing TED_API_TOKEN or parent id).",
    )
    return []
  }
  try {
    const r = await fetch(
      `https://ted.growth99.com/api/tasks/${parentTaskId}/subtasks`,
      { headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" } },
    )
    const ct = r.headers.get("content-type") || ""
    if (!r.ok || !ct.includes("application/json")) {
      console.error(
        `❌ TED /api/tasks/${parentTaskId}/subtasks did not return JSON (HTTP ${r.status}, content-type "${ct}").`,
      )
      return []
    }
    const body = (await r.json().catch(() => null)) as any
    // The endpoint returns the array directly; findSubtaskArray also handles a
    // wrapped shape just in case.
    const arr = Array.isArray(body) ? body : findSubtaskArray(body)
    const subs = (arr || [])
      .map(normalizeSubtask)
      .filter(Boolean) as { id: string; title: string; status: string | null }[]
    if (!subs.length) {
      console.log(
        `🔎 No subtasks in /api/tasks/${parentTaskId}/subtasks response. shape (truncated):`,
        JSON.stringify(body ?? {}).slice(0, 1000),
      )
    } else {
      console.log(
        `📋 Fetched ${subs.length} internal-test subtask(s) from TED /api/tasks/${parentTaskId}/subtasks: ${subs
          .map((s) => `#${s.id} "${s.title}"`)
          .join(", ")}`,
      )
    }
    return subs
  } catch (err) {
    console.error("❌ Error fetching internal-test subtasks from TED:", err)
    return []
  }
}

// Map discovered subtasks → QACC checks by SECTION title. Returns:
//   • map:  check_factor -> [subtaskId, ...]  (a check may report to several
//           subtasks; a subtask owns many checks)
//   • matchedChecks: the de-duplicated union of all mapped checks — exactly the
//           set the internal-QA scan runs, so it mirrors TED's checklist.
//   • unmatched: subtask titles that matched no section (logged, never silent —
//           a renamed section must be visible, not swallowed).
function mapSubtasksToChecks(
  subtasks: { id: string; title: string }[],
): { map: Record<string, string[]>; matchedChecks: string[]; unmatched: string[] } {
  const map: Record<string, string[]> = {}
  const unmatched: string[] = []
  for (const st of subtasks) {
    const norm = normalizeTitle(st.title)
    const section = INTERNAL_QA_SECTIONS.find((s) =>
      s.matchers.some((m) => norm.includes(m)),
    )
    if (!section) {
      unmatched.push(st.title)
      continue
    }
    for (const check of section.checks) {
      if (!map[check]) map[check] = []
      if (!map[check].includes(st.id)) map[check].push(st.id)
    }
  }
  if (unmatched.length) {
    console.log(
      `⚠️ ${unmatched.length} internal-test subtask(s) did not map to a section: ${unmatched.join(", ")}`,
    )
  }
  return { map, matchedChecks: Object.keys(map), unmatched }
}

// PUT a status onto a TED task. TED's SSR returns app-shell HTML (HTTP 200)
// when the task id can't be resolved, so a JSON body is the only proof the
// update landed. Returns true on success. Best-effort — never throws.
async function setTedTaskStatus(
  taskId: string | number,
  status: string,
  apiToken: string,
  runId?: string | null,
): Promise<boolean> {
  if (TED_PREVIEW_ONLY) {
    return recordLocalTedWrite(
      taskId,
      `<p>🔖 <strong>Status → ${status}</strong></p>`,
      `status:${taskId}:${status}:${runId || ""}`,
      "status",
      runId,
    )
  }
  try {
    const res = await fetch(
      `https://ted.growth99.com/api/tasks/${taskId}/status`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      },
    )
    const ct = res.headers.get("content-type") || ""
    if (res.ok && ct.includes("application/json")) {
      console.log(`✅ TED Task #${taskId} status set to "${status}".`)
      return true
    }
    const preview = (await res.text().catch(() => "")).slice(0, 200)
    console.error(
      `❌ Failed to set status "${status}" on TED task #${taskId} (HTTP ${res.status}, content-type "${ct}"). Body: ${preview}`,
    )
    return false
  } catch (err) {
    console.error(`❌ Error setting status on TED task #${taskId}:`, err)
    return false
  }
}

webhookRouter.post(
  "/ted/internal-qa",
  async (req: Request, res: Response) => {
    console.log("\n--- INCOMING TED WEBHOOK (INTERNAL QA) ---")
    // console.log("Headers:", JSON.stringify(req.headers, null, 2)) // disabled: full headers leak x-ted-webhook-secret into logs

    // Hoisted so the catch block can record the outcome/error on the audit row.
    let webhookEventId: string | null = null
    let createdRunId: string | null = null
    // The task QACC talks back to = beta_site.internal_test (the target),
    // NOT the beta_site.seo trigger. Resolved from the payload/timeline below.
    let targetTaskId: string | null = null
    // { check_factor: ted_subtask_id } for the parent's subtasks, and the
    // checks to actually run (defaults to the full suite until discovery runs).
    let tedSubtaskMap: Record<string, string[]> = {}
    let internalQaChecks: string[] = INTERNAL_QA_DEFAULT_CHECKS

    try {
      // 1. Read the body safely (Express may hand us a Buffer, object, or string)
      let payloadText = ""
      if (Buffer.isBuffer(req.body)) {
        payloadText = req.body.toString()
      } else if (
        typeof req.body === "object" &&
        Object.keys(req.body).length > 0
      ) {
        payloadText = JSON.stringify(req.body)
      } else {
        payloadText = String(req.body || "")
      }

      if (!payloadText || payloadText.trim() === "" || payloadText === "{}") {
        console.error("❌ Internal-QA webhook: empty body from TED")
        return res.status(400).json({ error: "Failed: No body received." })
      }

      console.log("Raw Payload Received:", payloadText.substring(0, 300) + "...")

      const payload = JSON.parse(payloadText)

      // Normalize (same shape as the other TED endpoints).
      const task = payload.trigger || payload.data || {}
      const targetTask = payload.target || null
      const eventType = payload.event
      const clientName =
        task.clientName ||
        task.client_name ||
        task.client?.name ||
        payload.clientName ||
        payload.client?.name ||
        payload.client_name ||
        null

      // 2. Validate the shared secret (header or body).
      const secretFromHeader =
        req.headers["x-ted-webhook-secret"] || req.headers["x-webhook-secret"]
      const secretFromBody = payload?.headers?.["X-TED-Webhook-Secret"]
      const secret = secretFromHeader || secretFromBody
      const expectedSecret = process.env.TED_WEBHOOK_SECRET

      if (!expectedSecret) {
        console.log("❌ SERVER ERROR: TED_WEBHOOK_SECRET is missing!")
        return res.status(500).json({ error: "Server misconfigured" })
      }
      if (secret !== expectedSecret) {
        console.log("❌ Unauthorized internal-QA TED webhook attempt.")
        return res.status(401).json({ error: "Unauthorized: Invalid secret" })
      }

      // Health-check ping.
      if (eventType === "PING_TEST") {
        console.log(
          "🏓 Received TED PING_TEST (internal-QA) — connection healthy. Responding pong.",
        )
        return res.status(200).json({
          status: 200,
          statusText: "OK",
          message: "pong: QACC internal-QA webhook endpoint is alive",
          timestamp: new Date().toISOString(),
          data: { acknowledged: true, event: "PING_TEST" },
        })
      }

      console.log(
        `📥 Internal-QA event: ${eventType} | Task: ${task.title || "?"} (#${task.id}) | TemplateKey: ${task.templateKey || "?"} | Status: ${task.previousStatus || "?"} -> ${task.status} | Target: #${targetTask?.id || "none"} (${payload.targetTemplateKey || "?"})`,
      )

      // Audit the event (best-effort; never breaks processing).
      try {
        const { data: logRow, error: logErr } = await supabase
          .from("ted_webhook_events")
          .insert({
            event_type: eventType || null,
            source: payload.source || null,
            ted_task_id: task.id ? String(task.id) : null,
            template_key: task.templateKey || null,
            task_title: task.title || null,
            assignee: task.assignee || null,
            status: task.status || null,
            previous_status: task.previousStatus || null,
            target_task_id: targetTask?.id ? String(targetTask.id) : null,
            target_template_key: payload.targetTemplateKey || null,
            client_name: clientName,
            raw_payload: payload,
          })
          .select("id")
          .single()
        if (logErr) {
          console.error(
            "⚠️ Failed to persist internal-QA webhook event (continuing):",
            logErr,
          )
        } else {
          webhookEventId = logRow?.id || null
        }
      } catch (logErr) {
        console.error(
          "⚠️ Failed to persist internal-QA webhook event (continuing):",
          logErr,
        )
      }

      // 3. Gate: act on beta_site.seo → Complete/Completed, OR on the
      //    beta_site.internal_test target itself while still "Not Started"
      //    (a direct manual/test trigger — touch the internal-test task to
      //    kick off the scan without waiting on the SEO task).
      const isSeoTemplate =
        task.templateKey === INTERNAL_QA_TRIGGER_TEMPLATE_KEY
      const isComplete =
        task.status === "Complete" || task.status === "Completed"

      // Direct trigger: the internal_test task (the target) at Not Started.
      const isInternalTestTemplate =
        task.templateKey === INTERNAL_QA_TARGET_TEMPLATE_KEY
      const isNotStarted = task.status === "Not Started"

      // TED labels a status change as TASK_UPDATED (the record event); the
      // "Task Status Changed" trigger is a TED-side filter, not the delivered
      // event name. So accept both. Duplicate deliveries are handled by the
      // run-dedupe guard below (one run per target task within the window).
      if (
        (eventType === "TASK_UPDATED" ||
          eventType === "TASK_STATUS_CHANGED") &&
        ((isSeoTemplate && isComplete) ||
          (isInternalTestTemplate && isNotStarted))
      ) {
        console.log(
          isInternalTestTemplate
            ? "✅ beta_site.internal_test direct trigger (Not Started)! Starting internal QA scan of the beta site..."
            : "✅ beta_site.seo is Complete! Starting internal QA scan of the beta site...",
        )

        if (clientName) {
          console.log(
            `🔍 Looking up QACC project matching name: "${clientName}"`,
          )

          // TED-first resolution (internal QA): the scan targets the BETA site,
          // used only when beta_site.env yields BOTH a betaSiteUrl and a clonable
          // betaSiteRepo (either may be in the payload OR a task comment).
          // Otherwise fall back to the forced demo site.
          const betaUrl = await resolveBetaSiteUrlFromTED(task.clientId)
          const betaRepo = await resolveBetaSiteRepoFromTED(task.clientId)
          const usablePair = !!betaUrl && (await isRepoClonable(betaRepo))
          const tedSiteUrl: string | null = usablePair ? betaUrl : null
          if (!usablePair)
            console.log(
              `ℹ️ internal-QA: beta_site.env pair not usable (url=${betaUrl || "none"}, repo=${betaRepo || "none"}) → forcing demo site.`,
            )

          // Resolve the beta_site.internal_test target task QACC talks back to.
          // Prefer resolving by template key (client-agnostic); fall back to the
          // sibling task TED included in the payload.
          targetTaskId =
            (await resolveTaskIdByTemplateKeyFromTED(
              task.clientId,
              INTERNAL_QA_TARGET_TEMPLATE_KEY,
              /internal beta site testing/i,
            )) ||
            (targetTask?.id ? String(targetTask.id) : null)

          // Discover the parent's subtasks and map each to a QACC check by
          // title. QACC runs exactly the checks that map to a subtask (so it
          // mirrors TED's checklist) and remembers which subtask each check
          // reports back to. If nothing is discovered, fall back to the full
          // internal-QA suite and report only to the parent task (no regression).
          const subtasks = await resolveInternalTestSubtasksFromTED(
            payload,
            targetTaskId,
          )
          const { map, matchedChecks } = mapSubtasksToChecks(subtasks)
          if (matchedChecks.length) {
            tedSubtaskMap = map
            internalQaChecks = matchedChecks
            console.log(
              `🧭 Internal-QA subtask map: ${JSON.stringify(map)} — running checks: ${matchedChecks.join(", ")}`,
            )
          } else {
            console.log(
              "ℹ️ No subtasks mapped — running the default internal-QA suite and reporting to the parent task only.",
            )
          }
          // Cross-browser has no subtask in the checklist but should still run
          // on internal QA — it reports to the parent summary.
          if (!internalQaChecks.includes("cross_browser")) {
            internalQaChecks = [...internalQaChecks, "cross_browser"]
          }

          // 1. Find the QACC project by TED clientName (case-insensitive).
          let { data: project } = await supabase
            .from("projects")
            .select("*")
            .ilike("name", clientName)
            .single()

          if (!project) {
            console.log(
              `⚠️ Could not find a QACC project named "${clientName}". Creating a new one automatically from TED details...`,
            )

            const { data: orgData } = await supabase
              .from("users")
              .select("org_id")
              .not("org_id", "is", null)
              .limit(1)
              .single()

            if (!orgData?.org_id) {
              console.log(
                `❌ Cannot auto-create project: Could not determine a default org_id in QACC.`,
              )
            } else {
              const insertPayload: any = {
                name: clientName,
                client_name: clientName,
                org_id: orgData.org_id,
                status: "active",
                site_url: tedSiteUrl || TED_FALLBACK_SITE_URL,
                // Internal beta-site testing is its own stage, before pre-release.
                is_internal_qa: true,
              }

              const { data: newProject, error: createError } = await supabase
                .from("projects")
                .insert(insertPayload)
                .select()
                .single()

              if (createError) {
                console.error(
                  "❌ Failed to auto-create project in database:",
                  createError,
                )
              } else {
                project = newProject
                console.log(
                  `✅ Successfully auto-created new QACC project: ${project.name} (ID: ${project.id})`,
                )
              }
            }
          }

          if (project) {
            console.log(
              `✅ Proceeding with QACC project: ${project.name} (ID: ${project.id})`,
            )

            // Backfill site URL from TED only while it's still the placeholder,
            // so a URL a human set intentionally is never clobbered.
            if (tedSiteUrl) {
              const current = (project.site_url || "").trim()
              const isPlaceholder =
                !current || /qacctest\.gogroth\.com/i.test(current)
              if (isPlaceholder && current !== tedSiteUrl) {
                const { data: upd, error: updErr } = await supabase
                  .from("projects")
                  .update({ site_url: tedSiteUrl })
                  .eq("id", project.id)
                  .select()
                  .single()
                if (updErr) {
                  console.error("❌ Failed to backfill project site_url:", updErr)
                } else if (upd) {
                  project = upd
                  console.log(
                    `✅ Backfilled project site_url: "${current || "(empty)"}" -> "${tedSiteUrl}"`,
                  )
                }
              }
            }

            // Shift the project into the internal-QA stage (only when not
            // already there). The three stages are mutually exclusive, so we
            // clear pre/post at the same time (mirrors the post-release
            // transition which clears pre and sets post).
            if (!project.is_internal_qa) {
              const { data: preUpd, error: preErr } = await supabase
                .from("projects")
                .update({
                  is_internal_qa: true,
                  is_pre_release: false,
                  is_post_release: false,
                })
                .eq("id", project.id)
                .select()
                .single()
              if (preErr) {
                console.error("❌ Failed to mark project as internal-QA:", preErr)
              } else if (preUpd) {
                project = preUpd
                console.log(`✅ Marked project "${project.name}" as internal-QA.`)
              }
            }

            // Resolve the run creator: real TED assignee, else ghost user,
            // else any user in the org.
            let runCreatorId: string | null = null
            const assigneeName = task.assignee || "TED System"
            const { data: existingUser } = await supabase
              .from("users")
              .select("id")
              .ilike("full_name", assigneeName)
              .eq("org_id", project.org_id)
              .limit(1)
              .single()
            if (existingUser?.id) {
              runCreatorId = existingUser.id
            } else {
              console.log(
                `👤 Assignee "${assigneeName}" not found in QACC. Auto-creating a ghost user...`,
              )
              const safeEmail = `${assigneeName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "ted"}-${Date.now()}@ted.internal`
              const { data: newUser, error: ghostErr } = await supabase
                .from("users")
                .insert({
                  id: randomUUID(),
                  clerk_user_id: `ghost_${Date.now()}`,
                  clerk_id: `ghost_${Date.now()}`,
                  full_name: assigneeName,
                  email: safeEmail,
                  org_id: project.org_id,
                  role: "qa_engineer",
                })
                .select("id")
                .single()
              if (ghostErr) {
                console.error("❌ Ghost user creation failed in Supabase:", ghostErr)
              } else if (newUser?.id) {
                runCreatorId = newUser.id
              }
            }
            if (!runCreatorId) {
              const { data: adminUser } = await supabase
                .from("users")
                .select("id")
                .eq("org_id", project.org_id)
                .limit(1)
                .single()
              runCreatorId = adminUser?.id || null
            }

            // Dedupe guard: QACC writes "In Progress" back to TED, which can
            // re-fire this webhook. Skip if a run for this target task was
            // created within TED_RUN_DEDUPE_HOURS (default 6).
            if (targetTaskId) {
              const dedupeHours = Number(process.env.TED_RUN_DEDUPE_HOURS || 6)
              const since = new Date(
                Date.now() - dedupeHours * 3600 * 1000,
              ).toISOString()
              const { data: recentRuns } = await supabase
                .from("qa_runs")
                .select("id, created_at")
                .eq("ted_task_id", String(targetTaskId))
                .gte("created_at", since)
                .limit(1)
              if (recentRuns && recentRuns.length > 0) {
                console.log(
                  `[TED internal-QA] Duplicate suppressed: run ${recentRuns[0].id} already exists for TED task ${targetTaskId} within ${dedupeHours}h`,
                )
                return res.status(200).json({
                  status: "duplicate_suppressed",
                  existingRunId: recentRuns[0].id,
                })
              }
            }

            // Create the internal QA run against the beta site. enabled_checks
            // are the checks that mapped to a discovered subtask (mirroring
            // TED's checklist), or the full internal-QA suite as a fallback.
            // ted_subtask_map lets the worker report each check's result back to
            // its own subtask. run_type "internal_qa" only labels the run — the
            // worker dispatches on enabled_checks, not run_type.
            const { data: run, error: runError } = await supabase
              .from("qa_runs")
              .insert({
                project_id: project.id,
                run_type: "internal_qa",
                // Scan target = the TED beta_site.env URL when its URL+repo pair
                // is usable, else the local fallback (:9400 + AI_FIX_LOCAL_REPO).
                // The project's stored site_url is deliberately NOT consulted —
                // what gets scanned is what THIS webhook resolves, independent of
                // whatever URL happens to be saved under the project's name.
                site_url: tedSiteUrl || TED_FALLBACK_SITE_URL,
                enabled_checks: internalQaChecks,
                ted_subtask_map: tedSubtaskMap,
                device_matrix: ["desktop"],
                status: "running",
                created_by: runCreatorId,
                ted_task_id: targetTaskId ? String(targetTaskId) : null,
              })
              .select()
              .single()

            if (runError) {
              console.error("❌ Failed to create internal-QA QA Run:", runError)
            } else if (run) {
              createdRunId = run.id
              console.log(
                `🚀 Created internal-QA QA Run ${run.id}! Adding to worker queue...`,
              )
              try {
                const { addRunJob } = require("../lib/queue")
                await addRunJob(run.id)
                console.log(
                  `✅ Internal QA scan for ${project.name} is now STARTING in the background!`,
                )
              } catch (queueErr) {
                console.error("❌ Failed to add run to worker queue:", queueErr)
              }
            }
          }
        } else {
          console.log(
            "⚠️ No clientName in payload — cannot match a QACC project.",
          )
        }

        // Talk back to the beta_site.internal_test target task (NOT the
        // beta_site.seo trigger): mark In Progress + confirmation comment.
        const taskId = targetTaskId
        const apiToken = process.env.TED_API_TOKEN

        if (!taskId) {
          console.log(
            "⚠️ Could not resolve the beta_site.internal_test task — skipping TED talk-back (won't post to the trigger task).",
          )
        }

        // Only mark In Progress when the scan actually started. QACC never
        // marks it Complete — a human closes it out after the manual work.
        if (createdRunId && taskId && apiToken) {
          console.log(
            `🔄 Marking TED Task #${taskId} as "In Progress" (internal QA scan started)...`,
          )
          await setTedTaskStatus(taskId, "In Progress", apiToken, createdRunId)
        }

        // Mark each mapped subtask "In Progress" too, so the whole checklist
        // reflects that QACC picked it up. Per-subtask results + final status
        // are written by the worker when the run completes (tedSync).
        if (createdRunId && apiToken) {
          // A check can map to several subtasks, so flatten + de-dupe the ids.
          const subtaskIds = [...new Set(Object.values(tedSubtaskMap).flat())]
          for (const subId of subtaskIds) {
            await setTedTaskStatus(subId, "In Progress", apiToken, createdRunId)
          }
        }

        if (taskId) {
          console.log(
            `💬 Sending internal-QA confirmation comment to TED Task #${taskId}...`,
          )
          await postTedComment(
            taskId,
            "Received the beta site SEO completion signal and started internal QA testing of the beta site.",
            `ext:qacc-internal-qa-received-${taskId}`,
            createdRunId,
          )
        }
      } else {
        console.log(
          `ℹ️ Internal-QA endpoint ignored event (templateKey="${task.templateKey}", status="${task.status}"). Acts only on ${INTERNAL_QA_TRIGGER_TEMPLATE_KEY} → Complete/Completed, or ${INTERNAL_QA_TARGET_TEMPLATE_KEY} → Not Started.`,
        )
      }

      // Record outcome on the audit row.
      if (webhookEventId) {
        try {
          await supabase
            .from("ted_webhook_events")
            .update({
              triggered_run: !!createdRunId,
              qa_run_id: createdRunId,
            })
            .eq("id", webhookEventId)
        } catch (updErr) {
          console.error(
            "⚠️ Failed to update internal-QA webhook event outcome:",
            updErr,
          )
        }
      }

      console.log("✅ Internal-QA webhook successfully processed")
      return res.status(200).json({
        status: 200,
        statusText: "OK",
        message: "Internal-QA webhook payload received and processed successfully",
        timestamp: new Date().toISOString(),
        data: {
          acknowledged: true,
          workflowId: "qacc-ted-internal-qa",
          executionId: targetTaskId || "unknown",
          // The QACC run this trigger started (null if no run was created). TED
          // stores this to later pause/resume/cancel the run via /webhooks/ted/*.
          qaRunId: createdRunId,
        },
      })
    } catch (error) {
      console.error("❌ Error processing internal-QA TED webhook:", error)
      if (webhookEventId) {
        try {
          await supabase
            .from("ted_webhook_events")
            .update({ error: String((error as Error)?.message || error) })
            .eq("id", webhookEventId)
        } catch {
          /* never let audit logging mask the original error */
        }
      }
      return res.status(400).json({ error: "Invalid payload format" })
    }
  },
)

// --- TED Webhook Receiver: POST-RELEASE ---
// POST /webhooks/ted/post-release
// Fires when a `release.security` task is marked Complete/Completed. It shifts
// the (already-existing) QACC project into the post-release stage and starts a
// post-release run of the automated General Checks. The scan URL is the client's
// LIVE site (from client notes), not the beta site.
webhookRouter.post(
  "/ted/post-release",
  async (req: Request, res: Response) => {
    console.log("\n--- INCOMING TED WEBHOOK (POST-RELEASE) ---")
    // console.log("Headers:", JSON.stringify(req.headers, null, 2)) // disabled: full headers leak x-ted-webhook-secret into logs

    // Hoisted so the catch block can record the outcome/error on the audit row.
    let webhookEventId: string | null = null
    let createdRunId: string | null = null
    // The scan task QACC operates on for post-release = release.qa_post (NOT the
    // release.security trigger). Resolved from the client's tasks below.
    let scanTaskId: string | null = null

    try {
      // 1. Read the body safely (Express may hand us a Buffer, object, or string)
      let payloadText = ""
      if (Buffer.isBuffer(req.body)) {
        payloadText = req.body.toString()
      } else if (
        typeof req.body === "object" &&
        Object.keys(req.body).length > 0
      ) {
        payloadText = JSON.stringify(req.body)
      } else {
        payloadText = String(req.body || "")
      }

      if (!payloadText || payloadText.trim() === "" || payloadText === "{}") {
        console.error("❌ Post-release webhook: empty body from TED")
        return res.status(400).json({ error: "Failed: No body received." })
      }

      console.log(
        "Raw Payload Received:",
        payloadText.substring(0, 300) + "...",
      )

      const payload = JSON.parse(payloadText)

      // Normalize (same shape as the pre-release endpoint).
      const task = payload.trigger || payload.data || {}
      const targetTask = payload.target || null
      const eventType = payload.event
      const actionableTaskId = targetTask?.id || task.id || null
      const clientName =
        task.clientName ||
        task.client_name ||
        task.client?.name ||
        payload.clientName ||
        payload.client?.name ||
        payload.client_name ||
        null

      // 2. Validate the shared secret (header or body).
      const secretFromHeader =
        req.headers["x-ted-webhook-secret"] || req.headers["x-webhook-secret"]
      const secretFromBody = payload?.headers?.["X-TED-Webhook-Secret"]
      const secret = secretFromHeader || secretFromBody
      const expectedSecret = process.env.TED_WEBHOOK_SECRET

      if (!expectedSecret) {
        console.log("❌ SERVER ERROR: TED_WEBHOOK_SECRET is missing!")
        return res.status(500).json({ error: "Server misconfigured" })
      }
      if (secret !== expectedSecret) {
        console.log("❌ Unauthorized post-release TED webhook attempt.")
        return res.status(401).json({ error: "Unauthorized: Invalid secret" })
      }

      // Health-check ping.
      if (eventType === "PING_TEST") {
        console.log(
          "🏓 Received TED PING_TEST (post-release) — connection healthy. Responding pong.",
        )
        return res.status(200).json({
          status: 200,
          statusText: "OK",
          message: "pong: QACC post-release webhook endpoint is alive",
          timestamp: new Date().toISOString(),
          data: { acknowledged: true, event: "PING_TEST" },
        })
      }

      console.log(
        `📥 Post-release event: ${eventType} | Task: ${task.title || "?"} (#${task.id}) | TemplateKey: ${task.templateKey || "?"} | Status: ${task.previousStatus || "?"} -> ${task.status} | Target: #${targetTask?.id || "none"}`,
      )

      // Audit the event (best-effort; never breaks processing).
      try {
        const { data: logRow, error: logErr } = await supabase
          .from("ted_webhook_events")
          .insert({
            event_type: eventType || null,
            source: payload.source || null,
            ted_task_id: task.id ? String(task.id) : null,
            template_key: task.templateKey || null,
            task_title: task.title || null,
            assignee: task.assignee || null,
            status: task.status || null,
            previous_status: task.previousStatus || null,
            target_task_id: targetTask?.id ? String(targetTask.id) : null,
            target_template_key: payload.targetTemplateKey || null,
            client_name: clientName,
            raw_payload: payload,
          })
          .select("id")
          .single()
        if (logErr) {
          console.error(
            "⚠️ Failed to persist post-release webhook event (continuing):",
            logErr,
          )
        } else {
          webhookEventId = logRow?.id || null
        }
      } catch (logErr) {
        console.error(
          "⚠️ Failed to persist post-release webhook event (continuing):",
          logErr,
        )
      }

      // 3. Gate: act on release.security → Complete/Completed, OR on the
      //    release.qa_post target task itself while still "Not Started" (a
      //    manual/test kick-off, same setting as internal QA / pre-release).
      const isSecurityTemplate = task.templateKey === "release.security"
      const isComplete =
        task.status === "Complete" || task.status === "Completed"

      // Direct trigger: the release.qa_post target task at Not Started.
      const isPostQaTarget = task.templateKey === "release.qa_post"
      const isNotStarted = task.status === "Not Started"

      if (
        (eventType === "TASK_UPDATED" ||
          eventType === "TASK_STATUS_CHANGED") &&
        ((isSecurityTemplate && isComplete) ||
          (isPostQaTarget && isNotStarted))
      ) {
        console.log(
          isPostQaTarget && isNotStarted
            ? "✅ release.qa_post direct trigger (Not Started)! Shifting project to post-release and starting General Checks..."
            : "✅ release.security is Complete! Shifting project to post-release and starting General Checks...",
        )

        if (clientName) {
          // Resolve the LIVE site URL from the HubSpot client notes (via TED).
          // This is the canonical/expected final domain.
          const liveSiteUrl = await resolveClientNotesSiteUrlFromTED(
            task.clientId,
            clientName,
          )
          // Resolve the RELEASED URL from the release.security task's payload —
          // the live_site_link check asserts this matches the client-notes URL.
          const releasedUrl = await resolveReleasedUrlFromReleaseSecurity(
            task.id,
          )

          // Resolve the release.qa_post ("Complete QA post-release testing")
          // task — this is the scan task QACC talks back to, NOT the
          // release.security trigger. Fall back to the payload target if given.
          scanTaskId =
            (await resolveTaskIdByTemplateKeyFromTED(
              task.clientId,
              "release.qa_post",
              /post-?release testing/i,
            )) ||
            (targetTask?.id ? String(targetTask.id) : null)

          // The project must already exist in QACC (per requirement).
          const { data: project } = await supabase
            .from("projects")
            .select("*")
            .ilike("name", clientName)
            .single()

          if (!project) {
            console.log(
              `⚠️ No existing QACC project named "${clientName}" — skipping post-release run (project must already exist).`,
            )
          } else {
            console.log(
              `✅ Found QACC project: ${project.name} (ID: ${project.id})`,
            )

            // Shift the project into the post-release stage (+ live URL).
            // Clear both earlier-stage flags so stages stay mutually exclusive.
            const projectUpdate: any = {
              is_pre_release: false,
              is_internal_qa: false,
              is_post_release: true,
            }
            if (liveSiteUrl) projectUpdate.live_site_url = liveSiteUrl
            const { error: shiftErr } = await supabase
              .from("projects")
              .update(projectUpdate)
              .eq("id", project.id)
            if (shiftErr) {
              console.error(
                "❌ Failed to shift project to post-release:",
                shiftErr,
              )
            } else {
              console.log(
                `✅ Project "${project.name}" shifted to post-release${liveSiteUrl ? ` (live URL: ${liveSiteUrl})` : ""}.`,
              )
            }

            // Resolve the run creator: real TED assignee, else a ghost user,
            // else any user in the org.
            let runCreatorId: string | null = null
            const assigneeName = task.assignee || "TED System"
            const { data: existingUser } = await supabase
              .from("users")
              .select("id")
              .ilike("full_name", assigneeName)
              .eq("org_id", project.org_id)
              .limit(1)
              .single()
            if (existingUser?.id) {
              runCreatorId = existingUser.id
            } else {
              const safeEmail = `${assigneeName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "ted"}-${Date.now()}@ted.internal`
              const { data: newUser, error: ghostErr } = await supabase
                .from("users")
                .insert({
                  id: randomUUID(),
                  clerk_user_id: `ghost_${Date.now()}`,
                  clerk_id: `ghost_${Date.now()}`,
                  full_name: assigneeName,
                  email: safeEmail,
                  org_id: project.org_id,
                  role: "qa_engineer",
                })
                .select("id")
                .single()
              if (ghostErr) {
                console.error("❌ Ghost user creation failed:", ghostErr)
              } else if (newUser?.id) {
                runCreatorId = newUser.id
              }
            }
            if (!runCreatorId) {
              const { data: adminUser } = await supabase
                .from("users")
                .select("id")
                .eq("org_id", project.org_id)
                .limit(1)
                .single()
              runCreatorId = adminUser?.id || null
            }

            // Create the post-release run of the automated General Checks.
            // Post-release QA matrix (docs/qacc-postrelease-matrix.html), minus
            // the explicitly-skipped rows (two-way text, speed/perf, client
            // email, G99 contact form + chatbot/VC, backup size). Everything
            // below is credential-free / human-free.
            // TED-first resolution (post-release): the scan URL comes from the
            // release.security task (payload OR comment); the repo to fix is the
            // SAME beta_site.env repo (payload OR comment). Go real only when the
            // pair is usable — a released URL AND a clonable repo. Otherwise fall
            // back to the forced demo site (+ local fallback repo, no push).
            const postRepo = await resolveBetaSiteRepoFromTED(task.clientId)
            const postUsablePair =
              !!releasedUrl && (await isRepoClonable(postRepo))
            const runSiteUrl = postUsablePair
              ? (releasedUrl as string)
              : TED_FALLBACK_SITE_URL
            if (!postUsablePair)
              console.log(
                `ℹ️ post-release: pair not usable (releasedUrl=${releasedUrl || "none"}, repo=${postRepo || "none"}) → forcing demo site.`,
              )
            const { data: run, error: runError } = await supabase
              .from("qa_runs")
              .insert({
                project_id: project.id,
                run_type: "post_release",
                site_url: runSiteUrl,
                enabled_checks: [
                  "gsr_check", // row 01
                  "accessibility_check", // row 02
                  "spelling", // row 05 (Grammarly)
                  "grammar", // row 05 (Grammarly)
                  "live_site_link", // row 06
                  "functionality_check", // row 07
                  "cross_browser", // row 07 (live-site smoke)
                  "plugin_number", // row 12
                  "verify_plugin_updates", // row 13
                  "page_speed", // PageSpeed Insights (speed optimization)
                ],
                device_matrix: ["desktop"],
                status: "running",
                created_by: runCreatorId,
                ted_task_id: scanTaskId ? String(scanTaskId) : null,
                // live_site_link compares these two TED-sourced URLs:
                //   live_site_url    = HubSpot client-notes canonical domain
                //   released_site_url = URL released in the release.security task
                live_site_url: liveSiteUrl,
                released_site_url: releasedUrl,
              })
              .select()
              .single()

            if (runError) {
              console.error(
                "❌ Failed to create post-release QA Run:",
                runError,
              )
            } else if (run) {
              createdRunId = run.id
              console.log(
                `🚀 Created post-release QA Run ${run.id}! Adding to worker queue...`,
              )
              try {
                const { addRunJob } = require("../lib/queue")
                await addRunJob(run.id)
                console.log(
                  `✅ Post-release General Checks run for ${project.name} is now STARTING.`,
                )
              } catch (queueErr) {
                console.error("❌ Failed to add run to worker queue:", queueErr)
              }
            }
          }
        } else {
          console.log(
            "⚠️ No clientName in payload — cannot match a QACC project.",
          )
        }

        // Talk back to the release.qa_post scan task (NOT the release.security
        // trigger): mark In Progress + confirmation comment.
        const taskId = scanTaskId
        const apiToken = process.env.TED_API_TOKEN

        if (!taskId) {
          console.log(
            "⚠️ Could not resolve the release.qa_post task — skipping TED talk-back (won't post to the trigger task).",
          )
        }

        if (createdRunId && taskId && apiToken) {
          console.log(
            `🔄 Marking TED Task #${taskId} as "In Progress" (post-release scan started)...`,
          )
          await setTedTaskStatus(taskId, "In Progress", apiToken, createdRunId)
        }

        if (taskId) {
          console.log(
            `💬 Sending post-release confirmation comment to TED Task #${taskId}...`,
          )
          await postTedComment(
            taskId,
            "Received the post-release signal and started the General Checks. ✅",
            `ext:qacc-postrelease-received-${taskId}`,
            createdRunId,
          )
        }
      } else {
        console.log(
          `ℹ️ Post-release endpoint ignored event (templateKey="${task.templateKey}", status="${task.status}"). Acts only on release.security → Complete/Completed, or release.qa_post → Not Started.`,
        )
      }

      // Record outcome on the audit row.
      if (webhookEventId) {
        try {
          await supabase
            .from("ted_webhook_events")
            .update({
              triggered_run: !!createdRunId,
              qa_run_id: createdRunId,
            })
            .eq("id", webhookEventId)
        } catch (updErr) {
          console.error(
            "⚠️ Failed to update post-release webhook event outcome:",
            updErr,
          )
        }
      }

      console.log("✅ Post-release webhook successfully processed")
      return res.status(200).json({
        status: 200,
        statusText: "OK",
        message: "Post-release webhook payload received and processed successfully",
        timestamp: new Date().toISOString(),
        data: {
          acknowledged: true,
          workflowId: "qacc-ted-post-release",
          executionId: actionableTaskId || "unknown",
          // The QACC run this trigger started (null if no run was created). TED
          // stores this to later pause/resume/cancel the run via /webhooks/ted/*.
          qaRunId: createdRunId,
        },
      })
    } catch (error) {
      console.error("❌ Error processing post-release TED webhook:", error)
      if (webhookEventId) {
        try {
          await supabase
            .from("ted_webhook_events")
            .update({ error: String((error as Error)?.message || error) })
            .eq("id", webhookEventId)
        } catch {
          /* never let audit logging mask the original error */
        }
      }
      return res.status(400).json({ error: "Invalid payload format" })
    }
  },
)

// ============================================================================
// TED Webhook Receivers: RUN CONTROL (pause / resume / cancel)
// ----------------------------------------------------------------------------
// Let TED's admin drive a live QACC run the same way the QACC web UI does
// (Pause / Resume / Cancel), but authenticated by the shared TED webhook secret
// instead of a Clerk login. They call the shared runControl engine, which is the
// SAME transition + resume machinery behind PATCH /api/runs/:id/status — so the
// worker already obeys the resulting status (startRunJob + crawlPageJob bail on
// paused/cancelled; resume re-enqueues the unfinished pages).
//
// A run is addressed by its `runId` (the qa_run UUID). TED receives this id as
// `data.qaRunId` in the trigger response (see the three receivers above).
//
//   POST /webhooks/ted/pause    { runId }  running                 -> paused
//   POST /webhooks/ted/resume   { runId }  paused                  -> running
//   POST /webhooks/ted/cancel   { runId }  pending/running/paused  -> cancelled
//
// Auth: X-TED-Webhook-Secret header (or body.headers["X-TED-Webhook-Secret"]),
// identical to the trigger receivers.
// ============================================================================

// Parse the body the same tolerant way the trigger receivers do (Buffer/obj/str).
function parseTedWebhookBody(reqBody: any): any {
  let payloadText = ""
  if (Buffer.isBuffer(reqBody)) payloadText = reqBody.toString()
  else if (
    typeof reqBody === "object" &&
    reqBody &&
    Object.keys(reqBody).length > 0
  )
    payloadText = JSON.stringify(reqBody)
  else payloadText = String(reqBody || "")
  if (!payloadText || payloadText.trim() === "" || payloadText === "{}")
    return null
  try {
    return JSON.parse(payloadText)
  } catch {
    return null
  }
}

// Shared handler factory for the three control actions.
function makeRunControlHandler(
  action: "pause" | "resume" | "cancel",
  targetStatus: "paused" | "running" | "cancelled",
) {
  return async (req: Request, res: Response) => {
    console.log(
      `\n--- INCOMING TED WEBHOOK (RUN CONTROL: ${action.toUpperCase()}) ---`,
    )

    const payload = parseTedWebhookBody(req.body)
    if (!payload) {
      return res.status(400).json({ error: "Failed: No body received." })
    }

    // Auth — same secret check as the trigger receivers.
    const secretFromHeader =
      req.headers["x-ted-webhook-secret"] || req.headers["x-webhook-secret"]
    const secretFromBody = payload?.headers?.["X-TED-Webhook-Secret"]
    const secret = secretFromHeader || secretFromBody
    const expectedSecret = process.env.TED_WEBHOOK_SECRET
    if (!expectedSecret) {
      console.error(
        "❌ TED_WEBHOOK_SECRET missing — cannot process run control.",
      )
      return res.status(500).json({ error: "Server misconfigured" })
    }
    if (secret !== expectedSecret) {
      return res.status(401).json({ error: "Unauthorized: Invalid secret" })
    }

    // Health-check ping (same convention as the trigger receivers).
    if (payload.event === "PING_TEST") {
      return res.status(200).json({
        status: 200,
        statusText: "OK",
        message: `pong: QACC ${action} endpoint is alive`,
        timestamp: new Date().toISOString(),
        data: { acknowledged: true, event: "PING_TEST" },
      })
    }

    // Resolve the run id from several accepted shapes.
    const runId =
      payload.runId ||
      payload.qaRunId ||
      payload.data?.runId ||
      payload.data?.qaRunId ||
      payload.trigger?.runId ||
      null

    if (!runId) {
      return res.status(400).json({
        error:
          "Missing runId. Provide the qaRunId returned in the trigger response.",
      })
    }

    const result = await transitionRunStatus(String(runId), targetStatus)

    if (!result.ok) {
      const httpStatus =
        result.code === "not_found"
          ? 404
          : result.code === "invalid_transition"
            ? 409
            : 500
      console.warn(
        `⚠️ TED ${action} for run ${runId} rejected (${result.code}): ${result.error}`,
      )
      return res.status(httpStatus).json({
        status: httpStatus,
        statusText: result.code,
        error: result.error,
        data: {
          acknowledged: false,
          runId,
          action,
          fromStatus: result.fromStatus,
        },
      })
    }

    // Best-effort: mirror the action into the run's TED task as a comment.
    try {
      const { data: run } = await supabase
        .from("qa_runs")
        .select("ted_task_id")
        .eq("id", String(runId))
        .single()
      const tedTaskId = run?.ted_task_id
      if (tedTaskId) {
        const verb =
          action === "pause"
            ? "paused ⏸️"
            : action === "resume"
              ? "resumed ▶️"
              : "cancelled ⏹️"
        await postTedComment(
          tedTaskId,
          `The QA run was ${verb} from TED.`,
          `ext:qacc-run-${action}-${runId}`,
          String(runId),
        )
      }
    } catch (commentErr) {
      console.error(
        `⚠️ Failed to post TED ${action} comment (continuing):`,
        commentErr,
      )
    }

    console.log(
      `✅ TED ${action}: run ${runId} ${result.fromStatus} -> ${result.toStatus}`,
    )
    return res.status(200).json({
      status: 200,
      statusText: "OK",
      message: `Run ${action} processed successfully`,
      timestamp: new Date().toISOString(),
      data: {
        acknowledged: true,
        runId,
        action,
        fromStatus: result.fromStatus,
        toStatus: result.toStatus,
      },
    })
  }
}

webhookRouter.post("/ted/pause", makeRunControlHandler("pause", "paused"))
webhookRouter.post("/ted/resume", makeRunControlHandler("resume", "running"))
webhookRouter.post("/ted/cancel", makeRunControlHandler("cancel", "cancelled"))
