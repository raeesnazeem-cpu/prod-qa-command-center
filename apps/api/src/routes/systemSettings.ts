import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { logger } from "../lib/logger"

const router: Router = Router()

/**
 * GET /api/system-settings
 * Publicly accessible endpoint to fetch system settings (like maintenance mode)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("is_maintenance_mode")
      .eq("id", 1)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No row found, assume false
        return res.json({ is_maintenance_mode: false })
      }
      throw error
    }

    return res.json(data)
  } catch (error: unknown) {
    const err = error as Error
    logger.error({ error: err.message }, "Failed to fetch system settings")
    // Fallback to false if there is an error
    return res.status(500).json({ error: err.message, is_maintenance_mode: false })
  }
})

export { router as systemSettingsRouter }
