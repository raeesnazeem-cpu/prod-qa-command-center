// ECS task scale-in protection for the autoscaled worker service.
//
// On AWS the worker service grows and shrinks with the number of runs in flight
// (infra/terraform/autoscaling.tf). When it shrinks, ECS picks tasks to stop; a
// task that is in the middle of a page scan would lose that work (BullMQ re-runs
// it, but only after the 5-10 min stalled check). So while this worker has any
// job active it asks ECS not to stop it, and drops the request a little after it
// goes idle.
//
// On only when ECS_TASK_PROTECTION=true and the ECS agent endpoint exists
// (Fargate sets ECS_AGENT_URI). Elsewhere every call is a no-op. Never throws.
import pino from "pino"

const logger = pino({ level: process.env.LOG_LEVEL || "info" })

// Protection expires on its own after this long, so a crashed renew loop can
// never pin a task forever. Renewed while jobs keep running.
const EXPIRES_MINUTES = 60
const RENEW_MS = 20 * 60_000
// Wait this long after the last job before allowing scale-in: a run's page
// jobs arrive back to back, and flapping the flag on every gap is pointless.
const IDLE_GRACE_MS = Math.max(0, Number(process.env.ECS_PROTECTION_IDLE_MS || 120_000))

let active = 0
let protectedNow = false
let renewTimer: NodeJS.Timeout | null = null
let idleTimer: NodeJS.Timeout | null = null

function enabled(): boolean {
  return process.env.ECS_TASK_PROTECTION === "true" && !!process.env.ECS_AGENT_URI
}

async function setProtection(on: boolean): Promise<void> {
  try {
    const r = await fetch(`${process.env.ECS_AGENT_URI}/task-protection/v1/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        on ? { ProtectionEnabled: true, ExpiresInMinutes: EXPIRES_MINUTES } : { ProtectionEnabled: false },
      ),
    })
    if (!r.ok) {
      logger.warn({ status: r.status }, "ECS task protection update failed")
      return
    }
    protectedNow = on
  } catch (e: any) {
    logger.warn({ error: e?.message }, "ECS task protection update threw")
  }
}

export function jobStarted(): void {
  if (!enabled()) return
  active++
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!protectedNow) void setProtection(true)
  if (!renewTimer) {
    renewTimer = setInterval(() => void setProtection(true), RENEW_MS)
    renewTimer.unref()
  }
}

export function jobEnded(): void {
  if (!enabled()) return
  active = Math.max(0, active - 1)
  if (active > 0 || idleTimer) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (active > 0) return
    if (renewTimer) {
      clearInterval(renewTimer)
      renewTimer = null
    }
    void setProtection(false)
  }, IDLE_GRACE_MS)
  idleTimer.unref()
}

// Test seam.
export function _resetTaskProtection(): void {
  active = 0
  protectedNow = false
  if (renewTimer) clearInterval(renewTimer)
  if (idleTimer) clearTimeout(idleTimer)
  renewTimer = null
  idleTimer = null
}
