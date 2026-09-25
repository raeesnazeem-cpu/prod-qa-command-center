/**
 * AI-fix progress counter (drives ai_fix_done → TED's /progress bar).
 *
 * The fix has three stages and each finding goes through one of two paths:
 *  • deterministic handler (loop 1) — counts as 1 when decided;
 *  • LLM path — 0.7 when its triage batch returns (Phase A, the slow part) and
 *    the last 0.3 when its edit is applied/decided (Phase B, fast + serial).
 * So the bar keeps moving through triage instead of freezing, never counts a
 * finding twice, only ever goes up, and lands exactly on `total`.
 */
export const TRIAGE_WEIGHT = 0.7

export class FixProgress {
  private decided = 0 // loop-1 findings fully decided
  private triaged = 0 // LLM findings whose triage returned
  private applied = 0 // LLM findings finished in Phase B
  private last = 0

  constructor(readonly total: number) {}

  /** Loop 1: `n` = findings decided so far (analysis.length). Never goes down. */
  setDecided(n: number) {
    this.decided = Math.max(this.decided, n)
  }
  markTriaged(n = 1) {
    this.triaged += n
  }
  markApplied(n = 1) {
    this.applied += n
  }

  /** Whole findings decided so far, clamped to [0,total] and never decreasing. */
  processed(): number {
    const raw =
      this.decided +
      this.triaged * TRIAGE_WEIGHT +
      this.applied * (1 - TRIAGE_WEIGHT)
    // floor (+epsilon for float drift) so a finding only reads as done once its
    // last stage lands — never rounds up ahead of the real work.
    const v = Math.max(0, Math.min(this.total, Math.floor(raw + 1e-9)))
    this.last = Math.max(this.last, v)
    return this.last
  }
}

/**
 * Throttle a fire-and-forget writer: runs at most once per `ms`, and a call
 * inside the window schedules ONE trailing run so the latest state is never
 * lost during a long stall. `cancel()` drops a pending trailing run (call it
 * before the final write).
 */
export function throttleTrailing(fn: () => void, ms: number) {
  let lastRun = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = () => {
    timer = null
    lastRun = Date.now()
    fn()
  }
  const call = () => {
    const wait = lastRun + ms - Date.now()
    if (wait <= 0) {
      if (timer) clearTimeout(timer)
      run()
    } else if (!timer) {
      timer = setTimeout(run, wait)
    }
  }
  call.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return call
}
