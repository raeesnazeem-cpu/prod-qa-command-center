// Liveness for the container health check (GET /health).
//
// The old health server answered 200 to everything, so a worker wedged inside a
// scan looked healthy forever and Docker never replaced it. This reports
// unhealthy only when scan work is active but nothing has moved for STUCK_MS:
// every page / check progress write counts as movement. A worker whose event
// loop is frozen can't answer at all, which the health check also treats as a
// failure.
//
// Only scan jobs are watched. Other jobs (AI fix, video, API checks) can be
// quiet for long stretches legitimately, so they never trip it. Movement is
// tracked worker-wide on purpose: if any page is progressing the worker is doing
// useful work, and a restart would kill it — a single hung page is the page
// timer's job (crawlPageJob PAGE_TIMEOUT_MS), not this one's.

const WATCHED_JOBS = new Set(["crawl_batch", "crawl_page"])

// Comfortably above one page's worst case (two timed-out attempts ≈ 6 min).
const STUCK_MS = Math.max(
  120_000,
  Number(process.env.WORKER_STUCK_MS || 600_000), // 10 min
)

const activeScanJobs = new Set<string>()
let lastActivityAt = Date.now()

export function markActivity(): void {
  lastActivityAt = Date.now()
}

export function scanJobStarted(jobId: string | undefined, name: string): void {
  if (!jobId || !WATCHED_JOBS.has(name)) return
  activeScanJobs.add(jobId)
  markActivity()
}

export function scanJobEnded(jobId: string | undefined): void {
  if (!jobId) return
  activeScanJobs.delete(jobId)
  markActivity()
}

export function healthStatus(now = Date.now()) {
  const idleMs = now - lastActivityAt
  const activeJobs = activeScanJobs.size
  const ok = activeJobs === 0 || idleMs < STUCK_MS
  return {
    ok,
    activeJobs,
    idleSeconds: Math.round(idleMs / 1000),
    stuckAfterSeconds: Math.round(STUCK_MS / 1000),
    ...(ok ? {} : { reason: "scan job active with no progress" }),
  }
}

// Test seam.
export function _resetHealth(): void {
  activeScanJobs.clear()
  lastActivityAt = Date.now()
}
