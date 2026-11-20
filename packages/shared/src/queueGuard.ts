import { existsSync, readFileSync } from "fs"

// Keeps every local machine off the production job queue.
//
// The prod queue (Upstash) is shared by everything that holds its URL. A
// worker on a developer Mac with the prod URL in its .env silently became a
// second prod worker in 2026-10/11 and took ~1,500 prod pages, failing each one
// (no browser installed). A local API with the prod URL would likewise push
// test jobs into the prod queue.
//
// Rule: only a deployed container may use a remote queue. Prod runs as Docker
// containers on Dokploy (Docker always creates /.dockerenv in a container) or as
// ECS tasks on AWS (detected from the ECS agent's env vars).
// Anything else — a Mac, Windows, a Linux laptop — that is given a remote queue
// URL is switched to local Redis, whatever its .env says. There is no override.

export const LOCAL_REDIS_URL = "redis://127.0.0.1:6379"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "redis", "host.docker.internal"])

/** True when the Redis URL points at this machine (or a local docker service). */
export function isLocalRedisUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return LOCAL_HOSTS.has(host) || host.endsWith(".localhost")
  } catch {
    return false
  }
}

/** True when this process runs inside a Linux container (how prod is deployed). */
export function isRunningInContainer(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform !== "linux") return false // Docker Desktop containers still report linux
  // AWS ECS / Fargate: no /.dockerenv and cgroup v2 shows only "0::/", but the
  // ECS agent always sets these for every task container.
  if (env.ECS_CONTAINER_METADATA_URI_V4 || env.ECS_CONTAINER_METADATA_URI || /^AWS_ECS_/.test(env.AWS_EXECUTION_ENV || "")) return true
  try {
    if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) return true
    const cgroup = readFileSync("/proc/1/cgroup", "utf8")
    return /docker|kubepods|containerd|libpod|\/ecs\//.test(cgroup)
  } catch {
    return false
  }
}

export interface QueueUrlDecision {
  url: string
  /** Set when the configured URL was replaced; say it loudly in the log. */
  warning?: string
}

/** The Redis URL this process may actually use for the job queue. */
export function resolveQueueRedisUrl(
  configured: string,
  opts: { inContainer?: boolean } = {},
): QueueUrlDecision {
  if (isLocalRedisUrl(configured)) return { url: configured }
  const inContainer = opts.inContainer ?? isRunningInContainer()
  if (inContainer) return { url: configured }
  return {
    url: LOCAL_REDIS_URL,
    warning:
      `UPSTASH_REDIS_URL points at a remote (production) queue, but this process is not a deployed container. ` +
      `Using local Redis at ${LOCAL_REDIS_URL} instead, so a local machine never takes or adds production jobs.`,
  }
}
