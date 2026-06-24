import { Router, Request, Response } from "express"
import { clerkAuth } from "../middleware/clerkAuth"
import { requireRole } from "../middleware/requireRole"
import { qaQueue } from "../lib/queue"
import { logger } from "../lib/logger"
import { supabase } from "../lib/supabase"

const router: Router = Router()

/**
 * POST /api/admin/ping-worker
 * Enqueues a 'test' job to verify worker connectivity.
 */
router.post(
  "/ping-worker",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const job = await qaQueue.add("test", {
        source: "Week1TestPage",
        timestamp: new Date().toISOString(),
        triggeredBy: req.auth?.userId,
      })

      return res.json({
        success: true,
        jobId: job.id,
        message: "Test job enqueued",
      })
    } catch (error: unknown) {
      const err = error as Error
      logger.error({ error: err.message }, "Failed to ping worker")
      return res.status(500).json({ error: err.message })
    }
  },
)

/**
 * GET /api/admin/queue-stats
 * Returns job counts from the 'qa-jobs' queue.
 */
router.get(
  "/queue-stats",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const counts = await qaQueue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
      )
      return res.json(counts)
    } catch (error: unknown) {
      const err = error as Error
      logger.error({ error: err.message }, "Failed to fetch queue stats")
      return res.status(500).json({ error: err.message })
    }
  },
)

/**
 * GET /api/admin/redis-info
 * Returns real-time Redis performance and connection stats.
 */
router.get(
  "/redis-info",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const redis = qaQueue.opts.connection as any
      const stats = await redis.info("stats")
      const clients = await redis.info("clients")

      const parseInfo = (info: string) => {
        const result: Record<string, string> = {}
        // Handle both \n (Unix/Mac) and \r\n (Windows/Cloud)
        info.split(/\r?\n/).forEach((line) => {
          const trimmedLine = line.trim()
          if (trimmedLine && !trimmedLine.startsWith("#")) {
            const parts = trimmedLine.split(":")
            if (parts.length >= 2) {
              result[parts[0].trim()] = parts[1].trim()
            }
          }
        })
        return result
      }

      const statsData = parseInfo(stats)
      const clientsData = parseInfo(clients)
      const totalCommands = parseInt(statsData.total_commands_processed || "0")

      // 1. Calculate Estimated Cost (usd 0.2 per 100k commands)
      const estimatedCost = (totalCommands / 100000) * 0.2

      // 2. Persist stats if needed (throttle to 1 hour to save Supabase rows)
      const { data: lastStats } = await supabase
        .from("redis_stats")
        .select("created_at, total_commands")
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      const now = new Date()
      if (
        !lastStats ||
        now.getTime() - new Date(lastStats.created_at).getTime() > 3600000
      ) {
        await supabase
          .from("redis_stats")
          .insert({ total_commands: totalCommands })
      }

      // 3. Get 24h delta
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const { data: stats24h } = await supabase
        .from("redis_stats")
        .select("total_commands")
        .gte("created_at", yesterday.toISOString())
        .order("created_at", { ascending: true })
        .limit(1)
        .single()

      const commands24h = stats24h
        ? totalCommands < stats24h.total_commands
          ? totalCommands
          : totalCommands - stats24h.total_commands
        : 0

      // 4. Get Month-to-Date delta
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const { data: statsMonth } = await supabase
        .from("redis_stats")
        .select("total_commands")
        .gte("created_at", monthStart.toISOString())
        .order("created_at", { ascending: true })
        .limit(1)
        .single()

      const commandsMonth = statsMonth
        ? totalCommands < statsMonth.total_commands
          ? totalCommands
          : totalCommands - statsMonth.total_commands
        : totalCommands

      const totalMonthCost = (Math.max(0, commandsMonth) / 100000) * 0.2
      const total24hCost = (Math.max(0, commands24h) / 100000) * 0.2

      // 5. Get runs for cost subtraction (last 30 days)
      const { data: monthRuns } = await supabase
        .from("qa_runs")
        .select("pages_total, created_at")
        .eq("status", "completed")
        .gte("created_at", monthStart.toISOString())

      const { data: dayRuns } = await supabase
        .from("qa_runs")
        .select("pages_total, created_at")
        .eq("status", "completed")
        .gte("created_at", yesterday.toISOString())

      const calculateRunCosts = (runs: any[] | null) => {
        return (runs || []).reduce((acc, run) => {
          const batches = Math.ceil((run.pages_total || 0) / 10)
          const estimatedCommands = (batches + 1) * 20
          return acc + (estimatedCommands / 100000) * 0.2
        }, 0)
      }

      const runCostsMonth = calculateRunCosts(monthRuns)
      const runCosts24h = calculateRunCosts(dayRuns)

      // 6. Get last 3 runs for UI table
      const { data: recentRuns } = await supabase
        .from("qa_runs")
        .select("id, site_url, pages_total, created_at")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(3)

      const runStats = (recentRuns || []).map((run) => {
        const batches = Math.ceil((run.pages_total || 0) / 10)
        const estimatedCommands = (batches + 1) * 20
        return {
          id: run.id,
          site_url: run.site_url,
          pages: run.pages_total,
          commands: estimatedCommands,
          cost: (estimatedCommands / 100000) * 0.2,
        }
      })

      return res.json({
        total_commands: totalCommands,
        commands_24h: Math.max(0, commands24h),
        commands_month: Math.max(0, commandsMonth),
        estimated_cost: estimatedCost,
        month_cost: totalMonthCost,
        day_cost: total24hCost,
        idle_24h: Math.max(0, total24hCost - runCosts24h),
        idle_month: Math.max(0, totalMonthCost - runCostsMonth),
        ops_per_sec: statsData.instantaneous_ops_per_sec,
        connected_clients: clientsData.connected_clients,
        recent_runs: runStats,
      })
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to fetch Redis info")
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * GET /api/admin/run-history
 * Returns a full history of runs with estimated Redis usage.
 */
router.get(
  "/run-history",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const { data: runs, error } = await supabase
        .from("qa_runs")
        .select("id, site_url, pages_total, created_at, status")
        .order("created_at", { ascending: false })

      if (error) throw error

      const history = (runs || []).map((run) => {
        const batches = Math.ceil((run.pages_total || 0) / 10)
        const estimatedCommands = (batches + 1) * 20
        return {
          ...run,
          estimated_commands: estimatedCommands,
          estimated_cost: (estimatedCommands / 100000) * 0.2,
        }
      })

      return res.json(history)
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to fetch run history")
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * GET /api/admin/activity-logs
 * Returns paginated activity logs with filters.
 */
router.get(
  "/activity-logs",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const {
        page = 1,
        limit = 50,
        search = "",
        entityType = "",
        startDate = "",
        endDate = "",
        projectName = "",
      } = req.query
      const from = (Number(page) - 1) * Number(limit)
      const to = from + Number(limit) - 1

      let query = supabase
        .from("activity_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to)

      if (search) {
        query = query.ilike("performer_name", `%${search}%`)
      }

      if (entityType) {
        query = query.eq("entity_type", entityType)
      }

      if (startDate) {
        query = query.gte("created_at", startDate)
      }

      if (endDate) {
        query = query.lte("created_at", endDate)
      }

      if (projectName) {
        query = query.ilike("details->>projectName", `%${projectName}%`)
      }

      const { data, error, count } = await query

      if (error) throw error

      return res.json({
        data,
        total: count,
        page: Number(page),
        limit: Number(limit),
      })
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to fetch activity logs")
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * DELETE /api/admin/activity-logs
 * Clears all activity logs. Super-Admin only.
 */
router.delete(
  "/activity-logs",
  clerkAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      // Delete all rows
      const { error } = await supabase
        .from("activity_logs")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000")
      if (error) throw error
      return res.json({ success: true, message: "All logs cleared" })
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to clear activity logs")
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * PATCH /api/admin/maintenance-mode
 * Toggles maintenance mode. Super-Admin only.
 */
router.patch(
  "/maintenance-mode",
  clerkAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      const { is_maintenance_mode } = req.body

      if (typeof is_maintenance_mode !== "boolean") {
        return res.status(400).json({ error: "is_maintenance_mode must be a boolean" })
      }

      const { data, error } = await supabase
        .from("system_settings")
        .update({ is_maintenance_mode })
        .eq("id", 1)
        .select()
        .single()

      if (error) throw error

      return res.json({ success: true, is_maintenance_mode: data.is_maintenance_mode })
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to update maintenance mode")
      return res.status(500).json({ error: error.message })
    }
  },
)

export { router as adminRouter }
