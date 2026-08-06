import { supabase } from "./supabase"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

// Post a comment to a TED task, preferring the newer /comments/ai endpoint
// (X-Api-Key + idempotent eventKey); fall back to the proven /comments (Bearer).
// Returns true on success.
async function postTedComment(
  tedTaskId: string,
  text: string,
  eventKey: string,
): Promise<boolean> {
  const xApiKey = process.env.X_API_KEY
  const bearer = process.env.TED_API_TOKEN
  const isJsonOk = (r: Response) =>
    r.ok && (r.headers.get("content-type") || "").includes("application/json")

  // 1. Preferred: /comments/ai with X-Api-Key + eventKey.
  if (xApiKey) {
    try {
      const r = await fetch(
        `https://ted.growth99.com/api/tasks/${tedTaskId}/comments/ai`,
        {
          method: "POST",
          headers: {
            "X-Api-Key": xApiKey,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text, eventKey }),
        },
      )
      if (isJsonOk(r)) {
        logger.info({ tedTaskId }, "Posted TED comment via /comments/ai.")
        return true
      }
      const preview = (await r.text().catch(() => "")).slice(0, 200)
      logger.warn(
        { tedTaskId, status: r.status, preview },
        "/comments/ai unavailable; falling back to /comments (Bearer).",
      )
    } catch (err: any) {
      logger.warn(
        { tedTaskId, error: err?.message },
        "/comments/ai threw; falling back to /comments (Bearer).",
      )
    }
  } else {
    logger.info(
      { tedTaskId },
      "X_API_KEY not set in worker; using /comments (Bearer) directly.",
    )
  }

  // 2. Fallback: /comments with Bearer (the currently-working endpoint).
  if (!bearer) {
    logger.error({ tedTaskId }, "No TED_API_TOKEN for /comments fallback.")
    return false
  }
  try {
    const r = await fetch(
      `https://ted.growth99.com/api/tasks/${tedTaskId}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    )
    if (isJsonOk(r)) {
      logger.info({ tedTaskId }, "Posted TED comment via /comments (Bearer).")
      return true
    }
    const preview = (await r.text().catch(() => "")).slice(0, 200)
    logger.error(
      { tedTaskId, status: r.status, preview },
      "Failed to post TED comment via /comments (response not JSON).",
    )
    return false
  } catch (err: any) {
    logger.error(
      { tedTaskId, error: err?.message },
      "Error posting TED comment via /comments.",
    )
    return false
  }
}

export async function postFinalReportToTED(runId: string, tedTaskId: string) {
  try {
    const apiToken = process.env.TED_API_TOKEN
    if (!apiToken) {
      logger.warn(
        "TED_API_TOKEN is not configured in worker environment. Skipping TED report.",
      )
      return
    }

    // Idempotency claim: a run can be finalized by several completion paths
    // (runChecksJob / crawlPageJob, RPC + fallback). Atomically stamp
    // ted_report_posted_at so exactly ONE caller proceeds to post the report.
    const { data: claim, error: claimErr } = await supabase
      .from("qa_runs")
      .update({ ted_report_posted_at: new Date().toISOString() })
      .eq("id", runId)
      .is("ted_report_posted_at", null)
      .select("id")

    if (claimErr) {
      logger.error(
        { runId, error: claimErr.message },
        "Failed to claim TED report; skipping to avoid duplicates",
      )
      return
    }
    if (!claim || claim.length === 0) {
      logger.info(
        { runId },
        "TED final report already posted by another completion path; skipping.",
      )
      return
    }

    // Fetch findings for the run
    const { data: findings, error: findingsError } = await supabase
      .from("findings")
      .select("*")
      .eq("run_id", runId)

    if (findingsError) {
      logger.error(
        { error: findingsError.message },
        "Error fetching findings for TED sync",
      )
      return
    }

    // Fetch run to get project_id
    const { data: run } = await supabase
      .from("qa_runs")
      .select("project_id")
      .eq("id", runId)
      .single()

    const qaccDomain =
      process.env.PUBLIC_SITE_URL || "https://qacc.growth99.com"
    const runLink = `${qaccDomain}/projects/${run?.project_id || "unknown"}/runs/${runId}`

    let reportText = `<strong>QACC Automated QA Run Completed</strong><br><br>`

    if (!findings || findings.length === 0) {
      logger.info(
        { runId },
        "No findings for run, reporting perfect score to TED.",
      )
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
          const htmlDesc = finding.description.replace(/\n/g, "<br>")
          reportText += `Details: ${htmlDesc}<br>`
        }

        const qaccDomain =
          process.env.PUBLIC_SITE_URL || "https://qacc.growth99.com"
        const link = `${qaccDomain}/projects/${run?.project_id || "unknown"}/runs/${runId}`
        reportText += `QACC Link: <a href="${link}">${link}</a><br><br>`
      }
    } // End of findings loop else block

    logger.info({ tedTaskId }, "Sending final report to TED")

    // Try /comments/ai (X-Api-Key + idempotent eventKey) first, else /comments.
    const posted = await postTedComment(
      tedTaskId,
      reportText.trim(),
      `ext:qacc-report-${runId}`,
    )

    if (posted) {
      logger.info(
        { tedTaskId },
        "Successfully posted final report back to TED!",
      )
    } else {
      logger.error(
        { tedTaskId },
        "Failed to post final report to TED via both /comments/ai and /comments.",
      )
      // Release the claim so a retry / another completion path can post it later.
      await supabase
        .from("qa_runs")
        .update({ ted_report_posted_at: null })
        .eq("id", runId)
    }
  } catch (error: any) {
    logger.error(
      { error: error.message },
      "Exception while syncing report to TED",
    )
    // Release the claim on unexpected failure so the report isn't lost forever.
    await supabase
      .from("qa_runs")
      .update({ ted_report_posted_at: null })
      .eq("id", runId)
      .then(undefined, () => {})
  }
}
