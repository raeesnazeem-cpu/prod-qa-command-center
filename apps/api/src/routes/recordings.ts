import { Router } from "express"
import { JobsClient } from "@google-cloud/run"
import { supabase } from "../lib/supabase"
import { logger } from "../lib/logger"
import axios from "axios"

// ---------------------------------------------------------------------------
// Manual video-recording trigger for the "Record Full Project Video" button in
// RunDetailPage. POST /api/recordings/start { runId } launches one Cloud Run Job
// execution per viewport (desktop/tablet/mobile).
//
// AUTH: JobsClient() authenticates via Application Default Credentials — it reads
// GOOGLE_APPLICATION_CREDENTIALS, which apps/api/src/index.ts points at the
// /tmp/gcp-key.json file it writes from the GCP_SERVICE_ACCOUNT_JSON env var at
// boot. This works on ANY host (Hetzner/Dokploy included) with no metadata
// server — which is exactly why this path worked before and the worker's raw
// REST trigger (metadata-only) does not.
// ---------------------------------------------------------------------------
const router: Router = Router()
const jobsClient = new JobsClient()

const RECORDING_VIEWPORTS = ["desktop", "tablet", "mobile"] as const

router.post("/start", async (req, res) => {
  const { runId } = req.body

  if (!runId) {
    return res.status(400).json({ error: "Missing runId" })
  }

  try {
    // Mark the run as officially recording and reset progress to 0%.
    await supabase
      .from("qa_runs")
      .update({
        recording_status: "recording",
        recording_progress: { desktop: 0, tablet: 0, mobile: 0 },
        recording_updated_at: new Date().toISOString(),
      })
      .eq("id", runId)

    const cloudProvider = process.env.CLOUD_PROVIDER || "GCP"

    // Env every recorder container needs, regardless of viewport. Includes the
    // GCS bucket + provider so the recorder uploads the finished webm to the
    // right place (recordingWorker reads GCS_BUCKET_NAME / CLOUD_PROVIDER).
    const recorderEnv = (viewportType: string): { name: string; value: string }[] =>
      [
        { name: "VIEWPORT_TYPE", value: viewportType },
        { name: "RUN_ID", value: String(runId) },
        { name: "SUPABASE_URL", value: process.env.SUPABASE_URL || "" },
        { name: "SUPABASE_SERVICE_ROLE_KEY", value: process.env.SUPABASE_SERVICE_ROLE_KEY || "" },
        { name: "CLOUD_PROVIDER", value: cloudProvider },
        { name: "GCS_BUCKET_NAME", value: process.env.GCS_BUCKET_NAME || "" },
        { name: "AWS_S3_BUCKET_NAME", value: process.env.AWS_S3_BUCKET_NAME || "" },
      ].filter((e) => e.value !== "")

    let jobPath = ""
    if (cloudProvider === "GCP") {
      const jobName = process.env.GCP_RECORDING_JOB_NAME || "recording-worker"
      const projectId = process.env.GCP_PROJECT_ID
      const location = process.env.GCP_LOCATION || "us-central1"
      if (!projectId) throw new Error("GCP_PROJECT_ID is not set")
      jobPath = `projects/${projectId}/locations/${location}/jobs/${jobName}`
    }

    // Launch one Cloud Run Job execution per viewport, with per-viewport env
    // overrides.
    const triggerPromises = RECORDING_VIEWPORTS.map(async (viewportType) => {
      logger.info({ runId, viewportType }, `Triggering recording job for ${viewportType}`)
      try {
        if (cloudProvider === "AWS") {
          const { ECSClient, RunTaskCommand } = await import("@aws-sdk/client-ecs")
          const ecsClient = new ECSClient({ region: process.env.AWS_REGION || "us-east-1" })
          const runTaskCommand = new RunTaskCommand({
            cluster: process.env.AWS_ECS_CLUSTER || "qacc-cluster",
            taskDefinition: process.env.AWS_ECS_TASK_DEFINITION || "qacc-worker-task",
            launchType: "FARGATE",
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: (process.env.AWS_ECS_SUBNETS || "").split(",").filter(Boolean),
                securityGroups: (process.env.AWS_ECS_SECURITY_GROUPS || "").split(",").filter(Boolean),
                assignPublicIp:
                  process.env.AWS_ECS_ASSIGN_PUBLIC_IP === "DISABLED" ? "DISABLED" : "ENABLED",
              },
            },
            overrides: {
              ...(process.env.AWS_ECS_TASK_ROLE_ARN
                ? { taskRoleArn: process.env.AWS_ECS_TASK_ROLE_ARN }
                : {}),
              ...(process.env.AWS_ECS_EXECUTION_ROLE_ARN
                ? { executionRoleArn: process.env.AWS_ECS_EXECUTION_ROLE_ARN }
                : {}),
              containerOverrides: [{ name: "qacc-worker", environment: recorderEnv(viewportType) }],
            },
          })
          return ecsClient.send(runTaskCommand)
        }
        // GCP (default): JobsClient auto-authenticates via GOOGLE_APPLICATION_CREDENTIALS.
        const [operation] = await jobsClient.runJob({
          name: jobPath,
          overrides: { containerOverrides: [{ env: recorderEnv(viewportType) }] },
        })
        return operation
      } catch (err: any) {
        logger.error({ err: err.message, viewportType }, "Failed to trigger recording job")
        throw err
      }
    })

    await Promise.all(triggerPromises)

    res.json({ message: "Recording jobs initiated", viewports: [...RECORDING_VIEWPORTS] })
  } catch (error: any) {
    logger.error(
      { error: error.message, stack: error.stack },
      "Error starting recording jobs",
    )
    res.status(500).json({ error: "Failed to start recording jobs" })
  }
})

// Proxy a stored recording so the browser gets a clean download.
router.get("/download", async (req, res) => {
  const videoUrl = req.query.url as string
  const filename = (req.query.filename as string) || "video.webm"
  if (!videoUrl) return res.status(400).json({ error: "Missing url parameter" })
  try {
    const response = await axios({ method: "GET", url: videoUrl, responseType: "stream" })
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.setHeader("Content-Type", "video/webm")
    response.data.pipe(res)
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to proxy download video")
    res.status(500).json({ error: "Failed to download video" })
  }
})

export { router as recordingsRouter }
