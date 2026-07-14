import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"
import { requireRole } from "../middleware/requireRole"
import { zodValidate } from "../middleware/zodValidate"
import { CreateRunSchema } from "@qacc/shared"
import { addRunJob } from "../lib/queue"
import { quickFetchUrls } from "../lib/crawler"
import * as activityService from "../services/activityService"
import { chatWithFallback } from "../lib/aiProviders"

const router: Router = Router()

/**
 * Helper to get Supabase user UUID from Clerk ID
 */
async function getSupabaseUserId(clerkIdOrUuid: string): Promise<string> {
  if (clerkIdOrUuid.length === 36 && clerkIdOrUuid.includes("-")) {
    return clerkIdOrUuid
  }

  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", clerkIdOrUuid)
    .maybeSingle()

  if (error || !data) {
    throw new Error(`User not synced: ${clerkIdOrUuid}`)
  }
  return data.id
}

/**
 * POST /api/runs
 * Start a new QA run (Status: pending).
 */
router.post(
  "/",
  clerkAuth,
  requireRole("qa_engineer"),
  zodValidate(CreateRunSchema),
  async (req: Request, res: Response) => {
    const {
      project_id,
      run_type,
      site_url,
      figma_url,
      enabled_checks,
      is_woocommerce,
      device_matrix,
      selected_urls,
      live_site_url,
    } = req.body
    const { userId: clerkUserId } = req.auth!

    try {
      const supabaseUserId = await getSupabaseUserId(clerkUserId)

      const { data: run, error } = await supabase
        .from("qa_runs")
        .insert({
          project_id,
          run_type,
          site_url,
          figma_url,
          enabled_checks,
          is_woocommerce,
          device_matrix,
          selected_urls,
          live_site_url,
          pages_total: selected_urls ? selected_urls.length : 0,
          status: "pending",
          created_by: supabaseUserId,
        })
        .select()
        .single()

      if (error) throw error

      return res.status(201).json(run)
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/runs/fetch-urls
 * Fetch URLs for a site to allow manual selection.
 */
router.post(
  "/fetch-urls",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { site_url } = req.body

    if (!site_url) {
      return res.status(400).json({ error: "site_url is required" })
    }

    try {
      const urls = await quickFetchUrls(site_url)
      return res.json({ urls })
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * GET /api/runs/projects/:id/runs
 * List runs for a project with pagination and summary stats.
 */
router.get(
  "/projects/:id/runs",
  clerkAuth,
  async (req: Request, res: Response) => {
    const { id: project_id } = req.params
    const { orgId } = req.auth!
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    try {
      // Verify project belongs to org
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("id", project_id)
        .eq("org_id", orgId)
        .single()

      if (!project) return res.status(404).json({ error: "Project not found" })

      const {
        data: runs,
        error,
        count,
      } = await supabase
        .from("qa_runs")
        .select(
          `
        *,
        recording_updated_at,
        users!qa_runs_created_by_fkey (
          full_name,
          email
        )
      `,

          { count: "exact" },
        )
        .eq("project_id", project_id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      const enrichedRuns = runs.map((run: any) => ({
        ...run,
        created_by_name: run.users?.full_name || run.users?.email || "Unknown",
      }))

      return res.json({
        data: enrichedRuns,
        pagination: {
          page,
          limit,
          total: count,
        },
      })
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * GET /api/runs/projects/:id/pinned-runs
 * List pinned runs for a project.
 */
router.get(
  "/projects/:id/pinned-runs",
  clerkAuth,
  async (req: Request, res: Response) => {
    const { id: project_id } = req.params
    const { orgId } = req.auth!

    try {
      // Verify project belongs to org
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("id", project_id)
        .eq("org_id", orgId)
        .single()

      if (!project) return res.status(404).json({ error: "Project not found" })

      const { data: runs, error } = await supabase
        .from("qa_runs")
        .select(
          `
        *,
        recording_updated_at,
        users!qa_runs_created_by_fkey (
          full_name,
          email
        )
      `,
        )
        .eq("project_id", project_id)
        .eq("is_pinned", true)
        .order("created_at", { ascending: false })

      if (error) throw error

      const enrichedRuns = runs.map((run: any) => ({
        ...run,
        created_by_name: run.users?.full_name || run.users?.email || "Unknown",
      }))

      return res.json({
        data: enrichedRuns,
      })
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * GET /api/runs/pages/:pageId/findings
 * Get detailed findings for a specific page.
 */
router.get(
  "/pages/:pageId/findings",
  clerkAuth,
  async (req: Request, res: Response) => {
    const { pageId } = req.params

    try {
      const { data: findings, error } = await supabase
        .from("findings")
        .select(
          `
        *,
        pages (
          url
        ),
        tasks (
          id,
          status,
          assigned_to,
          users:assigned_to (id, full_name, email),
          rebuttals (
            id,
            ai_verdict,
            ai_confidence,
            ai_reasoning
          )
        )
      `,
        )
        .eq("page_id", pageId)
        .order("created_at", { ascending: false })

      if (error) throw error

      return res.json(findings || [])
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * GET /api/runs/:id/findings
 * Get all findings for a full run (all pages).
 */
router.get("/:id/findings", clerkAuth, async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const { data: findings, error } = await supabase
      .from("findings")
      .select(
        `
        *,
        pages (
          url
        ),
        tasks (
          id,
          status,
          assigned_to,
          users:assigned_to (id, full_name, email),
          rebuttals (
            id,
            ai_verdict,
            ai_confidence,
            ai_reasoning
          )
        )
      `,
      )
      .eq("run_id", id)
      .order("created_at", { ascending: false })

    if (error) throw error

    return res.json(findings || [])
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/runs/:id
 * Get full run details, pages, and findings summary.
 */
router.get("/:id", clerkAuth, async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    // 1. Fetch run details with creator info
    const { data: run, error: runError } = await supabase
      .from("qa_runs")
      .select(
        `
        *,
        users!qa_runs_created_by_fkey (
          full_name,
          email
        ),
        sign_offs(id, basecamp_message_id)
      `,
      )
      .eq("id", id)
      .single()

    if (runError || !run) {
      return res.status(404).json({ error: "Run not found" })
    }

    // 2. Fetch pages for this run
    const { data: pages, error: pagesError } = await supabase
      .from("pages")
      .select("*")
      .eq("run_id", id)
      .order("created_at", { ascending: true })

    if (pagesError) throw pagesError

    // 3. Fetch all findings for this run to aggregate per page
    const { data: findings, error: findingsError } = await supabase
      .from("findings")
      .select("id, page_id, check_factor, severity, status")
      .eq("run_id", id)

    if (findingsError) throw findingsError

    // 4. Aggregate findings per page and for the whole run
    const runFindingCounts: Record<string, number> = {}
    const pageFindingCounts: Record<string, Record<string, number>> = {}

    findings?.forEach((f: any) => {
      // Only count open or confirmed findings
      if (f.status === "false_positive") return

      // Global counts
      runFindingCounts[f.check_factor] =
        (runFindingCounts[f.check_factor] || 0) + 1

      // Per-page counts
      if (!pageFindingCounts[f.page_id]) {
        pageFindingCounts[f.page_id] = {}
      }
      pageFindingCounts[f.page_id][f.check_factor] =
        (pageFindingCounts[f.page_id][f.check_factor] || 0) + 1
    })

    // 5. Enrich pages with their finding counts
    const enrichedPages = pages?.map((page) => ({
      ...page,
      finding_counts: pageFindingCounts[page.id] || {},
    }))

    // 6. Calculate progress
    const pages_total = run.pages_total || 0
    const pages_processed = run.pages_processed || 0
    const progress_percentage =
      pages_total > 0 ? (pages_processed / pages_total) * 100 : 0

    // 7. Get concurrent scans count (running or pending in the same organization)
    const { count: concurrentScans } = await supabase
      .from("qa_runs")
      .select("id", { count: "exact", head: true })
      .in("status", ["running", "pending"])

    return res.json({
      ...run,
      created_by_name: run.users?.full_name || run.users?.email || "Unknown",
      pages: enrichedPages,
      finding_counts: runFindingCounts,
      progress_percentage,
      concurrent_scans: concurrentScans || 0,
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/findings/:id
 * Update finding details (severity, status, etc.)
 */
router.patch(
  "/findings/:id",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { severity, status } = req.body

    try {
      const { data: updatedFinding, error } = await supabase
        .from("findings")
        .update({ severity, status })
        .eq("id", id)
        .select()
        .single()

      if (error) throw error

      return res.json(updatedFinding)
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * PATCH /api/runs/:id/pin
 * Toggle pin status and custom name for a run.
 */
router.patch(
  "/:id/pin",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { is_pinned, custom_name } = req.body

    try {
      const { data: updatedRun, error } = await supabase
        .from("qa_runs")
        .update({ is_pinned, custom_name: custom_name || null })
        .eq("id", id)
        .select()
        .single()

      if (error) throw error

      return res.json(updatedRun)
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * PATCH /api/runs/:id/status
 * Update run status with strict state transition rules.
 */
router.patch(
  "/:id/status",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { status: newStatus } = req.body

    try {
      const { data: run, error: fetchError } = await supabase
        .from("qa_runs")
        .select("status")
        .eq("id", id)
        .single()

      if (fetchError || !run) {
        return res.status(404).json({ error: "Run not found" })
      }

      const currentStatus = run.status

      // Validate transitions
      const validTransitions: Record<string, string[]> = {
        pending: ["running", "cancelled"],
        running: ["completed", "failed", "paused", "cancelled"],
        paused: ["running", "cancelled"],
      }

      if (!validTransitions[currentStatus]?.includes(newStatus)) {
        return res.status(422).json({
          error: `Invalid status transition from ${currentStatus} to ${newStatus}`,
        })
      }

      const updateData: any = { status: newStatus }
      if (
        newStatus === "completed" ||
        newStatus === "failed" ||
        newStatus === "cancelled"
      ) {
        updateData.completed_at = new Date().toISOString()
      }

      const { data: updatedRun, error: updateError } = await supabase
        .from("qa_runs")
        .update(updateData)
        .eq("id", id)
        .select()
        .single()

      if (updateError) throw updateError
      // Target Resume Trigger: Re-enqueue remaining or discovery scans
      if (currentStatus === "paused" && newStatus === "running") {
        const { qaQueue } = require("../lib/queue")

        // Fetch pages already discovered for this run
        const { data: pages, error: pagesError } = await supabase
          .from("pages")
          .select("id, url, status")
          .eq("run_id", id)

        if (pagesError) throw pagesError

        if (!pages || pages.length === 0) {
          // Bypassed Phase 1: Re-queue sitemap discovery
          const { addRunJob } = require("../lib/queue")
          await addRunJob(id)
        } else {
          // Bypassed Phase 2: Fetch and re-queue pending/processing pages
          const remainingPages = pages.filter(
            (p) => p.status !== "done" && p.status !== "failed",
          )

          if (remainingPages.length > 0) {
            const remainingPageIds = remainingPages.map((p) => p.id)

            // Clean page states in the DB
            await supabase
              .from("pages")
              .update({
                status: "pending",
                current_step: "Queued for resume...",
                progress: 0,
              })
              .in("id", remainingPageIds)

            // Group pages into batches of 10 and add to queue
            const BATCH_SIZE = 10
            const chunks = []
            for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
              chunks.push(remainingPages.slice(i, i + BATCH_SIZE))
            }

            const jobs = chunks.map((chunk) => {
              if (chunk.length === 1) {
                const page = chunk[0]
                return {
                  name: "crawl_page",
                  data: {
                    runId: id,
                    pageId: page.id,
                    url: page.url,
                    projectId: updatedRun.project_id,
                    enabledChecks: updatedRun.enabled_checks,
                  },
                  opts: {
                    attempts: 3,
                    backoff: { type: "exponential", delay: 5000 },
                  },
                }
              } else {
                return {
                  name: "crawl_batch",
                  data: {
                    runId: id,
                    pages: chunk.map((p) => ({ id: p.id, url: p.url })),
                    projectId: updatedRun.project_id,
                  },
                  opts: {
                    attempts: 3,
                    backoff: { type: "exponential", delay: 5000 },
                    lockDuration: 600000,
                  },
                }
              }
            })

            await qaQueue.addBulk(jobs)
          }
        }
      }

      // [Step 4.2] Log Run Pause/Resume
      if (newStatus === "running" || newStatus === "paused") {
        try {
          const { userId: clerkUserId } = req.auth!
          const [performerRes, projectRes] = await Promise.all([
            supabase
              .from("users")
              .select("id, full_name")
              .eq("clerk_user_id", clerkUserId)
              .single(),
            supabase
              .from("projects")
              .select("name")
              .eq("id", updatedRun.project_id)
              .single(),
          ])

          const performerName = performerRes.data?.full_name || "QA Engineer"
          const projectName = projectRes.data?.name || "Project"
          const actionWord = newStatus === "running" ? "resumed" : "paused"

          await activityService.logActivity(
            { id: performerRes.data?.id || "", name: performerName },
            {
              type: `RUN_${newStatus.toUpperCase()}`,
              details: {
                projectName,
                message: `${actionWord} the run for ${projectName}`,
              },
            },
            { id: updatedRun.id, type: "run" },
            [updatedRun.created_by],
          )
        } catch (logError) {
          console.error(
            "[ActivityService] Failed to log run status change:",
            logError,
          )
        }
      }
      // [Step 4.3] Log Run Completion (Success/Failed)
      if (newStatus === "completed" || newStatus === "failed") {
        try {
          const { userId: clerkUserId } = req.auth!
          const [performerRes, projectRes] = await Promise.all([
            supabase
              .from("users")
              .select("id, full_name")
              .eq("clerk_user_id", clerkUserId)
              .single(),
            supabase
              .from("projects")
              .select("name")
              .eq("id", updatedRun.project_id)
              .single(),
          ])

          const performerName = performerRes.data?.full_name || "System"
          const projectName = projectRes.data?.name || "Project"

          const actionType =
            newStatus === "completed" ? "RUN_COMPLETED" : "RUN_FAILED"
          const message =
            newStatus === "completed"
              ? `Run for ${projectName} finished successfully`
              : `Run for ${projectName} failed`

          await activityService.logActivity(
            { id: performerRes.data?.id || "", name: performerName },
            {
              type: actionType,
              details: {
                projectName,
                status: newStatus === "completed" ? "Success" : "Failed",
                message,
              },
            },
            { id: updatedRun.id, type: "run" },
            [updatedRun.created_by],
          )
        } catch (logError) {
          console.error(
            "[ActivityService] Failed to log run completion:",
            logError,
          )
        }
      }

      // Trigger embeddings generation if completed
      if (newStatus === "completed") {
        const { qaQueue } = require("../lib/queue")
        qaQueue
          .add("generate_embeddings", { runId: id })
          .catch((e: any) =>
            console.error("Failed to queue generate_embeddings from API:", e),
          )
      }

      return res.json(updatedRun)
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/runs/:id/start
 * Manually start a pending QA run and enqueue it in BullMQ.
 */
router.post(
  "/:id/start",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params

    try {
      // 1. Fetch current status
      const { data: run, error: fetchError } = await supabase
        .from("qa_runs")
        .select("status")
        .eq("id", id)
        .single()

      if (fetchError || !run) {
        return res.status(404).json({ error: "Run not found" })
      }

      if (run.status !== "pending") {
        return res.status(400).json({
          error: `Only pending runs can be started. Current status: ${run.status}`,
        })
      }

      // 2. Update status to 'running'
      const { data: updatedRun, error: updateError } = await supabase
        .from("qa_runs")
        .update({ status: "running" })
        .eq("id", id)
        .select()
        .single()

      if (updateError) throw updateError

      // [Step 4.1] Log QA Run Started
      try {
        const { userId: clerkUserId } = req.auth!
        const [performerRes, projectRes] = await Promise.all([
          supabase
            .from("users")
            .select("id, full_name")
            .eq("clerk_user_id", clerkUserId)
            .single(),
          supabase
            .from("projects")
            .select("name")
            .eq("id", updatedRun.project_id)
            .single(),
        ])

        const performerName = performerRes.data?.full_name || "QA Engineer"
        const projectName = projectRes.data?.name || "Project"

        await activityService.logActivity(
          { id: performerRes.data?.id || "", name: performerName },
          {
            type: "RUN_STARTED",
            details: {
              projectName,
              message: ` started a run for ${projectName}`,
            },
          },
          { id: updatedRun.id, type: "run" },
          [updatedRun.created_by],
        )
      } catch (logError) {
        console.error("[ActivityService] Failed to log run start:", logError)
      }

      // 3. Enqueue the job in BullMQ for the worker to pick up, passing the RAM password
      await addRunJob(id, req.body.wp_password)

      return res.json(updatedRun)
    } catch (error: any) {
      console.error("[Start Run Error]:", error)
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/runs/:id/retry-check
 * Retry a specific check for a given run. Deletes existing findings for that check and enqueues jobs.
 */
router.post(
  "/:id/retry-check",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { checkKey, wp_password } = req.body

    try {
      // 1. Delete existing findings for this checkKey
      await supabase
        .from("findings")
        .delete()
        .eq("run_id", id)
        .eq("check_factor", checkKey)

      // 2. Fetch run details
      const { data: run } = await supabase
        .from("qa_runs")
        .select("project_id, site_url")
        .eq("id", id)
        .single()

      if (!run) {
        return res.status(404).json({ error: "Run not found" })
      }

      // 3. Fetch all pages for this run
      const { data: pages } = await supabase
        .from("pages")
        .select("id, url, check_progress")
        .eq("run_id", id)

      const { qaQueue } = require("../lib/queue")

      // 4. Enqueue jobs based on the checkKey
      if (checkKey === "project_plan") {
        // await supabase.from("qa_runs").update({ status: "running" }).eq("id", id)
        await qaQueue.add("check_project_plan", {
          runId: id,
          projectId: run.project_id,
          isRetry: true,
        })
      } else if (checkKey === "paid_media") {
        // await supabase.from("qa_runs").update({ status: "running" }).eq("id", id)
        await qaQueue.add("check_paid_media", {
          runId: id,
          projectId: run.project_id,
          isRetry: true,
        })
      } else if (pages && pages.length > 0) {
        // Filter pages for homepage-only checks so we don't queue redundant tasks
        const homepageChecks = [
          "privacy_policy",
          "footer_logo",
          "single_script",
          "top_bar_sticky",
          "favicon",
          "chatbot_consultation",
          "logo_chatbot",
          "text_share",
          "callnow_links",
          "verify_plugin_updates",
          "social_share_heading",
          "url_tab_compare",
          "gsr_check",
        ]

        let relevantPages = pages
        if (homepageChecks.includes(checkKey)) {
          relevantPages = relevantPages.filter((p) => {
            const normalize = (u: string) =>
              u
                .replace(/^https?:\/\//, "")
                .replace(/^www\./, "")
                .replace(/\/$/, "")
                .toLowerCase()
            return normalize(p.url) === normalize(run.site_url)
          })
          if (relevantPages.length === 0 && pages.length > 0) {
            relevantPages = [pages[0]]
          }
        }

        // Don't change run status or pages_processed for targeted check retry.
        // The run stays "completed" so the UI keeps showing 100% for all other checks.

        // ONLY update check_progress for the specific check, so we don't drop progress for all other checks!
        for (const page of relevantPages) {
          const updatedCheckProgress = {
            ...(page.check_progress || {}),
            [checkKey]: {
              progress: 0,
              status: "processing",
              step: "Queued for retry...",
            },
          }
          await supabase
            .from("pages")
            .update({ check_progress: updatedCheckProgress })
            .eq("id", page.id)

          // Delete the old finding so we don't get duplicates
          await supabase
            .from("findings")
            .delete()
            .eq("run_id", id)
            .eq("page_id", page.id)
            .eq("check_factor", checkKey)
        }

        // Enqueue crawl_batch for the pages with overrideChecks
        const BATCH_SIZE = 10
        const chunks = []
        for (let i = 0; i < relevantPages.length; i += BATCH_SIZE) {
          chunks.push(relevantPages.slice(i, i + BATCH_SIZE))
        }

        const jobs = chunks.map((chunk) => {
          if (chunk.length === 1) {
            return {
              name: "crawl_page",
              data: {
                runId: id,
                pageId: chunk[0].id,
                url: chunk[0].url,
                overrideChecks: [checkKey],
                wpPassword: wp_password,
              },
              opts: {
                attempts: 3,
                backoff: { type: "exponential", delay: 5000 },
              },
            }
          } else {
            return {
              name: "crawl_batch",
              data: {
                runId: id,
                pages: chunk.map((p) => ({ id: p.id, url: p.url })),
                overrideChecks: [checkKey],
                wpPassword: wp_password,
              },
              opts: {
                attempts: 3,
                backoff: { type: "exponential", delay: 5000 },
                lockDuration: 600000,
              },
            }
          }
        })
        await qaQueue.addBulk(jobs)
      }

      return res.json({ success: true, message: `Retrying check: ${checkKey}` })
    } catch (error: any) {
      console.error("[Retry Check Error]:", error)
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * DELETE /api/runs
 * Bulk delete QA runs.
 */
router.delete(
  "/",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { runIds } = req.body

    if (!runIds || !Array.isArray(runIds) || runIds.length === 0) {
      return res.status(400).json({ error: "runIds array is required" })
    }

    try {
      const { bulkDeleteRuns } = require("../services/runService")
      await bulkDeleteRuns(runIds)

      return res.status(200).json({ message: "Runs deleted successfully" })
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/runs/compare-urls-ai
 * Uses AI to intelligently compare dev vs live URLs
 */
router.post("/compare-urls-ai", async (req, res) => {
  try {
    const { devPages, livePages } = req.body

    const systemPrompt = `You are an expert SEO analyst. 
    I will provide you with two JSON arrays: devPages (the beta site) and livePages (the current live site).
    Each contains 'url' and 'title'.
    
    Your job is to match them contextually. 
    Keep in mind:
    - Slugs might have slight variations (e.g. /about vs /about-us).
    - Tab titles might have changed due to SEO optimization.
    - If they represent the same page contextually, consider them a match.
    
    Return ONLY the pages that are TRULY missing from one site but present in the other.
    You must use the 'report_discrepancies' tool to output your findings.`

    const userPrompt = `Here is the data:
    Dev Pages: ${JSON.stringify(devPages)}
    Live Pages: ${JSON.stringify(livePages)}`

    // We force the AI to return structured JSON by giving it exactly one tool
    const tools = [
      {
        name: "report_discrepancies",
        description: "Report the truly missing pages between the two sites.",
        parameters: {
          type: "object",
          properties: {
            missingInDev: {
              type: "array",
              description:
                "Array of URL objects from the live site that have NO contextual match in the dev site.",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  reason: {
                    type: "string",
                    description:
                      "Brief explanation of why you think it's missing",
                  },
                },
              },
            },
            missingInLive: {
              type: "array",
              description:
                "Array of URL objects from the dev site that have NO contextual match in the live site.",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  reason: {
                    type: "string",
                    description:
                      "Brief explanation of why you think it's missing",
                  },
                },
              },
            },
          },
          required: ["missingInDev", "missingInLive"],
        },
      },
    ]

    // The handler just catches what the AI outputs and returns it back to us
    let aiResult = null
    const toolHandler = async (name: string, args: any) => {
      if (name === "report_discrepancies") {
        aiResult = args
        return { success: true }
      }
      return { error: "Unknown tool" }
    }

    await chatWithFallback(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      toolHandler,
    )

    // Return the AI's smart JSON output
    return res
      .status(200)
      .json(aiResult || { missingInDev: [], missingInLive: [] })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/runs/verify-plugins-ai
 * Uses AI to analyze the plugins page screenshot and detect outdated plugins.
 */
router.post("/verify-plugins-ai", async (req, res) => {
  try {
    const { screenshotUrl } = req.body
    if (!screenshotUrl) {
      return res.status(400).json({ error: "screenshotUrl is required" })
    }

    const axios = require("axios")
    const { GoogleGenAI } = require("@google/genai")

    // 1. Download image as base64 (Bypass expired JWTs using Supabase Admin Client)
    let imageBuffer: Buffer
    let mimeType = "image/png"

    try {
      if (screenshotUrl.includes("/storage/v1/object/")) {
        const urlObj = new URL(screenshotUrl)
        const parts = urlObj.pathname.split("/")
        const bucketIndex =
          parts.findIndex((p) => p === "sign" || p === "public") + 1
        const bucket = parts[bucketIndex]
        const filePath = decodeURIComponent(
          parts.slice(bucketIndex + 1).join("/"),
        )

        const { data, error } = await supabase.storage
          .from(bucket)
          .download(filePath)
        if (error) throw error
        imageBuffer = Buffer.from(await data.arrayBuffer())
        mimeType = data.type || "image/png"
      } else {
        const axios = require("axios")
        const imageResponse = await axios.get(screenshotUrl, {
          responseType: "arraybuffer",
        })
        imageBuffer = Buffer.from(imageResponse.data)
        mimeType = imageResponse.headers["content-type"] || "image/png"
      }
    } catch (downloadError) {
      console.error("Failed to download screenshot:", downloadError)
      return res
        .status(400)
        .json({ error: "Failed to fetch screenshot for AI analysis" })
    }

    const base64Data = imageBuffer.toString("base64")

    // 2. Initialize Gemini 1.5 Pro
    const genAI = new GoogleGenAI({
      apiKey: process.env.GOOGLE_AI_API_KEY || "",
    })

    const systemPrompt = `You are an expert WordPress plugin reviewer.
I am providing you a screenshot of a WordPress plugins page.
Look at the plugins listed and identify any plugins that have an "Update available" or indicate they are outdated.

CRITICAL INSTRUCTION: You MUST IGNORE any plugin that matches these names: All-in-Migration, Litespeed Cache, Wp-Rocket, ELEMENTOR, WOO-COMMERCE. Do NOT include them in the outdated list even if they have an update available.

Return your findings as JSON in this exact structure:
{
  "status": "success",
  "message": "AI has reviewed the screenshot.",
  "outdatedPlugins": [
    { "name": "Plugin Name", "current": "1.0", "available": "2.0" }
  ],
  "excludedPlugins": ["All-in-Migration", "Litespeed Cache", "Wp-Rocket", "ELEMENTOR", "WOO-COMMERCE"]
}`

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: systemPrompt },
            { inlineData: { data: base64Data, mimeType } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    })

    const resultText = response.text || "{}"
    const resultJson = JSON.parse(resultText)

    return res.status(200).json(resultJson)
  } catch (error: any) {
    console.error("AI Verify Plugins Error:", error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/runs/verify-social-share-ai
 * Uses AI to analyze the social share screenshots and detect social share status.
 */
router.post("/verify-social-share-ai", async (req, res) => {
  try {
    const { screenshotUrls } = req.body
    if (!screenshotUrls || !Array.isArray(screenshotUrls)) {
      return res.status(400).json({ error: "screenshotUrls array is required" })
    }

    const axios = require("axios")
    const { GoogleGenAI } = require("@google/genai")

    // 1. Download images as base64 (Bypass expired JWTs using Supabase Admin Client)
    const imagesParts = []

    for (const url of screenshotUrls) {
      let imageBuffer: Buffer
      let mimeType = "image/png"

      try {
        if (url.includes("/storage/v1/object/")) {
          const urlObj = new URL(url)
          const parts = urlObj.pathname.split("/")
          const bucketIndex =
            parts.findIndex((p) => p === "sign" || p === "public") + 1
          const bucket = parts[bucketIndex]
          const filePath = decodeURIComponent(
            parts.slice(bucketIndex + 1).join("/"),
          )

          const { data, error } = await supabase.storage
            .from(bucket)
            .download(filePath)
          if (error) throw error
          imageBuffer = Buffer.from(await data.arrayBuffer())
          mimeType = data.type || "image/png"
        } else {
          const imageResponse = await axios.get(url, {
            responseType: "arraybuffer",
          })
          imageBuffer = Buffer.from(imageResponse.data)
          mimeType = imageResponse.headers["content-type"] || "image/png"
        }

        imagesParts.push({
          inlineData: { data: imageBuffer.toString("base64"), mimeType },
        })
      } catch (downloadError) {
        console.error(
          "Failed to download screenshot for social share verify:",
          downloadError,
        )
      }
    }

    if (imagesParts.length === 0) {
      return res
        .status(400)
        .json({ error: "Failed to fetch screenshots for AI analysis" })
    }

    // 2. Initialize Gemini 1.5 Pro
    const genAI = new GoogleGenAI({
      apiKey: process.env.GOOGLE_AI_API_KEY || "",
    })

    const systemPrompt = `You are an expert SEO analyst and QA tester.
I am providing you with multiple screenshots related to social share tags and previews (Facebook, Google, Twitter/X, LinkedIn).
Look at the screenshots to determine if the social share headings and images are properly set up and verified.

Return your findings as JSON in this exact structure:
{
  "status": "success",
  "message": "AI has reviewed the social share screenshots.",
  "socialShareHeadings": {
    "facebook": "verified" | "not verified",
    "google": "verified" | "not verified",
    "twitter": "verified" | "not verified",
    "linkedin": "verified" | "not verified"
  },
  "socialShareImages": {
    "facebook": "verified" | "not verified",
    "google": "verified" | "not verified",
    "twitter": "verified" | "not verified",
    "linkedin": "verified" | "not verified"
  },
  "socialMediaTags": {
    "facebook": "verified" | "not verified",
    "google": "verified" | "not verified",
    "twitter": "verified" | "not verified",
    "linkedin": "verified" | "not verified"
  }
}
If there is evidence of correct configuration for a platform, mark it as "verified", else "not verified".`

    let response
    try {
      response = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: systemPrompt }, ...imagesParts],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      })
    } catch (fallbackError) {
      console.warn("gemini-2.5-flash failed, falling back to gemini-2.0-flash")
      response = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: systemPrompt }, ...imagesParts],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      })
    }

    const resultText = response.text || "{}"
    const resultJson = JSON.parse(resultText)

    return res.status(200).json(resultJson)
  } catch (error: any) {
    console.error("AI Verify Social Share Error:", error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/runs/verify-favicon-ai
 * Uses AI to analyze the favicon screenshots and page source code.
 */
router.post("/verify-favicon-ai", async (req, res) => {
  try {
    const { screenshotUrls } = req.body
    if (!screenshotUrls || !Array.isArray(screenshotUrls)) {
      return res.status(400).json({ error: "screenshotUrls array is required" })
    }

    const axios = require("axios")
    const { GoogleGenAI } = require("@google/genai")

    const imagesParts = []
    for (const url of screenshotUrls) {
      let imageBuffer: Buffer
      let mimeType = "image/png"

      try {
        if (url.includes("/storage/v1/object/")) {
          const urlObj = new URL(url)
          const parts = urlObj.pathname.split("/")
          const bucketIndex =
            parts.findIndex((p) => p === "sign" || p === "public") + 1
          const bucket = parts[bucketIndex]
          const filePath = decodeURIComponent(
            parts.slice(bucketIndex + 1).join("/"),
          )

          const { data, error } = await supabase.storage
            .from(bucket)
            .download(filePath)
          if (error) throw error
          imageBuffer = Buffer.from(await data.arrayBuffer())
          mimeType = data.type || "image/png"
        } else {
          const imageResponse = await axios.get(url, {
            responseType: "arraybuffer",
          })
          imageBuffer = Buffer.from(imageResponse.data)
          mimeType = imageResponse.headers["content-type"] || "image/png"
        }

        imagesParts.push({
          inlineData: { data: imageBuffer.toString("base64"), mimeType },
        })
      } catch (downloadError) {
        console.error(
          "Failed to download screenshot for favicon verify:",
          downloadError,
        )
      }
    }

    if (imagesParts.length === 0) {
      return res
        .status(400)
        .json({ error: "Failed to fetch screenshots for AI analysis" })
    }

    const genAI = new GoogleGenAI({
      apiKey: process.env.GOOGLE_AI_API_KEY || "",
    })

    const systemPrompt = `You are an expert QA tester.
I am providing you with multiple screenshots related to a website's favicon (Desktop, Tablet, Mobile, and Page Source Code).
Look at the screenshots to determine if the favicon is properly installed and visible in the browser tabs, and if the favicon code snippet exists in the page source code.

Return your findings as JSON in this exact structure:
{
  "status": "success",
  "message": "AI has reviewed the favicon screenshots.",
  "faviconPresence": {
    "desktop": "verified" | "not verified",
    "tablet": "verified" | "not verified",
    "mobile": "verified" | "not verified",
    "sourceCode": "verified" | "not verified"
  }
}
If there is evidence of correct configuration, mark it as "verified", else "not verified".`

    let response
    try {
      response = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: systemPrompt }, ...imagesParts],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      })
    } catch (fallbackError) {
      response = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: systemPrompt }, ...imagesParts],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      })
    }

    const resultText = response.text || "{}"
    const resultJson = JSON.parse(resultText)

    return res.status(200).json(resultJson)
  } catch (error: any) {
    console.error("AI Verify Favicon Error:", error)
    return res.status(500).json({ error: error.message })
  }
})

export { router as runsRouter }
