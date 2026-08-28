/**
 * HubSpot read client — the source of truth for client-level data that TED does
 * not hold reliably: plan, paid-media engagement, and client details.
 *
 * Join key: DOMAIN, not TED's hubspotId. TED's hubspotId is the HubSpot record
 * id multiplied by 10 (e.g. TED 560466249290 = HubSpot company 56046624929), so
 * direct object lookups 404. Domain comes straight from the TED client notes
 * ("Client Domain/Website URL: …"). Two companies can share a domain (prod +
 * clone), so we disambiguate by exact name.
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
 * Find the HubSpot company for a client by domain, disambiguating by exact name
 * when a domain is shared (prod vs clone). Returns null when HubSpot is off, the
 * domain is unknown, or nothing matches — every caller must have a TED fallback.
 */
export async function getCompanyByDomain(
  domain: string | null | undefined,
  name?: string | null,
): Promise<{ id: string; properties: Record<string, any> } | null> {
  if (!hsEnabled() || !domain) return null
  const body = await hsFetch("/crm/v3/objects/companies/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: "domain", operator: "EQ", value: domain }] },
      ],
      properties: COMPANY_PROPS,
      limit: 10,
    }),
  })
  const results: any[] = body?.results || []
  if (results.length === 0) return null

  const want = (name || "").trim().toLowerCase()
  const exact = want
    ? results.find((c) => (c.properties?.name || "").trim().toLowerCase() === want)
    : null
  const chosen = exact || results[0]
  if (results.length > 1 && !exact) {
    logger.warn(
      { domain, name, ids: results.map((c) => c.id) },
      "HubSpot: multiple companies on domain, no exact name match — using first",
    )
  }
  return { id: String(chosen.id), properties: chosen.properties || {} }
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
 * Full client-level data for a TED client, joined into HubSpot by domain.
 * `domain` and `clientName` come from the TED client record (notes / name).
 */
export async function resolveHubspotClientData(
  domain: string | null | undefined,
  clientName?: string | null,
): Promise<HubspotClientData | null> {
  const company = await getCompanyByDomain(domain, clientName)
  if (!company) return null
  const p = company.properties

  return {
    companyId: company.id,
    name: p.name || clientName || "",
    domain: p.domain || domain || null,
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
