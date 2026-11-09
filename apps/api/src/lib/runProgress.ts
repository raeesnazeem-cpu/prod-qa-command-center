// Builds the progress view TED's Automation card and run log read from
// GET /webhooks/ted/runs/:runId/progress. Pure: the route does the queries.

export const STUCK_AFTER_MS = 15 * 60 * 1000

export interface RunRow {
  id: string
  run_type: string | null
  status: string | null
  enabled_checks: string[] | null
  pages_processed: number | null
  pages_total: number | null
  started_at: string | null
  completed_at: string | null
  created_at?: string | null
}

export interface RunEventRow {
  run_id?: string | null
  at: string
  kind: string
  status: string
  message: string
  detail?: Record<string, any> | null
}

export interface CheckResultRow {
  check_factor: string
  status: string
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "canceled", "done", "aborted"])

export function buildRunProgress(
  run: RunRow,
  events: RunEventRow[],
  checkResults: CheckResultRow[],
  issuesFound: number,
  now: number = Date.now(),
) {
  const enabled = Array.isArray(run.enabled_checks) ? run.enabled_checks : []
  // Done checks: the worker's check.done events, or the per-check results it
  // writes at the end (whichever knows more).
  const doneFromEvents = new Set(
    events.filter((e) => e.kind === "check.done").map((e) => String(e.detail?.check || e.message)),
  )
  const failedFromEvents = new Set(
    events
      .filter((e) => e.kind === "check.done" && (e.status === "failed" || e.detail?.passed === false))
      .map((e) => String(e.detail?.check || e.message)),
  )
  const scanResults = checkResults.filter((c) => c)
  const failedFromResults = new Set(
    scanResults.filter((c) => c.status === "failed" || c.status === "errored").map((c) => c.check_factor),
  )
  const checksDone = Math.max(doneFromEvents.size, scanResults.length)
  const failedChecks = Math.max(failedFromEvents.size, failedFromResults.size)

  const last = events.length ? events[events.length - 1] : null
  const lastEventAt = last ? last.at : null
  const status = run.status || "unknown"
  const running = !TERMINAL.has(status)

  let currentStep: string
  if (!running) {
    currentStep = status === "completed" ? "Finished" : last?.message || status
  } else {
    const active = [...events].reverse().find((e) => e.status === "running")
    currentStep = active?.message || last?.message || "Waiting for the worker"
  }

  const since = lastEventAt || run.started_at || run.created_at || null
  const stuck = running && !!since && now - new Date(since).getTime() > STUCK_AFTER_MS

  return {
    runId: run.id,
    runType: run.run_type,
    // QACC's qa_runs.status as-is (running / completed / failed / cancelled ...).
    status,
    currentStep,
    checksTotal: enabled.length,
    checksDone: Math.min(checksDone, enabled.length || checksDone),
    failedChecks,
    pagesProcessed: run.pages_processed ?? 0,
    pagesTotal: run.pages_total ?? 0,
    issuesFound,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    lastEventAt,
    stuck,
  }
}

// Kinds logged when a trigger started nothing (see TriggerTracker.fail).
export const NOT_STARTED_KINDS = [
  "project.missing",
  "url.missing",
  "run.create_failed",
  "run.queue_failed",
  "check.unmapped",
]

// Newest of: the task's latest run, or a could-not-start event (no run) after it.
export function pickLatestRun(
  run: { id: string; status: string | null; created_at: string | null; custom_name?: string | null; site_url?: string | null } | null,
  notStarted: RunEventRow | null,
) {
  const runAt = run?.created_at ? new Date(run.created_at).getTime() : -1
  const evAt = notStarted ? new Date(notStarted.at).getTime() : -1
  // >= : an aborted run (no URL) and its could-not-start event share a moment.
  if (notStarted && evAt >= runAt) {
    return {
      // Set for an aborted run (no URL), null when no run row was created.
      runId: notStarted.run_id || null,
      status: "not_started",
      outcome: "not_started",
      reason: notStarted.message,
      fix: (notStarted.detail?.fix as string) || null,
      at: notStarted.at,
    }
  }
  if (!run) return { runId: null, status: null, outcome: null, reason: null, fix: null, at: null }
  return {
    runId: run.id,
    status: run.status,
    // An aborted run (createAbortedRun) has no site URL: it never started.
    outcome: run.status === "failed" && !run.site_url ? "not_started" : "started",
    reason: run.status === "failed" ? run.custom_name || null : null,
    fix: null,
    at: run.created_at,
  }
}
