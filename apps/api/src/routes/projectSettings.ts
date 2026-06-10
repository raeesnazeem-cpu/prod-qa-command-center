import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"
import { requireRole } from "../middleware/requireRole"
import { encrypt, decrypt } from "../lib/encryption"
import axios from "axios"

const router: Router = Router()

/**
 * Helper to redact sensitive tokens
 */
function redactToken(token: string | null | undefined): string | null {
  if (!token) return null
  // If it's already encrypted (has colons), we decrypt first to redact the real value
  // or just return the redacted placeholder if we can't/don't want to decrypt here.
  // The requirement says "return only **** + last 4 chars".
  // Since we store encrypted, we MUST decrypt to get the last 4 chars of the original.
  try {
    const decrypted = decrypt(token)
    return `****${decrypted.slice(-4)}`
  } catch (e) {
    return "****"
  }
}

/**
 * GET /api/projects/:id/settings
 * Return project settings with redacted tokens.
 */
router.get("/:id/settings", clerkAuth, async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const { data, error } = await supabase
      .from("project_settings")
      .select("*")
      .eq("project_id", id)
      .single()

    if (error && error.code !== "PGRST116") {
      // PGRST116 is "not found"
      throw error
    }

    if (!data) {
      return res.json({})
    }

    return res.json({
      ...data,
      figma_token: redactToken(data.figma_token),
      basecamp_token: redactToken(data.basecamp_token),
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/projects/:id/settings
 * Update project settings with encrypted tokens.
 */
router.patch(
  "/:id/settings",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const { id: project_id } = req.params
    const {
      figma_token,
      basecamp_token,
      basecamp_account_id,
      basecamp_project_id,
      basecamp_todolist_id,
      slack_webhook_url,
      google_chat_webhook_url,
      google_chat_enabled,
      notify_run_complete,
      notify_critical_finding,
      notify_sign_off,
    } = req.body

    try {
      const updateData: any = {
        project_id,
        updated_at: new Date().toISOString(),
      }

      if (figma_token !== undefined) {
        updateData.figma_token = figma_token ? encrypt(figma_token) : null
      }
      if (basecamp_token !== undefined) {
        updateData.basecamp_token = basecamp_token
          ? encrypt(basecamp_token)
          : null
      }
      if (basecamp_account_id !== undefined)
        updateData.basecamp_account_id = basecamp_account_id
      if (basecamp_project_id !== undefined)
        updateData.basecamp_project_id = basecamp_project_id
      if (basecamp_todolist_id !== undefined)
        updateData.basecamp_todolist_id = basecamp_todolist_id
      if (slack_webhook_url !== undefined)
        updateData.slack_webhook_url = slack_webhook_url
      if (google_chat_webhook_url !== undefined)
        updateData.google_chat_webhook_url = google_chat_webhook_url
      if (google_chat_enabled !== undefined)
        updateData.google_chat_enabled = google_chat_enabled
      if (notify_run_complete !== undefined)
        updateData.notify_run_complete = notify_run_complete
      if (notify_critical_finding !== undefined)
        updateData.notify_critical_finding = notify_critical_finding
      if (notify_sign_off !== undefined)
        updateData.notify_sign_off = notify_sign_off

      const { data, error } = await supabase
        .from("project_settings")
        .upsert(updateData, { onConflict: "project_id" })
        .select()
        .single()

      if (error) throw error

      return res.json({
        ...data,
        figma_token: redactToken(data.figma_token),
        basecamp_token: redactToken(data.basecamp_token),
      })
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/projects/:id/settings/test-basecamp
 * Test Basecamp connection by making a real API call.
 */
router.post(
  "/:id/settings/test-basecamp",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const { id: project_id } = req.params

    try {
      const { data: settings, error } = await supabase
        .from("project_settings")
        .select("*")
        .eq("project_id", project_id)
        .single()

      if (error || !settings) {
        return res.status(404).json({ error: "Project settings not found" })
      }

      if (!settings.basecamp_token_encrypted || !settings.basecamp_account_id) {
        return res.status(400).json({ error: "Basecamp configuration missing" })
      }

      const decryptedToken = decrypt(settings.basecamp_token_encrypted)

      try {
        const response = await axios.get(
          `https://3.basecampapi.com/${settings.basecamp_account_id}/projects.json`,
          {
            headers: {
              Authorization: `Bearer ${decryptedToken}`,
              "User-Agent": "QA Command Center (raees@example.com)", // Basecamp requires a User-Agent
            },
          },
        )

        if (response.status === 200) {
          return res.json({ success: true, message: "Connected" })
        } else {
          throw new Error(`Basecamp returned status ${response.status}`)
        }
      } catch (apiError: any) {
        const message = apiError.response?.data?.error || apiError.message
        return res
          .status(400)
          .json({ success: false, error: `Basecamp API error: ${message}` })
      }
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/projects/:id/settings/test-slack
 * Test Slack connection by sending a test message.
 */
router.post(
  "/:id/settings/test-slack",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const { webhook_url } = req.body

    if (!webhook_url) {
      return res.status(400).json({ error: "Webhook URL is required" })
    }

    try {
      const { sendSlackMessage } = require("../lib/slackNotifier")
      await sendSlackMessage(webhook_url, {
        text: "🔔 *QA Command Center Test* - Slack integration verified successfully!",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "🔔 *QA Command Center Test*\nSlack integration verified successfully!",
            },
          },
        ],
      })

      return res.json({ success: true, message: "Test message sent" })
    } catch (apiError: any) {
      return res
        .status(400)
        .json({ success: false, error: `Slack error: ${apiError.message}` })
    }
  },
)

export { router as projectSettingsRouter }
