/**
 * HubSpot read client — the source of truth for client-level data that TED does
 * not hold reliably: plan, paid-media engagement, and client details.
 *
 * Join key: the HubSpot ID shown on the TED client page (the client record's
 * hubspotId), which is the HubSpot company id (e.g. 56046624929). The company is
 * read directly by that id — no domain search.
 *
 * NOT sourced here (confirmed absent from the CRM): the beta site URL and GBP.
 * Those stay on TED / the live gbpCheck.
 *
 * Auth: a HubSpot private-app token (pat-na1-…) in HUBSPOT_TOKEN, read-only.
 * Nothing runs unless the token is set; every failure degrades to null so the
 * caller can fall back to TED.
 */
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

const HS_BASE = "https://api.hubapi.com"

// Company properties we actually read. Requesting an explicit set keeps the
// payload small and documents exactly what QACC depends on.
const COMPANY_PROPS = [
  "name",
  "domain",
  "website",
  "growth99_plan",
  "accessibility_plan_add_on",
  "paid_search_strategist",
  "seo_strategist",
  "select_if_deal_has_lead_generation",
  "growth99_support_level",
  "growth99_on_boarding_level",
  "website_release_date",
  "project_manager",
  "contact_email",
  "phone",
  "address",
  "city",
  "state",
  "zip",
  "country",
  "industry",
  "lifecyclestage",
]

function hsEnabled(): boolean {
  return !!process.env.HUBSPOT_TOKEN
}

async function hsFetch(
  path: string,
  init?: RequestInit,
): Promise<any | null> {
  const token = process.env.HUBSPOT_TOKEN
  if (!token) return null
  try {
    const r = await fetch(`${HS_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    })
    if (!r.ok) {
      logger.warn({ path, status: r.status }, "HubSpot request not OK")
      return null
    }
    if (!(r.headers.get("content-type") || "").includes("application/json")) return null
    return await r.json()
  } catch (e: any) {
    logger.warn({ path, error: e?.message }, "HubSpot request threw")
    return null
  }
}

export interface HubspotClientData {
  companyId: string
  name: string
  domain: string | null
  plan: string | null // growth99_plan
  accessibilityPlan: string | null // accessibility_plan_add_on: "Complete" | "Basic"
  paidSearchStrategist: string | null // resolved owner name, else raw id
  hasLeadGenFlag: boolean // select_if_deal_has_lead_generation === "true"
  details: {
    projectManager?: string
    supportLevel?: string
    onboardingLevel?: string
    websiteReleaseDate?: string
    contactEmail?: string
    phone?: string
    address?: string
    industry?: string
    lifecycleStage?: string
  }
  raw: Record<string, any>
}

/**
 * Read the HubSpot company by its id (the TED client page's HubSpot ID).
 * Returns null when HubSpot is off, the id is missing, or nothing matches —
 * every caller must have a TED fallback.
 */
export async function getCompanyById(
  hubspotId: string | null | undefined,
): Promise<{ id: string; properties: Record<string, any> } | null> {
  const id = String(hubspotId ?? "").trim()
  if (!hsEnabled() || !/^\d+$/.test(id)) return null
  const body = await hsFetch(
    `/crm/v3/objects/companies/${id}?properties=${encodeURIComponent(COMPANY_PROPS.join(","))}`,
  )
  if (!body?.id) {
    logger.warn({ hubspotId: id }, "HubSpot: no company for the TED client page HubSpot ID")
    return null
  }
  return { id: String(body.id), properties: body.properties || {} }
}

/** Resolve a HubSpot owner id to a display name (best-effort). */
async function ownerName(id: string | null | undefined): Promise<string | null> {
  if (!id || !/^\d+$/.test(String(id))) return id ? String(id) : null
  const o = await hsFetch(`/crm/v3/owners/${id}`)
  if (!o) return String(id)
  const full = [o.firstName, o.lastName].filter(Boolean).join(" ").trim()
  return full || o.email || String(id)
}

/**
 * Full client-level data for a TED client, read from HubSpot by the HubSpot ID
 * on the TED client page. `clientName` is only a display fallback.
 */
export async function resolveHubspotClientData(
  hubspotId: string | null | undefined,
  clientName?: string | null,
): Promise<HubspotClientData | null> {
  const company = await getCompanyById(hubspotId)
  if (!company) return null
  const p = company.properties

  return {
    companyId: company.id,
    name: p.name || clientName || "",
    domain: p.domain || null,
    plan: (p.growth99_plan || "").trim() || null,
    accessibilityPlan: (p.accessibility_plan_add_on || "").trim() || null,
    paidSearchStrategist: await ownerName(p.paid_search_strategist),
    hasLeadGenFlag: String(p.select_if_deal_has_lead_generation) === "true",
    details: {
      projectManager: p.project_manager || undefined,
      supportLevel: p.growth99_support_level || undefined,
      onboardingLevel: p.growth99_on_boarding_level || undefined,
      websiteReleaseDate: p.website_release_date || undefined,
      contactEmail: p.contact_email || undefined,
      phone: p.phone || undefined,
      address: [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ") || undefined,
      industry: p.industry || undefined,
      lifecycleStage: p.lifecyclestage || undefined,
    },
    raw: p,
  }
}
