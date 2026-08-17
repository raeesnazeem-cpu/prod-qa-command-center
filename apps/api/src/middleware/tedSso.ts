import { createRemoteJWKSet, jwtVerify, decodeJwt, type JWTPayload } from "jose"

// ---------------------------------------------------------------------------
// TED → QACC Single Sign-On: verify a TED-minted login token.
//
// TED signs a short-lived JWT ("for QACC only") with its PRIVATE key and
// publishes matching PUBLIC keys at a JWKS URL. QACC downloads those keys and
// verifies the token with NO shared password. See docs/qacc-ted-sso/.
//
// This module ONLY verifies. clerkAuth.ts decides what to do with the result
// (it stamps the same shared super_admin identity as a Google login).
// ---------------------------------------------------------------------------

// OFF by default — flip SSO_TED_ENABLED=true only after TED's side is live.
export const SSO_TED_ENABLED = process.env.SSO_TED_ENABLED === "true"

const TED_JWKS_URL = process.env.TED_JWKS_URL || ""
const TED_JWT_ISSUER = process.env.TED_JWT_ISSUER || "https://ted.growth99.com"
const TED_JWT_AUDIENCE = process.env.TED_JWT_AUDIENCE || "qacc"

// Same company domains the Google gate allows. Reuses AUTH_ALLOWED_DOMAINS.
const ALLOWED_DOMAINS = (
  process.env.AUTH_ALLOWED_DOMAINS || "growth99.com,growth99.net"
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean)

// The JWKS key set is fetched lazily and cached (jose refreshes it and handles
// key rotation on its own). Built once, on first use.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getJwks() {
  if (!jwks && TED_JWKS_URL) jwks = createRemoteJWKSet(new URL(TED_JWKS_URL))
  return jwks
}

/**
 * Peek at a token's `iss` WITHOUT verifying it, so clerkAuth can route:
 * TED-issued token → this module; anything else → the Google path.
 * Returns false for non-JWTs and any token not claiming TED as issuer.
 */
export function isTedIssuedToken(token: string): boolean {
  if (!SSO_TED_ENABLED) return false
  try {
    const claims: JWTPayload = decodeJwt(token)
    return claims.iss === TED_JWT_ISSUER
  } catch {
    return false
  }
}

export type TedSsoResult =
  | { ok: true; email: string; sub: string }
  | { ok: false; status: number; error: string }

/**
 * Fully verify a TED SSO token: signature (via JWKS), issuer, audience (=qacc),
 * expiry, and an allowed company email domain. jose does the crypto — we never
 * hand-roll the checks. On any failure we return a status + safe message; we
 * NEVER log the token itself.
 *
 * Note on replay (`jti`): the token intentionally doubles as QACC's session
 * bearer for its full 2-hour life — the browser attaches it to EVERY request —
 * so it is used many times by design. Single-use `jti` rejection would break
 * the app on the second request. Safety instead rests on: HTTPS-only transit,
 * `aud=qacc` (unusable elsewhere), and the short 2-hour expiry.
 */
export async function verifyTedSsoToken(token: string): Promise<TedSsoResult> {
  const keys = getJwks()
  if (!keys) {
    // SSO flagged on but TED_JWKS_URL missing — misconfiguration, not the
    // user's fault. 503 so the frontend can fall back to Google sign-in.
    return { ok: false, status: 503, error: "SSO not configured" }
  }

  let payload: JWTPayload
  try {
    const res = await jwtVerify(token, keys, {
      issuer: TED_JWT_ISSUER,
      audience: TED_JWT_AUDIENCE,
    })
    payload = res.payload
  } catch {
    return { ok: false, status: 401, error: "Invalid login" }
  }

  const email = String(payload.email || "").toLowerCase()
  const domain = email.split("@")[1] || ""
  if (!email || !ALLOWED_DOMAINS.includes(domain)) {
    return { ok: false, status: 403, error: "This account is not allowed." }
  }

  return { ok: true, email, sub: String(payload.sub || "") }
}
