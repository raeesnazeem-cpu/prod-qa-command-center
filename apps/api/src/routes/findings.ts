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
      severity,
      title,
      description,
      screenshot_url,
      context_text,
      ai_generated = false,
    } = req.body

    if (!page_id || !run_id || !title || !check_factor || !severity) {
      return res.status(400).json({
        error:
          "Missing required fields: page_id, run_id, title, check_factor, severity",
      })
    }

    try {
      const { data: newFinding, error } = await supabase
        .from("findings")
        .insert({
          page_id,
          run_id,
          check_factor,
          severity,
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
 * Update finding severity.
 */
router.patch(
  "/:id",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params
    const {
      severity,
      context_text,
      basecamp_comment_id,
      basecamp_comment_url,
    } = req.body

    if (severity && !["critical", "high", "medium", "low"].includes(severity)) {
      return res.status(400).json({ error: "Invalid severity" })
    }

    try {
      const updatePayload: any = { updated_at: new Date().toISOString() }
      if (severity !== undefined) updatePayload.severity = severity
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
        "Error updating finding severity",
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

/**
 * POST /api/findings/:id/push-basecamp
 * Directly push a general project plan finding to the designated Basecamp checklist comments thread.
 */
router.post(
  "/:id/push-basecamp",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params

    try {
      // 1. Fetch Finding and its QA Run details
      const idList = id.split(",")
      const { data: findingsList, error: findingError } = await supabase
        .from("findings")
        .select("*, qa_runs:run_id (project_id, site_url)")
        .in("id", idList)

      if (findingError || !findingsList || findingsList.length === 0) {
        return res.status(404).json({ error: "Finding not found" })
      }

      const finding = findingsList[0]
      if (idList.length > 1) {
        finding.description = findingsList.map((f: any) => f.description).filter(Boolean).join("\n")
      }

      const projectId = (finding.qa_runs as any).project_id
      const siteUrl = (finding.qa_runs as any).site_url

      // 2. Fetch Basecamp credentials and settings
      const { getProjectSettings } = require("../lib/getDecryptedSettings")
      const settings = await getProjectSettings(projectId)

      const currentUserResult = await supabase
        .from("users")
        .select("basecamp_access_token, role")
        .eq("id", req.auth?.userId)
        .single()
      const currentUser = currentUserResult.data

      let activeBasecampToken = currentUser?.basecamp_access_token

      if (!activeBasecampToken) {
        if (
          req.auth?.role === "super_admin" ||
          currentUser?.role === "super_admin"
        ) {
          activeBasecampToken = settings?.basecamp_token
        } else {
          return res.status(403).json({
            error:
              "Please connect your personal Basecamp account to push tasks.",
          })
        }
      }

      if (
        !settings ||
        !activeBasecampToken ||
        !settings.basecamp_account_id
      ) {
        return res
          .status(400)
          .json({ error: "Basecamp settings are not fully configured" })
      }

      const {
        basecamp_account_id: accountId,
        basecamp_project_id: bcProjectId,
      } = settings
      const token = activeBasecampToken
      const rawPlan = finding.context_text || ""
      if (finding.check_factor === "project_plan") {
        if (
          !rawPlan ||
          rawPlan.toLowerCase().includes("no plan details") ||
          rawPlan.toLowerCase().includes("not listed")
        ) {
          return res.status(400).json({
            error:
              "Cannot push to Basecamp: No project plan was identified during the scan. Please verify that the 'Project Order Details' todo has comments listing the Growth99 Plan.",
          })
        }
      }

      const plan = rawPlan.trim()

      const headers = {
        Authorization: `Bearer ${token}`,
        "User-Agent": "QACC (raees.nazeem@growth99.com)",
        "Content-Type": "application/json",
        Accept: "application/json",
      }

      // 3. Locate the specific Basecamp checklist item using official traversals
      // A. Get Docker tool lists to find To-dos set
      const bucketUrl = `https://3.basecampapi.com/${accountId}/buckets/${bcProjectId}.json`
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
          l.name.toLowerCase().includes("quality assurance - prerelease 2026"),
      )

      if (!targetList) {
        throw new Error(
          'Checklist list heading "15-Quality Assurance - Prerelease 2026" not found in Basecamp.',
        )
      }

      // D. Fetch all checklist items under the matched list and look for "QA-Check if reviews are added for Accelerator plan"
      let allTodos: any[] = []

      // 1. Fetch active to-dos
      let page = 1
      while (true) {
        const todosResponse = await axios.get(
          `${targetList.todos_url}?page=${page}`,
          { headers },
        )
        const pageTodos = todosResponse.data || []
        if (pageTodos.length === 0) break
        allTodos = allTodos.concat(pageTodos)
        if (pageTodos.length < 15) break // Basecamp's default page size is 15
        page++
      }

      // 2. Fetch completed to-dos
      let completedPage = 1
      while (true) {
        const completedResponse = await axios.get(
          `${targetList.todos_url}?completed=true&page=${completedPage}`,
          { headers },
        )
        const pageCompletedTodos = completedResponse.data || []
        if (pageCompletedTodos.length === 0) break
        allTodos = allTodos.concat(pageCompletedTodos)
        if (pageCompletedTodos.length < 15) break
        completedPage++
      }

      let targetTodo
      const checkFactor = finding.check_factor

      if (checkFactor === "project_plan") {
        targetTodo = allTodos.find((todo: any) =>
          todo.content
            .toLowerCase()
            .includes("qa-check if reviews are added for accelerator plan"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA-Check if reviews are added for Accelerator plan" not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "hero_media") {
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
      } else if (checkFactor === "dead_links") {
        targetTodo = allTodos.find((todo: any) => {
          const lower = todo.content.toLowerCase()
          return lower.includes("qa") && lower.includes("verify deadlink")
        })
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA - Verify Deadlink." not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "learn_more_buttons") {
        targetTodo = allTodos.find((todo: any) =>
          todo.content
            .toLowerCase()
            .includes("qa- check learn more, read more button on website"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA- Check Learn more, read more button on website" not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "paid_media") {
        targetTodo = allTodos.find(
          (todo: any) =>
            todo.content.toLowerCase().includes("qa paid media") ||
            todo.content.toLowerCase().includes("qa- paid media"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA Paid Media" not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "privacy_policy") {
        targetTodo = allTodos.find((todo: any) =>
          todo.content
            .toLowerCase()
            .includes("qa- check if privacy policy page added on the website"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA- Check if Privacy policy page added on the website." not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "footer_logo") {
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
      } else if (checkFactor === "single_script") {
        targetTodo = allTodos.find((todo: any) =>
          todo.content
            .toLowerCase()
            .includes("qa - check if single script features are added"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA - Check if single script features are added." not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "url_tab_compare") {
        targetTodo = allTodos.find((todo: any) =>
          todo.content
            .toLowerCase()
            .includes("qa - check url is matching and check for the tab name"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA - Check URL is Matching and check for the tab name" not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "top_bar_sticky") {
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
      } else if (checkFactor === "favicon_check" || checkFactor === "favicon") {
        targetTodo = allTodos.find((todo: any) =>
          todo.content.toLowerCase().includes("qa - add favicon"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA - Add Favicon." not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "contact_form") {
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
      } else if (checkFactor === "logo_chatbot") {
        targetTodo = allTodos.find((todo: any) =>
          todo.content
            .toLowerCase()
            .includes("qa - check if website logo is added to the chat bot"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA - Check if website logo is added to the chat bot." not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (
        checkFactor === "callnow_links" ||
        checkFactor === "verify_plugin_updates"
      ) {
        targetTodo = allTodos.find((todo: any) =>
          todo.content
            .toLowerCase()
            .includes("qa - before release - verify all plug-ins are updated"),
        )
        if (!targetTodo)
          throw new Error(
            `To-do checklist item "QA - Before Release - Verify ALL plug-ins are updated | Must verify then only start all pre-release tasks." not found in Basecamp checklist "${targetList.name}".`,
          )
      } else if (checkFactor === "social_share_heading") {
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

      // 4. Extract screenshots: split comma-separated list and reuse the worker's pre-captured reviews proof
      let screenshot2Url = ""
      const screenshotParts = (finding.screenshot_url || "").split(",")
      const screenshot1Url = screenshotParts[0] || ""

      if (screenshotParts[1]) {
        screenshot2Url = screenshotParts[1]
      }

      // Fallback: if we don't already have the pre-captured reviews screenshot, capture it live via Playwright
      if (
        finding.check_factor === "project_plan" &&
        !screenshot2Url &&
        siteUrl
      ) {
        const { chromium } = require("playwright")
        const sharp = require("sharp")
        const { uploadScreenshot } = require("../lib/supabaseStorage")

        const browser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

        try {
          const page = await browser.newPage()
          await page.setViewportSize({ width: 1920, height: 1080 })
          const targetReviewsUrl = `${siteUrl.replace(/\/$/, "")}/reviews`

          logger.info(
            { targetReviewsUrl },
            "Capturing live reviews widget proof",
          )
          await page.goto(targetReviewsUrl, {
            waitUntil: "networkidle",
            timeout: 30000,
          })

          const buffer = await page.screenshot()
          const compressed = await sharp(buffer)
            .jpeg({ quality: 85 })
            .toBuffer()

          const path = `evidence/reviews-proof/${id}-${Date.now()}.jpg`
          screenshot2Url = await uploadScreenshot(compressed, path, {
            bucket: "evidence",
            isPublic: true,
          })
        } catch (pwError: any) {
          logger.error(
            { error: pwError.message },
            "Failed to capture live reviews proof via Playwright",
          )
        } finally {
          await browser.close()
        }
      }

      let commentHtml = ""
      if (finding.check_factor === "paid_media") {
        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          ${finding.description.replace(/\n/g, "<br/>")}
          <br/><br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "project_plan") {
        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
         <br/>
          We have successfully verified Basecamp project plan: <br/><br/>
          
          <strong>1. Plan (Project Order Details):</strong><br/>
                   <a href="${screenshot1Url}" target="_blank"><img src="${screenshot1Url}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px; margin-bottom: 16px;" /></a><br/><br/><br/>

          
          <strong>2. <br/> Website Screenshot (${siteUrl}/reviews):</strong><br/><br/>
          ${
            screenshot2Url
              ? `<a href="${screenshot2Url}" target="_blank"><img src="${screenshot2Url}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px;" /></a>`
              : `<em style="color: #EF4444;">Failed to capture live website reviews screenshot, please confirm manually.</em>`
          }<br/><br/>
          
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "privacy_policy") {
        const {
          isScreenshotVerified,
          isPageVerified,
          isContentVerified,
          hasTask,
          assigneeNames,
        } = req.body || {}
        const allVerified =
          isScreenshotVerified && isPageVerified && isContentVerified
        const heading = `<strong>Privacy Policy ${allVerified ? "Verified" : "Unverified"}</strong>`

        let contentHtml = ""
        if (hasTask) {
          contentHtml = `
          ${heading}<br/><br/>
          <strong>Assignees:</strong> ${assigneeNames || "None"}<br/><br/>
          <strong>Verification Status:</strong><br/>
          - Footer Screenshot: ${isScreenshotVerified ? "Verified" : "Unverified"}<br/>
          - Full Page: ${isPageVerified ? "Verified" : "Unverified"}<br/>
          - Content: ${isContentVerified ? "Verified" : "Unverified"}<br/><br/>
          `
        } else {
          contentHtml = `
          ${heading}<br/><br/>
          <strong>Footer Screenshot:</strong><br/>
          <a href="${screenshot1Url}" target="_blank"><img src="${screenshot1Url}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px; margin-bottom: 16px;" /></a><br/><br/>
          ${
            screenshot2Url
              ? `
          <strong>Full Privacy Policy Page:</strong><br/>
          <a href="${screenshot2Url}" target="_blank"><img src="${screenshot2Url}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px; margin-bottom: 16px;" /></a><br/><br/>
          `
              : ""
          }

          <strong>Confirm verification:</strong><br/>
          - Footer Screenshot: ${isScreenshotVerified ? "Verified" : "Unverified"}<br/>
          - Full Page Screenshot: ${isPageVerified ? "Verified" : "Unverified"}<br/>
          - Content Verification: ${isContentVerified ? "Verified" : "Unverified"}<br/><br/>
          `
        }

        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          ${contentHtml}
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "hero_media") {
        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>Hero Media Check</strong><br/><br/>
          ${finding.description.replace(/\n/g, "<br/>")}
          <br/><br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "social_share_heading") {
        const screens = (finding.screenshot_url || "")
          .split(",")
          .filter(Boolean)
        const screenshotsHtml = screens
          .map(
            (url: string) =>
              `<a href="${url.trim()}" target="_blank"><img src="${url.trim()}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px; margin-bottom: 16px;" /></a>`,
          )
          .join("<br/><br/>")

        const { aiResultsText } = req.body || {}

        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>Social Share Heading Verification</strong><br/><br/>
          All social share properties and previews have been verified.<br/><br/>
          <strong>Screenshots:</strong><br/>
          ${screenshotsHtml}
          ${aiResultsText ? `<br/><br/><div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 16px;"><strong>${aiResultsText.replace(/\n/g, "<br/>")}</strong></div>` : ""}
          <br/><br/>
          <em>Sent automatically via QA Command Center</em>
                </div>
        `.trim()
      } else if (finding.check_factor === "url_tab_compare") {
        const { urlsTableHtml, aiResultsText } = req.body || {}
        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>URL & Tab Compare Verification</strong><br/>
          ${urlsTableHtml || ""}
          ${aiResultsText ? `<br/><div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 16px;"><strong>${aiResultsText.replace(/\n/g, "<br/>")}</strong></div>` : ""}
          <br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "logo_chatbot") {
        const { isLogoVerified } = req.body || {}
        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>Logo on Chatbot Verification</strong><br/><br/>
                    Logo on chatbot verified? <strong>${isLogoVerified ? "YES" : "NO"}</strong><br/><br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "verify_plugin_updates") {
        const { aiResultsText } = req.body || {}
        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>Plugin Updates Verification</strong><br/><br/>
          Plugin updates have been verified.<br/><br/>
          <strong>Screenshot:</strong><br/>
          <a href="${screenshot1Url}" target="_blank"><img src="${screenshot1Url}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px; margin-bottom: 16px;" /></a>
          ${aiResultsText ? `<br/><br/><div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 16px;"><strong>${aiResultsText.replace(/\n/g, "<br/>")}</strong></div>` : ""}
          <br/><br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (
        finding.check_factor === "favicon_check" ||
        finding.check_factor === "favicon"
      ) {
        const { aiResultsText, isVerified, assigneeNames } = req.body || {}
        let mentionsHtml = ""
        if (
          assigneeNames &&
          Array.isArray(assigneeNames) &&
          assigneeNames.length > 0
        ) {
          mentionsHtml = `<strong>Assigned to:</strong> ${assigneeNames.join(", ")}<br/><br/>`
        }

        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>Favicon Verification</strong><br/><br/>
          ${mentionsHtml}
          Status: <strong>${isVerified ? "Verified" : "Pending Review"}</strong><br/><br/>
          <strong>Screenshots:</strong><br/>
          ${screenshot1Url ? `<a href="${screenshot1Url}" target="_blank"><img src="${screenshot1Url}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px; margin-bottom: 16px;" /></a>` : ""}
          ${aiResultsText ? `<br/><br/><div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 16px;"><strong>${aiResultsText.replace(/\n/g, "<br/>")}</strong></div>` : ""}
          <br/><br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "single_script") {
        const { aiResultsText, assigneeNames } = req.body || {}
        let mentionsHtml = ""
        if (assigneeNames) {
          mentionsHtml = `<strong>Assigned to:</strong> ${assigneeNames}<br/><br/>`
        }

        const screens = (finding.screenshot_url || "")
          .split(",")
          .filter(Boolean)
        const screenshotsHtml = screens
          .map(
            (url: string) =>
              `<a href="${url.trim()}" target="_blank"><img src="${url.trim()}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px; margin-bottom: 16px;" /></a>`,
          )
          .join("<br/><br/>")

        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>${finding.title || "Verify Single Script Features"}</strong><br/><br/>
          ${mentionsHtml}
          ${finding.description ? finding.description.replace(/\n/g, "<br/>") : "Please verify the single script features across Desktop, Tablet, Mobile and verify the script code addition."}<br/><br/>
          <strong>Screenshots:</strong><br/>
          ${screenshotsHtml}
          ${aiResultsText ? `<br/><br/><div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 16px;"><strong>${aiResultsText.replace(/\n/g, "<br/>")}</strong></div>` : ""}
          <br/><br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "dead_links") {
        let links: any[] = []
        for (const f of findingsList) {
          let descLinks: any[] = []
          try {
            const parsed = JSON.parse(f.description)
            descLinks = Array.isArray(parsed) ? parsed : [parsed]
          } catch (e) {
            const regex = /- \*\*(.*?)\*\*\s*\* Reason:\s*(.*?)\s*\* Link Text:\s*(.*?)\s*\* Found on:\s*(.*?)(?=\s+- \*\*|$)/gs
            let match
            while ((match = regex.exec(f.description)) !== null) {
              descLinks.push({
                url: match[1].trim(),
                reason: match[2].trim(),
                link_text: match[3].trim(),
                found_on: match[4].trim(),
              })
            }
          }
          links = links.concat(descLinks)
        }

        let tableHtml = ""
        if (links.length > 0) {
          tableHtml = `
            <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; border-color: #e2e8f0; font-family: sans-serif; font-size: 13px;">
              <thead style="background-color: #f8fafc; color: #64748b; text-align: left;">
                <tr>
                  <th>URL</th>
                  <th>Reason</th>
                  <th>Link Text</th>
                  <th>Found On</th>
                </tr>
              </thead>
              <tbody>
                ${links.map((link: any) => `
                  <tr>
                    <td style="color: #3b82f6;"><a href="${link.url}" target="_blank">${link.url}</a></td>
                    <td>${link.reason || "-"}</td>
                    <td>${link["Link text"] || link.link_text || "-"}</td>
                    <td style="color: #3b82f6;">${link.found_on ? `<a href="${link.found_on}" target="_blank">${link.found_on}</a>` : "-"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          `
        }

        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>Dead Links Verification</strong><br/><br/>
          ${tableHtml || "No dead links found."}
          <br/><br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else if (finding.check_factor === "contact_form") {
        let pagesData: any[] = []
        for (const f of findingsList) {
          try {
            const data = JSON.parse(f.context_text || "{}")
            if (data.url) pagesData.push(data)
          } catch (e) {}
        }

        let tableHtml = ""
        if (pagesData.length > 0) {
          tableHtml = `
            <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; border-color: #e2e8f0; font-family: sans-serif; font-size: 13px;">
              <thead style="background-color: #f8fafc; color: #64748b; text-align: left;">
                <tr>
                  <th>#</th>
                  <th>URL</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${pagesData
                  .map(
                    (data: any, idx: number) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="color: #3b82f6;"><a href="${data.url}" target="_blank">${data.url}</a></td>
                    <td>${
                      data.hasForm
                        ? '<span style="color: #059669; font-weight: bold;">Present</span>'
                        : '<span style="color: #64748b; font-weight: bold;">Missing</span>'
                    }</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          `
        }

        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>Contact Form Verification</strong><br/><br/>
          ${tableHtml || "No pages analyzed."}
          <br/><br/>
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      } else {
        // Fallback for any other check that doesn't have a custom HTML layout
        const genericMessage = finding.description
          ? finding.description.replace(/\n/g, "<br/>")
          : "Verification completed."
        commentHtml = `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <strong>${finding.title || "Quality Assurance Check"}</strong><br/><br/>
          ${genericMessage}<br/><br/>
          ${screenshot1Url ? `<a href="${screenshot1Url}" target="_blank"><img src="${screenshot1Url}" width="500" style="border: 1px solid #e3e4e6; border-radius: 6px; margin-bottom: 16px;" /></a><br/><br/>` : ""}
          <em>Sent automatically via QA Command Center</em>
        </div>
        `.trim()
      }

      const postCommentUrl = `https://3.basecampapi.com/${accountId}/buckets/${bcProjectId}/recordings/${targetTodo.id}/comments.json`

      const commentResponse = await axios.post(
        postCommentUrl,
        { content: commentHtml },
        { headers },
      )
      const createdCommentId = commentResponse.data.id

      if (
        finding.check_factor === "paid_media" ||
        finding.check_factor === "social_share_heading"
      ) {
        try {
          const {
            notifyOnGoogleChat,
          } = require("../services/googleChatNotificationService")

          const { data: relatedTasks } = await supabase
            .from("tasks")
            .select("assigned_to")
            .in("finding_id", idList)
          const assignedUserIds = relatedTasks
            ? Array.from(
                new Set(
                  relatedTasks.map((t: any) => t.assigned_to).filter(Boolean),
                ),
              )
            : []

          await notifyOnGoogleChat({
            taskId: finding.id,
            projectId: projectId,
            issueNumber: finding.issue_number || 0,
            projectName: siteUrl || "Project",
            issueHeading: finding.title || "Finding",
            findingsUrl: targetTodo.app_url || "",
            assignedUserIds: assignedUserIds,
            category: (finding.severity || "Finding").toUpperCase(),
            description: finding.description || "",
            thumbnails: screenshotParts
              .map((url: string) => url.trim())
              .filter(Boolean),
          })
        } catch (gcError: any) {
          logger.error(
            { error: gcError.message },
            "Failed to send Google Chat notification",
          )
        }
      }

      const createdCommentUrl = commentResponse.data.app_url

      // 6. Update finding status to 'confirmed' upon successful push and save the Comment ID and URL
      await supabase
        .from("findings")
        .update({
          status: "confirmed",
          basecamp_comment_id: createdCommentId
            ? createdCommentId.toString()
            : null,
          basecamp_comment_url: createdCommentUrl || null,
          updated_at: new Date().toISOString(),
        })
        .in("id", idList)

      return res.status(200).json({
        success: true,
        todoUrl: targetTodo.app_url,
        commentUrl: createdCommentUrl,
      })
    } catch (err: any) {
      logger.error({ error: err.message }, "Direct push to Basecamp failed")
      return res.status(500).json({ error: err.message })
    }
  },
)

/**
 * DELETE /api/findings/:id/delete-basecamp-push
 * Deletes the basecamp comment that was previously pushed, and un-confirms the finding.
 */
router.delete(
  "/:id/delete-basecamp-push",
  clerkAuth,
  requireRole("qa_engineer"),
  async (req: Request, res: Response) => {
    const { id } = req.params

    try {
      const idList = id.split(",")
      const { data: findingsList, error: findingError } = await supabase
        .from("findings")
        .select("*, qa_runs:run_id (project_id)")
        .in("id", idList)

      if (findingError || !findingsList || findingsList.length === 0)
        return res.status(404).json({ error: "Finding not found" })
      
      const finding = findingsList[0]
      if (!finding.basecamp_comment_id)
        return res
          .status(400)
          .json({ error: "No Basecamp comment associated with this finding." })

      const projectId = (finding.qa_runs as any).project_id
      const { getProjectSettings } = require("../lib/getDecryptedSettings")
      const settings = await getProjectSettings(projectId)

      const currentUserResult = await supabase
        .from("users")
        .select("basecamp_access_token, role")
        .eq("id", req.auth?.userId)
        .single()
      const currentUser = currentUserResult.data

      let activeBasecampToken = currentUser?.basecamp_access_token

      if (!activeBasecampToken) {
        if (
          req.auth?.role === "super_admin" ||
          currentUser?.role === "super_admin"
        ) {
          activeBasecampToken = settings?.basecamp_token
        } else {
          return res.status(403).json({
            error:
              "Please connect your personal Basecamp account to delete Basecamp pushes.",
          })
        }
      }

      if (
        !settings ||
        !activeBasecampToken ||
        !settings.basecamp_account_id
      ) {
        return res.status(400).json({ error: "Basecamp settings missing" })
      }

      const { deleteBasecampComment } = require("../lib/basecampClient")
      await deleteBasecampComment({
        token: activeBasecampToken,
        accountId: settings.basecamp_account_id,
        projectId: settings.basecamp_project_id,
        recordingId: "not-used",
        commentId: parseInt(finding.basecamp_comment_id, 10),
      })

      await supabase
        .from("findings")
        .update({
          status: "pending",
          basecamp_comment_id: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", idList)

      return res.status(200).json({ success: true })
    } catch (err: any) {
      logger.error({ error: err.message }, "Failed to delete Basecamp push")
      return res.status(500).json({ error: err.message })
    }
  },
)

export { router as findingsRouter }
