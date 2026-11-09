// Step log for QA runs (table run_events), worker side. Mirrors
// apps/api/src/lib/runEvents.ts. TED's "View run log" panel shows these
// messages to people: keep each one plain line.
//
// logRunEvent never throws: a logging failure must not break a run.

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

// Plain-language name of a check key for the run log ("contact_form" → "Contact form").
export function checkLabel(key: string): string {
  const s = String(key || "").replace(/[_-]+/g, " ").trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Check"
}
