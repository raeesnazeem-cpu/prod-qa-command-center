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

    let reportText = `**QACC Automated QA Run Completed**\n\n`

    if (!findings || findings.length === 0) {
      logger.info({ runId }, "No findings for run, reporting perfect score to TED.")
      reportText += `🎉 All checks passed successfully! 0 issues found.\n\nQACC Link: ${runLink}`
    } else {
      // Build the report text paragraph by paragraph for each finding

    for (const finding of findings) {
      reportText += `${finding.title || finding.check_factor}\n`
      
      let statusText = "Failed"
      if (finding.status === "passed") statusText = "Passed"
      else if (finding.status === "open") statusText = "Failed"
      else statusText = finding.status
      
      reportText += `Status: ${statusText}\n`
      
      if (finding.description) {
        reportText += `Details: ${finding.description}\n`
      }
      
      const qaccDomain = process.env.PUBLIC_SITE_URL || "https://qacc.growth99.com"
      reportText += `QACC Link: ${qaccDomain}/projects/${run?.project_id || 'unknown'}/runs/${runId}\n\n`
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

    if (tedResponse.ok) {
      logger.info("Successfully posted final report back to TED!")
    } else {
      logger.error({ status: tedResponse.status }, "Failed to post final report to TED.")
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "Exception while syncing report to TED")
  }
}
