import { supabase } from "./supabase"
import { logger } from "./logger"

// Publishes "how many QA runs need a worker right now" to CloudWatch once a
// minute. The worker service's autoscaling policy (infra/terraform/autoscaling.tf)
// tracks this number: one worker task per run in flight, up to RUN_SLOT_LIMIT.
//
// In flight = pending (waiting for a run slot) or running. Paused runs need no
// worker. Runs older than RUN_METRICS_MAX_AGE_HOURS are ignored so a run left
// "running" by a crash cannot keep extra workers alive forever.
//
// Off unless RUN_METRICS_NAMESPACE is set (Terraform sets it on AWS only).

const INTERVAL_MS = 60_000

export async function countRunsInFlight(now = Date.now()): Promise<number> {
  const maxAgeHours = Math.max(1, Number(process.env.RUN_METRICS_MAX_AGE_HOURS || 12))
  const since = new Date(now - maxAgeHours * 3_600_000).toISOString()
  const { count, error } = await supabase
    .from("qa_runs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "running"])
    .gte("created_at", since)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export function startRunMetrics(): void {
  const namespace = process.env.RUN_METRICS_NAMESPACE
  if (!namespace) return
  const env = process.env.RUN_METRICS_ENV || "default"

  let client: any
  let PutMetricDataCommand: any

  const publish = async () => {
    try {
      if (!client) {
        const mod = await import("@aws-sdk/client-cloudwatch")
        client = new mod.CloudWatchClient({ region: process.env.AWS_REGION || "us-east-1" })
        PutMetricDataCommand = mod.PutMetricDataCommand
      }
      const value = await countRunsInFlight()
      await client.send(
        new PutMetricDataCommand({
          Namespace: namespace,
          MetricData: [
            {
              MetricName: "RunsInFlight",
              Dimensions: [{ Name: "Env", Value: env }],
              Unit: "Count",
              Value: value,
            },
          ],
        }),
      )
      logger.debug({ value }, "Published RunsInFlight")
    } catch (e: any) {
      logger.warn({ error: e?.message }, "RunsInFlight metric publish failed")
    }
  }

  void publish()
  setInterval(publish, INTERVAL_MS).unref()
  logger.info({ namespace, env }, "RunsInFlight metric publisher started")
}
