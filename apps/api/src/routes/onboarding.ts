import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"
import { logger } from "../lib/logger"
import { randomUUID } from "crypto"

const router: Router = Router()

/**
 * POST /api/users/onboard
 * Complete user profile and add to all existing projects in the organization.
 * Ensuring it correctly inserts or updates the user row.
 */
router.post("/onboard", clerkAuth, async (req: Request, res: Response) => {
  const { fullName, role, email: bodyEmail } = req.body
  const { userId, orgId, email: authEmail, clerkUserId } = req.auth as any

  if (!fullName || !role) {
    return res.status(400).json({ error: "fullName and role are required" })
  }

  try {
    const emailToUpdate = bodyEmail || authEmail

    // 1. Ensure user exists in Supabase (Upsert)
    // If userId is already a UUID (from clerkAuth), we use it.
    // If it's a Clerk ID, we generate a new UUID for the 'id' column.
    const isUuid = userId && userId.length === 36 && userId.includes("-")
    const finalUserId = isUuid ? userId : randomUUID()

    const { data: user, error: userError } = await supabase
      .from("users")
      .upsert(
        {
          id: finalUserId,
          clerk_user_id: clerkUserId || userId,
          clerk_id: clerkUserId || userId,
          full_name: fullName,
          role: role,
          org_id: orgId,
          email: emailToUpdate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clerk_user_id" },
      )
      .select()
      .single()

    if (userError) {
      logger.error(
        { error: userError, userId: finalUserId },
        "Error in onboarding upsert",
      )
      throw userError
    }

    logger.info(
      { userId: user.id, role: user.role },
      "User onboarded successfully",
    )

    // 1.5 Sync name back to Clerk so <UserButton> shows correct name
    try {
      const { clerkClient } = await import("@clerk/express")
      const clerkId = clerkUserId || userId
      if (clerkId && !clerkId.includes("-")) {
        // Only if it's a Clerk ID, not UUID
        await clerkClient.users.updateUser(clerkId, {
          firstName: fullName.split(" ")[0] || fullName,
          lastName: fullName.split(" ").slice(1).join(" ") || "",
        })
        logger.info({ clerkId }, "Synced name back to Clerk")
      }
    } catch (clerkErr) {
      logger.error(
        { error: clerkErr },
        "Failed to sync name to Clerk (non-fatal)",
      )
    }

    // 2. Automatically add to all projects in the organization
    if (orgId) {
      const { data: projects, error: projectsError } = await supabase
        .from("projects")
        .select("id")
        .eq("org_id", orgId)

      if (!projectsError && projects && projects.length > 0) {
        const memberships = projects.map((p) => ({
          project_id: p.id,
          user_id: user.id,
          role: role,
        }))

        const { error: membersError } = await supabase
          .from("project_members")
          .upsert(memberships, { onConflict: "project_id,user_id" })

        if (membersError) {
          logger.error(
            { error: membersError.message },
            "Failed to auto-assign user to projects",
          )
        }
      }
    }

    return res.status(201).json({ success: true, user })
  } catch (error: any) {
    logger.error({ error: error.message }, "Error in user onboarding")
    return res.status(500).json({ error: error.message })
  }
})

export { router as onboardingRouter }
