import { Router, Request, Response } from "express"
import { supabase } from "../lib/supabase"
import { clerkAuth } from "../middleware/clerkAuth"
import { requireRole } from "../middleware/requireRole"
import { getProjectSettings } from "../lib/getDecryptedSettings"
import {
  createBasecampTodo,
  getBasecampPeople,
  getBasecampPerson,
  formatBasecampMention,
  createBasecampComment,
  deleteBasecampComment,
} from "../lib/basecampClient"
import { notifyOnGoogleChat } from "../services/googleChatNotificationService"
import { logger } from "../lib/logger"
import { broadcastTaskUpdate } from "../lib/realtimeService"
import crypto from "crypto"
import axios from "axios"

const router = Router()

const BASECAMP_CLIENT_ID = process.env.BASECAMP_CLIENT_ID || ""
const BASECAMP_CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET || ""
const BASECAMP_REDIRECT_URI =
  process.env.BASECAMP_REDIRECT_URI ||
  "http://localhost:3000/api/basecamp/callback"

router.get("/user-auth", clerkAuth, (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString("hex")
  res.cookie("basecamp_oauth_state", state, {
    httpOnly: true,
    maxAge: 1000 * 60 * 10,
  })
  const authUrl = `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${BASECAMP_CLIENT_ID}&redirect_uri=${encodeURIComponent(BASECAMP_REDIRECT_URI)}&state=${state}`
  return res.redirect(authUrl)
})

router.get("/callback", clerkAuth, async (req: Request, res: Response) => {
  const { code, state } = req.query
  if (!state) {
    return res.status(400).json({ error: "Invalid state parameter." })
  }

  try {
    const tokenResponse = await axios.post(
      "https://launchpad.37signals.com/authorization/token",
      null,
      {
        params: {
          type: "web_server",
          client_id: BASECAMP_CLIENT_ID,
          redirect_uri: BASECAMP_REDIRECT_URI,
          client_secret: BASECAMP_CLIENT_SECRET,
          code,
        },
      },
    )
    const { access_token, refresh_token, expires_in } = tokenResponse.data

    // Automatically fetch the user's Basecamp Identity ID
    const authInfoResponse = await axios.get(
      "https://launchpad.37signals.com/authorization.json",
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "User-Agent": "QACC (raees.nazeem@growth99.com)",
        },
      },
    )

    console.log("37SIGNALS IDENTITY RESPONSE:", authInfoResponse.data)

    const personId = authInfoResponse.data?.identity?.id

    await supabase
      .from("users")
      .update({
        basecamp_access_token: access_token,
        basecamp_refresh_token: refresh_token,
        basecamp_token_expires_at: new Date(
          Date.now() + expires_in * 1000,
        ).toISOString(),
        ...(personId ? { basecamp_person_id: String(personId) } : {}),
      })
      .eq("id", req.auth?.userId)

    res.clearCookie("basecamp_oauth_state")
    return res.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:5173"}/settings?basecamp=connected`,
    )
  } catch (error: any) {
    console.error(
      "Basecamp token error:",
      error.response?.data || error.message,
    )
    return res.status(500).json({ error: "Failed to connect to Basecamp." })
  }
})

/**
 * GET /api/basecamp/people
 * Fetch all people from Basecamp for a specific project.
 */
router.get("/people", clerkAuth, async (req: Request, res: Response) => {
  const { projectId } = req.query

  if (!projectId) {
    return res.status(400).json({ error: "projectId is required" })
  }

  try {
    const projectSettings = await getProjectSettings(projectId as string)

    if (
      !projectSettings ||
      !projectSettings.basecamp_token ||
      !projectSettings.basecamp_account_id
    ) {
      return res
        .status(400)
        .json({ error: "Basecamp not configured for this project" })
    }

    const people = await getBasecampPeople(
      projectSettings.basecamp_token,
      projectSettings.basecamp_account_id,
    )

    return res.json(people)
  } catch (error: any) {
    console.error("[BasecampPeople] Error:", error.message)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/tasks/:id/basecamp
 * Push a task to Basecamp as a to-do.
 */
router.post(
  "/:id/basecamp",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params

    console.log(`[BasecampPush] Starting push for task ${id}`)

    try {
      // 1. Load task + finding
      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .select("*, findings:finding_id (*)")
        .eq("id", id)
        .single()

      if (taskError || !task) {
        console.error(`[BasecampPush] Task ${id} fetch error:`, taskError)
        return res.status(404).json({ error: "Task not found" })
      }

      // 2. Parallel data fetching for settings, project, page URL, and siblings
      const siblingsQuery = supabase
        .from("tasks")
        .select("id, assigned_to")
        .eq("project_id", task.project_id)

      if (task.finding_id) {
        siblingsQuery.eq("finding_id", task.finding_id)
      } else {
        siblingsQuery.eq("title", task.title)
      }

      const [
        projectSettings,
        projectRecordResult,
        pageResult,
        siblingsResult,
        currentUserResult,
      ] = await Promise.all([
        getProjectSettings(task.project_id),
        supabase
          .from("projects")
          .select("is_pre_release, is_post_release, name")
          .eq("id", task.project_id)
          .single(),
        task.findings?.page_id
          ? supabase
              .from("pages")
              .select("url")
              .eq("id", task.findings.page_id)
              .single()
          : Promise.resolve({ data: null }),
        siblingsQuery,
        supabase
          .from("users")
          .select("basecamp_access_token, role")
          .eq("id", req.auth?.userId)
          .single(),
      ])

      const projectRecord = projectRecordResult.data
      if (projectRecordResult.error || !projectRecord) {
        console.error(
          `[BasecampPush] Project ${task.project_id} fetch error:`,
          projectRecordResult.error,
        )
        return res.status(404).json({ error: "Project not found" })
      }

      let findingUrl = (pageResult.data as any)?.url || "N/A"
      const siblings = siblingsResult.data
      const siblingIds = (siblings || []).map((s) => s.id)
      const siblingIdsForThread = siblingIds.length > 0 ? siblingIds : [id]

      // 2.2 Parallel fetch for thread comments and rebuttals
      const [threadCommentsResult, threadRebuttalsResult] = await Promise.all([
        supabase
          .from("comments")
          .select("content, created_at, users:author_id (full_name)")
          .in("task_id", siblingIdsForThread),
        supabase
          .from("rebuttals")
          .select("text, created_at, users:submitted_by (full_name)")
          .in("task_id", siblingIdsForThread),
      ])

      const threadComments = threadCommentsResult.data
      const threadRebuttals = threadRebuttalsResult.data
      const currentUser = currentUserResult.data

      let activeBasecampToken = currentUser?.basecamp_access_token

      if (!activeBasecampToken) {
        if (
          req.auth?.role === "super_admin" ||
          currentUser?.role === "super_admin"
        ) {
          activeBasecampToken = projectSettings?.basecamp_token
        } else {
          return res.status(403).json({
            error:
              "Please connect your personal Basecamp account to push tasks.",
          })
        }
      }

      if (
        !projectSettings ||
        !activeBasecampToken ||
        !projectSettings.basecamp_account_id ||
        !projectSettings.basecamp_project_id
      ) {
        console.warn(
          `[BasecampPush] Integration not configured for project ${task.project_id}`,
        )
        return res.status(400).json({
          error: "Basecamp integration not configured for this project",
        })
      }

      // Determine the correct to-do list based on project state
      let todolistId = projectSettings.basecamp_todolist_id
      if (projectRecord.is_post_release) {
        if (!projectSettings.basecamp_post_todolist_id) {
          return res
            .status(400)
            .json({ error: "Post-release to-do list not configured" })
        }
        todolistId = projectSettings.basecamp_post_todolist_id
      } else if (projectRecord.is_pre_release) {
        if (!projectSettings.basecamp_todolist_id) {
          return res
            .status(400)
            .json({ error: "Pre-release to-do list not configured" })
        }
        todolistId = projectSettings.basecamp_todolist_id
      }

      if (!todolistId) {
        return res
          .status(400)
          .json({ error: "Basecamp to-do list not configured" })
      }

      const checkFactor =
        task.findings?.check_factor || (task as any).check_factor

      const isProjectPlan = checkFactor === "project_plan"
      const isHeroMedia = checkFactor === "hero_media"
      const isDeadLink = checkFactor === "dead_links"
      const isLearnMore = checkFactor === "learn_more_buttons"
      const isPaidMedia = checkFactor === "paid_media"
      const isPrivacyPolicy = checkFactor === "privacy_policy"
      const isFooterLogo = checkFactor === "footer_logo"
      const isSingleScript = checkFactor === "single_script"
      const isUrlTabCompare = checkFactor === "url_tab_compare"
      const isTopBarSticky = checkFactor === "top_bar_sticky"
      const isFavicon =
        checkFactor === "favicon_check" || checkFactor === "favicon"
      const isContactForm = checkFactor === "contact_form"
      const isLogoChatbot = checkFactor === "logo_chatbot"
      const isCallnowLinks =
        checkFactor === "callnow_links" ||
        checkFactor === "verify_plugin_updates"
      const isSocialShare = checkFactor === "social_share_heading"

      const isSpecificCheck =
        isProjectPlan ||
        isHeroMedia ||
        isDeadLink ||
        isLearnMore ||
        isPaidMedia ||
        isPrivacyPolicy ||
        isFooterLogo ||
        isSingleScript ||
        isUrlTabCompare ||
        isTopBarSticky ||
        isFavicon ||
        isContactForm ||
        isLogoChatbot ||
        isCallnowLinks ||
        isSocialShare

      let appUrl = ""
      if (isSpecificCheck) {
        console.log(
          `[BasecampPush] Task is a specific checklist finding (${checkFactor}). Locating specific checklist item...`,
        )

        const headers = {
          Authorization: `Bearer ${activeBasecampToken}`,
          "User-Agent": "QACC (raees.nazeem@growth99.com)",
          "Content-Type": "application/json",
          Accept: "application/json",
        }

        // A. Get Docker tool lists to find To-dos set
        const bucketUrl = `https://3.basecampapi.com/${projectSettings.basecamp_account_id}/buckets/${projectSettings.basecamp_project_id}.json`
        const bucketResponse = await axios.get(bucketUrl, { headers })
        const todosetTool = bucketResponse.data.dock?.find(
          (tool: any) =>
            tool.title === "To-dos" || tool.url?.includes("/todosets/"),
        )

        if (!todosetTool) {
          throw new Error("Basecamp To-doset tool not found in project dock")
        }

        // B. Fetch todosets detail to fetch todolists_url
        const todosetDetailResponse = await axios.get(todosetTool.url, {
          headers,
        })
        const todolistsUrl = todosetDetailResponse.data.todolists_url

        // C. Fetch all to-do lists and locate the list matching "15-Quality Assurance - Prerelease 2026"
        const listsResponse = await axios.get(todolistsUrl, { headers })
        const targetList = listsResponse.data.find(
          (l: any) =>
            l.name
              .toLowerCase()
              .includes("15-quality assurance - prerelease 2026") ||
            l.name
              .toLowerCase()
              .includes("quality assurance - prerelease 2026"),
        )

        if (!targetList) {
          throw new Error(
            'Checklist list heading "15-Quality Assurance - Prerelease 2026" not found in Basecamp.',
          )
        }

        // D. Fetch all checklist items under the matched list
        let page = 1
        let allTodos: any[] = []
        while (true) {
          const todosResponse = await axios.get(
            `${targetList.todos_url}?page=${page}`,
            { headers },
          )
          const pageTodos = todosResponse.data || []
          if (pageTodos.length === 0) break
          allTodos = allTodos.concat(pageTodos)
          if (pageTodos.length < 15) break
          page++
        }

        let targetTodo

        if (isProjectPlan) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes("qa-check if reviews are added for accelerator plan"),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA-Check if reviews are added for Accelerator plan" not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isHeroMedia) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes(
                "qa-verify that the hero section video and fallback image load immediately on page load.",
              ),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA-Verify that the hero section video and fallback image load immediately on page load." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isDeadLink) {
          targetTodo = allTodos.find((todo: any) => {
            const lower = todo.content.toLowerCase()
            return lower.includes("qa") && lower.includes("verify deadlink")
          })
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Verify Deadlink." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isLearnMore) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes("qa- check learn more, read more button on website"),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA- Check Learn more, read more button on website" not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isPaidMedia) {
          targetTodo = allTodos.find(
            (todo: any) =>
              todo.content.toLowerCase().includes("qa paid media") ||
              todo.content.toLowerCase().includes("qa- paid media"),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA Paid Media" not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isPrivacyPolicy) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes(
                "qa- check if privacy policy page added on the website",
              ),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA- Check if Privacy policy page added on the website." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isFooterLogo) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes(
                "qa - check the footer logo , it should be the new logo with no tagline",
              ),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Check the footer logo , It should be the new logo with no tagline" not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isSingleScript) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes("qa - check if single script features are added"),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Check if single script features are added." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isUrlTabCompare) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes(
                "qa - check url is matching and check for the tab name",
              ),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Check URL is Matching and check for the tab name" not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isTopBarSticky) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes(
                "qa - verify contact number, e-mail id, and social media icons are added on top bar, and the header should be sticky",
              ),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Verify Contact Number, E-mail ID, and Social Media icons are added on Top Bar, and the header should be sticky." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isFavicon) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content.toLowerCase().includes("qa - add favicon"),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Add Favicon." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isContactForm) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes(
                "qa - verify growth99 contact form on all the pages for all views",
              ),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Verify Growth99 contact form on all the pages for all views." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isLogoChatbot) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes("qa - check if website logo is added to the chat bot"),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Check if website logo is added to the chat bot." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isCallnowLinks) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes(
                "qa - before release - verify all plug-ins are updated",
              ),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA - Before Release - Verify ALL plug-ins are updated | Must verify then only start all pre-release tasks." not found in Basecamp checklist "${targetList.name}".`,
            )
        } else if (isSocialShare) {
          targetTodo = allTodos.find((todo: any) =>
            todo.content
              .toLowerCase()
              .includes(
                "qa- while sharing the website on text , business name should be matched",
              ),
          )
          if (!targetTodo)
            throw new Error(
              `To-do checklist item "QA- While sharing the website on text , business name should be matched" not found in Basecamp checklist "${targetList.name}".`,
            )
        }

        todolistId = targetTodo.id
        appUrl = targetTodo.app_url || ""
        console.log(
          `[BasecampPush] Located target checklist item: ${targetTodo.content} (ID: ${todolistId})`,
        )
      }

      const allAssignedTo = Array.from(
        new Set((siblings || []).map((s) => s.assigned_to).filter(Boolean)),
      )

      let mentions = ""
      if (allAssignedTo.length > 0) {
        const { data: userList } = await supabase
          .from("users")
          .select("basecamp_person_id")
          .in("id", allAssignedTo)

        const bpIds = Array.from(
          new Set(
            userList?.map((u) => u.basecamp_person_id).filter(Boolean) || [],
          ),
        )
        const mentionsList = await Promise.all(
          bpIds.map(async (id: any) => {
            const person = await getBasecampPerson(
              activeBasecampToken,
              projectSettings!.basecamp_account_id!,
              Number(id),
            )
            if (person && person.attachable_sgid) {
              return formatBasecampMention(person.attachable_sgid, person.name)
            }
            return null
          }),
        )
        mentions = mentionsList.filter(Boolean).join(" ")
      }

      let galleryHtml = ""
      if (
        task.gallery_images &&
        Array.isArray(task.gallery_images) &&
        task.gallery_images.length > 0
      ) {
        galleryHtml =
          "<br/><br/><strong>Captured Evidence:</strong><br/>" +
          task.gallery_images
            .map((url: string) => `<img src="${url}" width="400" />`)
            .join("<br/>")
      }

      const issueMatch = task.title.match(/Issue #(\d+)/)
      const issueHeader = issueMatch
        ? `<div style="color: #EAB308;"><h1>Issue no: #${issueMatch[1]}</h1></div>`
        : ""

      let description = ""
      if (isDeadLink) {
        // Parse the markdown bullet-point description into structured objects
        const rawDesc = task.description || ""
        const lines = rawDesc.split("\n")
        const links: { url: string; reason: string; text: string }[] = []

        let currentLink: any = null
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith("- **") || trimmed.startsWith("-**")) {
            if (currentLink) links.push(currentLink)
            const urlMatch = trimmed.match(/-\s*\*\*(.*?)\*\*/)
            currentLink = {
              url: urlMatch ? urlMatch[1] : trimmed.replace(/[-\s*]/g, ""),
              reason: "N/A",
              text: "N/A",
            }
          } else if (
            trimmed.startsWith("* Reason:") ||
            trimmed.startsWith("Reason:")
          ) {
            if (currentLink) {
              currentLink.reason = trimmed
                .replace(/^\*\s*Reason:\s*/i, "")
                .replace(/^Reason:\s*/i, "")
            }
          } else if (
            trimmed.startsWith("* Link Text:") ||
            trimmed.startsWith("Link Text:")
          ) {
            if (currentLink) {
              currentLink.text = trimmed
                .replace(/^\*\s*Link\s+Text:\s*/i, "")
                .replace(/^Link\s+Text:\s*/i, "")
            }
          }
        }
        if (currentLink) links.push(currentLink)

        // Generate the beautiful HTML rows
        let tableRowsHtml = ""
        if (links.length > 0) {
          tableRowsHtml = links
            .map(
              (l, idx) => `
            <tr style="background-color: ${idx % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.02)"};">
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 11px; word-break: break-all; width: 45%;">
                <a href="${l.url}" target="_blank" style="color: #2563eb; text-decoration: none;">${l.url}</a>
              </td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-size: 12px; color: #ef4444; font-weight: 500; width: 30%;">
                ${l.reason}
              </td>
              <td style="padding: 10px; border: 1px solid #e2e8f0; font-size: 12px; font-style: italic; width: 25%;">
                ${l.text}
              </td>
            </tr>
          `,
            )
            .join("")
        } else {
          tableRowsHtml = `
            <tr>
              <td colspan="3" style="padding: 12px; border: 1px solid #e2e8f0; font-size: 12px; text-align: center;">
                ${rawDesc.replace(/\n/g, "<br/>")}
              </td>
            </tr>
          `
        }

        // Build premium styled container for the Basecamp comment
        description = `
          ${issueHeader}
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 800px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0;">
              <span style="font-size: 15px; font-weight: bold;"> General Findings: Dead Links Audit</span>
              <span style="background-color: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; text-transform: uppercase;">[PENDING]</span>
            </div>
            
            ${mentions ? `<div style="margin-bottom: 15px; font-size: 13px;">${mentions}</div>` : ""}

           

            <div style="overflow-x: auto; margin-bottom: 15px;">
              <table style="width: 100%; border-collapse: collapse; text-align: left; border: 1px solid #e2e8f0;">
                <thead>
                  <tr style="background-color: rgba(0,0,0,0.03);">
                    <th style="padding: 10px; border: 1px solid #e2e8f0; font-size: 11px; font-weight: bold; text-transform: uppercase;">Broken Link URL</th>
                    <th style="padding: 10px; border: 1px solid #e2e8f0; font-size: 11px; font-weight: bold; text-transform: uppercase;">Failure Reason</th>
                    <th style="padding: 10px; border: 1px solid #e2e8f0; font-size: 11px; font-weight: bold; text-transform: uppercase;">Anchor Text</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRowsHtml}
                </tbody>
              </table>
            </div>

            <div style="font-size: 10px; text-align: right; border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 15px; opacity: 0.7;">
              Created via QA Command Center
            </div>
          </div>
        `.trim()
      } else {
        const formattedDescription = (
          task.description || "No description provided."
        ).replace(/\n/g, "<br/>")
        description = `${issueHeader}
<div>[PENDING]</div>
${mentions ? `<div style="margin-bottom: 12px; font-size: 13px; font-weight: 500;">${mentions}</div>` : ""}

<br/>
<strong>${task.title}</strong><br/>
<div style="white-space: pre-wrap;">${formattedDescription}</div><br/>
URL: ${findingUrl}${galleryHtml}
<br/><br/>
Created via QA Command Center`.trim()
      }

      // 5. Call Basecamp (Push as comment to Command Center)
      console.log(`[BasecampPush] FINAL Description before POST:`, description)
      console.log(`[BasecampPush] Calling Basecamp API: Create Comment...`)

      const mainCommentResult = await createBasecampComment({
        token: activeBasecampToken,
        accountId: projectSettings!.basecamp_account_id,
        projectId: projectSettings!.basecamp_project_id || task.project_id,
        recordingId: todolistId!,
        content: description,
      })

      const mainCommentId = mainCommentResult?.id

      const mergedThread = [
        ...(threadComments || []).map((c: any) => ({
          content: `${c.users?.full_name || "Unknown"}: ${c.content}`,
          created_at: c.created_at,
        })),
        ...(threadRebuttals || []).map((r: any) => ({
          content: `Developer (Rebuttal) - ${r.users?.full_name || "Unknown"}: ${r.text}`,
          created_at: r.created_at,
        })),
      ].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )

      // 5.2 & 5.3 Parallel push for thread comments and Google Chat notification
      const [threadResults, notificationResult] = await Promise.all([
        Promise.all(
          mergedThread.map((item) =>
            createBasecampComment({
              token: activeBasecampToken,
              accountId: projectSettings!.basecamp_account_id!,
              projectId:
                projectSettings!.basecamp_project_id || task.project_id,
              recordingId: todolistId!,
              content: item.content,
            }),
          ),
        ),
        notifyOnGoogleChat({
          taskId: task.id,
          projectId: task.project_id,
          issueNumber: task.findings?.issue_number || 0,
          projectName:
            projectRecord?.name ||
            (projectSettings as any)?.name ||
            "Unknown Project",
          issueHeading: (task.title || "")
            .replace(/Issue\s+#\d+[:\s-]*/i, "")
            .trim(), // Robustly strip "Issue #123"
          findingsUrl: task.findings?.run_id
            ? `${process.env.FRONTEND_URL}/projects/${task.project_id}/runs/${task.findings.run_id}/findings?findingId=${task.findings.id}`
            : `${process.env.FRONTEND_URL}/projects/${task.project_id}`,
          assignedUserIds: allAssignedTo,
          category: (task.findings?.severity || "Finding").toUpperCase(), // Uppercase for badge style
          description: task.description || "No description provided",
          thumbnails: Array.isArray(task.gallery_images)
            ? task.gallery_images
            : [],
        }),
      ])

      // 5.4 Rollback if notification fails
      if (!notificationResult.success && mainCommentId) {
        logger.error(
          `[BasecampPush] Google Chat notification failed, rolling back Basecamp comment`,
        )
        try {
          await deleteBasecampComment({
            token: activeBasecampToken,
            accountId: projectSettings!.basecamp_account_id,
            projectId: projectSettings!.basecamp_project_id || task.project_id,
            recordingId: todolistId!,
            commentId: mainCommentId,
          })
          logger.info(
            `[BasecampPush] Rolled back Basecamp comment ${mainCommentId}`,
          )
        } catch (rollbackError: any) {
          logger.error(
            `[BasecampPush] Rollback failed: ${rollbackError.message}`,
          )
        }

        return res.status(500).json({
          error:
            "Failed to send Google Chat notification, Basecamp push rolled back",
          details: notificationResult.errors,
        })
      }

      const basecampUrl = isSpecificCheck
        ? appUrl ||
          `https://3.basecamp.com/${projectSettings.basecamp_account_id}/buckets/${projectSettings.basecamp_project_id}/todos/${todolistId}`
        : `https://3.basecamp.com/${projectSettings.basecamp_account_id}/buckets/${projectSettings.basecamp_project_id}/todolists/${todolistId}`

      // 6. Update all siblings in Supabase
      console.log(
        `[BasecampPush] 6/6 Updating ${siblingIds.length} tasks in Supabase with Basecamp info...`,
      )
      const { data: updatedRows, error: updateError } = await supabase
        .from("tasks")
        .update({
          basecamp_task_id: todolistId,
          basecamp_url: basecampUrl,
          status: "in_progress",
          updated_at: new Date().toISOString(),
        })
        .in("id", siblingIds)
        .select("id")

      if (updateError) {
        console.error("[BasecampPush] Supabase Update Error:", updateError)
        return res.json({
          basecampUrl,
          warning: "Supabase update failed but Basecamp todo created",
        })
      }

      if (!updatedRows || updatedRows.length === 0) {
        console.error(
          `[BasecampPush] CRITICAL: Task ${id} not updated in Supabase!`,
        )
        return res.status(500).json({
          error:
            "Failed to update local task with Basecamp info. Task not found.",
          taskId: id,
        })
      }

      console.log(`[BasecampPush] Successfully updated task ${id} in Supabase.`)

      await broadcastTaskUpdate(id, { status: "in_progress" })

      return res.json({ basecampUrl })
    } catch (error: any) {
      console.error("--- Basecamp Push FAILED ---")
      console.error("Task ID:", id)
      console.error("Error Message:", error.message)
      if (error.status || error.response?.status) {
        console.error("Status Code:", error.status || error.response?.status)
      }
      if (error.data || error.response?.data) {
        console.error(
          "Response Body:",
          JSON.stringify(error.data || error.response?.data, null, 2),
        )
      }
      logger.error(error, `Error pushing task ${id} to Basecamp`)
      return res.status(500).json({
        error: error.message,
        details: error.data || error.response?.data,
      })
    }
  },
)

/**
 * POST /api/tasks/basecamp/bulk-push
 * Push multiple tasks to a single Basecamp to-do.
 */
router.post(
  "/basecamp/bulk-push",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { taskIds } = req.body

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      console.error(
        `[BasecampBulkPush] Error: No task IDs provided in request body`,
      )
      return res.status(400).json({ error: "No task IDs provided" })
    }

    console.log(
      `[BasecampBulkPush] >>> STARTING bulk push for ${taskIds.length} tasks`,
    )
    console.log(`[BasecampBulkPush] Task IDs:`, taskIds)

    try {
      // 1. Load tasks + findings
      console.log(
        `[BasecampBulkPush] 1/6 Fetching tasks and findings from Supabase...`,
      )
      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select("*, findings:finding_id (*)")
        .in("id", taskIds)

      if (tasksError) {
        console.error(`[BasecampBulkPush] Supabase Fetch Error:`, tasksError)
        return res
          .status(500)
          .json({ error: "Database fetch failed", details: tasksError })
      }

      if (!tasks || tasks.length === 0) {
        console.error(
          `[BasecampBulkPush] Error: No tasks found for the provided IDs`,
        )
        return res.status(404).json({ error: "Tasks not found" })
      }

      console.log(`[BasecampBulkPush] Found ${tasks.length} tasks in database.`)

      // 2. Load page URLs for all findings
      console.log(`[BasecampBulkPush] 2/6 Resolving page URLs for findings...`)
      const pageIds = Array.from(
        new Set(tasks.map((t) => t.findings?.page_id).filter(Boolean)),
      )
      console.log(`[BasecampBulkPush] Unique page IDs to resolve:`, pageIds)

      const { data: pages, error: pagesError } = await supabase
        .from("pages")
        .select("id, url")
        .in("id", pageIds)

      if (pagesError) {
        console.warn(
          `[BasecampBulkPush] Warning: Could not fetch some page URLs:`,
          pagesError,
        )
      }

      const pageUrlMap = new Map(pages?.map((p) => [p.id, p.url]) || [])

      // 3. Load assignee mappings for all tasks
      console.log(
        `[BasecampBulkPush] 3/6 Resolving assignee Basecamp mappings...`,
      )
      const userIds = Array.from(
        new Set(tasks.map((t) => t.assigned_to).filter(Boolean)),
      )
      console.log(`[BasecampBulkPush] Unique user IDs to map:`, userIds)

      const { data: userList, error: mappingError } = await supabase
        .from("users")
        .select("id, basecamp_person_id")
        .in("id", userIds)

      if (mappingError) {
        console.warn(
          `[BasecampBulkPush] Warning: Could not fetch user mappings:`,
          mappingError,
        )
      }

      const userMappingMap = new Map(
        userList?.map((u) => [u.id, u.basecamp_person_id]) || [],
      )

      // 3.2 Group tasks by finding_id or title
      const taskGroups = new Map<string, any[]>()
      for (const task of tasks) {
        const groupKey = task.finding_id || task.title
        if (!taskGroups.has(groupKey)) {
          taskGroups.set(groupKey, [])
        }
        taskGroups.get(groupKey)!.push(task)
      }
      console.log(
        `[BasecampBulkPush] Grouped ${tasks.length} tasks into ${taskGroups.size} conceptual groups.`,
      )

      const projectId = tasks[0].project_id
      console.log(
        `[BasecampBulkPush] Resolving settings for project: ${projectId}`,
      )
      // 3.5 Load project state
      const { data: projectRecord, error: projectRecordError } = await supabase
        .from("projects")
        .select("is_pre_release, is_post_release")
        .eq("id", projectId)
        .single()

      if (projectRecordError || !projectRecord) {
        console.error(
          `[BasecampBulkPush] Project ${projectId} fetch error:`,
          projectRecordError,
        )
        return res.status(404).json({ error: "Project not found" })
      }

      const [projectSettings, currentUserResult] = await Promise.all([
        getProjectSettings(projectId),
        supabase
          .from("users")
          .select("basecamp_access_token, role")
          .eq("id", req.auth?.userId)
          .single(),
      ])

      const currentUser = currentUserResult.data
      let activeBasecampToken = currentUser?.basecamp_access_token

      if (!activeBasecampToken) {
        if (
          req.auth?.role === "super_admin" ||
          currentUser?.role === "super_admin"
        ) {
          activeBasecampToken = projectSettings?.basecamp_token
        } else {
          return res.status(403).json({
            error:
              "Please connect your personal Basecamp account to push tasks.",
          })
        }
      }

      console.log(`[BasecampBulkPush] 3/6.5 Project settings retrieved:`, {
        projectId,
        hasToken: !!activeBasecampToken,
        accountId: projectSettings?.basecamp_account_id,
        basecampProjectId: projectSettings?.basecamp_project_id,
        preReleaseList: projectSettings?.basecamp_todolist_id,
        postReleaseList: projectSettings?.basecamp_post_todolist_id,
        isPreRelease: projectRecord.is_pre_release,
        isPostRelease: projectRecord.is_post_release,
      })

      if (!projectSettings) {
        console.error(
          `[BasecampBulkPush] Error: No settings found for project ${projectId}`,
        )
        return res.status(400).json({ error: "Integration settings not found" })
      }

      if (
        !activeBasecampToken ||
        !projectSettings.basecamp_account_id ||
        !projectSettings.basecamp_project_id
      ) {
        console.error(
          `[BasecampBulkPush] Error: Incomplete Basecamp configuration`,
          {
            hasToken: !!activeBasecampToken,
            hasAccount: !!projectSettings.basecamp_account_id,
            hasProject: !!projectSettings.basecamp_project_id,
          },
        )

        return res.status(400).json({
          error: "Basecamp integration not configured for this project",
        })
      }

      // Determine the correct to-do list based on project state
      let todolistId = projectSettings.basecamp_todolist_id

      if (projectRecord.is_post_release) {
        if (!projectSettings.basecamp_post_todolist_id) {
          return res
            .status(400)
            .json({ error: "Post-release to-do list not configured" })
        }
        todolistId = projectSettings.basecamp_post_todolist_id
      } else if (projectRecord.is_pre_release) {
        if (!projectSettings.basecamp_todolist_id) {
          return res
            .status(400)
            .json({ error: "Pre-release to-do list not configured" })
        }
        todolistId = projectSettings.basecamp_todolist_id
      }

      if (!todolistId) {
        return res
          .status(400)
          .json({ error: "Basecamp to-do list not configured" })
      }

      // 5. Push as comments to the target to-do (Command Center)
      console.log(
        `[BasecampBulkPush] 5/6 Pushing ${taskGroups.size} groups as comments to target: ${todolistId}`,
      )

      // Fetch all todos from the list to map specific checks
      const basecampHeaders = {
        Authorization: `Bearer ${activeBasecampToken}`,
        "User-Agent": "QACC (raees.nazeem@growth99.com)",
        "Content-Type": "application/json",
        Accept: "application/json",
      }
      let allTodos: any[] = []
      let page = 1
      let hasMore = true
      while (hasMore) {
        const todosUrl = `https://3.basecampapi.com/${projectSettings.basecamp_account_id}/buckets/${projectSettings.basecamp_project_id}/todolists/${todolistId}/todos.json?page=${page}`
        try {
          const todosResponse = await axios.get(todosUrl, {
            headers: basecampHeaders,
          })
          const pageTodos = todosResponse.data
          if (pageTodos.length === 0) {
            hasMore = false
          } else {
            allTodos = allTodos.concat(pageTodos)
            const linkHeader = todosResponse.headers?.link
            if (linkHeader && linkHeader.includes('rel="next"')) {
              page++
            } else {
              hasMore = false
            }
          }
        } catch (err) {
          console.error(
            "[BasecampBulkPush] Failed to fetch todos for mapping",
            err,
          )
          hasMore = false
        }
      }

      let successCount = 0

      for (const [groupKey, groupTasks] of taskGroups.entries()) {
        const firstTask = groupTasks[0]

        // Consolidate mentions for all tasks in the group
        const groupMentions = await Promise.all(
          groupTasks.map(async (t) => {
            const bpId = t.assigned_to
              ? userMappingMap.get(t.assigned_to)
              : null
            if (bpId) {
              const person = await getBasecampPerson(
                activeBasecampToken,
                projectSettings.basecamp_account_id!,
                Number(bpId),
              )
              if (person?.attachable_sgid) {
                return formatBasecampMention(
                  person.attachable_sgid,
                  person.name,
                )
              }
            }
            return null
          }),
        )
        const mentionsHtml = Array.from(
          new Set(groupMentions.filter(Boolean)),
        ).join(" ")

        const taskFindingUrl = firstTask.findings?.page_id
          ? pageUrlMap.get(firstTask.findings.page_id)
          : "N/A"

        let galleryHtml = ""
        if (
          firstTask.gallery_images &&
          Array.isArray(firstTask.gallery_images) &&
          firstTask.gallery_images.length > 0
        ) {
          galleryHtml =
            "<br/><br/><strong>Captured Evidence:</strong><br/>" +
            firstTask.gallery_images
              .map((url: string) => `<img src="${url}" width="400" />`)
              .join("<br/>")
        }

        const issueMatch = firstTask.title.match(/Issue #(\d+)/)
        const issueHeader = issueMatch
          ? `<div style="color: #EAB308;"><h1>Issue no: #${issueMatch[1]}</h1></div>`
          : ""
        const formattedDescription = (
          firstTask.description || "No description provided."
        ).replace(/\n/g, "<br/>")
        const taskCommentContent = `
          ${issueHeader}
          <div>[PENDING]</div>
          ${mentionsHtml ? `<div>${mentionsHtml}</div>` : ""}
          <br/>
          <strong>${firstTask.title}</strong><br/>
          <div style="white-space: pre-wrap;">${formattedDescription}</div><br/>
          URL: ${taskFindingUrl || "N/A"}${galleryHtml}<br/><br/>
          Created via QA Command Center
        `.trim()

        try {
          let targetRecordingId = todolistId
          let targetAppUrl = ""
          let targetTodo

          const checkFactor =
            firstTask.findings?.check_factor || (firstTask as any).check_factor

          if (checkFactor === "project_plan") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes("qa-check if reviews are added for accelerator plan"),
            )
          } else if (checkFactor === "hero_media") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa-verify that the hero section video and fallback image load immediately on page load.",
                ),
            )
          } else if (checkFactor === "dead_links") {
            targetTodo = allTodos.find((todo: any) => {
              const lower = todo.content.toLowerCase()
              return lower.includes("qa") && lower.includes("verify deadlink")
            })
          } else if (checkFactor === "learn_more_buttons") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes("qa- check learn more, read more button on website"),
            )
          } else if (checkFactor === "paid_media") {
            targetTodo = allTodos.find(
              (todo: any) =>
                todo.content.toLowerCase().includes("qa paid media") ||
                todo.content.toLowerCase().includes("qa- paid media"),
            )
          } else if (checkFactor === "privacy_policy") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa- check if privacy policy page added on the website",
                ),
            )
          } else if (checkFactor === "footer_logo") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa - check the footer logo , it should be the new logo with no tagline",
                ),
            )
          } else if (checkFactor === "single_script") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes("qa - check if single script features are added"),
            )
          } else if (checkFactor === "url_tab_compare") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa - check url is matching and check for the tab name",
                ),
            )
          } else if (checkFactor === "top_bar_sticky") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa - verify contact number, e-mail id, and social media icons are added on top bar, and the header should be sticky",
                ),
            )
          } else if (
            checkFactor === "favicon_check" ||
            checkFactor === "favicon"
          ) {
            targetTodo = allTodos.find((todo: any) =>
              todo.content.toLowerCase().includes("qa - add favicon"),
            )
          } else if (checkFactor === "contact_form") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa - verify growth99 contact form on all the pages for all views",
                ),
            )
          } else if (checkFactor === "logo_chatbot") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa - check if website logo is added to the chat bot",
                ),
            )
          } else if (
            checkFactor === "callnow_links" ||
            checkFactor === "verify_plugin_updates"
          ) {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa - before release - verify all plug-ins are updated",
                ),
            )
          } else if (checkFactor === "social_share_heading") {
            targetTodo = allTodos.find((todo: any) =>
              todo.content
                .toLowerCase()
                .includes(
                  "qa- while sharing the website on text , business name should be matched",
                ),
            )
          }

          if (targetTodo) {
            targetRecordingId = targetTodo.id
            targetAppUrl = targetTodo.app_url || ""
          }

          await createBasecampComment({
            token: activeBasecampToken,
            accountId: projectSettings!.basecamp_account_id,
            projectId: projectSettings!.basecamp_project_id || projectId,
            recordingId: targetRecordingId,
            content: taskCommentContent,
          })

          // 5.2 Push thread items as separate comments
          const groupTaskIdsForThread = groupTasks.map((t) => t.id)

          const { data: groupComments } = await supabase
            .from("comments")
            .select("content, created_at, users:author_id (full_name)")
            .in("task_id", groupTaskIdsForThread)

          const { data: groupRebuttals } = await supabase
            .from("rebuttals")
            .select("text, created_at, users:submitted_by (full_name)")
            .in("task_id", groupTaskIdsForThread)

          const groupMergedThread = [
            ...(groupComments || []).map((c: any) => ({
              content: `${c.users?.full_name || "Unknown"}: ${c.content}`,
              created_at: c.created_at,
            })),
            ...(groupRebuttals || []).map((r: any) => ({
              content: `Developer (Rebuttal) - ${r.users?.full_name || "Unknown"}: ${r.text}`,
              created_at: r.created_at,
            })),
          ].sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          )

          for (const item of groupMergedThread) {
            if (!projectSettings) continue
            await createBasecampComment({
              token: activeBasecampToken,
              accountId: projectSettings!.basecamp_account_id,
              projectId: projectSettings!.basecamp_project_id || projectId,
              recordingId: targetRecordingId,
              content: item.content,
            })
          }

          // Update all tasks in this group in Supabase
          const groupTaskIds = groupTasks.map((t) => t.id)
          const basecampUrl = targetTodo
            ? targetAppUrl ||
              `https://3.basecamp.com/${projectSettings.basecamp_account_id}/buckets/${projectSettings.basecamp_project_id}/todos/${targetRecordingId}`
            : `https://3.basecamp.com/${projectSettings.basecamp_account_id}/buckets/${projectSettings.basecamp_project_id}/todolists/${todolistId}`

          await supabase
            .from("tasks")
            .update({
              basecamp_task_id: targetRecordingId,
              basecamp_url: basecampUrl,
              status: "in_progress",
              updated_at: new Date().toISOString(),
            })
            .in("id", groupTaskIds)

          await broadcastTaskUpdate(groupTaskIds[0], { status: "in_progress" })

          successCount += groupTasks.length
        } catch (err: any) {
          console.error(
            `[BasecampBulkPush] Group comment failed for group ${groupKey}:`,
            err.message,
          )
        }
      }

      console.log(
        `[BasecampBulkPush] Successfully processed ${successCount} tasks in Supabase.`,
      )
      console.log(`[BasecampBulkPush] <<< FINISHED bulk push successfully.`)
      return res.json({ count: successCount })
    } catch (error: any) {
      console.error("--- [BasecampBulkPush] CRITICAL FAILURE ---")
      console.error("Error:", error.message)
      if (error.response?.data) {
        console.error(
          "Basecamp API Error Data:",
          JSON.stringify(error.response.data, null, 2),
        )
      }
      logger.error(error, `Error bulk pushing tasks to Basecamp`)
      return res.status(500).json({
        error: error.message,
        details: error.response?.data,
      })
    }
  },
)

/**
 * POST /api/tasks/basecamp/bulk-comment
 * Push multiple tasks to their respective Basecamp to-dos as comments.
 */
router.post(
  "/basecamp/bulk-comment",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { taskIds, status: pushStatus } = req.body

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: "No task IDs provided" })
    }

    try {
      // 1. Load tasks + findings + comments
      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select(
          `
          *,
          comments (
            content,
            created_at
          )
        `,
        )
        .in("id", taskIds)

      if (tasksError || !tasks || tasks.length === 0) {
        return res.status(404).json({ error: "Tasks not found" })
      }

      const projectId = tasks[0].project_id
      const [projectSettings, currentUserResult] = await Promise.all([
        getProjectSettings(projectId),
        supabase
          .from("users")
          .select("basecamp_access_token, role")
          .eq("id", req.auth?.userId)
          .single(),
      ])

      const currentUser = currentUserResult.data
      let activeBasecampToken = currentUser?.basecamp_access_token

      if (!activeBasecampToken) {
        if (
          req.auth?.role === "super_admin" ||
          currentUser?.role === "super_admin"
        ) {
          activeBasecampToken = projectSettings?.basecamp_token
        } else {
          return res.status(403).json({
            error:
              "Please connect your personal Basecamp account to push tasks.",
          })
        }
      }

      if (
        !projectSettings ||
        !activeBasecampToken ||
        !projectSettings.basecamp_account_id
      ) {
        return res
          .status(400)
          .json({ error: "Basecamp not configured for this project" })
      }

      // 3.4 Load assignee mappings for all tasks
      const userIds = Array.from(
        new Set(tasks.map((t) => t.assigned_to).filter(Boolean)),
      )
      const { data: userList } = await supabase
        .from("users")
        .select("id, basecamp_person_id")
        .in("id", userIds)

      const userMappingMap = new Map(
        userList?.map((u) => [u.id, u.basecamp_person_id]) || [],
      )

      // 3.5 Load project state to select target to-do
      const { data: projectRecord, error: projectRecordError } = await supabase
        .from("projects")
        .select("is_pre_release, is_post_release")
        .eq("id", projectId)
        .single()

      if (projectRecordError || !projectRecord) {
        return res.status(404).json({ error: "Project not found" })
      } // 3.6 Group tasks by finding_id or title
      const taskGroups = new Map<string, any[]>()
      for (const task of tasks) {
        const groupKey = task.finding_id || task.title
        if (!taskGroups.has(groupKey)) {
          taskGroups.set(groupKey, [])
        }
        taskGroups.get(groupKey)!.push(task)
      }
      console.log(
        `[BasecampBulkComment] Grouped ${tasks.length} tasks into ${taskGroups.size} conceptual groups.`,
      )

      let successCount = 0
      let skippedCount = 0

      for (const [groupKey, groupTasks] of taskGroups.entries()) {
        const firstTask = groupTasks[0]

        // Determine the target recording ID (the Command Center)
        let groupTargetId = firstTask.basecamp_task_id
        if (!groupTargetId) {
          if (
            projectRecord.is_post_release &&
            projectSettings.basecamp_post_todolist_id
          ) {
            groupTargetId = projectSettings.basecamp_post_todolist_id
          } else if (
            projectRecord.is_pre_release &&
            projectSettings.basecamp_todolist_id
          ) {
            groupTargetId = projectSettings.basecamp_todolist_id
          } else {
            groupTargetId = projectSettings.basecamp_todolist_id
          }
        }

        if (!groupTargetId) {
          console.warn(
            `[BasecampBulkComment] Skipping group ${groupKey} - no target recording ID`,
          )
          skippedCount += groupTasks.length
          continue
        }

        // Consolidate mentions for all tasks in the group
        const groupMentions = await Promise.all(
          groupTasks.map(async (t) => {
            const bpId = t.assigned_to
              ? userMappingMap.get(t.assigned_to)
              : null
            if (bpId) {
              const person = await getBasecampPerson(
                activeBasecampToken,
                projectSettings.basecamp_account_id!,
                Number(bpId),
              )
              if (person?.attachable_sgid) {
                return formatBasecampMention(
                  person.attachable_sgid,
                  person.name,
                )
              }
            }
            return null
          }),
        )
        const mentionsHtml = Array.from(
          new Set(groupMentions.filter(Boolean)),
        ).join(" ")

        // Consolidate comments from all tasks in the group
        const allComments: any[] = []
        groupTasks.forEach((t) => {
          if (t.comments) allComments.push(...t.comments)
        })
        const sortedComments = allComments.sort(
          (a: any, b: any) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )

        let galleryHtml = ""
        if (
          firstTask.gallery_images &&
          Array.isArray(firstTask.gallery_images) &&
          firstTask.gallery_images.length > 0
        ) {
          galleryHtml =
            "<br/><br/><strong>Captured Evidence:</strong><br/>" +
            firstTask.gallery_images
              .map((url: string) => `<img src="${url}" width="400" />`)
              .join("<br/>")
        }

        const issueMatch = firstTask.title.match(/Issue #(\d+)/)
        const issueHeader = issueMatch
          ? `<div style="color: #EAB308;"><h1>Issue no: #${issueMatch[1]}</h1></div>`
          : ""

        const commentContent = `
          ${issueHeader}
          <div><strong>[${pushStatus.toUpperCase()}]</strong></div>
          ${mentionsHtml ? `<div>${mentionsHtml}</div>` : ""}
          <br/>
          <strong>${firstTask.title}</strong><br/>
          <div>${firstTask.description || "No description provided."}</div><br/>
          ${galleryHtml}
          <br/>
          <em>Pushed via QA Command Center</em>
        `.trim()

        try {
          await createBasecampComment({
            token: activeBasecampToken,
            accountId: projectSettings!.basecamp_account_id,
            projectId: projectSettings!.basecamp_project_id || projectId,
            recordingId: groupTargetId,
            content: commentContent,
          })

          // Post each comment in thread as a separate comment in Basecamp
          const groupTaskIdsForThread = groupTasks.map((t) => t.id)
          const { data: threadComments } = await supabase
            .from("comments")
            .select("content, created_at, users:author_id (full_name)")
            .in("task_id", groupTaskIdsForThread)

          const sortedComments = (threadComments || []).sort(
            (a: any, b: any) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          )

          for (const c of sortedComments) {
            if (!projectSettings) continue
            await createBasecampComment({
              token: activeBasecampToken,
              accountId: projectSettings!.basecamp_account_id,
              projectId: projectSettings!.basecamp_project_id || projectId,
              recordingId: groupTargetId,
              content: `${(c as any).users?.full_name || "Unknown"}: ${c.content}`,
            })
          }

          // Update all tasks in this group in Supabase
          const groupTaskIds = groupTasks.map((t) => t.id)
          const basecampUrl = `https://3.basecamp.com/${projectSettings.basecamp_account_id}/buckets/${projectSettings.basecamp_project_id}/todolists/${groupTargetId}`

          await supabase
            .from("tasks")
            .update({
              basecamp_task_id: groupTargetId,
              basecamp_url: basecampUrl,
              status: "in_progress",
              updated_at: new Date().toISOString(),
            })
            .in("id", groupTaskIds)

          await broadcastTaskUpdate(groupTaskIds[0], { status: "in_progress" })

          successCount += groupTasks.length
        } catch (err: any) {
          console.error(
            `[BasecampBulkComment] Failed for group ${groupKey}:`,
            err.message,
          )
          skippedCount += groupTasks.length
        }
      }

      return res.json({
        success: true,
        count: successCount,
        skipped: skippedCount,
      })
    } catch (error: any) {
      logger.error(error, "Error bulk pushing comments to Basecamp")
      return res.status(500).json({
        error: error.message,
        details: error.response?.data,
      })
    }
  },
)

/**
 * POST /api/basecamp/pending-reminder
 * Push a consolidated reminder for multiple tasks to Basecamp.
 */
router.post(
  "/pending-reminder",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { taskIds, assigneeIds, comment, projectId } = req.body

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: "No task IDs provided" })
    }

    try {
      // 1. Load tasks
      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select("title")
        .in("id", taskIds)

      if (tasksError || !tasks) {
        throw new Error("Failed to fetch tasks")
      }

      // 2. Load project settings
      const [projectSettings, currentUserResult] = await Promise.all([
        getProjectSettings(projectId),
        supabase
          .from("users")
          .select("basecamp_access_token, role")
          .eq("id", req.auth?.userId)
          .single(),
      ])

      const currentUser = currentUserResult.data
      let activeBasecampToken = currentUser?.basecamp_access_token

      if (!activeBasecampToken) {
        if (
          req.auth?.role === "super_admin" ||
          currentUser?.role === "super_admin"
        ) {
          activeBasecampToken = projectSettings?.basecamp_token
        } else {
          return res.status(403).json({
            error:
              "Please connect your personal Basecamp account to push tasks.",
          })
        }
      }

      if (
        !projectSettings ||
        !activeBasecampToken ||
        !projectSettings.basecamp_account_id ||
        !projectSettings.basecamp_project_id
      ) {
        return res.status(400).json({
          error: "Basecamp integration not configured for this project",
        })
      }

      // 3. Resolve mentions for assignees
      let mentions = ""
      if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
        const { data: userList } = await supabase
          .from("users")
          .select("basecamp_person_id")
          .in("id", assigneeIds)

        const bpIds = Array.from(
          new Set(
            userList?.map((u) => u.basecamp_person_id).filter(Boolean) || [],
          ),
        )
        const mentionsList = await Promise.all(
          bpIds.map(async (id: any) => {
            const person = await getBasecampPerson(
              activeBasecampToken,
              projectSettings.basecamp_account_id!,
              Number(id),
            )
            if (person && person.attachable_sgid) {
              return formatBasecampMention(person.attachable_sgid, person.name)
            }
            return null
          }),
        )
        mentions = mentionsList.filter(Boolean).join(" ")
      }

      // 4. Determine target to-do list (Command Center)
      // We use the same logic as push - use the configured to-do list
      const { data: projectRecord } = await supabase
        .from("projects")
        .select("is_pre_release, is_post_release")
        .eq("id", projectId)
        .single()

      let todolistId = projectSettings.basecamp_todolist_id
      if (
        projectRecord?.is_post_release &&
        projectSettings.basecamp_post_todolist_id
      ) {
        todolistId = projectSettings.basecamp_post_todolist_id
      }

      if (!todolistId) {
        return res
          .status(400)
          .json({ error: "Basecamp to-do list not configured" })
      }

      // 5. Format the reminder message
      // Deduplicate by title to avoid repeating the same finding/issue
      const uniqueTitles = Array.from(new Set(tasks.map((t) => t.title)))

      const taskListHtml = uniqueTitles
        .map((title) => {
          const match = title.match(/^(Issue #\d+):?\s*(.*)$/)
          if (match) {
            return `<li><strong style="color: #EAB308;">${match[1]}</strong>: ${match[2]}</li>`
          }
          return `<li>${title}</li>`
        })
        .join("")

      const reminderContent = `
        <div>
          ${mentions ? `<div style="margin-bottom: 12px;">${mentions}</div>` : ""}
          
          <p>The following tasks are currently <strong>In Progress</strong> and need your attention:</p>
          <ul style="margin-bottom: 16px;">
            ${taskListHtml}
          </ul>

          ${
            comment
              ? `
            <div style="border-top: 1px solid #eee; padding-top: 12px; margin-top: 12px;">
              <strong>Note from QA:</strong><br/>
              <em>${comment}</em>
            </div>
          `
              : ""
          }
          <br/>
          <small style="color: #A16207;">Pushed via QA Command Center</small>
        </div>
      `.trim()

      // 6. Post to Basecamp
      await createBasecampComment({
        token: activeBasecampToken,
        accountId: projectSettings.basecamp_account_id,
        projectId: projectSettings.basecamp_project_id,
        recordingId: todolistId,
        content: reminderContent,
      })

      return res.json({ success: true })
    } catch (error: any) {
      console.error("[PendingReminder] Error:", error)
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /webhooks/basecamp
 * Handle Basecamp webhooks.
 */
router.post("/basecamp", async (req: Request, res: Response) => {
  const signature = req.headers["x-basecamp-signature"] as string
  const secret = process.env.BASECAMP_WEBHOOK_SECRET

  if (!signature || !secret) {
    logger.warn("Basecamp webhook received without signature or secret")
    return res.status(401).json({ error: "Unauthorized" })
  }

  // req.body is a Buffer because we use express.raw for /webhooks in index.ts
  const hmac = crypto.createHmac("sha256", secret)
  const digest = hmac.update(req.body).digest("base64")

  if (digest !== signature) {
    logger.error("Basecamp webhook signature mismatch")
    return res.status(401).json({ error: "Invalid signature" })
  }

  try {
    const payload = JSON.parse(req.body.toString())
    const { kind, recording } = payload

    if (kind === "todo_completion") {
      const basecampTaskId = recording.id.toString()
      const userName = payload.creator?.name || "Unknown User"

      // 1. Find task by basecamp_task_id
      const { data: task, error: findError } = await supabase
        .from("tasks")
        .select("id")
        .eq("basecamp_task_id", basecampTaskId)
        .maybeSingle()

      if (findError || !task) {
        logger.info(
          `Basecamp todo completed, but no matching task found for ID: ${basecampTaskId}`,
        )
        return res.status(200).json({ received: true })
      }

      // 2. Update task status to 'resolved'
      const { error: updateError } = await supabase
        .from("tasks")
        .update({
          status: "resolved",
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)

      if (updateError) throw updateError

      // 3. Add system comment
      await supabase.from("comments").insert({
        task_id: task.id,
        content: `Resolved via Basecamp by ${userName}`,
        author_id: null, // System comment
      })

      logger.info(`Task ${task.id} resolved via Basecamp webhook`)
    }

    return res.status(200).json({ received: true })
  } catch (error: any) {
    logger.error(error, "Error processing Basecamp webhook")
    return res.status(500).json({ error: "Internal server error" })
  }
})

function severityToBadge(severity: string): string {
  const colors: Record<string, string> = {
    critical: "#ef4444",
    high: "#f97316",
    medium: "#eab308",
    low: "#3b82f6",
  }
  const color = colors[severity] || "#64748b"
  return `<span style="background-color: ${color}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase;">${severity}</span>`
}

/**
 * POST /api/basecamp/tasks/:id/resolve
 * Mark a task as resolved (by developer) and push a comment/screenshot to Basecamp.
 */
router.post(
  "/tasks/:id/resolve",
  clerkAuth,
  requireRole("developer"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { comment, screenshot_url } = req.body

    if (!comment) {
      return res.status(400).json({ error: "Comment is required" })
    }

    try {
      // 1. Get task and siblings
      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .select("*, projects(*)")
        .eq("id", id)
        .single()

      if (taskError || !task)
        return res.status(404).json({ error: "Task not found" })

      const [projectSettings, currentUserResult] = await Promise.all([
        getProjectSettings(task.project_id),
        supabase
          .from("users")
          .select("basecamp_access_token, role")
          .eq("id", req.auth?.userId)
          .single(),
      ])

      const isFeedback = task.title.includes("[Feedback]")

      const currentUser = currentUserResult.data
      let activeBasecampToken = currentUser?.basecamp_access_token

      if (!isFeedback) {
        if (!activeBasecampToken) {
          if (
            req.auth?.role === "super_admin" ||
            currentUser?.role === "super_admin"
          ) {
            activeBasecampToken = projectSettings?.basecamp_token
          } else {
            return res.status(403).json({
              error:
                "Please connect your personal Basecamp account to push tasks.",
            })
          }
        }

        if (!activeBasecampToken) {
          return res.status(400).json({ error: "Basecamp not configured" })
        }
      }

      // 2. Update status to resolved for all siblings
      const { data: siblings } = await supabase
        .from("tasks")
        .select("id")
        .eq("project_id", task.project_id)
        .or(
          `finding_id.eq.${task.finding_id}${task.finding_id ? "" : ",title.eq." + task.title}`,
        )

      const siblingIds = isFeedback
        ? Array.from(new Set([...(siblings || []).map((s) => s.id), task.id]))
        : (siblings || []).map((s) => s.id)

      await supabase
        .from("tasks")
        .update({ status: "resolved", updated_at: new Date().toISOString() })
        .in("id", siblingIds)

      // 3. Create comment in Supabase
      const { data: userProfile } = await supabase
        .from("users")
        .select("id, full_name")
        .eq("id", req.auth!.userId)
        .single()

      await supabase.from("comments").insert({
        task_id: id,
        author_id: userProfile?.id,
        content: `RESOLVED: ${comment}`,
      })

      // 3.2 Broadcast update
      await broadcastTaskUpdate(id, { status: "resolved" })

      // 4. Push to Basecamp
      let todolistId = task.basecamp_task_id
      if (!todolistId) {
        todolistId = task.projects.is_post_release
          ? projectSettings?.basecamp_post_todolist_id
          : projectSettings?.basecamp_todolist_id
      }

      if (todolistId && !isFeedback) {
        const issueMatch = task.title.match(/Issue #(\d+)/)
        const issueNumber = issueMatch ? issueMatch[1] : "N/A"

        const basecampComment = `
           <div style="color: #22c55e;"><h1>Issue number -#${issueNumber} resolved by ${userProfile?.full_name || "Developer"}</h1></div>
           ${screenshot_url ? `<br/><img src="${screenshot_url}" width="600" /><br/>` : ""}
           <br/>
           <div>${comment}</div>
         `.trim()

        await createBasecampComment({
          token: activeBasecampToken,
          accountId: projectSettings?.basecamp_account_id!,
          projectId: projectSettings?.basecamp_project_id!,
          recordingId: todolistId,
          content: basecampComment,
        })
      }

      return res.json({ success: true })
    } catch (error: any) {
      logger.error(error, "Error in resolve route")
      return res.status(500).json({ error: error.message })
    }
  },
)

/**
 * POST /api/basecamp/tasks/:id/not-resolved
 * Mark a task as not resolved and push a comment to Basecamp.
 */
router.post(
  "/tasks/:id/not-resolved",
  clerkAuth,
  async (req: Request, res: Response) => {
    const { id } = req.params
    const { comment, assignees } = req.body

    try {
      // 1. Get task and siblings
      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .select("*, projects(*)")
        .eq("id", id)
        .single()

      if (taskError || !task)
        return res.status(404).json({ error: "Task not found" })

      const isFeedback = task.title.includes("[Feedback]")

      // Role Check: Only qa_engineers (or higher) or developers on feedback tasks can mark as not resolved
      const role = req.auth?.role || "developer"
      const isQaOrHigher = [
        "super_admin",
        "admin",
        "sub_admin",
        "project_manager",
        "qa_engineer",
      ].includes(role)
      if (!isQaOrHigher && !(role === "developer" && isFeedback)) {
        return res.status(403).json({
          error: "Insufficient permissions. Required: qa_engineer or higher",
        })
      }

      const [projectSettings, currentUserResult] = await Promise.all([
        getProjectSettings(task.project_id),
        supabase
          .from("users")
          .select("basecamp_access_token, role")
          .eq("id", req.auth?.userId)
          .single(),
      ])

      const currentUser = currentUserResult.data
      let activeBasecampToken = currentUser?.basecamp_access_token

      if (!isFeedback) {
        if (!activeBasecampToken) {
          if (
            req.auth?.role === "super_admin" ||
            currentUser?.role === "super_admin"
          ) {
            activeBasecampToken = projectSettings?.basecamp_token
          } else {
            return res.status(403).json({
              error:
                "Please connect your personal Basecamp account to push tasks.",
            })
          }
        }

        if (!activeBasecampToken) {
          return res.status(400).json({ error: "Basecamp not configured" })
        }
      }

      // 2. Update status to in_progress for all siblings
      const { data: siblings } = await supabase
        .from("tasks")
        .select("id")
        .eq("project_id", task.project_id)
        .or(
          `finding_id.eq.${task.finding_id}${task.finding_id ? "" : ",title.eq." + task.title}`,
        )

      const siblingIds = isFeedback
        ? Array.from(new Set([...(siblings || []).map((s) => s.id), task.id]))
        : (siblings || []).map((s) => s.id)

      await supabase
        .from("tasks")
        .update({ status: "in_progress", updated_at: new Date().toISOString() })
        .in("id", siblingIds)

      // 3. Create comment in Supabase
      const { data: userProfile } = await supabase
        .from("users")
        .select("id, full_name")
        .eq("id", req.auth!.userId)
        .single()

      await supabase.from("comments").insert({
        task_id: id,
        author_id: userProfile?.id,
        content: `Marked as NOT RESOLVED: ${comment}`,
      })

      // 3.2 Broadcast update
      await broadcastTaskUpdate(id, { status: "in_progress" })

      // 4. Push to Basecamp
      let todolistId = task.basecamp_task_id
      if (!todolistId) {
        todolistId = task.projects.is_post_release
          ? projectSettings?.basecamp_post_todolist_id
          : projectSettings?.basecamp_todolist_id
      }

      if (todolistId && !isFeedback) {
        // Get mentions
        const { data: userList } = await supabase
          .from("users")
          .select("full_name, basecamp_person_id")
          .in("id", assignees || [])

        const mentionsList = await Promise.all(
          (userList || []).map(async (u) => {
            if (u.basecamp_person_id) {
              try {
                const person = await getBasecampPerson(
                  activeBasecampToken,
                  projectSettings!.basecamp_account_id!,
                  Number(u.basecamp_person_id),
                )
                if (person?.attachable_sgid)
                  return formatBasecampMention(
                    person.attachable_sgid,
                    person.name,
                  )
              } catch (err) {
                console.error(
                  `Failed to get Basecamp person ${u.basecamp_person_id}`,
                  err,
                )
              }
            }
            return null
          }),
        )
        const mentions = mentionsList.filter(Boolean).join(" ")

        const issueMatch = task.title.match(/Issue #(\d+)/)
        const issueHeader = issueMatch
          ? `<div style="color: #EAB308;"><h1>Issue no: #${issueMatch[1]}</h1></div>`
          : ""

        const basecampComment = `
           ${issueHeader}
           <div style="color: #ef4444;"><strong>[NOT RESOLVED] by ${userProfile?.full_name || "QA Engineer"}</strong></div>
           ${mentions ? `<div>${mentions}</div>` : ""}
           <br/>
           <div>${comment}</div>
           <br/>
           <em>Re-opened via QA Command Center</em>
         `.trim()

        await createBasecampComment({
          token: activeBasecampToken,
          accountId: projectSettings.basecamp_account_id!,
          projectId: projectSettings.basecamp_project_id!,
          recordingId: todolistId,
          content: basecampComment,
        })
      }

      return res.json({ success: true })
    } catch (error: any) {
      logger.error(error, "Error in not-resolved route")
      return res.status(500).json({ error: error.message })
    }
  },
)

export const basecampIntegrationRouter: Router = router
