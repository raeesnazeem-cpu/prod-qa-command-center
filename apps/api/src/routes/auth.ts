import { Router, Request, Response } from "express"
import type { CookieOptions } from "express"
import { verifyTedSsoTicket } from "../middleware/tedSso"
import { clerkAuth } from "../middleware/clerkAuth"
import { QACC_SESSION_COOKIE, signQaccSession } from "../lib/qaccSession"

export const authRouter: Router = Router()

// QACC's frontend (apps/web) and API (apps/api) are deployed as separate
// origins, so this cookie travels on cross-site requests — SameSite=None is
// required for the browser to attach it at all, which in turn requires
// Secure unconditionally (browsers refuse to set/send a SameSite=None cookie
// without Secure). Secure cookies still work over plain http://localhost in
// Chromium/Firefox dev builds, which treat localhost as a "potentially
// trustworthy" origin — no local HTTPS setup needed.
const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: "none",
  secure: true,
  path: "/",
}

/**
 * Exchanges a TED SSO ticket for a qacc_session cookie. Used both for the
 * initial "Continue with TED" login and for TedSessionGuard's periodic
 * silent-check refresh — both hand this the same shape of ticket.
 */
authRouter.post("/ted-exchange", (req: Request, res: Response) => {
  const ticket = typeof req.body?.ticket === "string" ? req.body.ticket : null
  const claims = verifyTedSsoTicket(ticket)
  if (!claims) {
    res.status(401).json({ error: "invalid_or_expired_ticket" })
    return
  }
  const session = signQaccSession({ email: claims.email, name: claims.name, photo: claims.photo })
  res.cookie(QACC_SESSION_COOKIE, session, SESSION_COOKIE_OPTIONS)
  res.json({ ok: true, email: claims.email, name: claims.name, photo: claims.photo })
})

/**
 * QACC's own logout. Clears only qacc_session — deliberately never touches
 * TED, so signing out of QACC never signs the user out of TED or any other
 * TED-integrated app.
 */
authRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(QACC_SESSION_COOKIE, SESSION_COOKIE_OPTIONS)
  res.status(204).end()
})

/** Identity behind the current session — backs the profile menu. */
authRouter.get("/me", clerkAuth, (req: Request, res: Response) => {
  res.json({
    email: req.auth?.email ?? null,
    name: req.auth?.name ?? null,
    photo: req.auth?.photo ?? null,
  })
})
