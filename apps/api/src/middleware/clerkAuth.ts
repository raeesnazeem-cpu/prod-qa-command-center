import { Request, Response, NextFunction } from "express"

export interface AuthPayload {
  userId: string
  clerkUserId: string
  orgId: string | null
  role: string | null
  email: string | null
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
function stampSystemIdentity(req: Request, email: string, clerkUserId: string) {
  req.auth = {
    userId: process.env.SYSTEM_USER_ID || DEFAULT_SYSTEM_USER_ID,
    clerkUserId,
    orgId: process.env.SYSTEM_ORG_ID || DEFAULT_SYSTEM_ORG_ID,
    role: "super_admin",
    email,
  }
}

// --- Login gate config (all env-driven; OFF by default) --------------------
// The gate is DISABLED unless AUTH_GATE_ENABLED === "true". While disabled,
// clerkAuth behaves EXACTLY as the old pass-through — zero behavior change — so
// deploying this code changes nothing until the env flag is flipped (after the
// frontend Google login is live). This is the safe, reversible rollout switch.
const AUTH_GATE_ENABLED = process.env.AUTH_GATE_ENABLED === "true"
// Human logins are limited to these Google Workspace domains.
const ALLOWED_DOMAINS = (
  process.env.AUTH_ALLOWED_DOMAINS || "growth99.com,growth99.net"
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ""

// Verify a Google ID token via Google's own tokeninfo endpoint. Google checks
// the signature and expiry for us and returns the claims (or a non-200 on any
// invalid/expired token). No extra npm dependency needed.
async function verifyGoogleIdToken(idToken: string): Promise<any | null> {
  try {
    const r = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" +
        encodeURIComponent(idToken),
    )
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

/**
 * Headless mode with an optional human login gate.
 *
 * - Gate OFF (default): unchanged pass-through — stamps the system identity and
 *   trusts every caller. Webhook routes never use this middleware; they stay on
 *   the TED shared secret regardless.
 * - Gate ON (AUTH_GATE_ENABLED=true): requires a valid Google ID token from an
 *   allowed domain (growth99.com / growth99.net). On success it still stamps the
 *   SAME super_admin system identity, so no downstream code / RBAC changes.
 *   No/invalid token → 401; wrong domain → 403.
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

  // Gate enabled → require a valid, allowed Google login.
  const authz = req.headers.authorization || ""
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : ""
  if (!token) {
    res.status(401).json({ error: "Login required" })
    return
  }

  const info = await verifyGoogleIdToken(token)
  if (!info || !info.email) {
    res.status(401).json({ error: "Invalid login" })
    return
  }
  // If a client id is configured, the token must have been minted for our app.
  if (GOOGLE_CLIENT_ID && info.aud !== GOOGLE_CLIENT_ID) {
    res.status(401).json({ error: "Invalid login (wrong app)" })
    return
  }
  const emailVerified = info.email_verified === true || info.email_verified === "true"
  const email = String(info.email).toLowerCase()
  const domain = email.split("@")[1] || ""
  if (!emailVerified || !ALLOWED_DOMAINS.includes(domain)) {
    res.status(403).json({ error: "This account is not allowed." })
    return
  }

  stampSystemIdentity(req, email, "google:" + (info.sub || ""))
  next()
}
