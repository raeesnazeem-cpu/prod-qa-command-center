import { Router, Request, Response } from "express"
import { Webhook } from "svix"
import { supabase } from "../lib/supabase"
import { logger } from "../lib/logger"
import { randomUUID } from "crypto"

export const webhookRouter: Router = Router()

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || ""

// Placeholder used only when we cannot determine a client's real site URL.
const TED_FALLBACK_SITE_URL = "http://qacctest.gogroth.com"

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
      const m = payload.match(/betaSiteUrl=(\S+)/i)
      if (m && m[1]) {
        const url = m[1].replace(/[.,;)]+$/, "")
        console.log(
          `✅ Resolved beta site URL from TED (task #${id}): ${url}`,
        )
        return url
      }
      console.log(
        `⚠️ beta_site.env task #${id} has no betaSiteUrl in automation.payload yet.`,
      )
    }
    return null
  } catch (err) {
    console.error("❌ Error resolving beta site URL from TED:", err)
    return null
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
): Promise<boolean> {
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
  console.log("Headers:", req.headers)
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
  console.log("Headers:", JSON.stringify(req.headers, null, 2))

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
      if (
        task.status === "Ready to Release" ||
        task.status === "Ready for Release" ||
        task.status === "In Progress" ||
        task.status === "Complete" ||
        task.status === "Completed"
      ) {
        console.log(
          "✅ Trigger task is Complete / Ready to Release / In Progress! Triggering QACC pre-release workflow...",
        )
        console.log("Task Data:", task)

        // --- MATCH PROJECT & START QA RUN ---
        if (clientName) {
          console.log(
            `🔍 Looking up QACC project matching name: "${clientName}"`,
          )

          // Resolve the beta site URL to scan from TED once — used both to
          // auto-create a new project and to backfill an existing one.
          const tedSiteUrl = await resolveBetaSiteUrlFromTED(task.clientId)

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
            // so the project is now in the pre-release QA stage). Only write
            // when it isn't already set, to avoid a redundant update.
            if (!project.is_pre_release) {
              const { data: preUpd, error: preErr } = await supabase
                .from("projects")
                .update({ is_pre_release: true })
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

            // 3. Create the new QA Run in the database
            const { data: run, error: runError } = await supabase
              .from("qa_runs")
              .insert({
                project_id: project.id,
                run_type: "pre_release",
                site_url:
                  project.site_url || tedSiteUrl || TED_FALLBACK_SITE_URL, // Run needs a URL to crawl
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
          try {
            console.log(
              `🔄 Marking TED Task #${taskId} as "In Progress" (QACC scan started)...`,
            )
            const statusRes = await fetch(
              `https://ted.growth99.com/api/tasks/${taskId}/status`,
              {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${apiToken}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: "In Progress" }),
              },
            )
            // Same caveat as comments: TED's SSR returns app-shell HTML with a
            // 200 when the task id can't be resolved. Only a JSON body means the
            // status update actually reached the API.
            const ct = statusRes.headers.get("content-type") || ""
            if (statusRes.ok && ct.includes("application/json")) {
              console.log(
                `✅ TED Task #${taskId} marked "In Progress".`,
              )
            } else {
              const preview = (await statusRes.text().catch(() => "")).slice(
                0,
                200,
              )
              console.error(
                `❌ Failed to set status on TED task #${taskId}: response was not JSON (HTTP ${statusRes.status}, content-type "${ct}"). The task id likely does not resolve on TED. Body preview: ${preview}`,
              )
            }
          } catch (statusErr) {
            console.error(
              "❌ Error calling TED API to set task status:",
              statusErr,
            )
          }
        }

        if (taskId) {
          console.log(
            `💬 Sending confirmation comment back to TED Task #${taskId}...`,
          )
          await postTedComment(
            taskId,
            "QACC successfully received the release request and the automated connection is active! 🚀",
            `ext:qacc-prerelease-received-${taskId}`,
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
    console.log("Headers:", JSON.stringify(req.headers, null, 2))

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

      // 3. Gate: only act on release.security transitioning to Complete/Completed.
      const isSecurityTemplate = task.templateKey === "release.security"
      const isComplete =
        task.status === "Complete" || task.status === "Completed"

      if (
        (eventType === "TASK_UPDATED" ||
          eventType === "TASK_STATUS_CHANGED") &&
        isSecurityTemplate &&
        isComplete
      ) {
        console.log(
          "✅ release.security is Complete! Shifting project to post-release and starting General Checks...",
        )

        if (clientName) {
          // Resolve the LIVE site URL from client notes.
          const liveSiteUrl = await resolveClientNotesSiteUrlFromTED(
            task.clientId,
            clientName,
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
            const projectUpdate: any = {
              is_pre_release: false,
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
            // (Only gsr_check runs automatically today; the manual General
            // Checks are added later.)
            const runSiteUrl =
              liveSiteUrl ||
              project.live_site_url ||
              project.site_url ||
              TED_FALLBACK_SITE_URL
            const { data: run, error: runError } = await supabase
              .from("qa_runs")
              .insert({
                project_id: project.id,
                run_type: "post_release",
                site_url: runSiteUrl,
                enabled_checks: [
                  "gsr_check",
                  "spelling",
                  "grammar",
                  "accessibility_check",
                ],
                device_matrix: ["desktop"],
                status: "running",
                created_by: runCreatorId,
                ted_task_id: scanTaskId ? String(scanTaskId) : null,
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
          try {
            console.log(
              `🔄 Marking TED Task #${taskId} as "In Progress" (post-release scan started)...`,
            )
            const statusRes = await fetch(
              `https://ted.growth99.com/api/tasks/${taskId}/status`,
              {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${apiToken}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: "In Progress" }),
              },
            )
            const ct = statusRes.headers.get("content-type") || ""
            if (statusRes.ok && ct.includes("application/json")) {
              console.log(`✅ TED Task #${taskId} marked "In Progress".`)
            } else {
              const preview = (
                await statusRes.text().catch(() => "")
              ).slice(0, 200)
              console.error(
                `❌ Failed to set status on TED task #${taskId} (HTTP ${statusRes.status}, content-type "${ct}"). Body: ${preview}`,
              )
            }
          } catch (statusErr) {
            console.error("❌ Error calling TED API to set task status:", statusErr)
          }
        }

        if (taskId) {
          console.log(
            `💬 Sending post-release confirmation comment to TED Task #${taskId}...`,
          )
          await postTedComment(
            taskId,
            "QACC received the post-release signal and started the General Checks. ✅",
            `ext:qacc-postrelease-received-${taskId}`,
          )
        }
      } else {
        console.log(
          `ℹ️ Post-release endpoint ignored event (templateKey="${task.templateKey}", status="${task.status}"). Only release.security → Complete/Completed acts.`,
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
