import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"
import { logger } from "../lib/logger"

const router: Router = Router()

type TedComment = {
  id: string
  project_id: string | null
  qa_run_id: string | null
  ted_task_id: string | null
  target_kind: string | null
  check_factor: string | null
  body_html: string
  event_key: string | null
  source: string | null
  author: string | null
  created_at: string
}

/**
 * GET /api/ted-comments?project_id=...
 * List the locally-captured TED comments for a project, grouped by QA run
 * (newest run first, comments oldest-first within a run) plus any that aren't
 * tied to a run. This is the local preview of what QACC would post to TED.
 */
router.get("/", clerkAuth, async (req: Request, res: Response) => {
  const projectId = String(req.query.project_id || "")
  if (!projectId) {
    return res.status(400).json({ error: "project_id is required" })
  }

  try {
    const { data: comments, error } = await supabase
      .from("ted_comments")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })

    if (error) {
      logger.error({ error: error.message }, "Failed to list TED comments")
      return res.status(500).json({ error: "Failed to list TED comments" })
    }

    const rows = (comments || []) as TedComment[]

    // Pull run metadata so the tab can label each group.
    const runIds = Array.from(
      new Set(rows.map((c) => c.qa_run_id).filter(Boolean)),
    ) as string[]

    let runsById: Record<string, any> = {}
    if (runIds.length) {
      const { data: runs } = await supabase
        .from("qa_runs")
        .select("id, run_type, site_url, status, created_at, custom_name")
        .in("id", runIds)
      runsById = Object.fromEntries((runs || []).map((r) => [r.id, r]))
    }

    // Group by run.
    const groupsMap = new Map<string, { run: any; comments: TedComment[] }>()
    const unlinked: TedComment[] = []
    for (const c of rows) {
      if (!c.qa_run_id) {
        unlinked.push(c)
        continue
      }
      if (!groupsMap.has(c.qa_run_id)) {
        groupsMap.set(c.qa_run_id, {
          run: runsById[c.qa_run_id] || { id: c.qa_run_id },
          comments: [],
        })
      }
      groupsMap.get(c.qa_run_id)!.comments.push(c)
    }

    // Newest run first (by run created_at, falling back to first comment time).
    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      const ta = new Date(a.run?.created_at || a.comments[0]?.created_at || 0).getTime()
      const tb = new Date(b.run?.created_at || b.comments[0]?.created_at || 0).getTime()
      return tb - ta
    })

    return res.json({ groups, unlinked })
  } catch (err: any) {
    logger.error({ error: err?.message }, "Exception listing TED comments")
    return res.status(500).json({ error: "Failed to list TED comments" })
  }
})

/**
 * POST /api/ted-comments
 * Add a manual comment to the local preview. Local-only — never posted to TED.
 * Body: { project_id, body_html, qa_run_id?, ted_task_id?, check_factor? }
 */
router.post("/", clerkAuth, async (req: Request, res: Response) => {
  const { project_id, body_html, qa_run_id, ted_task_id, check_factor } =
    req.body || {}

  if (!project_id || !body_html || !String(body_html).trim()) {
    return res
      .status(400)
      .json({ error: "project_id and body_html are required" })
  }

  try {
    const { data, error } = await supabase
      .from("ted_comments")
      .insert({
        project_id,
        qa_run_id: qa_run_id || null,
        ted_task_id: ted_task_id || null,
        target_kind: "parent",
        check_factor: check_factor || null,
        body_html: String(body_html),
        event_key: null,
        source: "manual",
        author: "You",
      })
      .select("*")
      .single()

    if (error) {
      logger.error({ error: error.message }, "Failed to add TED comment")
      return res.status(500).json({ error: "Failed to add TED comment" })
    }
    return res.status(201).json(data)
  } catch (err: any) {
    logger.error({ error: err?.message }, "Exception adding TED comment")
    return res.status(500).json({ error: "Failed to add TED comment" })
  }
})

/**
 * DELETE /api/ted-comments?project_id=...
 * Remove ALL comments for a project from the local preview at once.
 * Local-only — TED is untouched. Declared before "/:id" so the bare path
 * with a project_id query is matched here, not as an id of "".
 */
router.delete("/", clerkAuth, async (req: Request, res: Response) => {
  const projectId = String(req.query.project_id || "")
  if (!projectId) {
    return res.status(400).json({ error: "project_id is required" })
  }
  try {
    const { error } = await supabase
      .from("ted_comments")
      .delete()
      .eq("project_id", projectId)
    if (error) {
      logger.error(
        { error: error.message },
        "Failed to delete all TED comments",
      )
      return res.status(500).json({ error: "Failed to delete all TED comments" })
    }
    return res.status(204).send()
  } catch (err: any) {
    logger.error({ error: err?.message }, "Exception deleting all TED comments")
    return res.status(500).json({ error: "Failed to delete all TED comments" })
  }
})

/**
 * DELETE /api/ted-comments/:id
 * Remove a comment from the local preview. Local-only — TED is untouched.
 */
router.delete("/:id", clerkAuth, async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const { error } = await supabase.from("ted_comments").delete().eq("id", id)
    if (error) {
      logger.error({ error: error.message }, "Failed to delete TED comment")
      return res.status(500).json({ error: "Failed to delete TED comment" })
    }
    return res.status(204).send()
  } catch (err: any) {
    logger.error({ error: err?.message }, "Exception deleting TED comment")
    return res.status(500).json({ error: "Failed to delete TED comment" })
  }
})

export { router as tedCommentsRouter }
