// Per-check timing instrumentation for a QA run.
//
// Every check dispatched through crawlPageJob's schedule()/scheduleOnSharedPage()
// is wrapped in timeCheck(), which records the wall-clock duration of that
// check's factory. Because checks run CONCURRENTLY (pLimit lanes), the per-check
// wall times OVERLAP — the sum of them is NOT the run's total. The true total is
// the run wall-clock (started_at → completion), reported separately.
//
// A run holds the global run slot for its whole life, so only ONE run executes
// at a time in this process — keying by runId can never collide across runs.
// The map is cleared at closeout after the report is posted.
import { supabase } from "./supabase"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

export type CheckTiming = {
  name: string
  pageUrl: string
  durationMs: number
  ok: boolean
}

const timings = new Map<string, CheckTiming[]>()

function push(runId: string, t: CheckTiming): void {
  const arr = timings.get(runId) || []
  arr.push(t)
  timings.set(runId, arr)
}

/**
 * Time a single check factory. The factories in crawlPageJob already swallow
 * their own errors (each ends in .catch(lapse(...))), so this normally resolves;
 * the try/catch is defensive so a throwing check is still recorded and re-thrown.
 */
export async function timeCheck<T>(
  runId: string,
  name: string,
  pageUrl: string,
  factory: () => Promise<T>,
): Promise<T> {
  const startMs = Date.now()
  try {
    const out = await factory()
    push(runId, { name, pageUrl, durationMs: Date.now() - startMs, ok: true })
    return out
  } catch (e) {
    push(runId, { name, pageUrl, durationMs: Date.now() - startMs, ok: false })
    throw e
  }
}

/**
 * Record a timing for work that doesn't go through the scheduler (e.g. the
 * run-level cross-browser check that runs at closeout).
 */
export function recordTiming(
  runId: string,
  name: string,
  pageUrl: string,
  durationMs: number,
  ok = true,
): void {
  push(runId, { name, pageUrl, durationMs, ok })
}

export function getRunTimings(runId: string): CheckTiming[] {
  return timings.get(runId) || []
}

export function clearRunTimings(runId: string): void {
  timings.delete(runId)
}

const fmt = (ms: number): string => {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  return `${m}m ${(s - m * 60).toFixed(1)}s`
}

type Agg = { name: string; count: number; total: number; min: number; max: number }

function aggregate(rows: CheckTiming[]): Agg[] {
  const byName = new Map<string, Agg>()
  for (const r of rows) {
    const a =
      byName.get(r.name) ||
      { name: r.name, count: 0, total: 0, min: Infinity, max: 0 }
    a.count += 1
    a.total += r.durationMs
    a.min = Math.min(a.min, r.durationMs)
    a.max = Math.max(a.max, r.durationMs)
    byName.set(r.name, a)
  }
  return [...byName.values()].sort((x, y) => y.total - x.total)
}

export type TimingReport = {
  runId: string
  siteUrl: string | null
  pagesTotal: number | null
  totalWallMs: number | null
  sumOfChecksMs: number
  checkRuns: number
  checks: Agg[]
}

/**
 * Aggregate the run's timings into a plain analytics object. Returns null when
 * no checks were timed. This is ANALYTICS ONLY — it is never posted to TED.
 */
export async function buildTimingReport(runId: string): Promise<TimingReport | null> {
  const rows = getRunTimings(runId)
  if (rows.length === 0) return null

  const { data: run } = await supabase
    .from("qa_runs")
    .select("started_at, completed_at, site_url, pages_total")
    .eq("id", runId)
    .single()

  // True total = run wall-clock (started_at → completed_at/now).
  let totalWallMs: number | null = null
  if (run?.started_at) {
    const start = new Date(run.started_at).getTime()
    const end = run.completed_at ? new Date(run.completed_at).getTime() : Date.now()
    totalWallMs = end - start
  }

  return {
    runId,
    siteUrl: run?.site_url ?? null,
    pagesTotal: run?.pages_total ?? null,
    totalWallMs,
    sumOfChecksMs: rows.reduce((s, r) => s + r.durationMs, 0),
    checkRuns: rows.length,
    checks: aggregate(rows),
  }
}

function renderTable(report: TimingReport): string {
  const pad = (s: string, n: number) => s.padEnd(n)
  const padR = (s: string, n: number) => s.padStart(n)
  const lines: string[] = []
  lines.push(
    `${pad("CHECK", 24)} ${padR("RUNS", 5)} ${padR("TOTAL", 10)} ${padR("AVG", 10)} ${padR("SLOWEST", 10)}`,
  )
  lines.push("-".repeat(63))
  for (const a of report.checks) {
    lines.push(
      `${pad(a.name, 24)} ${padR(String(a.count), 5)} ${padR(fmt(a.total), 10)} ${padR(fmt(Math.round(a.total / a.count)), 10)} ${padR(fmt(a.max), 10)}`,
    )
  }
  lines.push("-".repeat(63))
  lines.push(
    `TOTAL scan wall-clock: ${report.totalWallMs != null ? fmt(report.totalWallMs) : "—"}   ` +
      `Sum of check times: ${fmt(report.sumOfChecksMs)} across ${report.checkRuns} check runs`,
  )
  return lines.join("\n")
}

/**
 * Analytics sink for a finished run: log a readable timing table to the worker
 * log AND persist the structured report as JSON, then clear the buffer.
 * Deliberately does NOT touch TED — timing is analytics only.
 */
export async function saveTimingReport(runId: string): Promise<void> {
  try {
    const report = await buildTimingReport(runId)
    if (!report) {
      logger.info({ runId }, "No check timings recorded; nothing to save.")
      return
    }

    const table = renderTable(report)
    logger.info(
      { runId },
      `\n===== INTERNAL QA CHECK TIMINGS =====\nSite: ${report.siteUrl ?? "—"} · Pages: ${report.pagesTotal ?? "—"}\n${table}\n=====================================`,
    )

    const dir = path.join(
      process.env.CHECK_TIMINGS_DIR || path.join(os.tmpdir(), "qacc-check-timings"),
    )
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `timings-${runId}.json`)
    fs.writeFileSync(file, JSON.stringify(report, null, 2))
    logger.info({ runId, file }, "Saved check-timing analytics.")
  } catch (e: any) {
    logger.warn({ runId, error: e?.message }, "Failed to save check-timing analytics.")
  } finally {
    clearRunTimings(runId)
  }
}

// ---------------------------------------------------------------------------
// AI-fix step timings — a SEPARATE bucket from the scan-check timings above.
// The AI fix runs as its own job (ai_fix_run) after the scan, so it logs its own
// "AI FIX STEP TIMINGS" table at the end of that job. Same single-run-at-a-time
// invariant (global run slot) keeps the runId keying safe.
// ---------------------------------------------------------------------------
const aiFixTimings = new Map<string, CheckTiming[]>()

/** Record one AI-fix step's wall-clock, labelled (usually the check_factor). */
export function recordAiFixTiming(
  runId: string,
  label: string,
  durationMs: number,
  ok = true,
): void {
  const arr = aiFixTimings.get(runId) || []
  arr.push({ name: label, pageUrl: "", durationMs, ok })
  aiFixTimings.set(runId, arr)
}

/**
 * Log the AI-fix step-timing table to the worker log and clear the buffer.
 * `totalWallMs` is the whole ai_fix_run job's wall-clock (steps are largely
 * serial here, so it should roughly equal the sum). Analytics only.
 */
export function saveAiFixTimingReport(runId: string, totalWallMs?: number): void {
  try {
    const rows = aiFixTimings.get(runId) || []
    if (rows.length === 0) {
      logger.info({ runId }, "No AI-fix timings recorded; nothing to log.")
      return
    }
    const aggs = aggregate(rows)
    const sum = rows.reduce((s, r) => s + r.durationMs, 0)

    const pad = (s: string, n: number) => s.padEnd(n)
    const padR = (s: string, n: number) => s.padStart(n)
    const lines: string[] = []
    lines.push(
      `${pad("AI-FIX STEP", 26)} ${padR("N", 4)} ${padR("TOTAL", 10)} ${padR("AVG", 10)} ${padR("SLOWEST", 10)}`,
    )
    lines.push("-".repeat(64))
    for (const a of aggs) {
      lines.push(
        `${pad(a.name, 26)} ${padR(String(a.count), 4)} ${padR(fmt(a.total), 10)} ${padR(fmt(Math.round(a.total / a.count)), 10)} ${padR(fmt(a.max), 10)}`,
      )
    }
    lines.push("-".repeat(64))
    lines.push(
      `TOTAL ai-fix wall-clock: ${totalWallMs != null ? fmt(totalWallMs) : "—"}   ` +
        `Sum of step times: ${fmt(sum)} across ${rows.length} steps`,
    )
    logger.info(
      { runId },
      `\n===== AI FIX STEP TIMINGS =====\n${lines.join("\n")}\n===============================`,
    )
  } catch (e: any) {
    logger.warn({ runId, error: e?.message }, "Failed to log AI-fix step timings.")
  } finally {
    aiFixTimings.delete(runId)
  }
}
