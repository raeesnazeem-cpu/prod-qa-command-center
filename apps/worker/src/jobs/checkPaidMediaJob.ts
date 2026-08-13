import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { checkPaidMedia } from "../checks/paidMediaCheck"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

// Page-scan checks — used only to decide whether THIS API-only job owns the
// progress bar and run-completion (it must not if a crawl is also running).
const PAGE_CHECKS = [
  "visual_regression", "accessibility", "performance", "spelling",
  "console_errors", "seo", "dummy_content", "dead_links", "url_matching",
  "privacy_policy", "callnow_links", "hero_media", "footer_logo",
  "single_script", "top_bar_sticky", "favicon", "contact_form",
  "chatbot_consultation", "text_share",
]

export async function processCheckPaidMediaJob(job: Job) {
  const { runId, projectId, isRetry } = job.data
  if (!runId || !projectId) {
    throw new Error("Missing required data for checkPaidMedia job")
  }
  logger.info({ runId, projectId }, "Processing paid media check job (TED)")

  const { data: runConfig } = await supabase
    .from("qa_runs")
    .select("enabled_checks")
    .eq("id", runId)
    .single()
  const isApiOnly = !runConfig?.enabled_checks?.some((c: string) =>
    PAGE_CHECKS.includes(c),
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

  if (isApiOnly) {
    await supabase
      .from("pages")
      .update({ status: "processing", progress: 0, current_step: "Reading paid media state from TED..." })
      .eq("id", pageId)
  }

  const updateProgress = async (progress: number, step: string) => {
    if (pageId && isApiOnly) {
      await supabase.from("pages").update({ progress, current_step: step }).eq("id", pageId)
    }
    await supabase.channel(`run:${runId}`).send({
      type: "broadcast",
      event: "page_progress",
      payload: { pageId, progress, current_step: step },
    })
  }

  // Resolve TED client name (project.name == TED clientName).
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single()
  const clientName = project?.name || ""

  let findings: any[] = []
  try {
    if (isApiOnly) await updateProgress(40, "Querying TED timeline...")
    findings = await checkPaidMedia(clientName)
  } catch (error: any) {
    logger.error({ error: error.message }, "Error in paid media check")
    findings = [
      {
        check_factor: "paid_media",
        title: "Paid Media Check Error",
        description: `Failed to evaluate paid media from TED: ${error.message}`,
        status: "open",
        ai_generated: false,
      },
    ]
  }

  if (isApiOnly) await updateProgress(100, "Done")

  if (findings.length > 0) {
    await supabase
      .from("findings")
      .insert(findings.map((f) => ({ ...f, page_id: pageId, run_id: runId })))
  }

  await supabase.channel(`run:${runId}`).send({
    type: "broadcast",
    event: "progress",
    payload: { status: "done", message: "Paid media check completed" },
  })

  // Mark run completed if no page scan is also running.
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
  }
}
