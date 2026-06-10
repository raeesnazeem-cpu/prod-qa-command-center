import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { processCrawlPageJob } from "./crawlPageJob"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function processCrawlBatchJob(job: Job) {
  const { runId, pages, projectId, wpPassword } = job.data

  if (!runId || !pages || !Array.isArray(pages)) {
    throw new Error(
      "Missing required data for crawl_batch job (runId or pages array)",
    )
  }

  logger.info({ runId, batchSize: pages.length }, "Processing crawl batch")

  for (const page of pages) {
    const { id: pageId, url: pageUrl } = page

    try {
      // 1. Skip already-processed pages (Self-Healing / Retry Logic)
      const { data: pageData } = await supabase
        .from("pages")
        .select("status")
        .eq("id", pageId)
        .single()

      if (pageData?.status === "done" || pageData?.status === "completed") {
        logger.info({ pageId }, "Page already processed, skipping in batch")
        continue
      }

      // 2. Perform the actual crawl
      // We reuse the existing processCrawlPageJob by mocking the BullMQ Job object
      // This ensures we keep the exact same logic, progress updates, and database increments
      logger.info({ pageId, pageUrl }, "Processing page within batch")

      await processCrawlPageJob({
        data: {
          runId,
          pageId,
          url: pageUrl,
          projectId,
          enabledChecks: job.data.enabledChecks,
          wpPassword,
        },
      } as Job)
    } catch (error: any) {
      logger.error(
        { pageId, error: error.message },
        "Error processing page in batch",
      )
      // We don't throw here so that one bad page doesn't kill the whole batch
      // The individual page status will be updated to 'failed' inside processCrawlPageJob
    }
  }
  logger.info({ runId }, "Crawl batch processing complete")
}
