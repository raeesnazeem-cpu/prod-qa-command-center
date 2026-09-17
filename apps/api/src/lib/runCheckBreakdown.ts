import { rollupChecks, type CheckBreakdown } from "@qacc/shared"
import { supabase } from "./supabase"
import { logger } from "./logger"

/**
 * Per-check pass/fail for a run, for the TED-facing progress endpoint.
 *
 * TED polls that endpoint every ~5 seconds for the whole length of a scan.
 * Classifying a finding means running regexes over its title AND description,
 * and descriptions are large (HTML, link tables, image manifests) — so doing
 * that work on every poll would mean dragging the run's entire finding set out
 * of the database several hundred times per scan to produce an answer that
 * barely changed.
 *
 * It barely changes because the answer can only change when a page finishes:
 * findings are written per page. So the result is cached against
 * `pages_processed` (plus whether the run has ended, which flips "not run yet"
 * into a verdict). A page takes minutes and a poll takes seconds, so the large
 * majority of polls are served from memory and never touch the database.
 *
 * Deliberately in-process and unshared: this is a cache of something cheap to
 * recompute, not state. Several API instances each keeping their own copy is
 * correct and needs no coordination.
 */

interface Entry {
  /** What the cached value was computed from; a change here means recompute. */
  key: string
  value: CheckBreakdown
  at: number
}

const cache = new Map<string, Entry>()

/** Bounds memory when many runs are polled. Entries are cheap; this is generous. */
const MAX_ENTRIES = 200

/** Nothing should be served from a snapshot older than this, even for a finished run. */
const TTL_MS = 30 * 60 * 1000

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return
  // Map preserves insertion order, so the oldest key is first. Dropping a live
  // entry is harmless — it is recomputed on the next poll.
  const oldest = cache.keys().next().value
  if (oldest !== undefined) cache.delete(oldest)
}

/**
 * The per-check board for `runId`.
 *
 * Returns null when the findings cannot be read — the caller then omits the
 * breakdown rather than reporting a board of zeros, which would read as "every
 * check passed with nothing found".
 */
export async function getCheckBreakdown(
  runId: string,
  enabledChecks: string[],
  pagesProcessed: number,
  runComplete: boolean,
): Promise<CheckBreakdown | null> {
  const key = `${pagesProcessed}:${runComplete ? 1 : 0}`
  const hit = cache.get(runId)
  if (hit && hit.key === key && Date.now() - hit.at < TTL_MS) {
    return hit.value
  }

  // Every finding, not just `status = open` — the same set the end-of-run report
  // classifies, so the live board and the final report agree about the run.
  // `title` and `description` are what the classifiers read; nothing else is
  // fetched, so the screenshot and inline-media columns stay out of this query.
  const { data, error } = await supabase
    .from("findings")
    .select("check_factor, title, description")
    .eq("run_id", runId)

  if (error) {
    logger.warn(
      { runId, error: error.message },
      "check breakdown: could not read findings",
    )
    return null
  }

  const value = rollupChecks(enabledChecks || [], data || [], runComplete)
  cache.set(runId, { key, value, at: Date.now() })
  evictIfNeeded()
  return value
}
