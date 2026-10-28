// =====================================================================
// TED read helpers for the webhook flows.
//
// • tedGetJson        — every TED GET goes through here. TED rate-limits the
//                       API token (HTTP 429 "Retry after 1s"); a 429 is retried
//                       instead of being read as "no data" (which used to cancel
//                       scans with "no beta site URL").
// • getTedClientProfile — the client details tab (ted.growth99.com/v2/dashboard/
//                       clients/{id}?tab=details): GET /api/clients/{id}/info
//                       (live site, beta preview, GitHub repo, contact) plus
//                       GET /api/clients/{id}/deal-summary (core plan + add-ons).
//                       Fetched once per client and reused for a short window,
//                       so one trigger no longer reads /info two or three times.
// • findTaskIdByTemplateKey — the client's task for a template key. TED's
//                       timeline no longer carries automation.templateKey, so
//                       candidates come from titles; subtasks are skipped.
// • pickReleasedUrl   — the released URL on the launch task, without grabbing
//                       unrelated links (GitHub, beta, QACC report links).
// =====================================================================

export const TED_BASE = "https://ted.growth99.com"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// GET a TED API path and return the parsed JSON, or null on any miss. TED's SSR
// answers unknown routes with HTML 200, so only a JSON body counts. A 429 is
// retried (up to `retries` times) after Retry-After, else 1s, 2s, 3s.
export async function tedGetJson(
  path: string,
  opts: { retries?: number; label?: string } = {},
): Promise<any | null> {
  const apiToken = process.env.TED_API_TOKEN
  if (!apiToken) return null
  const url = path.startsWith("http") ? path : `${TED_BASE}${path}`
  const retries = opts.retries ?? 3
  for (let attempt = 0; ; attempt++) {
    let r: globalThis.Response
    try {
      r = await fetch(url, {
        headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      })
    } catch (err) {
      console.error(`❌ TED ${opts.label || url} request failed:`, err)
      return null
    }
    if (r.status === 429 && attempt < retries) {
      const after = Number(r.headers.get("retry-after"))
      const waitMs = (after > 0 ? after : attempt + 1) * 1000
      console.log(`⏳ TED rate limit on ${opts.label || url} — retrying in ${waitMs}ms.`)
      await sleep(waitMs)
      continue
    }
    const ct = r.headers.get("content-type") || ""
    if (!r.ok || !ct.includes("application/json")) {
      console.error(
        `❌ TED ${opts.label || url} did not return JSON (HTTP ${r.status}, content-type "${ct}").`,
      )
      return null
    }
    return r.json().catch(() => null)
  }
}

// ---------------------------------------------------------------------------
// Client profile
// ---------------------------------------------------------------------------

export type TedClientProfile = {
  clientId: string
  info: any | null
  dealSummary: any | null
}

const PROFILE_TTL_MS = 2 * 60 * 1000
const profileCache = new Map<string, { at: number; promise: Promise<TedClientProfile | null> }>()

// The client's details-tab data. Returns null when /info can't be read. Only
// successful reads are cached, so a failed read is retried on the next call.
export function getTedClientProfile(
  clientId: string | number | null | undefined,
): Promise<TedClientProfile | null> {
  if (clientId == null || String(clientId).trim() === "") return Promise.resolve(null)
  const id = String(clientId).trim()
  const hit = profileCache.get(id)
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.promise

  const enc = encodeURIComponent(id)
  const promise = (async () => {
    const [info, dealSummary] = await Promise.all([
      tedGetJson(`/api/clients/${enc}/info`, { label: `client ${id} info` }),
      tedGetJson(`/api/clients/${enc}/deal-summary`, { label: `client ${id} deal-summary` }),
    ])
    if (!info) return null
    return { clientId: id, info, dealSummary }
  })()
  profileCache.set(id, { at: Date.now(), promise })
  promise.then((p) => {
    if (!p && profileCache.get(id)?.promise === promise) profileCache.delete(id)
  })
  return promise
}

export function clearTedClientProfileCache(): void {
  profileCache.clear()
}

// ---------------------------------------------------------------------------
// Task lookup by template key
// ---------------------------------------------------------------------------

// Subtasks are never a template-key target. TED gives some subtasks a "sub_"
// id and all of them a parentId.
function isSubtask(t: any): boolean {
  return String(t?.id ?? "").startsWith("sub_") || (t?.parentId != null && t.parentId !== "")
}

// The client's task id for `templateKey`, verified via GET /api/tasks/{id}.
// Candidates: activeTasks that still carry the key, then top-level tasks whose
// title matches `titleRegex`. Stops at the first verified match.
export async function findTaskIdByTemplateKey(
  clientId: string | number | null | undefined,
  templateKey: string,
  titleRegex: RegExp,
): Promise<string | null> {
  if (clientId == null || !process.env.TED_API_TOKEN) return null
  const tl = await tedGetJson(`/api/clients/${encodeURIComponent(String(clientId))}/timeline`, {
    label: `client ${clientId} timeline`,
  })
  if (!tl) return null

  const ids: string[] = []
  const add = (t: any) => {
    const id = t?.id != null ? String(t.id) : ""
    if (id && !isSubtask(t) && !ids.includes(id)) ids.push(id)
  }
  const all = [...(tl.activeTasks || []), ...(tl.timeline || [])]
  for (const t of all) if (String(t?.automation?.templateKey || "") === templateKey) add(t)
  for (const t of all) if (titleRegex.test(t?.title || "")) add(t)

  if (!ids.length) {
    console.log(`⚠️ No task matching templateKey "${templateKey}" found in client ${clientId}'s timeline.`)
    return null
  }
  for (const id of ids) {
    const task = await tedGetJson(`/api/tasks/${encodeURIComponent(id)}`, { label: `task ${id}` })
    if (String(task?.automation?.templateKey || "") === templateKey) {
      console.log(`✅ Resolved "${templateKey}" task from TED: #${id}`)
      return id
    }
  }
  console.log(`⚠️ None of ${ids.length} candidate task(s) carry templateKey "${templateKey}" (client ${clientId}).`)
  return null
}

// ---------------------------------------------------------------------------
// Released URL on the launch task
// ---------------------------------------------------------------------------

export function hostOf(u: string | null | undefined): string {
  if (!u) return ""
  let s = String(u).trim()
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    return new URL(s).host.replace(/^www\./i, "").toLowerCase()
  } catch {
    return ""
  }
}

// Links that are never the released site: code hosts, beta/staging hosts,
// Growth99/TED/QACC tooling.
const NOT_A_RELEASED_SITE = /(^|\.)(github\.com|gogroth\.com|growth99\.com|growth99\.net|raees\.dev|basecamp\.com|google\.com|hubspot\.com|userway\.org)$/i

function cleanUrl(raw: string): string | null {
  let url = raw.trim().replace(/<[^>]*$/, "").replace(/[.,;)"'\]]+$/, "")
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  return /\.[a-z]{2,}/i.test(hostOf(url)) ? url : null
}

// Pick the released URL from the launch task's payload/comments text.
//   1. a keyed token (releaseUrl=…, liveSiteUrl=…)
//   2. a labelled line ("Live URL: …", "Released URL - …", "Website: …")
//   3. a bare URL on the client's live domain (`liveHost`, from the details tab)
// Never "the first link anywhere": that picked up GitHub, beta and report links.
export function pickReleasedUrl(text: string, liveHost?: string | null): string | null {
  if (!text) return null
  const plain = text.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
  const ok = (u: string | null) => !!u && !NOT_A_RELEASED_SITE.test(hostOf(u))

  const keyed = plain.match(
    /(?:releaseUrl|releasedUrl|liveUrl|liveSiteUrl|siteUrl|productionUrl|prodUrl|domainUrl|websiteUrl)=(\S+)/i,
  )
  const k = keyed ? cleanUrl(keyed[1]) : null
  if (ok(k)) return k

  const labelRe =
    /(?:released?|live|production|prod|website|site|domain)(?:\s+(?:site|website))?\s*(?:url|link|domain)?\s*[:\-–]\s*((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<]*)/gi
  for (const m of plain.matchAll(labelRe)) {
    const u = cleanUrl(m[1])
    if (ok(u)) return u
  }

  const want = (liveHost || "").replace(/^www\./i, "").toLowerCase()
  if (want) {
    for (const m of plain.matchAll(/https?:\/\/[^\s<"']+/gi)) {
      const u = cleanUrl(m[0])
      if (u && hostOf(u) === want) return u
    }
  }
  return null
}
