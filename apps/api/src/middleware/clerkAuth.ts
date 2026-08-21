import { Request, Response, NextFunction } from "express"
import { QACC_SESSION_COOKIE, readCookie, verifyQaccSession } from "../lib/qaccSession"

export interface AuthPayload {
  userId: string
  clerkUserId: string
  orgId: string | null
  role: string | null
  email: string | null
  name: string | null
  photo: string | null
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload
    }
  }
}

/**
 * The deployment is single-tenant: one organisation ("Default Organization")
 * owns every project, user and run, so these are constants rather than
 * configuration. They are real rows — `created_by` and `org_id` are FKs, and a
 * fabricated UUID would violate them. SYSTEM_USER_ID / SYSTEM_ORG_ID still
 * override if the target database ever changes.
 */
const DEFAULT_SYSTEM_USER_ID = "7e6b260d-39b5-4485-b8e5-578a995625a9" // tedsystem-…@ted.internal
const DEFAULT_SYSTEM_ORG_ID = "57d2a6b4-3131-493b-9253-fbf8c748487e" // Default Organization

// Stamp the synthetic system identity on the request. Role stays "super_admin"
// so requireRole() and every downstream reader keep working exactly as before —
// this is a LOGIN GATE ONLY, not a re-introduction of RBAC. `email` is the one
// field that reflects the real signed-in human (when the gate is on).
function stampSystemIdentity(
  req: Request,
  email: string,
  clerkUserId: string,
  name?: string,
  photo?: string,
) {
  req.auth = {
    userId: process.env.SYSTEM_USER_ID || DEFAULT_SYSTEM_USER_ID,
    clerkUserId,
    orgId: process.env.SYSTEM_ORG_ID || DEFAULT_SYSTEM_ORG_ID,
    role: "super_admin",
    email,
    name: name ?? null,
    photo: photo ?? null,
  }
}

// --- Login gate config (env-driven; OFF by default) ------------------------
// The gate is DISABLED unless AUTH_GATE_ENABLED === "true". While disabled,
// clerkAuth behaves EXACTLY as the old pass-through — zero behavior change.
const AUTH_GATE_ENABLED = process.env.AUTH_GATE_ENABLED === "true"

/**
 * Headless mode gated by TED SSO only.
 *
 * - Gate OFF (default): unchanged pass-through — stamps the system identity
 *   and trusts every caller. Webhook routes never use this middleware; they
 *   stay on the TED shared secret regardless.
 * - Gate ON (AUTH_GATE_ENABLED=true): requires a valid qacc_session cookie,
 *   which is established ONLY by POST /api/auth/ted-exchange after a TED SSO
 *   ticket was verified (see routes/auth.ts). There is deliberately no
 *   independent bearer-token fallback here — TED SSO is the sole login
 *   authority for this gate, so a caller cannot reach an authenticated
 *   identity without first completing the TED → qacc_session exchange.
 */
export const clerkAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Gate disabled → original behavior, untouched.
  if (!AUTH_GATE_ENABLED) {
    stampSystemIdentity(req, "system@qacc.internal", "system")
    next()
    return
  }

  // TED SSO session cookie — the only credential this gate accepts.
  const sessionToken = readCookie(req, QACC_SESSION_COOKIE)
  const session = sessionToken ? verifyQaccSession(sessionToken) : null
  if (!session) {
    res.status(401).json({ error: "Login required" })
    return
  }
  stampSystemIdentity(req, session.email, "ted:" + session.email, session.name, session.photo)
  next()
}
