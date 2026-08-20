import { createHmac, timingSafeEqual } from "crypto"
import type { Request } from "express"

// ---------------------------------------------------------------------------
// QACC's own signed application session.
//
// Established by routes/auth.ts after a TED SSO ticket (see middleware/tedSso)
// or a Google ID token is verified. TED (or Google) only vouches for the
// identity — QACC decides independently what "signed in" means on its side,
// the same design as g99-web-audit's cro_session. Signed with QACC_SESSION_SECRET,
// a QACC-only secret never shared with TED or any other app.
// ---------------------------------------------------------------------------

export const QACC_SESSION_COOKIE = "qacc_session"

// 20 minutes — a backstop expiry. Normal refresh comes from TedSessionGuard's
// ~3-minute silent-check tick on the frontend re-exchanging a fresh ticket.
const SESSION_TTL_SECONDS = 20 * 60

export interface QaccSessionClaims {
  email: string
  name: string
  photo: string
  exp: number
}

function secret(): string {
  const s = process.env.QACC_SESSION_SECRET
  if (!s) throw new Error("QACC_SESSION_SECRET is not configured")
  return s
}

function hmac(payload: string): string {
  return createHmac("sha256", secret()).update(payload, "utf8").digest("base64url")
}

export function signQaccSession(claims: { email: string; name?: string; photo?: string }): string {
  const payload: QaccSessionClaims = {
    email: claims.email,
    name: claims.name ?? "",
    photo: claims.photo ?? "",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url")
  return `${payloadB64}.${hmac(payloadJson)}`
}

export function verifyQaccSession(token: string | undefined | null): QaccSessionClaims | null {
  if (!token) return null
  try {
    const parts = token.split(".")
    if (parts.length !== 2) return null
    const [payloadB64, sig] = parts
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8")
    const sigBuf = Buffer.from(sig)
    const expectedBuf = Buffer.from(hmac(payloadJson))
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
    const claims: QaccSessionClaims = JSON.parse(payloadJson)
    if (!claims.email || !Number.isFinite(claims.exp)) return null
    if (Date.now() / 1000 > claims.exp) return null
    return claims
  } catch {
    return null
  }
}

/** Minimal manual cookie-header reader — avoids adding cookie-parser for a single cookie. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}
