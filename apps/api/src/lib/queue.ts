import { Queue, QueueEvents } from "bullmq"
import IORedis from "ioredis"
import "dotenv/config"

const redisUrl = process.env.UPSTASH_REDIS_URL

if (!redisUrl) {
  throw new Error("UPSTASH_REDIS_URL is not defined in environment variables")
}

/**
 * BullMQ connection using Upstash Redis
 */
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: redisUrl.startsWith("rediss://")
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000)
    return delay
  },
  reconnectOnError(err) {
    const targetError = "READONLY"
    if (err.message.includes(targetError)) {
      return true
    }
    return false
  },
  connectTimeout: 10000,
  keepAlive: 10000,
})

/**
 * Optional BullMQ key prefix. Unset → BullMQ default ("bull"), unchanged prod
 * behaviour. Set (e.g. for a local test run) → jobs live under a separate key
 * namespace on the SAME redis, so a deployed prod worker on the default prefix
 * never consumes them. Must match the worker's prefix to line up.
 */
const bullPrefix = process.env.BULLMQ_PREFIX || undefined

/**
 * QA Jobs Queue
 */
export const qaQueue = new Queue("qa-jobs", {
  connection,
  ...(bullPrefix ? { prefix: bullPrefix } : {}),
})

/**
 * Singleton QueueEvents for monitoring job completion without leaking connections
 */
export const qaQueueEvents = new QueueEvents("qa-jobs", {
  connection,
  ...(bullPrefix ? { prefix: bullPrefix } : {}),
})

/**
 * Enqueue a crawler job for a specific QA run
 * @param runId The UUID of the qa_run
 */
export const addRunJob = async (runId: string, wp_password?: string) => {
  return qaQueue.add(
    "start_run",
    { runId, wp_password },
    {
      removeOnComplete: true,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
    },
  )
}
