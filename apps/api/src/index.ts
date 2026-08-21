import "dotenv/config"
import fs from "fs"
import path from "path"

// Bootstrap GCP credentials from environment variable (for Docker deployments)
// Must run before any @google-cloud/* SDK modules are initialised
if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
  try {
    const keyPath = path.join("/tmp", "gcp-key.json")
    fs.writeFileSync(keyPath, process.env.GCP_SERVICE_ACCOUNT_JSON)
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath
    console.log("Successfully loaded GCP credentials into:", keyPath)
  } catch (err) {
    console.error("Failed to write GCP credentials file:", err)
  }
}

import express, { Request, Response, NextFunction } from "express"
import helmet from "helmet"
import cors from "cors"

import { logger } from "./lib/logger"
import { defaultRateLimiter } from "./middleware/rateLimiter"
import { healthRouter } from "./routes/health"
import { webhookRouter } from "./routes/webhooks"
import { runsRouter } from "./routes/runs"
import { aiFixRunsRouter } from "./routes/ai-fix-runs"
import { findingsRouter } from "./routes/findings"
import { projectsRouter } from "./routes/projects"
import { tedCommentsRouter } from "./routes/tedComments"
import { authRouter } from "./routes/auth"
import { createBullBoard } from "@bull-board/api"
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter"
import { ExpressAdapter } from "@bull-board/express"
import { qaQueue } from "./lib/queue"

const app: express.Application = express()
const PORT = process.env.PORT ?? 3001

logger.info(`FRONTEND_URL configured as: ${process.env.FRONTEND_URL}`)

// Security & parsing middleware
app.use(helmet())
app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  }),
)

// Webhook mount BEFORE express.json() — express.raw gives the exact bytes
// needed for TED signature verification.
app.use("/webhooks", express.raw({ type: "application/json" }), webhookRouter)

app.use(express.json({ limit: "50mb" }))
app.use(defaultRateLimiter)

// Headless mode: no Clerk. TED owns auth/RBAC. clerkAuth is a pass-through
// stamping a synthetic system identity (see middleware/clerkAuth.ts).

// BullBoard — queue visibility for the scan pipeline
const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath("/admin/queues")
createBullBoard({
  queues: [new BullMQAdapter(qaQueue as any)],
  serverAdapter: serverAdapter,
})
app.use("/admin/queues", serverAdapter.getRouter())

// TED SSO login/logout/session endpoints — unauthenticated by definition
// (this is where a session gets established or cleared in the first place).
app.use("/api/auth", authRouter)

// Headless API surface — scan trigger + report reads only
app.use("/api/health", healthRouter)
app.use("/api/runs", runsRouter)
app.use("/api/ai-fix-runs", aiFixRunsRouter)
app.use("/api/findings", findingsRouter)
app.use("/api/projects", projectsRouter)
app.use("/api/ted-comments", tedCommentsRouter)

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" })
})

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(err, "Unhandled error")
  res.status(500).json({ error: "Internal server error" })
})

app.listen(PORT, () => {
  logger.info(`API server running on port ${PORT}`)
})

export default app
