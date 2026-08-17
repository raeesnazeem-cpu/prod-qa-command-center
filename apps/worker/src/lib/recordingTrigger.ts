import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

// The three viewports the recorder (recordingWorker.ts) actually produces. One
// cloud job execution is launched per viewport, each with a different
// VIEWPORT_TYPE. Keep this in sync with recordingWorker.ts and the completion
// gate in merge_qa_run_recording_url.
export const RECORDING_VIEWPORTS = ["desktop", "tablet", "mobile"] as const

export type TriggerResult = {
  // True when at least the cloud API accepted the launch of EVERY viewport job.
  // (The barrier still confirms an actual start via the DB flip.)
  triggered: boolean
  // True when VIDEO_RECORDING_ENABLED is off — no real cloud call was made and
  // the barrier should treat this as a simulated success for local testing.
  simulated: boolean
  provider: string
  viewports: string[]
  // Per-viewport failure detail (empty when every launch was accepted). Surfaced
  // in the QACC-internal log/comment, never to the client.
  errors: string[]
}

// ---------------------------------------------------------------------------
// Re-implements the cloud trigger that used to live in the (now-missing)
// apps/api/src/routes/recordings.ts. Instead of a manual, UI-initiated POST, the
// video_recording_check barrier calls this once all other checks have passed.
//
// Gated by VIDEO_RECORDING_ENABLED (default OFF). When off, no cloud is touched
// and a `simulated` result is returned so the comment/verdict flow is testable
// locally (TED_PREVIEW_ONLY + client 1397) without spinning GCP/AWS infra.
//
// CLOUD_PROVIDER selects the backend (default GCP):
//   • GCP → Cloud Run Job `:run` with per-viewport env overrides. Auth token
//     from the instance metadata server (works on Cloud Run/GCE without extra
//     deps) or GOOGLE_OAUTH_TOKEN for local/testing.
//   • AWS → ECS RunTask (needs @aws-sdk/client-ecs; imported lazily so the
//     worker still builds without it — a clear error is reported if selected
//     without the SDK installed).
//   • RECORDING_TRIGGER_URL (any provider) → simple HTTP POST escape hatch:
//     one POST { runId, viewport } per viewport to that URL.
// ---------------------------------------------------------------------------
export async function triggerFullProjectRecording(
  runId: string,
): Promise<TriggerResult> {
  const provider = (process.env.CLOUD_PROVIDER || "GCP").toUpperCase()
  const viewports = [...RECORDING_VIEWPORTS]

  if (process.env.VIDEO_RECORDING_ENABLED !== "true") {
    logger.info(
      { runId },
      "VIDEO_RECORDING_ENABLED is not 'true' — skipping real cloud trigger (simulated start).",
    )
    return { triggered: true, simulated: true, provider, viewports, errors: [] }
  }

  const errors: string[] = []
  for (const viewport of viewports) {
    try {
      if (process.env.RECORDING_TRIGGER_URL) {
        await triggerViaHttp(process.env.RECORDING_TRIGGER_URL, runId, viewport)
      } else if (provider === "AWS") {
        await triggerViaEcs(runId, viewport)
      } else {
        await triggerViaCloudRun(runId, viewport)
      }
      logger.info({ runId, viewport, provider }, "Recording job launch accepted.")
    } catch (e: any) {
      const detail = `[${viewport}] ${e?.message || String(e)}`
      logger.error({ runId, viewport, provider, error: e?.message }, "Recording job launch failed.")
      errors.push(detail)
    }
  }

  return {
    triggered: errors.length === 0,
    simulated: false,
    provider,
    viewports,
    errors,
  }
}

// Env every recorder process needs, regardless of provider.
function recorderEnv(runId: string, viewport: string): Record<string, string> {
  return {
    VIEWPORT_TYPE: viewport,
    RUN_ID: runId,
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    CLOUD_PROVIDER: process.env.CLOUD_PROVIDER || "GCP",
    GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME || "",
    AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME || "",
  }
}

// --- GCP: Cloud Run Job execution with per-viewport container env overrides ---
async function triggerViaCloudRun(runId: string, viewport: string): Promise<void> {
  // Accept both the recording-specific names and the general GCP names already
  // present in prod.env (GCP_PROJECT_ID / GCP_LOCATION / GCP_RECORDING_JOB_NAME).
  const project =
    process.env.GCP_RECORDING_PROJECT || process.env.GCP_PROJECT_ID || "qacc-video-recorder-2026"
  const region =
    process.env.GCP_RECORDING_REGION || process.env.GCP_LOCATION || "europe-west3"
  const job =
    process.env.GCP_RECORDING_JOB || process.env.GCP_RECORDING_JOB_NAME || "recording-worker"

  const token = await getGcpAccessToken()
  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`
  const env = recorderEnv(runId, viewport)
  const body = {
    overrides: {
      containerOverrides: [
        {
          env: Object.entries(env)
            .filter(([, v]) => v !== "")
            .map(([name, value]) => ({ name, value })),
        },
      ],
    },
  }

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const preview = (await r.text().catch(() => "")).slice(0, 300)
    throw new Error(`Cloud Run :run returned ${r.status}: ${preview}`)
  }
}

// Access token from the GCE/Cloud Run metadata server (no google-auth-library
// dependency). Falls back to GOOGLE_OAUTH_TOKEN for local/testing.
async function getGcpAccessToken(): Promise<string> {
  if (process.env.GOOGLE_OAUTH_TOKEN) return process.env.GOOGLE_OAUTH_TOKEN
  const r = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-account/token",
    { headers: { "Metadata-Flavor": "Google" } },
  ).catch((e) => {
    throw new Error(`metadata token fetch failed: ${e?.message || e}`)
  })
  if (!r.ok) throw new Error(`metadata token returned ${r.status}`)
  const j: any = await r.json()
  if (!j?.access_token) throw new Error("metadata token response missing access_token")
  return j.access_token
}

// --- AWS: ECS RunTask. @aws-sdk/client-ecs is imported lazily via a runtime
// variable so the bundler does not hard-require it (it is not a worker dep by
// default). If AWS is selected without the SDK, a clear error is thrown. ---
async function triggerViaEcs(runId: string, viewport: string): Promise<void> {
  const cluster = process.env.AWS_ECS_CLUSTER || "qacc-cluster"
  const taskDefinition = process.env.AWS_ECS_TASK_DEF
  const containerName = process.env.AWS_ECS_CONTAINER || "qacc-worker"
  if (!taskDefinition) throw new Error("AWS_ECS_TASK_DEF not set")

  const pkg = "@aws-sdk/client-ecs"
  let ecsMod: any
  try {
    ecsMod = await import(pkg)
  } catch {
    throw new Error(
      "CLOUD_PROVIDER=AWS but @aws-sdk/client-ecs is not installed in the worker.",
    )
  }
  const { ECSClient, RunTaskCommand } = ecsMod
  const client = new ECSClient({ region: process.env.AWS_REGION || "us-east-1" })

  const env = recorderEnv(runId, viewport)
  const subnets = (process.env.AWS_ECS_SUBNETS || "").split(",").map((s) => s.trim()).filter(Boolean)
  const securityGroups = (process.env.AWS_ECS_SECURITY_GROUPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  await client.send(
    new RunTaskCommand({
      cluster,
      taskDefinition,
      launchType: "FARGATE",
      networkConfiguration: subnets.length
        ? {
            awsvpcConfiguration: {
              subnets,
              securityGroups,
              assignPublicIp: process.env.AWS_ECS_ASSIGN_PUBLIC_IP || "ENABLED",
            },
          }
        : undefined,
      overrides: {
        containerOverrides: [
          {
            name: containerName,
            environment: Object.entries(env)
              .filter(([, v]) => v !== "")
              .map(([name, value]) => ({ name, value })),
          },
        ],
      },
    }),
  )
}

// --- Generic HTTP escape hatch: POST { runId, viewport } to a trigger URL. ---
async function triggerViaHttp(url: string, runId: string, viewport: string): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.RECORDING_TRIGGER_TOKEN
        ? { Authorization: `Bearer ${process.env.RECORDING_TRIGGER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ runId, viewport }),
  })
  if (!r.ok) {
    const preview = (await r.text().catch(() => "")).slice(0, 300)
    throw new Error(`trigger URL returned ${r.status}: ${preview}`)
  }
}
