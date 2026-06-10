import "dotenv/config"
import { Queue, Worker, Job } from "bullmq"
import pino from "pino"
import { processTestJob } from "./jobs/testJob"
import { processStartRunJob } from "./jobs/startRunJob"
import { processCrawlPageJob } from "./jobs/crawlPageJob"
import { processRunChecksJob } from "./jobs/runChecksJob"
import { processAnalyzeRebuttalJob } from "./jobs/analyzeRebuttalJob"
import { processVisualDiffJob } from "./jobs/visualDiffJob"
import { processGenerateEmbeddingsJob } from "./jobs/generateEmbeddingsJob"
import { processCaptureScreenshotJob } from "./jobs/captureScreenshotJob"
import { processRunAiChecksJob } from "./jobs/runAiChecksJob"
import { processCrawlBatchJob } from "./jobs/crawlBatchJob"
import { processCheckProjectPlanJob } from "./jobs/checkProjectPlanJob"
import { processCheckPaidMediaJob } from "./jobs/checkPaidMediaJob"
import { processCaptureMultiviewScreenshotsJob } from "./jobs/captureMultiviewScreenshotsJob"
import { qaQueue, connection } from "./lib/queue"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
})

const queueName = "qa-jobs"

// 2. Create the Worker
const worker = new Worker(
  queueName,
  async (job: Job) => {
    const { name } = job

    logger.info(
      { jobId: job.id, jobName: name, data: job.data },
      `Job ${name} received - starting processing`,
    )

    try {
      switch (name) {
        case "start_run":
          await processStartRunJob(job)
          break
        case "crawl_page":
          await processCrawlPageJob(job)
          break
        case "crawl_batch":
          await processCrawlBatchJob(job)
          break
        case "check_project_plan":
          await processCheckProjectPlanJob(job)
          break
        case "check_paid_media":
          await processCheckPaidMediaJob(job)
          break
        case "run_checks":
          await processRunChecksJob(job)
          break
        case "run_ai_checks":
        case "queueGeminiCall":
          await processRunAiChecksJob(job)
          break
        case "analyze_rebuttal":
          await processAnalyzeRebuttalJob(job)
          break
        case "visual_diff":
          await processVisualDiffJob(job)
          break
        case "generate_embeddings":
          await processGenerateEmbeddingsJob(job)
          break
        case "capture_screenshot":
          return await processCaptureScreenshotJob(job)
        case "capture_multiview_screenshots":
          return await processCaptureMultiviewScreenshotsJob(job)
        case "test":
          await processTestJob()
          break
        default:
          logger.warn({ jobName: name }, `Unknown job name: ${name}`)
      }
      logger.info(
        { jobId: job.id, jobName: name },
        `Job ${name} finished processing`,
      )
    } catch (error: any) {
      logger.error(
        {
          jobId: job.id,
          jobName: name,
          error: error.message,
          stack: error.stack,
        },
        `Error processing job ${name}`,
      )
      throw error
    }
  },
  {
    connection,
    concurrency: 20, // Process up to 5 jobs simultaneously
    drainDelay: 60, // Only poll every 60 seconds when the queue is empty
    stalledInterval: 300000, // 5 minutes
    checkStalledInterval: 300000, // 5 minutes
  },
)

// 3. Error Handling
worker.on("error", (err) => {
  logger.error(err, "Worker error occurred")
})

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, "Job failed")
})

worker.on("completed", (job) => {
  logger.info(
    { jobId: job.id, jobName: job.name },
    "Job completed successfully",
  )
})

logger.info(`Worker started, consuming queue: ${queueName}`)

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down worker...")
  await worker.close()
  await connection.quit()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
