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

    // 5. If the password is correct, we check what kind of event happened.
    if (
      payload.event === "TASK_UPDATED" ||
      payload.event === "TASK_STATUS_CHANGED"
    ) {
      if (
        payload.data?.status === "Ready to Release" ||
        payload.data?.status === "Ready for Release"
      ) {
        console.log(
          "✅ Project is marked as Ready to Release! Triggering QACC pre-release workflow...",
        )
        console.log("Project Data:", payload.data)

        // --- MATCH PROJECT & START QA RUN ---
        const clientName = payload.data?.clientName

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

              if (payload.data?.id && process.env.TED_API_TOKEN) {
                try {
                  console.log(
                    `🔍 Fetching task metadata from TED API to extract site URL...`,
                  )
                  const tedTaskRes = await fetch(
                    `https://ted.growth99.com/api/tasks/${payload.data.id}`,
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
            const assigneeName = payload.data?.assignee || "TED System"

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
                ted_task_id: payload.data?.id ? String(payload.data.id) : null,
              })
              .select()
              .single()

            if (runError) {
              console.error("❌ Failed to create QA Run in database:", runError)
            } else if (run) {
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
        const taskId = payload.data?.id
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

            if (tedResponse.ok) {
              console.log(
                "✅ Successfully posted confirmation comment back to TED!",
              )
            } else {
              console.error(
                "❌ Failed to post comment back to TED. HTTP Status:",
                tedResponse.status,
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
        executionId: payload.data?.id || "unknown",
      },
    })
  } catch (error) {
    console.error("❌ Error parsing TED webhook payload:", error)
    return res.status(400).json({ error: "Invalid payload format" })
  }
})
