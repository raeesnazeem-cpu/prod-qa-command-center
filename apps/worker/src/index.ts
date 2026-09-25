import "dotenv/config"
import { Queue, Worker, Job } from "bullmq"
import pino from "pino"
import { processTestJob } from "./jobs/testJob"
import { processStartRunJob } from "./jobs/startRunJob"
import { processCrawlPageJob, finalizeRun } from "./jobs/crawlPageJob"
import { processCaptureScreenshotJob } from "./jobs/captureScreenshotJob"
import { processCrawlBatchJob } from "./jobs/crawlBatchJob"
import { processCheckProjectPlanJob } from "./jobs/checkProjectPlanJob"
import { processCheckPaidMediaJob } from "./jobs/checkPaidMediaJob"
import { processAiFixRunJob } from "./jobs/aiFixRunJob"
import {
  processVideoRecordingJob,
  processVideoUrlVerifyJob,
} from "./jobs/videoRecordingJob"
import { qaQueue, connection } from "./lib/queue"
import { processCaptureMultiviewScreenshotsJob } from "./jobs/captureMultiviewScreenshotsJob"
import { startStuckRunSweeper } from "./lib/stuckRunSweeper"
import { releaseReportGate } from "./lib/reportGate"

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

// Run a standalone API check, then release its part of the run's report gate.
// Released on success or on the LAST failed attempt (a failed check must not
// block the report forever); earlier failures retry first. If this check was
// the last part still running, it finalizes the run (TED report, AI fix).
async function runApiCheck(
  job: Job,
  check: string,
  processor: (job: Job) => Promise<void>,
) {
  const release = async () => {
    if (job.data.isRetry) return
    if ((await releaseReportGate(job.data.runId, check)) !== "open") return
    // Never let a finalize error fail (and re-run) the check itself.
    await finalizeRun(job.data.runId).catch((e) =>
      logger.error(
        { runId: job.data.runId, error: e?.message },
        "finalizeRun after API check failed",
      ),
    )
  }
  try {
    await processor(job)
  } catch (err) {
    // attemptsMade = failed attempts BEFORE this one.
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await release()
    throw err
  }
  await release()
}

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
          await runApiCheck(job, "project_plan", processCheckProjectPlanJob)
          break
        case "check_paid_media":
          await runApiCheck(job, "paid_media", processCheckPaidMediaJob)
          break
        case "ai_fix_run":
          await processAiFixRunJob(job)
          break
        case "video_recording_check":
          await processVideoRecordingJob(job)
          break
        case "video_url_verify":
          await processVideoUrlVerifyJob(job)
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
    // Must match the queue prefix (lib/queue.ts + API). Unset → BullMQ default.
    ...(process.env.BULLMQ_PREFIX ? { prefix: process.env.BULLMQ_PREFIX } : {}),
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "3", 10), // Reduced from 15 to prevent 100% CPU usage during browser scans
    drainDelay: 60, // Only poll every 60 seconds when the queue is empty
    stalledInterval: 300000, // 5 minutes
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

// Periodic safety net: complete runs whose page counter drifted below the real
// finished-page count so they can never hang at ~99% forever. See
// lib/stuckRunSweeper.ts (root cause in migration 20260917000000).
startStuckRunSweeper()

import http from "http"

// Dummy HTTP server for Dokploy/PaaS health checks
const port =
  process.env.PORT || (process.env.NODE_ENV === "production" ? 8080 : 0)
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" })
  res.end("Worker is healthy\n")
})
server.listen(port, () => {
  logger.info(`Health check server listening on port ${port}`)
})

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down worker...")
  server.close()
  await worker.close()
  await connection.quit()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
