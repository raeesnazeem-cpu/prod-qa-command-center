import { createHmac, timingSafeEqual } from "crypto"

/**
 * Worker → API calls on QACC's own internal routes. Both services already hold
 * SUPABASE_SERVICE_ROLE_KEY, so the token is derived from it (HMAC per
 * purpose): no new secret to configure, and the raw key never travels.
 */
export const INTERNAL_TOKEN_HEADER = "x-qacc-internal-token"

export function internalToken(purpose: string, secret = process.env.SUPABASE_SERVICE_ROLE_KEY): string | null {
  if (!secret) return null
  return createHmac("sha256", secret).update(`qacc-internal:${purpose}`).digest("hex")
}

export function isValidInternalToken(purpose: string, given: unknown, secret = process.env.SUPABASE_SERVICE_ROLE_KEY): boolean {
  const expected = internalToken(purpose, secret)
  if (!expected || typeof given !== "string" || given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}
