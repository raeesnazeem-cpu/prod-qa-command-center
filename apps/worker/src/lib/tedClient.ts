/**
 * Minimal worker-side TED client reader.
 *
 * The API app parses client notes in webhooks.ts (resolveClientNotesSiteUrlFromTED),
 * but that is not exported/shared. This lib gives worker-side checks (GBP,
 * Review & Reputation) read access to a TED client + its clientDetails.notes,
 * using the TED_API_TOKEN already present in the worker environment.
 *
 * Read-only: only GET /api/clients. No writes.
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

/** Fetch a single TED client by id (preferred) or name (case-insensitive). */
export async function getClient(
  clientIdOrName: string | number | null | undefined,
): Promise<any | null> {
  const token = process.env.TED_API_TOKEN
  if (!token || clientIdOrName == null) return null

  try {
    const r = await fetch(`${TED_BASE}/clients`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })
    if (!r.ok || !(r.headers.get("content-type") || "").includes("application/json")) {
      return null
    }
    const body: any = await r.json()
    const list: any[] = Array.isArray(body)
      ? body
      : body?.clients || body?.data || body?.items || []

    const wantId = String(clientIdOrName).trim()
    const wantName = wantId.toLowerCase()
    return (
      list.find((c) => String(c?.id) === wantId) ||
      list.find((c) => (c?.name || "").toLowerCase().trim() === wantName) ||
      list.find((c) => (c?.name || "").toLowerCase().includes(wantName)) ||
      null
    )
  } catch {
    return null
  }
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
 * The client's website domain — the join key into HubSpot. Prefers the explicit
 * clientDetails.website, then the "Client Domain/Website URL: …" line in notes,
 * then any bare domain in the notes. Returns a bare host (no scheme/path).
 */
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

export async function getClientDomain(
  clientIdOrName: string | number | null | undefined,
): Promise<string | null> {
  const client = await getClient(clientIdOrName)
  if (!client) return null
  return (
    extractDomain(client?.clientDetails?.website) ||
    extractDomain(stripHtml(client?.clientDetails?.notes || ""))
  )
}

async function tedGetJson(pathAndQuery: string): Promise<any | null> {
  const token = process.env.TED_API_TOKEN
  if (!token) return null
  try {
    const r = await fetch(`${TED_BASE}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })
    if (!r.ok || !(r.headers.get("content-type") || "").includes("application/json")) return null
    return await r.json()
  } catch {
    return null
  }
}

/**
 * Resolve the beta site's GitHub repo for a client. Mirrors the betaSiteUrl
 * resolution: timeline → beta_site.env task → automation.payload has a
 * `betaSiteRepo=<url>` token right next to `betaSiteUrl=`. Client-agnostic.
 * See [[ted-beta-site-url-resolution]].
 */
export async function resolveBetaSiteRepo(
  clientIdOrName: string | number | null | undefined,
): Promise<string | null> {
  const client = await getClient(clientIdOrName)
  const clientId = client?.id
  if (!clientId) return null

  // Repo always comes from the beta_site.env task — its automation.payload
  // (betaSiteRepo=…) or a "GitHub repo: …" comment on that task. HubSpot is NOT
  // a repo source (it supplies site URL / plan / GBP / paid-media data — see
  // hubspotClient.ts). There is no local fallback repo.
  return await repoFromTedTimeline(clientId)
}

/**
 * Concatenate a TED task's comment bodies into one searchable string. The repo
 * (and URL) may be written in the automation.payload OR typed as a comment on
 * the task page, so resolvers search both. Tolerates the several shapes the
 * comments endpoint may return; returns "" on any miss.
 */
export async function tedTaskCommentsText(
  taskId: string | number,
): Promise<string> {
  const c = await tedGetJson(`/tasks/${taskId}/comments`)
  const arr: any[] = Array.isArray(c)
    ? c
    : c?.comments || c?.data || c?.items || []
  if (!Array.isArray(arr)) return ""
  return arr
    .map((x: any) =>
      typeof x === "string"
        ? x
        : x?.text || x?.body || x?.content || x?.comment || "",
    )
    .filter(Boolean)
    .join("\n")
}

/**
 * The TED path: timeline → beta_site.env task → `betaSiteRepo=<url>`, read from
 * the automation.payload first and, failing that, from the task's comments.
 */
async function repoFromTedTimeline(
  clientId: string | number,
): Promise<string | null> {
  const timeline = await tedGetJson(`/clients/${clientId}/timeline`)
  if (!timeline) return null

  // Prefer activeTasks (carry automation.templateKey); else timeline title match.
  const active = (timeline.activeTasks || []).find(
    (t: any) => (t?.automation?.templateKey || "").toLowerCase() === "beta_site.env",
  )
  const byTitle = (timeline.timeline || []).find((t: any) =>
    /create beta site environment/i.test(t?.title || ""),
  )
  const taskId = active?.id || byTitle?.id
  if (!taskId) return null

  const task = await tedGetJson(`/tasks/${taskId}`)
  const payload = task?.automation?.payload || task?.task?.automation?.payload
  const payloadText =
    typeof payload === "string" ? payload : payload ? JSON.stringify(payload) : ""

  // Payload first, then the task's comments (the URL/repo is sometimes typed as
  // a comment rather than baked into the payload).
  // Stop the capture at whitespace, quotes, or angle brackets so a repo typed as
  // an HTML anchor (<a href="https://…">https://…</a>) in a comment/payload yields
  // just the URL — not the surrounding markup, which would otherwise leak into the
  // report as half-eaten HTML.
  const matchRepo = (text: string) => {
    const m = text.match(/betaSiteRepo=([^\s"'<>]+)/i)
    if (m) return m[1].replace(/[),.;]+$/, "")
    // Also accept a bare GitHub URL written in a comment ("repo: https://…").
    const g = text.match(/https?:\/\/(?:www\.)?github\.com\/[^\s"'<>]+/i)
    return g ? g[0].replace(/[),.;]+$/, "") : null
  }

  const fromPayload = payloadText ? matchRepo(payloadText) : null
  if (fromPayload) return fromPayload

  const commentsText = await tedTaskCommentsText(taskId)
  return commentsText ? matchRepo(commentsText) : null
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

  const tl = await tedGetJson(`/clients/${clientId}/timeline`)
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
