import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { checkProjectPlan } from "../checks/projectPlanCheck"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function processCheckProjectPlanJob(job: Job) {
  const { runId, projectId, isRetry } = job.data

  if (!runId || !projectId) {
    throw new Error(
      "Missing required data for checkProjectPlan job (runId or projectId)",
    )
  }

  logger.info({ runId, projectId, isRetry }, "Processing project plan check job")

  // Resolve the TED client name from the project (project.name == TED clientName).
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single()
  const clientName = project?.name || ""

  // Step 2: Fetch the first page of the run to use as page_id for findings table constraint
  const { data: firstPage, error: pageError } = await supabase
    .from("pages")
    .select("id")
    .eq("run_id", runId)
    .limit(1)
    .single()

  const pageId = firstPage?.id
  if (!pageId) {
    logger.warn(
      { runId },
      "No pages found for this run, cannot associate findings. Skipping.",
    )
    return
  }

  // 1. Detect if this run is API-only (no web crawl)
  const PAGE_CHECKS = [
    "visual_regression",
    "accessibility",
    "console_errors",
    "performance",
    "seo",
    "spelling",
    "dummy_content",
    "image_compliance",
    "ai_content_audit",
    "hero_media",
    "dead_links",
    "footer_logo",
    "single_script",
    "top_bar_sticky",
    "favicon",
    "url_matching",
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
    PAGE_CHECKS.includes(c),
  )

  // 2. If API-only, reset the placeholder page to processing so the UI progress bar starts at 0%
  if (isApiOnly && pageId) {
    await supabase
      .from("pages")
      .update({
        status: "processing",
        progress: 0,
        current_step: "Initializing check...",
      })
      .eq("id", pageId)
  }

  const updateProgress = async (progress: number, step: string) => {
    // Only update the database progress if we own the page (API-only)
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

  // Step 3: Call the general check functions
  let findings: any[] = []
  try {
    // Fetch run to get site_url, enabled_checks and the resolved theme type
    const { data: run } = await supabase
      .from("qa_runs")
      .select("site_url, enabled_checks, theme_type")
      .eq("id", runId)
      .single()

    const enabledChecks = run?.enabled_checks || []

    // 1. Run Project Plan Check if enabled (reads plan from TED)
    if (enabledChecks.includes("project_plan")) {
      logger.info({ clientName }, "Calling checkProjectPlan (TED)")
      const planFindings = await checkProjectPlan(
        clientName,
        { id: pageId, siteUrl: run?.site_url, themeType: run?.theme_type },
        updateProgress,
      )
      findings = [...findings, ...planFindings]
    }
  } catch (checkErr: any) {
    logger.error(
      { error: checkErr.message },
      "Error during general checks execution",
    )
    throw checkErr
  }

  // Step 4: Save result to findings table
  if (findings && findings.length > 0) {
    const findingsWithIds = findings.map((finding) => ({
      ...finding,
      page_id: pageId,
      run_id: runId,
    }))

    logger.info(
      { count: findingsWithIds.length },
      "Inserting project plan findings into Supabase",
    )
    const { error: insertError } = await supabase
      .from("findings")
      .insert(findingsWithIds)

    if (insertError) {
      logger.error(
        { error: insertError.message },
        "Failed to insert project plan findings",
      )
      throw new Error(`Failed to save findings: ${insertError.message}`)
    }
  }

  if (isApiOnly && pageId) {
    await supabase
      .from("pages")
      .update({ status: "done", progress: 100 })
      .eq("id", pageId)
  }

  // Step 5: Broadcast progress update
  const progressChannel = supabase.channel(`run:${runId}`)
  await progressChannel.send({
    type: "broadcast",
    event: "progress",
    payload: {
      status: "done",
      message: "Project plan check completed",
    },
  })

  // Step 6: Mark run as completed if no page scan checks were enqueued
  const { data: runData } = await supabase
    .from("qa_runs")
    .select("enabled_checks, pages_total")
    .eq("id", runId)
    .single()

  const needsPageScan = runData?.enabled_checks?.some((c: string) =>
    PAGE_CHECKS.includes(c),
  )

  if (!needsPageScan && !isRetry) {
    await supabase
      .from("qa_runs")
      .update({
        status: "completed",
        pages_processed: runData?.pages_total || 0,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)

    logger.info(
      { runId },
      "Run marked as completed after general check completion",
    )
  }

  logger.info({ runId }, "Project plan check job completed successfully")
}
