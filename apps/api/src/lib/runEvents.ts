// Step log for QA runs (table run_events). TED's "View run log" panel reads it
// through GET /webhooks/ted/runs/:runId/events, so every message here is shown
// to people: keep it one plain line.
//
// logRunEvent never throws: a logging failure must not break a trigger.

export type RunEventStatus = "ok" | "running" | "failed" | "info" | "warn"

export interface RunEventInput {
  runId?: string | null
  tedTaskId?: string | number | null
  kind: string
  status: RunEventStatus
  message: string
  detail?: Record<string, unknown>
}

export function buildRunEventRow(e: RunEventInput) {
  return {
    run_id: e.runId || null,
    ted_task_id: e.tedTaskId != null && String(e.tedTaskId) !== "" ? String(e.tedTaskId) : null,
    kind: e.kind,
    status: e.status,
    message: e.message,
    detail: e.detail || {},
  }
}

export async function logRunEvent(e: RunEventInput, client?: any): Promise<void> {
  try {
    const db = client || require("./supabase").supabase
    const { error } = await db.from("run_events").insert(buildRunEventRow(e))
    if (error) console.warn(`⚠️ run_events insert failed (${e.kind}):`, error.message || error)
  } catch (err) {
    console.warn(`⚠️ run_events insert threw (${e.kind}):`, (err as Error)?.message || err)
  }
}

// What a run-triggering webhook tells TED, on top of its existing fields.
export type TriggerOutcome = "started" | "duplicate" | "not_started" | "ignored"

// Tracks one trigger from "received" to its outcome, so every exit path of a
// webhook handler answers TED the same way and a trigger that started nothing
// always gets a "Could not start" comment.
export class TriggerTracker {
  outcome: TriggerOutcome = "ignored"
  reason: string | undefined
  fix: string | undefined
  runId: string | null = null
  tedTaskId: string | null = null
  // True once the could-not-start comment (or an equivalent) was posted.
  commented = false

  constructor(public readonly flow: string, private readonly client?: any) {}

  // The trigger is one QACC acts on (not an ignored event).
  received(tedTaskId: string | number | null | undefined, detail: Record<string, unknown> = {}) {
    this.outcome = "not_started"
    this.tedTaskId = tedTaskId != null ? String(tedTaskId) : null
    return logRunEvent(
      { tedTaskId: this.tedTaskId, kind: "trigger.received", status: "ok", message: `Trigger received from TED (${this.flow})`, detail },
      this.client,
    )
  }

  setTask(tedTaskId: string | number | null | undefined) {
    if (tedTaskId != null && String(tedTaskId) !== "") this.tedTaskId = String(tedTaskId)
  }

  step(kind: string, status: RunEventStatus, message: string, detail: Record<string, unknown> = {}) {
    return logRunEvent({ runId: this.runId, tedTaskId: this.tedTaskId, kind, status, message, detail }, this.client)
  }

  // Nothing will run. `kind` names the step that failed (project.missing, url.missing, ...).
  fail(kind: string, reason: string, fix: string, runId?: string | null, detail: Record<string, unknown> = {}) {
    this.outcome = "not_started"
    this.reason = reason
    this.fix = fix
    if (runId) this.runId = runId
    return logRunEvent(
      { runId: this.runId, tedTaskId: this.tedTaskId, kind, status: "failed", message: reason, detail: { ...detail, fix } },
      this.client,
    )
  }

  duplicate(existingRunId: string, reason: string) {
    this.outcome = "duplicate"
    this.runId = existingRunId
    this.reason = reason
    this.commented = true
    return logRunEvent(
      { runId: existingRunId, tedTaskId: this.tedTaskId, kind: "run.duplicate", status: "info", message: reason },
      this.client,
    )
  }

  started(runId: string, detail: Record<string, unknown> = {}) {
    this.outcome = "started"
    this.runId = runId
    this.reason = undefined
    this.fix = undefined
    return logRunEvent(
      { runId, tedTaskId: this.tedTaskId, kind: "run.queued", status: "ok", message: "Run queued for the worker", detail },
      this.client,
    )
  }

  // True when the handler still owes TED a could-not-start comment.
  needsCouldNotStartComment(): boolean {
    return this.outcome === "not_started" && !this.commented && !!this.tedTaskId && !!this.reason
  }

  responseData() {
    const d: Record<string, unknown> = { outcome: this.outcome }
    if (this.reason) d.reason = this.reason
    if (this.fix) d.fix = this.fix
    return d
  }
}

export function couldNotStartText(reason: string, fix: string): string {
  return `Could not start the test run. ${reason.trim()} To fix: ${fix.trim()}`
}

export function startedText(url: string, source: string, checks: string[], runId: string): string {
  const from = source ? ` (URL from ${source})` : ""
  const list = checks.length ? checks.join(", ") : "default suite"
  return `Test run started on ${url}${from}. Checks: ${list}. Run ${runId}.`
}
