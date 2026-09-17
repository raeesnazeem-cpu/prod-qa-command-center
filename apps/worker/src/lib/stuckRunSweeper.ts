// Safety net for runs stuck in `running` because their page counter drifted
// below the real number of finished pages (see migration
// 20260917000000_reconcile_run_completion.sql for the root cause).
//
// The count-based completion RPC self-heals whenever a page finally still fires.
// This sweeper covers the residual case the prod incident actually hit: EVERY
// page already finished, so no crawl_page finally will ever run again, yet the
// run is one increment short and would hang at ~99% forever with no other code
// path able to notice.
//
// It is deliberately conservative:
//   • only runs older than MIN_AGE are considered — a live run is never
//     completed out from under the worker still driving it;
//   • a run is only reconciled when its pages are ALL terminal (done/failed);
//   • reconcile_run_completion is atomic and status-guarded, so if a late page
//     finally (or another worker) completes the run first, this sweep does
//     nothing and does not double-post.
//
// The recovery side-effects are the same idempotent ones the normal completion
// path uses, each isolated so one failure cannot block the others or crash the
// interval. It runs in-process on the long-lived worker; prod runs a single
// worker box, and the atomic RPC keeps it correct even if that ever changes.
import { supabase } from "./supabase"
import { releaseRunSlot } from "./runSlot"
import { persistScanCheckResults } from "./runResults"
import { postFinalReportToTED } from "./tedSync"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

// How often to sweep. Cheap (a couple of indexed queries), floored at 60s.
const SWEEP_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.STUCK_RUN_SWEEP_MS || 300_000), // 5 min
)

// A run younger than this is still plausibly live; never reconcile it. Must
// comfortably exceed a normal end-to-end run's finalization window.
const MIN_AGE_MS = Math.max(
  60_000,
  Number(process.env.STUCK_RUN_MIN_AGE_MS || 600_000), // 10 min
)

let timer: NodeJS.Timeout | null = null

async function sweepOnce(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString()
    const { data: runs, error } = await supabase
      .from("qa_runs")
      .select("id, ted_task_id, run_type, pages_total, pages_processed, started_at")
      .eq("status", "running")
      .gt("pages_total", 0)
      .lt("started_at", cutoff)
      .limit(50)
    if (error) {
      logger.warn({ error: error.message }, "stuck-run sweep: qa_runs query failed")
      return
    }
    if (!runs || runs.length === 0) return

    for (const run of runs) {
      // Only act when every page is genuinely terminal — otherwise it is a live
      // run mid-scan, not a stuck one.
      const { count: doneCount, error: cErr } = await supabase
        .from("pages")
        .select("id", { count: "exact", head: true })
        .eq("run_id", run.id)
        .in("status", ["done", "failed"])
      if (cErr) {
        logger.warn(
          { runId: run.id, error: cErr.message },
          "stuck-run sweep: pages count failed",
        )
        continue
      }
      if ((doneCount ?? 0) < (run.pages_total ?? 0)) continue

      // Atomic, status-guarded complete. `true` only if THIS call won the flip.
      const { data: won, error: rErr } = await supabase.rpc(
        "reconcile_run_completion",
        { run_id_param: run.id },
      )
      if (rErr) {
        logger.warn(
          { runId: run.id, error: rErr.message },
          "stuck-run sweep: reconcile_run_completion RPC failed",
        )
        continue
      }
      if (won !== true) continue // already completed by another path, or not eligible

      logger.warn(
        {
          runId: run.id,
          runType: run.run_type,
          pagesTotal: run.pages_total,
          pagesProcessed: run.pages_processed,
          doneCount,
        },
        "stuck run reconciled to completed by sweeper — page counter had drifted below the real finished-page count",
      )

      // Recovery side-effects. All idempotent; each isolated.
      await persistScanCheckResults(run.id).catch((e) =>
        logger.warn(
          { runId: run.id, error: e?.message },
          "stuck-run sweep: persistScanCheckResults failed",
        ),
      )
      if (run.ted_task_id) {
        await postFinalReportToTED(run.id, String(run.ted_task_id)).catch((e) =>
          logger.warn(
            { runId: run.id, error: e?.message },
            "stuck-run sweep: postFinalReportToTED failed",
          ),
        )
      }
      await releaseRunSlot(run.id).catch(() => {})
    }
  } catch (e: any) {
    logger.warn({ error: e?.message }, "stuck-run sweep failed")
  }
}

/**
 * Start the periodic stuck-run sweeper. Idempotent; no-op if already started or
 * disabled via STUCK_RUN_SWEEP_DISABLED=true. The timer is unref'd so it never
 * keeps the process alive on its own.
 */
export function startStuckRunSweeper(): void {
  if (process.env.STUCK_RUN_SWEEP_DISABLED === "true") {
    logger.info("stuck-run sweeper disabled (STUCK_RUN_SWEEP_DISABLED=true)")
    return
  }
  if (timer) return
  timer = setInterval(() => {
    void sweepOnce()
  }, SWEEP_INTERVAL_MS)
  if (typeof timer.unref === "function") timer.unref()
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, minAgeMs: MIN_AGE_MS },
    "stuck-run sweeper started",
  )
}
