import { Job } from "bullmq"
import { chromium } from "playwright"
import { supabase } from "../lib/supabase"
import { qaQueue } from "../lib/queue"
import { checkBrokenLinks } from "../checks/brokenLinksCheck"
import { checkExternalLinks } from "../checks/externalLinkCheck"
import { checkMeta } from "../checks/metaCheck"
import { checkConsoleErrors } from "../checks/consoleErrorCheck"
import { checkDummyContent } from "../checks/dummyContentCheck"
import { checkImageCompliance } from "../checks/imageComplianceCheck"
import { checkHeroMedia } from "../checks/heroMediaCheck"
import { processCheckProjectPlanJob } from "./checkProjectPlanJob"
import { checkOptimizedLinks } from "../checks/optimizedLinksCheck"
import { checkGsr } from "../checks/gsrCheck"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function processRunChecksJob(job: Job) {
  const { runId, pageId, url: pageUrl } = job.data

  if (!runId || !pageId) {
    throw new Error("Missing runId or pageId for run_checks job")
  }

  logger.info({ runId, pageId, pageUrl }, "Starting checks for page")

  const updateProgress = async (progress: number, step: string) => {
    await supabase
      .from("pages")
      .update({ progress, current_step: step, status: "processing" })
      .eq("id", pageId)

    // Broadcast granular update
    const channel = supabase.channel(`run:${runId}`)
    await channel.send({
      type: "broadcast",
      event: "page_progress",
      payload: { pageId, progress, current_step: step },
    })
  }

  try {
    // Load page from DB to ensure we have the latest data
    const { data: page, error: pageError } = await supabase
      .from("pages")
      .select("*")
      .eq("id", pageId)
      .single()

    if (pageError || !page) {
      throw new Error(`Page not found: ${pageId}`)
    }

    let currentCheckProgress: Record<string, { progress: number; step: string; status?: string }> =
      page.check_progress || {}

    const updateCheckProgress = async (
      checkKey: string,
      progress: number,
      step: string,
      status: string = "running"
    ) => {
      currentCheckProgress[checkKey] = { progress, step, status }

      await supabase
        .from("pages")
        .update({ check_progress: currentCheckProgress })
        .eq("id", pageId)

      const progressChannel = supabase.channel(`run:${runId}`)
      await progressChannel.send({
        type: "broadcast",
        event: "page_progress",
        payload: {
          pageId,
          check_progress: currentCheckProgress,
        },
      })
    }

    await updateProgress(10, "Initializing quality checks...")

    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    })

    try {
      const context = await browser.newContext()
      const playwrightPage = await context.newPage()

      // Initialize Playwright page with console listener (via checkConsoleErrors internal setup if needed,
      // or explicit here as per prompt "console listener must be attached before page.goto()")
      const consoleErrors: string[] = []
      const criticalErrors: string[] = []

      playwrightPage.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text())
      })

      playwrightPage.on("pageerror", (err) => {
        criticalErrors.push(err.message)
      })

      await updateProgress(30, "Navigating to page...")
      await playwrightPage.goto(pageUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      })

      await updateProgress(60, "Running automated audits...")

      // Before running checks, fetch enabled_checks from the run:
      const { data: run } = await supabase
        .from("qa_runs")
        .select("enabled_checks, project_id, run_type")
        .eq("id", runId)
        .single()

      const checksToRun = job.data.overrideChecks || run?.enabled_checks || []
      const checkPromises: Promise<any[]>[] = []

      if (checksToRun.includes("visual_regression")) {
        checkPromises.push(checkBrokenLinks(playwrightPage, page))
        checkPromises.push(checkExternalLinks(playwrightPage, page))
        checkPromises.push(checkImageCompliance(playwrightPage, page))
      }

      if (checksToRun.includes("accessibility")) {
        checkPromises.push(checkMeta(playwrightPage, page))
        checkPromises.push(checkDummyContent(playwrightPage, page))
      }

      if (checksToRun.includes("console_errors")) {
        checkPromises.push(checkConsoleErrors(playwrightPage, page))
      }

      if (checksToRun.includes("hero_media")) {
        checkPromises.push(
          checkHeroMedia(playwrightPage, page, async (p, m) => {
            await updateProgress(p, m)
          }),
        )
      }

      if (checksToRun.includes("dead_links")) {
        checkPromises.push(
          (async () => {
            try {
              const transport = new StdioClientTransport({
                command: "node",
                args: [
                  "/Users/ikkaavaforever/Documents/Work/react-projects/feature-mcp/packages/elementor-mcp/index.js",
                ],
              })
              const mcpClient = new Client(
                { name: "qacc-worker", version: "1.0.0" },
                { capabilities: {} },
              )
              await mcpClient.connect(transport)

              return await checkOptimizedLinks(
                playwrightPage,
                page,
                mcpClient,
                async (p, m) => {
                  await updateProgress(p, m)
                },
              )
            } catch (e) {
              logger.error("Dead links check failed:", e)
              return []
            }
          })(),
        )
      }

      if (checksToRun.includes("learn_more_buttons")) {
        checkPromises.push(
          (async () => {
            const { checkLearnMoreButtons } =
              await import("../checks/learnMoreButtonsCheck.js")
            return await checkLearnMoreButtons(
              pageUrl,
              runId,
              pageId,
              async (p, m) => {
                await updateProgress(p, m)
              },
            )
          })(),
        )
      }

      if (run?.run_type === "post_release") {
        checkPromises.push(
          checkGsr(playwrightPage, page, async (p, m) => {
            await updateCheckProgress("gsr_check", p, m)
          })
            .then((res) => {
              updateCheckProgress("gsr_check", 100, "Done", "done").catch(() => {})
              return res
            })
            .catch((err) => {
              updateCheckProgress("gsr_check", 100, `Failed: ${err.message}`, "failed").catch(() => {})
              throw err
            }),
        )
      }

      // Execute enabled checks in parallel
      const checkResults = await Promise.all(checkPromises)

      const allFindings = checkResults.flat().map((f) => ({
        ...f,
        page_id: pageId,
        run_id: runId,
      }))

      // Add condition to run checkProjectPlanJob if 'project_plan' is in enabled_checks
      if (checksToRun.includes("project_plan")) {
        await processCheckProjectPlanJob({
          data: { runId, projectId: run?.project_id },
        } as any).catch((e) => {
          logger.error(
            { error: e.message },
            "Failed to run checkProjectPlanJob",
          )
        })
      }

      if (allFindings.length > 0) {
        await updateProgress(80, `Saving ${allFindings.length} findings...`)
        const { error: insertError } = await supabase
          .from("findings")
          .insert(allFindings)

        if (insertError) {
          logger.error(
            { pageId, error: insertError.message },
            "Failed to insert findings",
          )
        }
      }

      await updateProgress(95, "Finalizing check results...")
    } finally {
      await browser.close()
    }

    // Mark as done
    await supabase
      .from("pages")
      .update({
        status: "done",
        progress: 100,
        current_step: "Checks complete",
      })
      .eq("id", pageId)

    const channel = supabase.channel(`run:${runId}`)
    await channel.send({
      type: "broadcast",
      event: "progress",
      payload: { pageId, status: "done" },
    })

    logger.info({ pageId }, "Checks completed successfully")
  } catch (error: any) {
    logger.error({ pageId, error: error.message }, "Error during page checks")
    await supabase
      .from("pages")
      .update({ status: "failed", current_step: `Error: ${error.message}` })
      .eq("id", pageId)
    throw error
  } finally {
    if (!job.data.overrideChecks) {
      // Step 6 & 7: Atomically increment pages_processed and check for run completion
      const { data: isComplete, error: rpcError } = await supabase.rpc(
        "increment_and_check_completion",
        { run_id_param: runId },
      )

      if (rpcError) {
        logger.warn(
          { runId, error: rpcError.message },
          "RPC increment_and_check_completion failed, falling back",
        )

        // Fallback: use old increment RPC
        await supabase.rpc("increment_pages_processed", { run_id_param: runId })

        // Fallback: check completion separately
        const { data: runCheck } = await supabase
          .from("qa_runs")
          .select("pages_processed, pages_total, status")
          .eq("id", runId)
          .single()

        if (
          runCheck &&
          runCheck.status === "running" &&
          runCheck.pages_total > 0 &&
          runCheck.pages_processed >= runCheck.pages_total
        ) {
          await supabase
            .from("qa_runs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
            })
            .eq("id", runId)

          logger.info({ runId }, "Run marked as completed (fallback)")
          
          await supabase.channel(`run:${runId}`).send({
            type: "broadcast",
            event: "progress",
            payload: { runId, status: "completed" },
          })

          qaQueue
            .add("generate_embeddings", { runId })
            .catch((e) =>
              logger.error("Failed to queue generate_embeddings:", e),
            )
        }
      } else if (isComplete) {
        logger.info({ runId }, "Run marked as completed")
        
        await supabase.channel(`run:${runId}`).send({
          type: "broadcast",
          event: "progress",
          payload: { runId, status: "completed" },
        })

        qaQueue
          .add("generate_embeddings", { runId })
          .catch((e) => logger.error("Failed to queue generate_embeddings:", e))
      }

      // Step 8: Broadcast progress update
      const finalChannel = supabase.channel(`run:${runId}`)
      await finalChannel.send({
        type: "broadcast",
        event: "progress",
        payload: {
          pageUrl,
          status: "done",
          pageId,
        },
      })
    }
  }
}
