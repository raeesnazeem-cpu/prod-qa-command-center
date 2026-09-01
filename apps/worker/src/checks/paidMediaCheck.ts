import { Finding } from "@qacc/shared"
import {
  getClient,
  getClientTimeline,
  getClientDomain,
  tasksByDepartment,
  parsePlan,
  TedTask,
} from "../lib/tedClient"
import { resolveHubspotClientData } from "../lib/hubspotClient"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

const f = (
  title: string,
  description: string,
  context_text?: string,
): Finding =>
  ({
    check_factor: "paid_media",
    title,
    description,
    context_text,
    status: "open",
    ai_generated: false,
  }) as Finding

/**
 * Paid Media check — simple binary.
 *
 * Paid media details = a paid-media plan/engagement for this client. Signals
 * (any one -> details found):
 *   - plan contains "Lead Generation" (HubSpot growth99_plan preferred, else TED)
 *   - HubSpot select_if_deal_has_lead_generation = true
 *   - HubSpot paid_search_strategist / TED client.paidMediaStrategist set
 *   - Paid-Media-Team ads campaign task(s) in the TED timeline
 *
 * Decision:
 *   details found     -> PASS, post the details (plan / strategist / campaigns)
 *   no details found  -> FAIL, "no details found — no fix possible, add manually"
 */
export async function checkPaidMedia(clientName: string): Promise<Finding[]> {
  let client: any
  let tasks: TedTask[]
  let hs: Awaited<ReturnType<typeof resolveHubspotClientData>> = null
  try {
    // getClient, getClientTimeline and getClientDomain are independent TED reads
    // with no ordering dependency, so run them concurrently instead of serially.
    // Only resolveHubspotClientData genuinely depends on the resolved domain, so
    // it stays chained after. Error behavior is preserved: getClient /
    // getClientTimeline rejections still reject the Promise.all and fall into the
    // same outer catch → "could not reach TED" (getClientDomain keeps its own
    // .catch, exactly as before).
    const [clientResult, timeline, domain] = await Promise.all([
      getClient(clientName),
      getClientTimeline(clientName),
      getClientDomain(clientName).catch(() => null),
    ])
    client = clientResult
    tasks = timeline
    hs = await resolveHubspotClientData(domain, clientName).catch(() => null)
  } catch (error: any) {
    logger.error({ error: error.message }, "TED read failed for paid media")
    return [
      f(
        "Paid Media — could not reach TED",
        `Failed to read client/timeline from TED for "${clientName}": ${error.message}`,
      ),
    ]
  }

  // Plan: HubSpot growth99_plan is the source of truth; fall back to TED.
  const plan = parsePlan(hs?.plan || client?.plan)
  const strategist =
    hs?.paidSearchStrategist ||
    client?.paidMediaStrategist?.name ||
    client?.paidMediaStrategist ||
    null
  const hasLeadGen = !!plan?.hasLeadGen || !!hs?.hasLeadGenFlag

  const pmTasks = tasksByDepartment(tasks || [], "paid media")
  const strict = /build\s+(google|meta|facebook)\s+ads\s+campaign/i
  const loose = /(google|meta|facebook)\s+ads/i
  let campaigns = pmTasks.filter((t) => strict.test(t.title))
  if (campaigns.length === 0) campaigns = pmTasks.filter((t) => loose.test(t.title))

  const found = !!client && (hasLeadGen || !!strategist || campaigns.length > 0)

  const context = `Client: ${clientName}; plan: ${plan?.raw || "none"} (${
    hs?.plan ? "HubSpot" : "TED"
  }); strategist: ${strategist || "none"}; leadGenFlag: ${
    hs ? hs.hasLeadGenFlag : "n/a"
  }; campaigns: ${campaigns.length}`

  // No paid media details -> FAIL. No fix possible (API-only, no repo lever).
  if (!found) {
    return [
      f(
        "Paid Media details not found",
        "No paid media plan or campaign details were found for this client in TED/HubSpot. No fix possible — please add the paid media details manually.",
        context,
      ),
    ]
  }

  // Details found -> PASS, post them. Phrased as a clean-pass ("No … issues
  // found") so the report marks the check Passed, not a defect.
  const bits = [
    plan?.raw && `Plan: ${plan.raw}${hasLeadGen ? " (Lead Generation)" : ""}`,
    strategist && `Strategist: ${strategist}`,
    campaigns.length &&
      `Campaigns (${campaigns.length}): ${campaigns
        .map((t) => `#${t.id} ${t.title}${t.completed ? "" : " [pending]"}`)
        .join("; ")}`,
  ].filter(Boolean)
  return [
    f(
      "Paid Media — details found",
      `No paid media issues found. Paid media details located for "${clientName}". ${bits.join(
        " · ",
      )}.`,
      context,
    ),
  ]
}
