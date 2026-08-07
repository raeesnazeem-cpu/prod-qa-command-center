import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"

const router: Router = Router()

// List AI-fix (dry-run) records for a project, newest first, paginated.
router.get("/projects/:projectId", clerkAuth, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    const { data, error, count } = await supabase
      .from("ai_fix_runs")
      .select("id, run_id, project_id, run_type, committed, commit_url, created_at", {
        count: "exact",
      })
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return res.json({ data: data || [], pagination: { page, limit, total: count || 0 } })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Full detail (incl. the data JSON) for one AI-fix record.
router.get("/:id", clerkAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { data, error } = await supabase
      .from("ai_fix_runs")
      .select("*")
      .eq("id", id)
      .single()
    if (error || !data) return res.status(404).json({ error: "Not found" })
    return res.json(data)
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

export { router as aiFixRunsRouter }
