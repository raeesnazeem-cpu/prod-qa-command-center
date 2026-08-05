import { supabase } from "./supabase"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function postFinalReportToTED(runId: string, tedTaskId: string) {
  try {
    const apiToken = process.env.TED_API_TOKEN
    if (!apiToken) {
      logger.warn("TED_API_TOKEN is not configured in worker environment. Skipping TED report.")
      return
    }

    // Fetch findings for the run
    const { data: findings, error: findingsError } = await supabase
      .from("findings")
      .select("*")
      .eq("run_id", runId)

    if (findingsError) {
      logger.error({ error: findingsError.message }, "Error fetching findings for TED sync")
      return
    }

    // Fetch run to get project_id
    const { data: run } = await supabase
      .from("qa_runs")
      .select("project_id")
      .eq("id", runId)
      .single()

    const qaccDomain = process.env.PUBLIC_SITE_URL || "https://qacc.growth99.com"
    const runLink = `${qaccDomain}/projects/${run?.project_id || 'unknown'}/runs/${runId}`

    let reportText = `<strong>QACC Automated QA Run Completed</strong><br><br>`

    if (!findings || findings.length === 0) {
      logger.info({ runId }, "No findings for run, reporting perfect score to TED.")
      reportText += `🎉 All checks passed successfully! 0 issues found.<br><br>QACC Link: <a href="${runLink}">${runLink}</a>`
    } else {
      // Build the report text paragraph by paragraph for each finding

    for (const finding of findings) {
      reportText += `<strong>${finding.title || finding.check_factor}</strong><br>`
      
      let statusText = "Failed"
      if (finding.status === "passed") statusText = "Passed"
      else if (finding.status === "open") statusText = "Failed"
      else statusText = finding.status
      
      reportText += `Status: ${statusText}<br>`
      
      if (finding.description) {
        // Convert any newlines in the description to <br> for HTML rendering
        const htmlDesc = finding.description.replace(/\n/g, '<br>')
        reportText += `Details: ${htmlDesc}<br>`
      }
      
      const qaccDomain = process.env.PUBLIC_SITE_URL || "https://qacc.growth99.com"
      const link = `${qaccDomain}/projects/${run?.project_id || 'unknown'}/runs/${runId}`
      reportText += `QACC Link: <a href="${link}">${link}</a><br><br>`
    }
    } // End of findings loop else block

    logger.info({ tedTaskId }, "Sending final report to TED")

    const tedResponse = await fetch(`https://ted.growth99.com/api/tasks/${tedTaskId}/comments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: reportText.trim()
      })
    })

    // A 2xx is NOT sufficient proof of success: TED's Angular SSR serves the
    // app-shell HTML with HTTP 200 when the task id cannot be resolved (deleted
    // task, subtask, or a test/clone id). Only a JSON response means the comment
    // actually reached the API and was created.
    const contentType = tedResponse.headers.get("content-type") || ""
    if (tedResponse.ok && contentType.includes("application/json")) {
      logger.info({ tedTaskId }, "Successfully posted final report back to TED!")
    } else {
      const bodyPreview = (await tedResponse.text().catch(() => "")).slice(0, 200)
      logger.error(
        { tedTaskId, status: tedResponse.status, contentType, bodyPreview },
        "Failed to post report to TED: response was not JSON (task id likely unresolvable on TED, request fell through to the SPA)."
      )
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "Exception while syncing report to TED")
  }
}
