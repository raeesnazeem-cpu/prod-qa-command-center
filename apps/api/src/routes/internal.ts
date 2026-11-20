import { Router, Request, Response } from "express"
import { INTERNAL_TOKEN_HEADER, isValidInternalToken } from "@qacc/shared/internalAuth"
import { postTedAiComment } from "./webhooks"

/**
 * Routes only QACC's own worker calls, authenticated with the internal token
 * (packages/shared/src/internalAuth.ts).
 */
export const internalRouter: Router = Router()

/**
 * POST /internal/ted-comment { taskId, text, eventKey, aiAssigned? }
 * The worker relays its TED comments here so they post with the API's
 * X_API_KEY and show as "TED QA Agent" — the worker needs no TED key of its own.
 * 200 { posted: true } when TED took it; 502 { posted: false } otherwise, so the
 * worker falls back to its own path.
 */
internalRouter.post("/ted-comment", async (req: Request, res: Response) => {
  if (!isValidInternalToken("ted-comment", req.header(INTERNAL_TOKEN_HEADER))) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const { taskId, text, eventKey, aiAssigned } = req.body || {}
  if (!/^\d+$/.test(String(taskId ?? "")) || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "taskId (numeric) and text are required" })
  }
  const posted = await postTedAiComment(
    String(taskId),
    text,
    typeof eventKey === "string" ? eventKey : "",
    aiAssigned === true ? { aiAssigned: true } : {},
  )
  return res.status(posted ? 200 : 502).json({ posted })
})
