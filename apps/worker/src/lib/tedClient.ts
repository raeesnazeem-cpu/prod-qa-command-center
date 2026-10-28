/**
 * Minimal worker-side TED client reader.
 *
 * Gives worker-side checks read access to a TED client record, its
 * clientDetails.notes, and the client page's overview panel (beta/live URL,
 * GitHub repo), using the TED_API_TOKEN already present in the worker
 * environment.
 *
 * Read-only: only GET requests. No writes.
 */

const TED_BASE = "https://ted.growth99.com/api"

/** Strip HTML/entities to plain text (mirrors the API-side notes parser). */
export function stripHtml(html: string | null | undefined): string {
  return (html || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// Client-list cache.
//
// GET /clients returns EVERY TED client with their notes HTML — a large payload
// that does not change during a run. It used to be re-downloaded and re-scanned
// on every getClient() call, and getClientNotesText / getClientDomain /
// getReviewsWidgetId / getClientTimeline / getClientInfo all call it
// internally, so a single run issued roughly 8–15 full-list downloads.
//
// One in-flight promise is shared by all callers and memoised for a short TTL,
// with id/name indexes built once so lookups are O(1) instead of three linear
// scans. The TTL is deliberately short: TED stays the source of truth, we only
// collapse the duplicate reads inside one run.
// ---------------------------------------------------------------------------

const CLIENTS_TTL_MS = Math.max(
  0,
  Number(process.env.TED_CLIENTS_CACHE_TTL_MS || 5 * 60 * 1000),
)

interface ClientIndex {
  list: any[]
  byId: Map<string, any>
  byName: Map<string, any>
}

let clientsCache: { at: number; promise: Promise<ClientIndex | null> } | null = null

function indexClients(list: any[]): ClientIndex {
  const byId = new Map<string, any>()
  const byName = new Map<string, any>()
  for (const c of list) {
    const id = String(c?.id ?? "").trim()
    if (id && !byId.has(id)) byId.set(id, c)
    const name = (c?.name || "").toLowerCase().trim()
    if (name && !byName.has(name)) byName.set(name, c)
  }
  return { list, byId, byName }
}

async function fetchClientIndex(): Promise<ClientIndex | null> {
  try {
    const body: any = await tedGetJson("/clients")
    if (!body) return null
    const list: any[] = Array.isArray(body)
      ? body
      : body?.clients || body?.data || body?.items || []
    return indexClients(list)
  } catch {
    return null
  }
}

/** The client list, fetched at most once per TTL. Failures are not cached. */
async function getClientIndex(): Promise<ClientIndex | null> {
  const now = Date.now()
  if (clientsCache && now - clientsCache.at < CLIENTS_TTL_MS) {
    return clientsCache.promise
  }
  const entry = { at: now, promise: fetchClientIndex() }
  clientsCache = entry
  const result = await entry.promise
  // Never let a failed fetch stick around for the whole TTL — the next caller
  // should retry rather than inherit a null for five minutes.
  if (result === null && clientsCache === entry) clientsCache = null
  return result
}

/** Drop the cached client list (call between runs, or after a known TED write). */
export function clearClientCache(): void {
  clientsCache = null
}

/** Fetch a single TED client by id (preferred) or name (case-insensitive). */
export async function getClient(
  clientIdOrName: string | number | null | undefined,
): Promise<any | null> {
  if (clientIdOrName == null) return null

  const idx = await getClientIndex()
  if (!idx) return null

  const wantId = String(clientIdOrName).trim()
  const wantName = wantId.toLowerCase()
  // An empty key would substring-match the FIRST client in the list.
  if (!wantId) return null
  return (
    idx.byId.get(wantId) ||
    idx.byName.get(wantName) ||
    // Substring match stays a scan — it has no useful index and is the last resort.
    idx.list.find((c) => (c?.name || "").toLowerCase().includes(wantName)) ||
    null
  )
}

/** Convenience: the client's notes as plain text ("" if unavailable). */
export async function getClientNotesText(
  clientIdOrName: string | number | null | undefined,
): Promise<string> {
  const client = await getClient(clientIdOrName)
  return stripHtml(client?.clientDetails?.notes || "")
}

/**
 * Resolve the client's reviews-widget identifiers (per-client, dynamic) so the
 * AI-fix pass can inject the correct footer embed. The id/bid are NOT derivable
 * from the site (a missing widget leaves nothing to read), so they must come
 * from the client record. We scan the TED notes for either:
 *   • a ready-made embed URL: reviews.growth99.com/widget/?id=<id>&bid=<bid>
 *   • or a labelled line: "Reviews Widget ID: <id>" (+ optional "bid: <bid>")
 * Returns null when neither is present (fix falls back to a manual instruction).
 */
export async function getReviewsWidgetId(
  clientIdOrName: string | number | null | undefined,
): Promise<{ id: string; bid: string } | null> {
  const notes = await getClientNotesText(clientIdOrName).catch(() => "")
  if (!notes) return null
  // 1. Full embed URL already pasted in the notes.
  const url = notes.match(
    /reviews\.growth99\.com\/widget\/?\?id=([A-Za-z0-9_-]+)(?:&(?:amp;)?bid=(\d+))?/i,
  )
  if (url && url[1]) return { id: url[1], bid: url[2] || "" }
  // 2. Labelled line(s): "Reviews Widget ID: <id>" and optional "bid: <n>".
  const idLine = notes.match(
    /Reviews?\s*Widget\s*(?:ID|Id)\s*[:\-]\s*([A-Za-z0-9_-]{8,})/i,
  )
  if (idLine && idLine[1]) {
    const bidLine = notes.match(/\bbid\s*[:\-=]\s*(\d+)/i)
    return { id: idLine[1], bid: bidLine ? bidLine[1] : "" }
  }
  return null
}

/**
 * The client's business phone from the TED contact notes, for the Call Now
 * button fix. Prefers a labelled "Phone/Tel/Contact/Number: …" line, else the
 * first phone-shaped token. Returns:
 *   • null                       → no phone-like value in the notes ("not found")
 *   • { display, tel: "" }       → a value was present but it's not a valid,
 *                                  linkable number ("number not linked")
 *   • { display, tel }           → a usable `tel:` value (E.164-ish; US numbers
 *                                  default to +1)
 */
export async function getClientPhone(
  clientIdOrName: string | number | null | undefined,
): Promise<{ display: string; tel: string } | null> {
  const notes = await getClientNotesText(clientIdOrName).catch(() => "")
  if (!notes) return null
  const labelled = notes.match(
    /(?:phone|tel(?:ephone)?|contact(?:\s*(?:no\.?|number))?|number)\s*[:\-]?\s*(\+?\d[\d\s().\-]{6,}\d)/i,
  )
  const bare = notes.match(/\+?\d[\d\s().\-]{6,}\d/)
  const raw = (labelled?.[1] || bare?.[0] || "").trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, "")
  let tel = ""
  if (digits.length >= 7) {
    if (raw.startsWith("+")) tel = "+" + digits
    else if (digits.length === 10) tel = "+1" + digits
    else if (digits.length === 11 && digits.startsWith("1")) tel = "+" + digits
    else tel = digits
  }
  return { display: raw, tel }
}

/** Reduce a URL or labelled text ("Website URL: …") to a bare host (no scheme/path). */
export function extractDomain(text: string | null | undefined): string | null {
  if (!text) return null
  const s = String(text)
  const labelled = s.match(/(?:Domain|Website(?:\s*URL)?)\s*[:\-]\s*(\S+)/i)
  const candidate =
    (labelled && labelled[1]) ||
    (s.match(/\bhttps?:\/\/\S+/i) || [])[0] ||
    (s.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}\b/i) || [])[0] ||
    (s.match(/\b[a-z0-9-]+\.[a-z]{2,}\b/i) || [])[0] ||
    null
  if (!candidate) return null
  return candidate
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .replace(/[),.;]+$/, "")
    .toLowerCase() || null
}

/**
 * The client's live website domain: the host of the TED client page's
 * "Website URL" (info.liveSiteUrl). Returns a bare host (no scheme/path).
 */
export async function getClientDomain(
  clientIdOrName: string | number | null | undefined,
): Promise<string | null> {
  return extractDomain(await getClientLiveUrl(clientIdOrName))
}

// ---------------------------------------------------------------------------
// TED client "main page" fields.
//
// The TED client dashboard (ted.growth99.com/dashboard/clients/{id}) surfaces
// these structured fields. The right-hand overview panel reads
// GET /api/clients/{id}/info, which is the single source for:
//   • info.betaSiteUrl  → Beta site URL
//   • info.liveSiteUrl  → Website URL (live/production)
//   • info.githubRepo   → GitHub site URL, stored as the path after github.com
//                         (e.g. "G99agency/nuvoaestheticsclinic.gogroth.com")
// and the client record from GET /api/clients supplies:
//   • client.hubspotId           → HubSpot ID (the HubSpot company id)
//   • client.plan                → PLAN
//   • client.paidMediaStrategist → paid-media strategist
// These are the canonical, staff-visible values; the older heuristics (notes
// regex, beta_site.env task payload/comments) are no longer used for them.
// ---------------------------------------------------------------------------

/** Trim a URL to a clean, scheme-normalized value ("" → null). */
export function cleanSiteUrl(u: string | null | undefined): string | null {
  if (!u) return null
  let v = String(u)
    .split(/["'<>\s]/)[0]
    .replace(/[.,;)]+$/, "")
    .replace(/\/+$/, "")
    .trim()
  if (!v) return null
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`
  return /\.[a-z]{2,}/i.test(v) ? v : null
}

/** Normalize a URL/host to a bare, comparable host (lowercase, no scheme/www). */
export function normalizeHost(u: string | null | undefined): string {
  if (!u) return ""
  return String(u)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .replace(/[),.;]+$/, "")
    .toLowerCase()
    .trim()
}

/** The plan straight off the client record's main-page `plan` field. */
export function getClientPlanField(client: any): string {
  return (client?.plan || "").toString().trim()
}

/** The beta site URL from the TED client page (info.betaSiteUrl). */
export async function getClientBetaUrl(
  clientIdOrName: string | number | null | undefined,
): Promise<string | null> {
  const info = await getClientInfo(clientIdOrName)
  return cleanSiteUrl(info?.betaSiteUrl)
}

/** The live/production URL from the TED client page (info.liveSiteUrl). */
export async function getClientLiveUrl(
  clientIdOrName: string | number | null | undefined,
): Promise<string | null> {
  const info = await getClientInfo(clientIdOrName)
  return cleanSiteUrl(info?.liveSiteUrl)
}

/** The HubSpot ID from the TED client page (the client record's hubspotId). */
export async function getClientHubspotId(
  clientIdOrName: string | number | null | undefined,
): Promise<string | null> {
  const client = await getClient(clientIdOrName)
  const id = String(client?.hubspotId ?? "").trim()
  return /^\d+$/.test(id) ? id : null
}

/**
 * Turn the TED `githubRepo` value into a full GitHub URL. TED stores the path
 * after github.com ("owner/repo"); a full github.com URL is accepted as-is.
 * Mirrors how the TED client page builds its "GitHub site URL" link.
 */
export function githubRepoUrl(raw: string | null | undefined): string | null {
  const v = String(raw || "").trim().replace(/\.git$/i, "").replace(/\/+$/, "")
  if (!v) return null
  const path = v
    .replace(/^https?:\/\//i, "")
    .replace(/^(?:www\.)?github\.com\//i, "")
  return /^[\w.-]+\/[\w.-]+/.test(path) ? `https://github.com/${path}` : null
}

/**
 * Find the TED client whose main-page beta/website URL matches `siteUrl` (by
 * host). Lets URL-only runs (e.g. full_scan) recover the client record — and
 * thus the plan/strategist — even when no clientId/name was supplied.
 */
export async function findClientBySiteUrl(
  siteUrl: string | null | undefined,
): Promise<any | null> {
  const host = normalizeHost(siteUrl)
  if (!host) return null
  const idx = await getClientIndex()
  if (!idx) return null
  return (
    idx.list.find(
      (c) =>
        normalizeHost(c?.clientDetails?.betaUrl) === host ||
        normalizeHost(c?.clientDetails?.website) === host,
    ) || null
  )
}

/**
 * Resolve a TED client from the best available handle: the real ted_client_id
 * (preferred), else the project/client name, else — for URL-only runs — a host
 * match against the client record's beta/website URL.
 */
export async function resolveClient(
  clientIdOrName: string | number | null | undefined,
  siteUrl?: string | null,
): Promise<any | null> {
  const byIdOrName = await getClient(clientIdOrName)
  if (byIdOrName) return byIdOrName
  return findClientBySiteUrl(siteUrl)
}

// TED rate-limits the API token (HTTP 429 "Retry after 1s"). A 429 is retried
// (Retry-After, else 1s/2s/3s) so a busy moment never reads as "no data".
const TED_429_RETRIES = 3

async function tedGetJson(pathAndQuery: string): Promise<any | null> {
  const token = process.env.TED_API_TOKEN
  if (!token) return null
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${TED_BASE}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      })
      if (r.status === 429 && attempt < TED_429_RETRIES) {
        const after = Number(r.headers.get("retry-after"))
        await new Promise((res) => setTimeout(res, (after > 0 ? after : attempt + 1) * 1000))
        continue
      }
      if (!r.ok || !(r.headers.get("content-type") || "").includes("application/json")) return null
      return await r.json()
    } catch {
      return null
    }
  }
}

// A client's timeline is read by getClientTimeline() (project_plan,
// paid_media). Same short-TTL treatment as the client list: share one in-flight
// fetch, never cache a failure.
const timelineCache = new Map<string, { at: number; promise: Promise<any | null> }>()

async function tedGetTimeline(clientId: string | number): Promise<any | null> {
  const key = String(clientId)
  const now = Date.now()
  const hit = timelineCache.get(key)
  if (hit && now - hit.at < CLIENTS_TTL_MS) return hit.promise

  const entry = { at: now, promise: tedGetJson(`/clients/${key}/timeline`) }
  timelineCache.set(key, entry)
  const result = await entry.promise
  if (result === null && timelineCache.get(key) === entry) timelineCache.delete(key)
  return result
}

// The client page's overview panel (GET /clients/{id}/info) is read by the
// beta/live/repo getters, often several times in one run. Same short-TTL,
// shared in-flight fetch, failures not cached.
const infoCache = new Map<string, { at: number; promise: Promise<any | null> }>()

async function tedGetInfo(clientId: string | number): Promise<any | null> {
  const key = String(clientId)
  const now = Date.now()
  const hit = infoCache.get(key)
  if (hit && now - hit.at < CLIENTS_TTL_MS) return hit.promise

  const entry = {
    at: now,
    promise: tedGetJson(`/clients/${encodeURIComponent(key)}/info`),
  }
  infoCache.set(key, entry)
  const result = await entry.promise
  if (result === null && infoCache.get(key) === entry) infoCache.delete(key)
  return result
}

// The client's deal summary (GET /clients/{id}/deal-summary): the core plan and
// the add-on chips shown on the TED details tab. Same short-TTL cache.
const dealSummaryCache = new Map<string, { at: number; promise: Promise<any | null> }>()

async function tedGetDealSummary(clientId: string | number): Promise<any | null> {
  const key = String(clientId)
  const now = Date.now()
  const hit = dealSummaryCache.get(key)
  if (hit && now - hit.at < CLIENTS_TTL_MS) return hit.promise

  const entry = {
    at: now,
    promise: tedGetJson(`/clients/${encodeURIComponent(key)}/deal-summary`),
  }
  dealSummaryCache.set(key, entry)
  const result = await entry.promise
  if (result === null && dealSummaryCache.get(key) === entry) dealSummaryCache.delete(key)
  return result
}

/**
 * The TED client page's overview panel (GET /clients/{id}/info) for a client
 * id (preferred) or name. Returns the raw info object, or null.
 */
export async function getClientInfo(
  clientIdOrName: string | number | null | undefined,
): Promise<any | null> {
  const client = await getClient(clientIdOrName)
  const clientId = client?.id
  if (!clientId) return null
  return tedGetInfo(clientId)
}

/** Drop all cached TED reads. Call when a run finishes. */
export function clearTedCaches(): void {
  clearClientCache()
  timelineCache.clear()
  infoCache.clear()
  dealSummaryCache.clear()
}

/**
 * Resolve the client's GitHub repo URL from the TED client page's
 * "GitHub site URL" (info.githubRepo, the path after github.com). Client-agnostic.
 * There is no local fallback repo.
 */
export async function resolveBetaSiteRepo(
  clientIdOrName: string | number | null | undefined,
): Promise<string | null> {
  const info = await getClientInfo(clientIdOrName)
  return githubRepoUrl(info?.githubRepo)
}

// ---------------------------------------------------------------------------
// Timeline reads for the project_plan / paid_media checks.
// TED never populates `automation` in the timeline response (verified across
// clients), so these route on `departmentName` + title, never templateKey.
// ---------------------------------------------------------------------------

export interface TedTask {
  id: string
  title: string
  status?: string
  departmentName?: string
  completed?: boolean
}

/** Fetch a client's timeline. Returns activeTasks ∪ timeline, deduped by id. */
export async function getClientTimeline(
  clientIdOrName: string | number | null | undefined,
): Promise<TedTask[]> {
  const client = await getClient(clientIdOrName)
  const clientId = client?.id
  if (!clientId) return []

  const tl = await tedGetTimeline(clientId)
  if (!tl) return []

  const seen = new Set<string>()
  const out: TedTask[] = []
  for (const t of [...(tl.activeTasks || []), ...(tl.timeline || [])]) {
    const id = String(t?.id ?? "")
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title: t?.title || "",
      status: t?.status || t?.state,
      departmentName: t?.departmentName,
      completed:
        t?.completed === true || /^complete/i.test(String(t?.status || "")),
    })
  }
  return out
}

/** Tasks whose departmentName matches (case-insensitive substring). */
export function tasksByDepartment(tasks: TedTask[], dept: string): TedTask[] {
  const d = dept.toLowerCase()
  return tasks.filter((t) => (t.departmentName || "").toLowerCase().includes(d))
}

export interface ParsedPlan {
  raw: string
  base: string
  addOns: string[]
  hasLeadGen: boolean
}

/** Parse a TED `plan` string like "Growth99 Elite / Lead Generation". */
export function parsePlan(plan: string | null | undefined): ParsedPlan | null {
  if (!plan || !plan.trim()) return null
  const parts = plan
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)
  return {
    raw: plan.trim(),
    base: parts[0] || plan.trim(),
    addOns: parts.slice(1),
    hasLeadGen: /lead\s*generation/i.test(plan),
  }
}

// ---------------------------------------------------------------------------
// Client profile — everything on the TED client details tab
// (ted.growth99.com/v2/dashboard/clients/{id}?tab=details) in one object:
//   • client record (GET /clients): plan, HubSpot ID, onboarding tier, stage, status
//   • info (GET /clients/{id}/info): name, contact, live site, beta, GitHub repo
//   • deal summary (GET /clients/{id}/deal-summary): add-ons (Lead Gen, ADA
//     Basic/Complete, GIA Voice, Social, VIP …) and the deal type
// Built from the cached reads above, so checks can all call it freely.
// ---------------------------------------------------------------------------

export type AdaTier = "basic" | "complete" | "unknown"

export interface TedClientProfile {
  client: any
  info: any | null
  dealSummary: any | null
  /** Client name as TED shows it. */
  name: string
  /** Core plan + add-ons. Add-ons merge the plan text and the deal summary. */
  plan: ParsedPlan | null
  /** Add-on keys from the deal summary ("leadgen", "ada", "gia", "social", …). */
  addOnKeys: string[]
  hasLeadGen: boolean
  hasGia: boolean
  /** ADA add-on tier, or null when the client has no ADA add-on. */
  adaTier: AdaTier | null
  /** Raw ADA source value ("Basic", "Complete", …) for messages. */
  adaRaw: string | null
  contactPhone: string | null
  businessAddress: string | null
  onboardingTier: string | null
  dealType: string | null
  stage: string | null
  status: string | null
  onHold: boolean
}

function adaFromAddon(addon: any): { tier: AdaTier; raw: string } {
  const src = `${addon?.label || ""} ${addon?.sourceField || ""}`
  if (/complete/i.test(src)) return { tier: "complete", raw: "Complete" }
  if (/basic/i.test(src)) return { tier: "basic", raw: "Basic" }
  // The add-on is sold but TED doesn't say which tier (HubSpot may).
  return { tier: "unknown", raw: "tier not set" }
}

/**
 * The client's TED details-tab profile, resolved by ted_client_id (preferred),
 * name, or — for URL-only runs — a host match on `siteUrl`. Null when no TED
 * client matches.
 */
export async function getClientProfile(
  clientIdOrName: string | number | null | undefined,
  siteUrl?: string | null,
): Promise<TedClientProfile | null> {
  const client = await resolveClient(clientIdOrName, siteUrl)
  if (!client?.id) return null
  const [info, dealSummary] = await Promise.all([
    tedGetInfo(client.id),
    tedGetDealSummary(client.id),
  ])

  const addons: any[] = Array.isArray(dealSummary?.addons) ? dealSummary.addons : []
  const addOnKeys = addons.map((a) => String(a?.key || "").toLowerCase()).filter(Boolean)
  const planText = getClientPlanField(client) || String(dealSummary?.plan || "")
  const parsed = parsePlan(planText)
  let plan = parsed
  if (parsed) {
    const labels = addons.map((a) => String(a?.label || "").trim()).filter(Boolean)
    const have = parsed.addOns.map((x) => x.toLowerCase())
    // "Lead Gen" in the deal summary is the plan's "Lead Generation" — don't list it twice.
    const extra = labels.filter((l) => {
      const n = l.toLowerCase()
      if (/lead\s*gen/.test(n)) return !have.some((h) => /lead\s*gen/.test(h))
      if (/social/.test(n)) return !have.some((h) => /social/.test(h))
      return !have.includes(n)
    })
    plan = {
      ...parsed,
      addOns: [...parsed.addOns, ...extra],
      hasLeadGen: parsed.hasLeadGen || addOnKeys.includes("leadgen"),
    }
  }

  const ada = addons.find((a) => String(a?.key || "").toLowerCase() === "ada")
  const adaInfo = ada ? adaFromAddon(ada) : null
  const str = (v: any) => (v == null || String(v).trim() === "" ? null : String(v).trim())

  return {
    client,
    info,
    dealSummary,
    name: str(info?.name) || str(client?.name) || "",
    plan,
    addOnKeys,
    hasLeadGen: !!plan?.hasLeadGen || addOnKeys.includes("leadgen"),
    hasGia: addOnKeys.includes("gia"),
    adaTier: adaInfo?.tier ?? null,
    adaRaw: adaInfo?.raw ?? null,
    contactPhone: str(info?.contactPhone) || str(client?.clientDetails?.contactPhone),
    businessAddress: str(info?.businessAddress) || str(client?.clientDetails?.businessAddress),
    onboardingTier: str(client?.onboardingType),
    dealType: str(dealSummary?.dealType?.label) || str(dealSummary?.dealType?.raw),
    stage: str(client?.clientStage),
    status: str(client?.status),
    onHold: !!str(client?.onHoldReason) || /hold/i.test(String(client?.status || "")),
  }
}

/** One line of client context for reports ("" when there is nothing to say). */
export function profileContextLine(p: TedClientProfile | null): string {
  if (!p) return ""
  const bits = [
    p.onboardingTier && `Onboarding: ${p.onboardingTier}`,
    p.dealType && `Deal: ${p.dealType}`,
    p.stage && `Stage: ${p.stage}`,
    p.onHold && `ON HOLD${p.client?.onHoldReason ? ` (${p.client.onHoldReason})` : ""}`,
    p.hasGia && "GIA add-on",
    p.adaRaw && `ADA: ${p.adaRaw}`,
  ].filter(Boolean)
  return bits.length ? `\n\nClient details (TED): ${bits.join(" · ")}.` : ""
}
