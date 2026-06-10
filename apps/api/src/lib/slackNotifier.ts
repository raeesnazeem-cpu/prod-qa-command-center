import { logger } from "./logger"

/**
 * Sends a message to a Slack Incoming Webhook URL.
 */
export async function sendSlackMessage(
  webhookUrl: string,
  message: object,
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Slack API error: ${response.status} ${text}`)
    }
  } catch (error: any) {
    logger.error(
      { error: error.message, webhookUrl },
      "Failed to send Slack message",
    )
    throw error
  }
}

/**
 * Notifies Slack that a QA run is complete.
 */
export async function notifyRunComplete(
  run: any,
  projectName: string,
  findings: any[],
): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173"
  const runUrl = `${frontendUrl}/projects/${run.project_id}/runs/${run.id}`

  const criticalCount = findings.filter((f) => f.severity === "critical").length
  const highCount = findings.filter((f) => f.severity === "high").length

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `QA Run Complete — ${projectName}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Status:* Completed\n*Type:* ${run.run_type.replace("_", " ")}\n*Findings:* ${criticalCount} Critical, ${highCount} High`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Run in QACC",
            emoji: true,
          },
          url: runUrl,
          style: "primary",
        },
      ],
    },
  ]

  const { data: settings } = await require("./supabase")
    .supabase.from("project_settings")
    .select("slack_webhook_url")
    .eq("project_id", run.project_id)
    .single()

  if (settings?.slack_webhook_url) {
    await sendSlackMessage(settings.slack_webhook_url, { blocks })
  }
}

/**
 * Notifies Slack about a critical finding.
 */
export async function notifyCriticalFinding(
  finding: any,
  task: any,
  projectName: string,
): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173"
  const taskUrl = `${frontendUrl}/projects/${task.project_id}/tasks/${task.id}`

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*CRITICAL FINDING ALERT — ${projectName}*`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Title:* ${finding.title}\n*Severity:* CRITICAL\n*Page:* ${finding.url || "N/A"}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Description:* ${finding.description || task.description}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Task",
            emoji: true,
          },
          url: taskUrl,
          style: "danger",
        },
      ],
    },
  ]

  const { data: settings } = await require("./supabase")
    .supabase.from("project_settings")
    .select("slack_webhook_url")
    .eq("project_id", task.project_id)
    .single()

  if (settings?.slack_webhook_url) {
    await sendSlackMessage(settings.slack_webhook_url, { blocks })
  }
}

/**
 * Notifies Slack about a PM sign-off.
 */
export async function notifySignOff(
  run: any,
  signedBy: string,
  projectName: string,
): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173"
  const runUrl = `${frontendUrl}/projects/${run.project_id}/runs/${run.id}`

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `✅ *QA Sign-off Complete — ${projectName}*`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Run:* ${run.run_type.replace("_", " ")}\n*Signed By:* ${signedBy}\n*Date:* ${new Date().toLocaleDateString()}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Signed Run",
            emoji: true,
          },
          url: runUrl,
        },
      ],
    },
  ]

  const { data: settings } = await require("./supabase")
    .supabase.from("project_settings")
    .select("slack_webhook_url")
    .eq("project_id", run.project_id)
    .single()

  if (settings?.slack_webhook_url) {
    await sendSlackMessage(settings.slack_webhook_url, { blocks })
  }
}
