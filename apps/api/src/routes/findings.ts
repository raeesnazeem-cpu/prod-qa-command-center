import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"
import { requireRole } from "../middleware/requireRole"
import { logger } from "../lib/logger"
import axios from "axios"

const router: Router = Router()

/**
 * POST /api/findings
 * Create a new manual finding.
 */
router.post(
  "/",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const {
      page_id,
      run_id,
      check_factor,
      title,
      description,
      screenshot_url,
      context_text,
      ai_generated = false,
    } = req.body

    if (!page_id || !run_id || !title || !check_factor) {
      return res.status(400).json({
        error:
          "Missing required fields: page_id, run_id, title, check_factor",
      })
    }

    try {
      const { data: newFinding, error } = await supabase
        .from("findings")
        .insert({
          page_id,
          run_id,
          check_factor,
          title,
          description,
          screenshot_url,
          context_text,
          ai_generated,
          status: "open",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) throw error

      return res.status(201).json(newFinding)
    } catch (error: any) {
      logger.error({ error: error.message }, "Error creating manual finding")
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * PATCH /api/findings/:id/status
 * Update the status of a finding (confirmed, false_positive, open).
 */
router.patch(
  "/:id/status",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { status } = req.body

    if (!["confirmed", "false_positive", "open"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" })
    }

    try {
      const idList = id.split(",")
      const { data, error } = await supabase
        .from("findings")
        .update({ status, updated_at: new Date().toISOString() })
        .in("id", idList)
        .select()

      if (error) throw error
      if (!data || data.length === 0) return res.status(404).json({ error: "Finding not found" })

      return res.json(data[0])
    } catch (error: any) {
      logger.error(
        { findingId: id, error: error.message },
        "Error updating finding status",
      )
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * PATCH /api/findings/:id
 * Update finding details (context text, Basecamp comment references).
 */
router.patch(
  "/:id",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const {
      context_text,
      basecamp_comment_id,
      basecamp_comment_url,
    } = req.body

    try {
      const updatePayload: any = { updated_at: new Date().toISOString() }
      if (context_text !== undefined) updatePayload.context_text = context_text
      if (basecamp_comment_id !== undefined)
        updatePayload.basecamp_comment_id = basecamp_comment_id
      if (basecamp_comment_url !== undefined)
        updatePayload.basecamp_comment_url = basecamp_comment_url
      const idList = id.split(",")
      const { data, error } = await supabase
        .from("findings")
        .update(updatePayload)
        .in("id", idList)
        .select()

      if (error) throw error
      if (!data || data.length === 0) return res.status(404).json({ error: "Finding not found" })

      return res.json(data[0])
    } catch (error: any) {
      logger.error(
        { findingId: id, error: error.message },
        "Error updating finding",
      )
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/projects/:id/spelling-allowlist
 * Add a word to the project's spelling allowlist.
 * Note: This endpoint is grouped here as requested, though it acts on projects.
 */
router.post(
  "/projects/:id/spelling-allowlist",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id: project_id } = req.params
    const { word } = req.body

    if (!word) {
      return res.status(400).json({ error: "Word is required" })
    }

    try {
      // 1. Get current settings
      const { data: project, error: fetchError } = await supabase
        .from("projects")
        .select("project_settings")
        .eq("id", project_id)
        .single()

      if (fetchError || !project) {
        return res.status(404).json({ error: "Project not found" })
      }

      const settings = project.project_settings || {}
      const allowlist = settings.spelling_allowlist || []

      if (!allowlist.includes(word)) {
        allowlist.push(word)
      }

      // 2. Update settings
      const { error: updateError } = await supabase
        .from("projects")
        .update({
          project_settings: {
            ...settings,
            spelling_allowlist: allowlist,
          },
        })
        .eq("id", project_id)

      if (updateError) throw updateError

      return res.json({ success: true, word })
    } catch (error: any) {
      logger.error(
        { project_id, error: error.message },
        "Error adding word to spelling allowlist",
      )
      return res.status(500).json({ error: error.message })
    }
  },
)

export { router as findingsRouter }
