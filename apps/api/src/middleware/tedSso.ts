import { createHmac, timingSafeEqual } from "crypto"

// ---------------------------------------------------------------------------
// TED → QACC Single Sign-On: verify a TED-minted SSO ticket.
//
// TED mints a short-lived (5 minute) ticket using the same HMAC-SHA256 scheme
// it already uses for website-build-tool and g99-web-audit — NOT a JWT/JWKS
// token. QACC verifies it with a shared secret (TED_SSO_SECRET), which must
// equal TED's own QACC_SSO_SECRET exactly. A dedicated per-app secret, never
// BUILD_TOOL_SSO_SECRET or WEB_AUDIT_SSO_SECRET.
//
// This module ONLY verifies the one-time ticket used to establish a session
// (see routes/auth.ts). It is never used per-request — routes/auth.ts signs a
// QACC-owned qacc_session (lib/qaccSession.ts) that authenticates every
// subsequent request instead, because a 5-minute ticket isn't suitable as a
// long-lived bearer credential.
// ---------------------------------------------------------------------------

// OFF by default — flip SSO_TED_ENABLED=true only after TED's side is live.
export const SSO_TED_ENABLED = process.env.SSO_TED_ENABLED === "true"

export interface TedTicketClaims {
  email: string
  name: string
  photo: string
  exp: number
}

function secret(): string | undefined {
  return process.env.TED_SSO_SECRET || undefined
}

function hmac(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url")
}

/**
 * Verify a TED SSO ticket: signature (HMAC-SHA256, constant-time compare) and
 * expiry. There is no `aud`/app-identifier claim in TED's ticket format — app
 * scoping is enforced entirely by QACC holding a dedicated secret that no
 * other consumer app is given, matching the existing build-tool/web-audit
 * design.
 */
export function verifyTedSsoTicket(token: string | undefined | null): TedTicketClaims | null {
  const key = secret()
  if (!key || !token) return null
  try {
    const parts = token.split(".")
    if (parts.length !== 2) return null
    const [payloadB64, sig] = parts
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8")
    const sigBuf = Buffer.from(sig)
    const expectedBuf = Buffer.from(hmac(payloadJson, key))
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
    const claims: TedTicketClaims = JSON.parse(payloadJson)
    if (!claims.email || !Number.isFinite(claims.exp)) return null
    if (Date.now() / 1000 > claims.exp) return null
    return claims
  } catch {
    return null
  }
}
