import { connection } from "./queue"

// Report gate — closes the race between the page scan and the standalone API
// checks (project_plan, paid_media). They run as independent jobs, so without
// this the last page could post the TED report before the API findings land.
//
// One Redis SET per run holds the parts still running ("pages" + each API
// check). Every part removes itself when it finishes; the ONE removal that
// empties the set wins and finalizes the run (cross-browser, report, AI fix).
// O(1) time per call, O(k) space for k parts (k <= 3), auto-expires.
//
// No gate (key never armed, expired, or Redis error) → "none": the page scan
// finalizes on its own exactly as before, and API jobs never finalize. That
// keeps page-only runs, API-only runs and single-check retries unchanged.

export const PAGES_PART = "pages"
const TTL_SECONDS = 24 * 60 * 60

const gateKey = (runId: string) => `qacc:report-gate:${runId}`

// Atomic remove-and-check. 1 = this call emptied the gate (finalize now),
// 0 = other parts still running, -1 = no gate for this run.
const RELEASE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local removed = redis.call('SREM', KEYS[1], ARGV[1])
if removed == 1 and redis.call('SCARD', KEYS[1]) == 0 then return 1 end
return 0
`

export type GateResult = "open" | "wait" | "none"

/** Arm the gate before any page or API job is enqueued. */
export async function armReportGate(
  runId: string,
  apiChecks: string[],
): Promise<void> {
  if (apiChecks.length === 0) return
  const key = gateKey(runId)
  await connection
    .multi()
    .del(key)
    .sadd(key, PAGES_PART, ...apiChecks)
    .expire(key, TTL_SECONDS)
    .exec()
}

/** Mark one part finished. "open" means the caller must finalize the run. */
export async function releaseReportGate(
  runId: string,
  part: string,
): Promise<GateResult> {
  try {
    const res = await connection.eval(RELEASE_SCRIPT, 1, gateKey(runId), part)
    return res === 1 ? "open" : res === 0 ? "wait" : "none"
  } catch {
    return "none"
  }
}
