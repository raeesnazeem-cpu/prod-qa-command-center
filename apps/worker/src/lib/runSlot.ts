import { supabase } from "./supabase"
import pino from "pino"
import { releaseLinkCaches } from "../checks/optimizedLinksCheck"
import { clearTedCaches } from "./tedClient"
import { resetAiBreakers } from "./aiFallback"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

// Global run slots (RUN_SLOT_LIMIT of them, default 1 = one QA run at a time),
// backed by an atomic lock table in Postgres (migrations
// 20260820000000_add_run_slot_lock + 20261028000000_run_slot_limit). start_run
// claims a slot before a run begins and releases it when the run completes.
//
// FAIL-OPEN: if the lock RPC is missing (migration not applied) or errors, we
// let the run proceed rather than wedge the whole queue. The guard is a safety
// improvement, not a hard dependency — a broken lock must never stop all scans.

// How long a held slot may sit before a newer run is allowed to steal it. Must
// comfortably exceed a normal end-to-end run so a live run is never stolen from;
// it only frees a slot left behind by a crashed run. Default 30 min.
export const RUN_SLOT_STALE_SECONDS = Math.max(
  60,
  Number(process.env.RUN_SLOT_STALE_SECONDS || 1800),
)

// How many runs may execute at once (migration 20261028000000_run_slot_limit).
// Default 1 = the old "one run at a time". On AWS each worker task handles one
// run and the worker service scales out to this many tasks.
export const RUN_SLOT_LIMIT = Math.max(1, Number(process.env.RUN_SLOT_LIMIT || 1))

// Try to claim one of the run slots for `runId`. Returns true when this run now
// holds one (free / already ours / previous holder stale), false when every slot
// is held by another fresh run. Never throws.
export async function acquireRunSlot(runId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("acquire_run_slot", {
      p_run_id: runId,
      p_stale_seconds: RUN_SLOT_STALE_SECONDS,
      // Only sent when raised, so a database without the new migration keeps
      // working with the old two-argument function.
      ...(RUN_SLOT_LIMIT > 1 ? { p_max_slots: RUN_SLOT_LIMIT } : {}),
    })
    if (error) {
      logger.warn(
        { runId, error: error.message },
        "acquire_run_slot RPC failed; proceeding WITHOUT the global run lock (apply the run_slot_lock migration to enable it)",
      )
      return true // fail-open
    }
    return data === true
  } catch (e: any) {
    logger.warn(
      { runId, error: e?.message },
      "acquire_run_slot threw; proceeding without the global run lock",
    )
    return true // fail-open
  }
}

// Release the global run slot if this run still owns it. Idempotent and safe to
// call from several completion paths. Never throws.
//
// This is also where a run's in-memory caches are dropped: every completion
// path funnels through here, so it is the one place guaranteed to run once a
// run is over. The worker process is long-lived, so anything keyed by runId
// that is not released here leaks for the lifetime of the container.
export async function releaseRunSlot(runId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc("release_run_slot", { p_run_id: runId })
    if (error) {
      logger.warn({ runId, error: error.message }, "release_run_slot RPC failed")
    }
  } catch (e: any) {
    logger.warn({ runId, error: e?.message }, "release_run_slot threw")
  } finally {
    // Cache cleanup must happen even when the RPC fails — a wedged lock is a
    // scheduling problem, a leaked cache is a memory problem, and the second
    // one must not be caused by the first.
    try {
      releaseLinkCaches(runId)
      clearTedCaches()
      resetAiBreakers()
    } catch (e: any) {
      logger.warn({ runId, error: e?.message }, "run cache cleanup failed")
    }
  }
}
