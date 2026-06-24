import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"
import { requireRole } from "../middleware/requireRole"
import { zodValidate } from "../middleware/zodValidate"
import { CreateProjectSchema, UpdateProjectSchema } from "@qacc/shared"
import { logger } from "../lib/logger"
import { encrypt, decrypt } from "@qacc/shared/encryption"

import * as activityService from "../services/activityService"
import { bulkDeleteRuns } from "../services/runService"
import axios from "axios"

const router: Router = Router()

/**
 * Helper to get Supabase user UUID from Clerk ID.
 * Refactored to handle cases where the ID might already be a Supabase UUID from the middleware.
 */
async function getSupabaseUserId(clerkIdOrUuid: string): Promise<string> {
  if (!clerkIdOrUuid) throw new Error("clerkIdOrUuid is required")

  // If it's already a UUID, return it
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
 * POST /api/projects
 * Create a new project. Restricted to sub_admin and above.
 */
router.post(
  "/",
  clerkAuth,
  requireRole("sub_admin"),
  zodValidate(CreateProjectSchema),
  async (req: Request, res: Response) => {
    const { name, site_url, client_name, is_woocommerce, is_pre_release } =
      req.body
    const { orgId, userId: clerkUserId } = req.auth!

    if (!orgId) {
      return res.status(400).json({ error: "Organization ID is required" })
    }

    try {
      const supabaseUserId = await getSupabaseUserId(clerkUserId)

      // 1. Insert the project
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          name,
          site_url,
          client_name,
          is_woocommerce,
          is_pre_release: is_pre_release || false,
          org_id: orgId,
          status: "active",
        })
        .select()
        .single()

      if (projectError) {
        if (projectError.code === "23505") {
          return res.status(400).json({
            error: `A project with the name "${name}" already exists.`,
          })
        }
        throw projectError
      }

      // 2. Add creator as project member (sub_admin)
      const { error: memberError } = await supabase
        .from("project_members")
        .insert({
          project_id: project.id,
          user_id: supabaseUserId,
          role: "sub_admin",
        })

      if (memberError) throw memberError

      // 3. Initialize project_settings
      await supabase.from("project_settings").insert({
        project_id: project.id,
        notification_prefs: {},
        basecamp_account_id: '4023059',
      })

      // [Step 3.1 - 3.2] Log Project Creation
      try {
        const { data: userData } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", supabaseUserId)
          .single()

        await activityService.notifyProjectCreated(
          { id: supabaseUserId, name: userData?.full_name || "Unknown User" },
          { id: project.id, name: project.name },
        )
      } catch (logError) {
        logger.error(
          logError,
          "[ActivityService] Failed to log project creation",
        )
      }

      return res.status(201).json(project)
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * GET /api/projects
 * List projects based on RBAC.
 */
router.get("/", clerkAuth, async (req: Request, res: Response) => {
  const { userId: clerkUserId, role, orgId } = req.auth!

  try {
    const supabaseUserId = await getSupabaseUserId(clerkUserId)

    let query = supabase
      .from("projects")
      .select(
        `
               *,
        qa_runs(
          id,
          status,
          completed_at,
          created_at,
          pages_processed,
          pages_total
        ),
        tasks(
          status
        ),
        project_settings(
          basecamp_account_id,
          basecamp_project_id,
          basecamp_todolist_id,
          basecamp_post_todolist_id
        )
      `,
      )
      .eq("org_id", orgId)

    // Filter by membership if not super_admin or admin
    if (role !== "super_admin" && role !== "admin" && role !== "qa_engineer") {
      const { data: memberships } = await supabase
        .from("project_members")
        .select("project_id")
        .eq("user_id", supabaseUserId)

      const projectIds = memberships?.map((m) => m.project_id) || []
      if (projectIds.length === 0) return res.json([])
      query = query.in("id", projectIds)
    }

    const { data, error } = await query
    if (error) throw error

    const projects = data.map((project: any) => {
      const sortedRuns =
        project.qa_runs?.sort(
          (a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ) || []
      const lastRun = sortedRuns[0]
      const ongoingRun = project.qa_runs?.find((r: any) =>
        ["running", "pending", "paused"].includes(r.status),
      )
      const openIssuesCount =
        project.tasks?.filter((t: any) =>
          ["open", "in_progress"].includes(t.status) && !t.title?.includes("[Feedback]")
        ).length || 0

      const { qa_runs, tasks, project_settings, ...rest } = project
      const settings = Array.isArray(project_settings)
        ? project_settings[0]
        : project_settings

      return {
        ...rest,
        basecamp_account_id: settings?.basecamp_account_id || null,
        basecamp_project_id: settings?.basecamp_project_id || null,
        basecamp_todo_list_id: settings?.basecamp_todolist_id || null,
        basecamp_post_todo_list_id: settings?.basecamp_post_todolist_id || null,
        total_runs_count: project.qa_runs?.length || 0,
        last_run_date: lastRun
          ? lastRun.completed_at || lastRun.created_at
          : null,
        open_issues_count: openIssuesCount,
        ongoing_run: ongoingRun
          ? {
              id: ongoingRun.id,
              status: ongoingRun.status,
              pages_processed: ongoingRun.pages_processed,
              pages_total: ongoingRun.pages_total,
            }
          : null,
      }
    })

    return res.json(projects)
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/projects/:id/members
 * Add user to project. Restricted to sub_admin and above.
 */
router.post(
  "/:id/members",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id: project_id } = req.params
    const { email, role } = req.body

    if (!email || !role) {
      return res.status(400).json({ error: "email and role are required" })
    }

    try {
      // 1. Find user in the ORG's users table
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id, full_name")
        .eq("email", email)
        .eq("org_id", req.auth?.orgId)
        .single()

      if (userError || !user) {
        return res.status(404).json({
          error: `User with email ${email} not found in your organization`,
        })
      }

      // 2. Add to project_members
      const { data, error: insertError } = await supabase
        .from("project_members")
        .upsert(
          {
            project_id,
            user_id: user.id,
            role,
          },
          { onConflict: "project_id,user_id" },
        )
        .select()
        .single()

      if (insertError) throw insertError

      // [Step 3.11 - 3.12] Log Member Addition
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
            .eq("id", project_id)
            .single(),
        ])

        const performerName = performerRes.data?.full_name || "Admin"
        const projectName = projectRes.data?.name || "Project"

        // We use logActivity directly for this specific message format
        await activityService.logActivity(
          { id: performerRes.data?.id || "", name: performerName },
          {
            type: "MEMBER_ADDED",
            details: {
              memberEmail: email,
              projectName,
              message: `${user.full_name || email} was added to project by ${performerName}`,
            },
          },
          { id: project_id, type: "project" },
          [user.id], // [Step 3.12] Notify the specific member
        )
      } catch (logError) {
        logger.error(
          logError,
          "[ActivityService] Failed to log member addition",
        )
      }

      return res.status(201).json(data)
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * GET /api/projects/:id
 */
router.get("/:id", clerkAuth, async (req: Request, res: Response) => {
  const { id } = req.params
  const { userId: clerkUserId, role, orgId } = req.auth!

  try {
    const supabaseUserId = await getSupabaseUserId(clerkUserId)

    // Verify access if not super_admin/admin
    if (role !== "super_admin" && role !== "admin" && role !== "qa_engineer") {
      const { data: membership } = await supabase
        .from("project_members")
        .select("id")
        .eq("project_id", id)
        .eq("user_id", supabaseUserId)
        .single()

      if (!membership)
        return res
          .status(404)
          .json({ error: "Access denied or project not found" })
    }

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select(
        `
        *,
        project_members(
          role,
          user_id,
          users(full_name, email, role)
        ),
        qa_runs(
          id, status, completed_at, created_at, pages_processed, pages_total,
          creator:users!qa_runs_created_by_fkey (full_name, email)
        ),
        tasks(id, status, severity, created_at, title, finding_id),
        project_settings(*)
      `,
      )
      .eq("id", id)
      .eq("org_id", orgId)
      .single()

    if (projectError || !projectData)
      throw projectError || new Error("Project not found")

    const { qa_runs, tasks, project_settings, ...rest } = projectData

    const totalRuns = qa_runs?.length || 0
    const sortedRuns =
      qa_runs?.sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ) || []
    const lastRun = sortedRuns[0]
    const ongoingRun = qa_runs?.find((r: any) =>
      ["running", "pending", "paused"].includes(r.status),
    )

    const openIssuesCount = new Set(
      (tasks || [])
        .filter((t: any) => ["open", "in_progress"].includes(t.status) && !t.title?.includes("[Feedback]"))
        .map((t: any) => t.finding_id || t.title),
    ).size

    const resolvedIssuesCount =
      tasks?.filter((t: any) => ["resolved", "closed"].includes(t.status) && !t.title?.includes("[Feedback]"))
        .length || 0

    const settings = (Array.isArray(project_settings)
      ? project_settings[0]
      : project_settings) || {
      notification_prefs: {},
      figma_token_encrypted: null,
      basecamp_account_id: null,
      basecamp_project_id: null,
      basecamp_todolist_id: null,
      basecamp_post_todolist_id: null,
      basecamp_token_encrypted: null,
    }

    return res.json({
      ...rest,
      total_runs_count: totalRuns,
      last_run_date: lastRun
        ? lastRun.completed_at || lastRun.created_at
        : null,
      open_issues_count: openIssuesCount,
      resolved_issues_count: resolvedIssuesCount,
      ongoing_run: ongoingRun
        ? {
            id: ongoingRun.id,
            status: ongoingRun.status,
            pages_processed: ongoingRun.pages_processed,
            pages_total: ongoingRun.pages_total,
            created_by_name:
              ongoingRun.creator?.full_name ||
              ongoingRun.creator?.email ||
              "System",
          }
        : null,
      figma_access_token: settings?.figma_token_encrypted
        ? decrypt(settings.figma_token_encrypted)
        : null,
      basecamp_account_id: settings?.basecamp_account_id || null,
      basecamp_project_id: settings?.basecamp_project_id || null,
      basecamp_todo_list_id: settings?.basecamp_todolist_id || null,
      basecamp_post_todo_list_id: settings?.basecamp_post_todolist_id || null,
      basecamp_api_token: settings?.basecamp_token_encrypted
        ? decrypt(settings.basecamp_token_encrypted)
        : null,
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/projects/:id
 */
router.patch(
  "/:id",
  clerkAuth,
  requireRole("sub_admin"),
  zodValidate(UpdateProjectSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params
    try {
      const { data, error } = await supabase
        .from("projects")
        .update({
          name: req.body.name,
          site_url: req.body.site_url,
          client_name: req.body.client_name,
          is_pre_release:
            req.body.is_pre_release !== undefined
              ? req.body.is_pre_release
              : undefined,
          status: req.body.status || "active",
        })
        .eq("id", id)
        .eq("org_id", req.auth?.orgId)
        .select()
        .single()

      if (error) throw error

      //Log Project Update
      try {
        const { userId: clerkUserId } = req.auth!
        const supabaseUserId = await getSupabaseUserId(clerkUserId)
        const { data: userData } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", supabaseUserId)
          .single()

        const changes = []
        if (req.body.name) changes.push(`name to "${req.body.name}"`)
        if (req.body.status) changes.push(`status to "${req.body.status}"`)
        if (req.body.site_url) changes.push(`URL to "${req.body.site_url}"`)

        if (changes.length > 0) {
          await activityService.logActivity(
            { id: supabaseUserId, name: userData?.full_name || "Unknown User" },
            {
              type: "PROJECT_UPDATED",
              details: {
                projectName: data.name,
                message: `Updated ${changes.join(", ")}`,
              },
            },
            { id, type: "project" },
          )
        }
      } catch (logError) {
        logger.error(logError, "[ActivityService] Failed to log project update")
      }

      // Handle project_settings upsert
      const settingsUpdate: any = {}
      if (req.body.figma_access_token !== undefined) {
        const isEncrypted =
          typeof req.body.figma_access_token === "string" &&
          req.body.figma_access_token.split(":").length === 3
        if (req.body.figma_access_token && !isEncrypted) {
          settingsUpdate.figma_token_encrypted = encrypt(
            req.body.figma_access_token,
          )
        } else if (!req.body.figma_access_token) {
          settingsUpdate.figma_token_encrypted = null
        }
      }
      if (req.body.basecamp_account_id !== undefined)
        settingsUpdate.basecamp_account_id = req.body.basecamp_account_id
      if (req.body.basecamp_project_id !== undefined) {
        settingsUpdate.basecamp_project_id = req.body.basecamp_project_id

        // Auto-fetch user's global Basecamp token if they are linking a project
        // but not explicitly providing a new token.
        if (req.body.basecamp_api_token === undefined && req.auth?.userId) {
          const { data: userData } = await supabase
            .from("users")
            .select("basecamp_access_token")
            .eq("id", req.auth.userId)
            .single()

          if (userData?.basecamp_access_token) {
            settingsUpdate.basecamp_token_encrypted = encrypt(
              userData.basecamp_access_token
            )
          }
        }
      }
      if (req.body.basecamp_todo_list_id !== undefined)
        settingsUpdate.basecamp_todolist_id = req.body.basecamp_todo_list_id
      if (req.body.basecamp_post_todo_list_id !== undefined)
        settingsUpdate.basecamp_post_todolist_id =
          req.body.basecamp_post_todo_list_id
      if (req.body.basecamp_api_token !== undefined) {
        const isEncrypted =
          typeof req.body.basecamp_api_token === "string" &&
          req.body.basecamp_api_token.split(":").length === 3
        if (req.body.basecamp_api_token && !isEncrypted) {
          settingsUpdate.basecamp_token_encrypted = encrypt(
            req.body.basecamp_api_token,
          )
        } else if (!req.body.basecamp_api_token) {
          settingsUpdate.basecamp_token_encrypted = null
        }
      }

      if (Object.keys(settingsUpdate).length > 0) {
        const { error: settingsError } = await supabase
          .from("project_settings")
          .upsert(
            {
              project_id: id,
              ...settingsUpdate,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "project_id" },
          )

        if (settingsError) throw settingsError
      }

      return res.json(data)
    } catch (error: any) {
      logger.error({ error, projectId: id }, "[Update Project Error]")
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * DELETE /api/projects/:id
 */
router.delete(
  "/:id",
  clerkAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const { id } = req.params

    // [Step 3.5] Log Project Deletion before it's gone
    try {
      const { userId: clerkUserId } = req.auth!
      const supabaseUserId = await getSupabaseUserId(clerkUserId)

      // Fetch project and user info first
      const [projRes, userRes] = await Promise.all([
        supabase.from("projects").select("name").eq("id", id).single(),
        supabase
          .from("users")
          .select("full_name")
          .eq("id", supabaseUserId)
          .single(),
      ])

      if (projRes.data) {
        await activityService.logActivity(
          {
            id: supabaseUserId,
            name: userRes.data?.full_name || "Unknown User",
          },
          {
            type: "PROJECT_DELETED",
            details: { projectName: projRes.data.name },
            isAdminOnly: true, // Deletions are high-level actions
          },
          { id, type: "project" },
        )
      }
    } catch (logError) {
      logger.error(logError, "[ActivityService] Failed to log project deletion")
    }

    try {
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", id)
        .eq("org_id", req.auth?.orgId)

      if (error) throw error
      return res.status(204).send()
    } catch (error: any) {
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/projects/:id/settings/test-basecamp
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

      const { decrypt } = await import("@qacc/shared/encryption")

      const decryptedToken = decrypt(settings.basecamp_token_encrypted)

      const response = await axios.get(
        `https://3.basecampapi.com/${settings.basecamp_account_id}/projects.json`,
        {
          headers: {
            Authorization: `Bearer ${decryptedToken}`,
            "User-Agent": "QA Command Center (raees@example.com)",
          },
        },
      )

      return res.json({
        success: true,
        message: "Connected",
        projectsCount: response.data?.length,
      })
    } catch (error: any) {
      const message = error.response?.data?.error || error.message
      return res.status(400).json({ error: `Basecamp API error: ${message}` })
    }
  },
)

/**
 * POST /api/projects/:id/transition-release-state
 * Toggles is_pre_release and deletes unpinned pre-release runs if transitioning to pre-release
 */
router.post(
  "/:id/transition-release-state",
  clerkAuth,
  requireRole("qa_engineer"), // Assuming QA Engineers and Project Managers can do this
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { is_pre_release } = req.body;

    try {
      // 1. Update project
      const { data: project, error } = await supabase
        .from("projects")
        .update({ is_pre_release })
        .eq("id", id)
        .eq("org_id", req.auth?.orgId)
        .select()
        .single();

      if (error) throw error;

      // 2. If transitioning back to pre-release, delete unpinned pre-release runs
      if (is_pre_release) {
        const { data: runs } = await supabase
          .from("qa_runs")
          .select("id")
          .eq("project_id", id)
          .eq("run_type", "pre_release")
          .eq("is_pinned", false);

        if (runs && runs.length > 0) {
          const runIds = runs.map((r: any) => r.id);
          await bulkDeleteRuns(runIds);
        }
      }

      return res.json(project);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
)

export { router as projectsRouter }
