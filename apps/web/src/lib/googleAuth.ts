import axios from "axios"

// Simple Google login-gate helper (LOGIN GATE ONLY — no RBAC, no roles).
//
// The gate is OFF unless VITE_GOOGLE_CLIENT_ID is set at build time. When off,
// nothing here changes app behavior. When on, we store the Google ID token and
// attach it as the global axios Authorization header so EVERY api instance
// (the shared `api`, the useAuthAxios instance, bare axios) sends it — the
// backend `clerkAuth` gate verifies it.

const TOKEN_KEY = "qacc_google_id_token"

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ""
export const AUTH_ENABLED = !!GOOGLE_CLIENT_ID

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

// Read the `exp` claim (seconds) out of a JWT without verifying it — the
// backend does the real verification; here we only avoid sending a stale token.
function decodeExp(idToken: string): number {
  try {
    const payload = JSON.parse(atob(idToken.split(".")[1] || ""))
    return typeof payload.exp === "number" ? payload.exp : 0
  } catch {
    return 0
  }
}

export function tokenIsValid(idToken: string | null): boolean {
  if (!idToken) return false
  return decodeExp(idToken) * 1000 > Date.now() + 10_000 // 10s clock skew
}

export function applyToken(idToken: string): void {
  axios.defaults.headers.common["Authorization"] = `Bearer ${idToken}`
}

export function setToken(idToken: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, idToken)
  } catch {
    /* storage may be unavailable; header still applied for this session */
  }
  applyToken(idToken)
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  delete axios.defaults.headers.common["Authorization"]
}

// --- TED SSO handoff -------------------------------------------------------
// TED redirects the browser to https://qacc.raees.dev/sso#token=THE_TOKEN.
// The token rides in the URL hash (the "#..." part) on purpose: the hash is
// never sent to servers, never hits server logs, and never leaks in Referer.
//
// captureSsoTokenFromUrl() pulls that token out, stores it like any login
// token (so it's attached to every request as `Authorization: Bearer ...`),
// and scrubs it from the address bar. The backend does the real verification.
// Returns true if a usable token was captured. Safe to call more than once.
export function captureSsoTokenFromUrl(): boolean {
  try {
    const hash = window.location.hash || ""
    const m = hash.match(/[#&]token=([^&]+)/)
    if (!m) return false
    const token = decodeURIComponent(m[1])
    // Scrub the token from the URL no matter what, so it never lingers in
    // history or gets copy-pasted.
    scrubHash()
    if (!tokenIsValid(token)) return false // expired/garbage → normal login
    setToken(token)
    return true
  } catch {
    return false
  }
}

function scrubHash(): void {
  try {
    const clean = window.location.pathname + window.location.search
    window.history.replaceState(null, "", clean || "/")
  } catch {
    /* ignore */
  }
}
