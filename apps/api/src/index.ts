import "dotenv/config"
import express, { Request, Response, NextFunction } from "express"
import helmet from "helmet"
import cors from "cors"

import { logger } from "./lib/logger"
import { defaultRateLimiter } from "./middleware/rateLimiter"
import { healthRouter } from "./routes/health"
import { webhookRouter } from "./routes/webhooks"
import { meRouter } from "./routes/me"
import { projectsRouter } from "./routes/projects"
import { usersRouter } from "./routes/users"
import { userSettingsRouter } from "./routes/userSettings"
import { runsRouter } from "./routes/runs"
import { tasksRouter } from "./routes/tasks"
import { statsRouter } from "./routes/stats"
import { dashboardRouter } from "./routes/dashboard"
import { signOffRouter } from "./routes/signOff"
import { projectSettingsRouter } from "./routes/projectSettings"
import { debugRouter } from "./routes/debug"
import { testWebhookRouter } from "./routes/test-webhook"
import { adminRouter } from "./routes/admin"
import { findingsRouter } from "./routes/findings"
import { visualDiffRouter } from "./routes/visualDiff"
import { chatRouter } from "./routes/chat"
import { systemSettingsRouter } from "./routes/systemSettings"
import { basecampIntegrationRouter } from "./routes/basecampIntegration"
import { onboardingRouter } from "./routes/onboarding"
import { proxyRouter } from "./routes/proxy"
import { storageRouter } from "./routes/storage"
import { recordingsRouter } from "./routes/recordings"
import { clerkMiddleware, getAuth } from "@clerk/express"
import { createBullBoard } from "@bull-board/api"
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter"
import { ExpressAdapter } from "@bull-board/express"
import { qaQueue } from "./lib/queue"

const app: express.Application = express()
const PORT = process.env.PORT ?? 3001

if (!process.env.CLERK_SECRET_KEY) {
  logger.error("Missing CLERK_SECRET_KEY in environment variables")
} else {
  logger.info("CLERK_SECRET_KEY is set")
}
logger.info(`FRONTEND_URL configured as: ${process.env.FRONTEND_URL}`)

// Security & parsing middleware
app.use(helmet())
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  }),
)

// Webhook mount BEFORE express.json() and BEFORE Clerk middleware
// We use express.raw to get the exact bytes needed for signature verification
app.use("/webhooks", express.raw({ type: "application/json" }), webhookRouter)
app.use(
  "/webhooks",
  express.raw({ type: "application/json" }),
  basecampIntegrationRouter,
)

app.use(express.json({ limit: "50mb" }))
app.use(defaultRateLimiter)

// Clerk middleware for other routes
app.use(clerkMiddleware())

// BullBoard setup
const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath("/admin/queues")

createBullBoard({
  queues: [new BullMQAdapter(qaQueue as any)],
  serverAdapter: serverAdapter,
})

app.use("/admin/queues", serverAdapter.getRouter())

app.use((req, res, next) => {
  const auth = getAuth(req)
  console.log("--- Clerk Auth Debug ---")
  console.log("User ID:", auth.userId)
  console.log("Session ID:", auth.sessionId)
  // @ts-ignore - claims might be sessionClaims in some versions
  console.log("Claims:", auth.sessionClaims || (auth as any).claims)
  next()
})

// Core Routes
app.use("/api/me", meRouter)
app.use("/api/dashboard", dashboardRouter)
app.use("/api/system-settings", systemSettingsRouter)
app.use("/api", proxyRouter)

// Resource Routes
app.use("/api/health", healthRouter)
app.use("/api/projects", projectSettingsRouter)
app.use("/api/projects", projectsRouter)
app.use("/api/users", userSettingsRouter)
app.use("/api/users", onboardingRouter)
app.use("/api/users", usersRouter)
app.use("/api/runs", runsRouter)
app.use("/api/runs", signOffRouter)
app.use("/api/tasks", tasksRouter)
app.use("/api/stats", statsRouter)
app.use("/api/admin", adminRouter)
app.use("/api/findings", findingsRouter)
app.use("/api/visual-diff", visualDiffRouter)
app.use("/api/chat", chatRouter)
app.use("/api/tasks", basecampIntegrationRouter)
app.use("/api/basecamp", basecampIntegrationRouter)
app.use("/api/storage", storageRouter)
app.use("/api/recordings", recordingsRouter)
app.use("/debug", debugRouter)

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
