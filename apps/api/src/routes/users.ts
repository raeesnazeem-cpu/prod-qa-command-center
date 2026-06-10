import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"
import { requireRole } from "../middleware/requireRole"
import { logger } from "../lib/logger"
import * as activityService from "../services/activityService"

const router: Router = Router()

/**
 * GET /api/users
 * List all users in the same organization as the current user.
 */
router.get("/", clerkAuth, async (req: Request, res: Response) => {
  const { orgId } = req.auth!

  if (!orgId) {
    return res.status(400).json({ error: "Organization ID is required" })
  }

  try {
    logger.info({ orgId }, "Fetching all users for organization")

    const { data, error } = await supabase
      .from("users")
      .select("id, full_name, email, role, basecamp_person_id")
      .eq("org_id", orgId)
      .order("full_name", { ascending: true })

    if (error) {
      logger.error({ error: error.message }, "Error fetching workspace users")
      throw error
    }

    return res.json(data)
  } catch (error: any) {
    logger.error({ error: error.message }, "Unhandled error in GET /api/users")
    return res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/users/:id
 * Update a user's profile or role. Restricted to admin+.
 */
router.patch(
  "/:id",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { full_name, role } = req.body
    const { orgId } = req.auth!

    try {
      const { data, error } = await supabase
        .from("users")
        .update({
          ...(full_name && { full_name }),
          ...(role && { role }),
          ...(req.body.basecamp_person_id !== undefined && {
            basecamp_person_id: req.body.basecamp_person_id,
          }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("org_id", orgId)
        .select()
        .single()

      if (error) throw error

      // [Step 3.8] Log User Profile/Role Update
      try {
        const { userId: clerkUserId } = req.auth!
        const performerId = await supabase
          .from("users")
          .select("id, full_name")
          .eq("clerk_user_id", clerkUserId)
          .single()

        const changes = []
        if (full_name) changes.push(`name to "${full_name}"`)
        if (role) changes.push(`role to "${role}"`)

        if (changes.length > 0) {
          await activityService.logActivity(
            {
              id: performerId.data?.id || "",
              name: performerId.data?.full_name || "Admin",
            },
            {
              type: "USER_UPDATED",
              details: {
                targetUser: data.full_name,
                message: `Updated ${changes.join(", ")}`,
              },
              isAdminOnly: true,
            },
            { id, type: "user" },
          )
        }
      } catch (logError) {
        logger.error(logError, "[ActivityService] Failed to log user update")
      }

      return res.json(data)
    } catch (error: any) {
      logger.error({ error: error.message, userId: id }, "Error updating user")
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * DELETE /api/users/:id
 * Remove a user from the organization. Restricted to admin+.
 */
router.delete(
  "/:id",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { orgId } = req.auth!

    // [Step 3.9] Log User Deletion
    try {
      const { userId: clerkUserId } = req.auth!
      const [performerRes, targetRes] = await Promise.all([
        supabase
          .from("users")
          .select("id, full_name")
          .eq("clerk_user_id", clerkUserId)
          .single(),
        supabase.from("users").select("full_name").eq("id", id).single(),
      ])

      if (targetRes.data) {
        await activityService.logActivity(
          {
            id: performerRes.data?.id || "",
            name: performerRes.data?.full_name || "Admin",
          },
          {
            type: "USER_DELETED",
            details: { targetUser: targetRes.data.full_name },
            isAdminOnly: true,
          },
          { id, type: "user" },
        )
      }
    } catch (logError) {
      logger.error(logError, "[ActivityService] Failed to log user deletion")
    }

    try {
      // Fetch clerk_user_id before deleting from Supabase
      const { data: userToDelete } = await supabase
        .from("users")
        .select("clerk_user_id")
        .eq("id", id)
        .eq("org_id", orgId)
        .single()

      // Delete from Clerk
      if (userToDelete?.clerk_user_id) {
        const { clerkClient } = await import("@clerk/express")
        await clerkClient.users.deleteUser(userToDelete.clerk_user_id)
      }

      const { error } = await supabase
        .from("users")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId)

      if (error) throw error
      return res.status(204).send()
    } catch (error: any) {
      logger.error({ error: error.message, userId: id }, "Error deleting user")
      return res.status(500).json({ error: error.message })
    }
  },
)

export { router as usersRouter }
