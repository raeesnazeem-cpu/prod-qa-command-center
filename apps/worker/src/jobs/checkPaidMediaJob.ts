import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { decrypt } from "@qacc/shared/encryption"
import axios from "axios"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function processCheckPaidMediaJob(job: Job) {
  const { runId, projectId, isRetry } = job.data

  if (!runId || !projectId) {
    throw new Error("Missing required data for checkPaidMedia job")
  }

  logger.info({ runId, projectId }, "Processing paid media check job")

  // --- START OF ACCURATE PROGRESS REPORTING SETUP ---
  const ALL_PAGE_CHECKS = [
    "visual_regression",
    "accessibility",
    "performance",
    "spelling",
    "console_errors",
    "seo",
    "dummy_content",
    "dead_links",
    "url_matching",
    "privacy_policy",
    "callnow_links",
    "hero_media",
    "footer_logo",
    "single_script",
    "top_bar_sticky",
    "favicon",
    "contact_form",
    "chatbot_consultation",
    "text_share",
  ]

  const { data: runConfig } = await supabase
    .from("qa_runs")
    .select("enabled_checks")
    .eq("id", runId)
    .single()

  const isApiOnly = !runConfig?.enabled_checks?.some((c: string) =>
    ALL_PAGE_CHECKS.includes(c),
  )

  const { data: firstPage } = await supabase
    .from("pages")
    .select("id")
    .eq("run_id", runId)
    .limit(1)
    .single()

  const pageId = firstPage?.id

  if (!pageId) {
    logger.warn({ runId }, "No pages found for run. Skipping.")
    return
  }

  // Reset the placeholder page to processing so the UI progress bar starts accurately
  if (isApiOnly) {
    await supabase
      .from("pages")
      .update({
        status: "processing",
        progress: 0,
        current_step: "Initializing paid media check...",
      })
      .eq("id", pageId)
  }

  const updateProgress = async (progress: number, step: string) => {
    if (pageId && isApiOnly) {
      await supabase
        .from("pages")
        .update({ progress, current_step: step })
        .eq("id", pageId)
    }
    const channel = supabase.channel(`run:${runId}`)
    await channel.send({
      type: "broadcast",
      event: "page_progress",
      payload: { pageId, progress, current_step: step },
    })
  }
  // --- END OF ACCURATE PROGRESS REPORTING SETUP ---

  const findings: any[] = []

  // Wrap everything in try/catch to gracefully handle errors without crashing the queue
  try {
    if (isApiOnly) await updateProgress(10, "Fetching Basecamp credentials...")

    const { data: projectSettings, error: settingsError } = await supabase
      .from("project_settings")
      .select(
        "basecamp_token_encrypted, basecamp_account_id, basecamp_project_id",
      )
      .eq("project_id", projectId)
      .single()

    if (settingsError || !projectSettings) {
      throw new Error(
        `Failed to fetch project settings: ${settingsError?.message || "No settings found"}`,
      )
    }

    const {
      basecamp_token_encrypted,
      basecamp_account_id,
      basecamp_project_id,
    } = projectSettings

    if (
      !basecamp_token_encrypted ||
      !basecamp_account_id ||
      !basecamp_project_id
    ) {
      logger.warn(
        { projectId },
        "Basecamp credentials missing. Skipping paid media check.",
      )
      if (isApiOnly) await updateProgress(100, "Skipped (No credentials)")
      
      findings.push({
        check_factor: "paid_media",
        severity: "medium",
        title: "Paid Media Check Skipped",
        description: "Basecamp credentials are not configured for this project. Please configure Basecamp settings to enable this check.",
        status: "open",
        ai_generated: false,
      })
      // We don't return here so the run completion block at the bottom executes!
    } else {
      let decryptedToken: string
      try {
        decryptedToken = decrypt(basecamp_token_encrypted)
      } catch (err: any) {
        throw new Error(`Failed to decrypt token: ${err.message}`)
      }

      const headers = {
        Authorization: `Bearer ${decryptedToken}`,
        "User-Agent": "QACC (raees.nazeem@growth99.com)",
        "Content-Type": "application/json",
        Accept: "application/json",
      }

      if (isApiOnly)
        await updateProgress(30, "Fetching Basecamp bucket data...")
      const bucketUrl = `https://3.basecampapi.com/${basecamp_account_id}/buckets/${basecamp_project_id}.json`
      const bucketResponse = await axios.get(bucketUrl, { headers })
      const bucketData = bucketResponse.data

      const keywords = [
        "google ads",
        "facebook ads",
        "campaign started",
        "paid media",
      ]
      let foundCampaign = false
      let matchedItem = ""

      if (isApiOnly) await updateProgress(50, "Scanning Message Boards...")
      const messageBoardTool = bucketData.dock?.find(
        (tool: any) =>
          tool.title === "Message Board" ||
          tool.url?.includes("/message_boards/"),
      )

      if (messageBoardTool) {
        const messagesUrl = messageBoardTool.url.replace(
          ".json",
          "/messages.json",
        )
        const messagesResponse = await axios.get(messagesUrl, { headers })
        const messages = messagesResponse.data || []

        for (const msg of messages) {
          const textToScan =
            `${msg.subject || ""} ${msg.title || ""} ${msg.excerpt || ""}`.toLowerCase()
          if (keywords.some((kw) => textToScan.includes(kw))) {
            foundCampaign = true
            matchedItem = `Message Board post: "${msg.subject || msg.title}"`
            break
          }
        }
      }

      if (!foundCampaign) {
        if (isApiOnly) await updateProgress(70, "Scanning To-Do Lists...")
        const todosTool = bucketData.dock?.find(
          (tool: any) => tool.type === "todoset" || tool.title === "To-dos",
        )

        if (todosTool) {
          const listsUrl = todosTool.url.replace(".json", "/todolists.json")
          const listsResponse = await axios.get(listsUrl, { headers })
          const lists = listsResponse.data || []

          for (const list of lists) {
            const listTitle = (list.name || "").toLowerCase()
            if (keywords.some((kw) => listTitle.includes(kw))) {
              foundCampaign = true
              matchedItem = `To-Do List: "${list.name}"`
              break
            }

            if (list.todos_url) {
              const todosResponse = await axios.get(list.todos_url, { headers })
              const todos = todosResponse.data || []
              for (const todo of todos) {
                const todoContent =
                  `${todo.content || ""} ${todo.description || ""}`.toLowerCase()
                if (keywords.some((kw) => todoContent.includes(kw))) {
                  foundCampaign = true
                  matchedItem = `To-Do Item: "${todo.content}"`
                  break
                }
              }
            }
            if (foundCampaign) break
          }
        }
      }

      if (isApiOnly) await updateProgress(90, "Finalizing findings...")
      if (foundCampaign) {
        findings.push({
          check_factor: "paid_media",
          severity: "low",
          title: "Paid Media Campaign Active",
          description: `Verified: A Paid Media campaign was successfully found on Basecamp! Matched ${matchedItem}.`,
          status: "open",
          ai_generated: false,
        })
      } else {
        findings.push({
          check_factor: "paid_media",
          severity: "high",
          title: "Paid Media Campaign Not Found",
          description: `We checked the Basecamp project but could not find an active or created Google/Facebook Ads campaign. @Pankhila Kamble @Trixie Kate please provide details if campaign created for Google and Facebook ADS and all services created under campaign`,
          status: "open",
          ai_generated: false,
        })
      }
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "Error in Basecamp Paid Media check")
    findings.push({
      check_factor: "paid_media",
      severity: "medium",
      title: "Paid Media Check Error",
      description: `Failed to fetch details from Basecamp: ${error.message}. @Pankhila Kamble @Trixie Kate please provide details if campaign created for Google and Facebook ADS and all services created under campaign`,
      status: "open",
      ai_generated: false,
    })
  }

  if (isApiOnly) await updateProgress(100, "Done")

  if (findings.length > 0) {
    const findingsWithIds = findings.map((f) => ({
      ...f,
      page_id: pageId,
      run_id: runId,
    }))
    await supabase.from("findings").insert(findingsWithIds)
  }

  // Broadcast
  const progressChannel = supabase.channel(`run:${runId}`)
  await progressChannel.send({
    type: "broadcast",
    event: "progress",
    payload: { status: "done", message: "Paid media check completed" },
  })

  // Mark completion if needed
  const { data: runData } = await supabase
    .from("qa_runs")
    .select("enabled_checks, pages_total")
    .eq("id", runId)
    .single()
  const PAGE_CHECKS = [
    "visual_regression",
    "accessibility",
    "performance",
    "spelling",
    "console_errors",
    "seo",
    "dummy_content",
    "dead_links",
    "url_matching",
    "privacy_policy",
    "callnow_links",
    "hero_media",
    "footer_logo",
    "single_script",
    "top_bar_sticky",
    "favicon",
    "contact_form",
    "chatbot_consultation",
    "text_share",
  ]
  const needsPageScan = runData?.enabled_checks?.some((c: string) =>
    PAGE_CHECKS.includes(c),
  )
  if (!needsPageScan && !isRetry) {
    const { qaQueue } = require("../lib/queue")
    await supabase
      .from("qa_runs")
      .update({
        status: "completed",
        pages_processed: runData?.pages_total || 0,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
    qaQueue.add("generate_embeddings", { runId }).catch(() => {})
  }
}
