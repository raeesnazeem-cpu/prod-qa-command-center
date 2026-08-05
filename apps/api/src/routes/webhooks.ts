import { Router, Request, Response } from "express"
import { Webhook } from "svix"
import { supabase } from "../lib/supabase"
import { logger } from "../lib/logger"
import { randomUUID } from "crypto"

export const webhookRouter: Router = Router()

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || ""

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
        task.status === "In Progress"
      ) {
        console.log(
          "✅ Project is marked as Ready to Release (or In Progress)! Triggering QACC pre-release workflow...",
        )
        console.log("Task Data:", task)

        // --- MATCH PROJECT & START QA RUN ---
        if (clientName) {
          console.log(
            `🔍 Looking up QACC project matching name: "${clientName}"`,
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
              let extractedUrl = null

              if (task.id && process.env.TED_API_TOKEN) {
                try {
                  console.log(
                    `🔍 Fetching task metadata from TED API to extract site URL...`,
                  )
                  const tedTaskRes = await fetch(
                    `https://ted.growth99.com/api/tasks/${task.id}`,
                    {
                      headers: {
                        Authorization: `Bearer ${process.env.TED_API_TOKEN}`,
                      },
                    },
                  )
                  if (tedTaskRes.ok) {
                    const tedTaskData = (await tedTaskRes.json()) as any
                    const notesStr =
                      tedTaskData?.client?.clientDetails?.notes || ""
                    const urlMatch = notesStr.match(/href="([^"]+)"/)
                    if (urlMatch && urlMatch[1]) {
                      extractedUrl = urlMatch[1]
                      console.log(
                        `✅ Extracted site URL from TED: ${extractedUrl}`,
                      )
                    }
                  }
                } catch (err) {
                  console.error(
                    "❌ Failed to fetch task metadata from TED API:",
                    err,
                  )
                }
              }

              const insertPayload: any = {
                name: clientName,
                client_name: clientName,
                org_id: orgData.org_id,
                status: "active",
                site_url: extractedUrl || "http://qacctest.gogroth.com",
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
                site_url: project.site_url || "http://qacctest.gogroth.com", // Run needs a URL to crawl
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

        // --- POST COMMENT BACK TO TED ---
        // Talk back to the target QA task when TED provided one, otherwise the
        // trigger task itself.
        const taskId = actionableTaskId
        const apiToken = process.env.TED_API_TOKEN

        if (taskId && apiToken) {
          try {
            console.log(
              `💬 Sending confirmation comment back to TED Task #${taskId}...`,
            )
            const tedResponse = await fetch(
              `https://ted.growth99.com/api/tasks/${taskId}/comments`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiToken}`,
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  text: "QACC successfully received the release request and the automated connection is active! 🚀",
                }),
              },
            )

            // A 2xx alone is NOT proof of success. TED's Angular SSR returns the
            // app-shell HTML with HTTP 200 when the task id can't be resolved
            // (deleted task, subtask, or a test/clone id). Only a JSON body means
            // the comment actually reached the API and was created.
            const contentType = tedResponse.headers.get("content-type") || ""
            if (tedResponse.ok && contentType.includes("application/json")) {
              console.log(
                "✅ Successfully posted confirmation comment back to TED!",
              )
            } else {
              const bodyPreview = (
                await tedResponse.text().catch(() => "")
              ).slice(0, 200)
              console.error(
                `❌ Failed to post comment to TED task #${taskId}: response was not JSON (HTTP ${tedResponse.status}, content-type "${contentType}"). The task id likely does not resolve on TED and the request fell through to the SPA. Body preview: ${bodyPreview}`,
              )
            }
          } catch (fetchErr) {
            console.error("❌ Error calling TED API for comment:", fetchErr)
          }
        } else {
          console.log(
            "⚠️ Could not post comment to TED: Either taskId is missing from payload, or TED_API_TOKEN is missing in your .env file!",
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
