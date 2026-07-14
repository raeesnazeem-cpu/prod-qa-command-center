import { Router } from "express"
import { JobsClient } from "@google-cloud/run"
import { supabase } from "../lib/supabase"
import { logger } from "../lib/logger"
import axios from "axios"

const router: Router = Router()
const jobsClient = new JobsClient()

router.post("/start", async (req, res) => {
  const { runId } = req.body

  if (!runId) {
    return res.status(400).json({ error: "Missing runId" })
  }

  try {
    // Tell the database we are officially recording, and reset progress to 0%
    await supabase
      .from("qa_runs")
      .update({
        recording_status: "recording",
        recording_progress: { desktop: 0, laptop: 0, tablet: 0, mobile: 0 },
        recording_updated_at: new Date().toISOString(),
      })

      .eq("id", runId)

    const viewports = ["desktop", "tablet", "mobile"]
    const cloudProvider = process.env.CLOUD_PROVIDER || "GCP"

    let jobPath = ""
    if (cloudProvider === "GCP") {
      const jobName = process.env.GCP_RECORDING_JOB_NAME || "recording-worker"
      const projectId = process.env.GCP_PROJECT_ID
      const location = process.env.GCP_LOCATION || "us-central1"

      if (!projectId) {
        throw new Error("GCP_PROJECT_ID is not set")
      }

      jobPath = `projects/${projectId}/locations/${location}/jobs/${jobName}`
    }

    // 2. Trigger Cloud Run Jobs for each viewport
    const triggerPromises = viewports.map(async (viewportType) => {
      logger.info(
        { runId, viewportType },
        `Triggering recording job for ${viewportType}`,
      )

      try {
        if (cloudProvider === "AWS") {
          logger.info("Triggering AWS ECS RunTask for recording")
          // Pure additive: Dynamically import to avoid breaking GCP deployments if SDK isn't installed yet
          const { ECSClient, RunTaskCommand } =
            await import("@aws-sdk/client-ecs")
          const ecsClient = new ECSClient({
            region: process.env.AWS_REGION || "us-east-1",
          })

          const runTaskCommand = new RunTaskCommand({
            cluster: process.env.AWS_ECS_CLUSTER || "qacc-cluster",
            taskDefinition:
              process.env.AWS_ECS_TASK_DEFINITION || "qacc-worker-task",
            launchType: "FARGATE",
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: (process.env.AWS_ECS_SUBNETS || "").split(","),
                securityGroups: (
                  process.env.AWS_ECS_SECURITY_GROUPS || ""
                ).split(","),
                assignPublicIp: process.env.AWS_ECS_ASSIGN_PUBLIC_IP === "DISABLED" ? "DISABLED" : "ENABLED",
              },
            },
            overrides: {
              ...(process.env.AWS_ECS_TASK_ROLE_ARN ? { taskRoleArn: process.env.AWS_ECS_TASK_ROLE_ARN } : {}),
              ...(process.env.AWS_ECS_EXECUTION_ROLE_ARN ? { executionRoleArn: process.env.AWS_ECS_EXECUTION_ROLE_ARN } : {}),
              containerOverrides: [
                {
                  name: "qacc-worker",
                  environment: [
                    { name: "VIEWPORT_TYPE", value: viewportType },
                    { name: "RUN_ID", value: runId },
                    {
                      name: "SUPABASE_URL",
                      value: process.env.SUPABASE_URL || "",
                    },
                    {
                      name: "SUPABASE_SERVICE_ROLE_KEY",
                      value: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
                    },
                    { name: "CLOUD_PROVIDER", value: "AWS" },
                    ...(process.env.AWS_S3_BUCKET_NAME ? [{ name: "AWS_S3_BUCKET_NAME", value: process.env.AWS_S3_BUCKET_NAME }] : []),
                    ...(process.env.SCRAPER_API_KEY ? [{ name: "SCRAPER_API_KEY", value: process.env.SCRAPER_API_KEY }] : []),
                  ],
                },
              ],
            },
          })

          const operation = await ecsClient.send(runTaskCommand)
          return operation
        } else {
          const [operation] = await jobsClient.runJob({
            name: jobPath,
            overrides: {
              containerOverrides: [
                {
                  env: [
                    { name: "VIEWPORT_TYPE", value: viewportType },
                    { name: "RUN_ID", value: runId },
                    {
                      name: "SUPABASE_URL",
                      value: process.env.SUPABASE_URL || "",
                    },
                    {
                      name: "SUPABASE_SERVICE_ROLE_KEY",
                      value: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
                    },
                  ],
                },
              ],
            },
          })
          return operation
        }
      } catch (err: any) {
        logger.error(
          { err: err.message, viewportType },
          "Failed to trigger Cloud Run Job",
        )
        throw err
      }
    })

    await Promise.all(triggerPromises)

    res.json({ message: "Recording jobs initiated", viewports })
  } catch (error: any) {
    logger.error(
      { error: error.message, stack: error.stack },
      "Error starting recording jobs",
    )
    res.status(500).json({ error: "Failed to start recording jobs" })
  }
})

router.get("/download", async (req, res) => {
  const videoUrl = req.query.url as string
  const filename = (req.query.filename as string) || "video.webm"

  if (!videoUrl) {
    return res.status(400).json({ error: "Missing url parameter" })
  }

  try {
    const response = await axios({
      method: "GET",
      url: videoUrl,
      responseType: "stream",
    })

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.setHeader("Content-Type", "video/webm")

    response.data.pipe(res)
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to proxy download video")
    res.status(500).json({ error: "Failed to download video" })
  }
})

export { router as recordingsRouter }
