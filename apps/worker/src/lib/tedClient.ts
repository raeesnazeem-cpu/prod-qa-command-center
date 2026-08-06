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
  if (!payload) return null

  const text = typeof payload === "string" ? payload : JSON.stringify(payload)
  const m = text.match(/betaSiteRepo=(\S+)/i)
  return m ? m[1].replace(/[),.;]+$/, "") : null
}
