import axios from "axios"
import { decrypt } from "@qacc/shared/encryption"
import { supabase } from "./supabase"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

/**
 * Basecamp source for the Growth99 reviews-widget embed.
 *
 * The per-client widget id/bid are dynamic and can't be read off a site that is
 * missing the widget, so the Project Plan fix resolves them here:
 *   1. Read the project's Basecamp creds from project_settings (token encrypted
 *      at rest, account id, and — if linked — the bucket/project id).
 *   2. Resolve the Basecamp project: the stored basecamp_project_id, else match
 *      a project by name (projects.name == the QACC/TED client name).
 *   3. In that project's MESSAGE BOARD, find the message titled "Review and
 *      Reputation Code" (e.g. "06. Review And Reputation Code").
 *   4. Under its "Website Configuration Code" (the FIRST reviews.growth99.com
 *      widget URL — the ReviewsWidget iframe; the second is the Button code,
 *      which we ignore) extract { id, bid }.
 * Returns null on any miss — the caller then falls back / marks "review code not
 * found". All network is best-effort and non-fatal.
 */

// Same embed shape the fix writes / the check detects.
const WIDGET_RE =
  /reviews\.growth99\.com\/widget\/?\?id=([A-Za-z0-9_-]+)(?:&(?:amp;)?bid=(\d+))?/i
const LABEL_ID_RE = /Reviews?\s*Widget\s*(?:ID|Id)\s*[:\-]\s*([A-Za-z0-9_-]{8,})/i
const LABEL_BID_RE = /\bbid\s*[:\-=]\s*(\d+)/i

// The to-do list / to-do that holds the code.
const TARGET = "review and reputation code"
const TARGET_LOOSE = "review and reputation"

const UA = "QACC (raees.nazeem@growth99.com)"
const norm = (s: any) =>
  String(s || "").toLowerCase().replace(/\s+/g, " ").trim()

/**
 * Decode HTML entities so code PASTED into a Basecamp message (stored escaped:
 * `<` → `&lt;`, `&` → `&amp;`, etc.) is recovered as the literal markup. `&amp;`
 * is decoded LAST so a double-escaped `&amp;lt;` collapses correctly.
 */
function decodeHtmlEntities(s: string): string {
  return String(s || "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x0*2f;/gi, "/")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#0*(\d+);/g, (m, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 10))
      } catch {
        return m
      }
    })
    .replace(/&amp;/gi, "&")
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": UA,
    "Content-Type": "application/json",
    Accept: "application/json",
  }
}

async function bcGet(url: string, token: string): Promise<any> {
  const { data } = await axios.get(url, { headers: headers(token), timeout: 20000 })
  return data
}

/** Extract { id, bid } from any HTML/text blob (embed URL, else labelled line). */
export function extractWidget(html: string | null | undefined): { id: string; bid: string } | null {
  if (!html) return null
  const s = String(html)
  const url = s.match(WIDGET_RE)
  if (url && url[1]) return { id: url[1], bid: url[2] || "" }
  const idLine = s.match(LABEL_ID_RE)
  if (idLine && idLine[1]) {
    const bid = s.match(LABEL_BID_RE)
    return { id: idLine[1], bid: bid ? bid[1] : "" }
  }
  return null
}

/** Follow ?page pagination for a list endpoint, capped so we never spin. */
async function fetchAllPages(url: string, token: string, maxPages = 5): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= maxPages; page++) {
    const sep = url.includes("?") ? "&" : "?"
    const data = await bcGet(`${url}${sep}page=${page}`, token).catch(() => null)
    if (!Array.isArray(data) || data.length === 0) break
    out.push(...data)
    if (data.length < 15) break // Basecamp pages are ~15; short page = last page
  }
  return out
}

/** List projects and match one by name (exact, else contains). Returns bucket id. */
async function matchProjectByName(
  apiBase: string,
  token: string,
  projectName: string,
): Promise<string | null> {
  const want = norm(projectName)
  if (!want) return null
  const projects = await fetchAllPages(`${apiBase}/projects.json`, token).catch(() => [])
  let contains: any = null
  for (const p of projects) {
    const n = norm(p?.name)
    if (n === want) return String(p.id)
    if (!contains && n && (n.includes(want) || want.includes(n))) contains = p
  }
  return contains ? String(contains.id) : null
}

/** Resolve { apiBase, token, bucketId } for a project, or null. */
async function resolveBucket(
  projectId: string | null | undefined,
  projectName?: string | null,
): Promise<{ apiBase: string; token: string; bucketId: string } | null> {
  if (!projectId) return null
  const { data: settings } = await supabase
    .from("project_settings")
    .select("basecamp_token_encrypted, basecamp_account_id, basecamp_project_id")
    .eq("project_id", projectId)
    .single()
  if (!settings?.basecamp_token_encrypted || !settings?.basecamp_account_id) {
    logger.info({ projectId }, "Basecamp: no creds on project_settings")
    return null
  }
  let token: string
  try {
    token = decrypt(settings.basecamp_token_encrypted)
  } catch (e: any) {
    logger.warn({ error: e.message }, "Basecamp: token decrypt failed")
    return null
  }
  const apiBase = `https://3.basecampapi.com/${settings.basecamp_account_id}`
  let bucketId = settings.basecamp_project_id ? String(settings.basecamp_project_id) : null
  if (!bucketId && projectName) {
    bucketId = await matchProjectByName(apiBase, token, projectName).catch(() => null)
  }
  if (!bucketId) {
    logger.info({ projectId, projectName }, "Basecamp: could not resolve project bucket")
    return null
  }
  return { apiBase, token, bucketId }
}

/**
 * Fetch the raw HTML (body + full body + comments) of the Message Board message
 * whose subject matches `loose` (prefers `exact` when several match). Generic —
 * used for review/VC/cliffhanger codes. Returns "" on any miss.
 */
export async function getMessageBoardHtml(
  projectId: string | null | undefined,
  projectName: string | null | undefined,
  loose: string,
  exact?: string,
): Promise<string> {
  try {
    const b = await resolveBucket(projectId, projectName)
    if (!b) return ""
    const { apiBase, token, bucketId } = b
    const bucket = await bcGet(`${apiBase}/buckets/${bucketId}.json`, token)
    const boardTool = (bucket?.dock || []).find(
      (t: any) => t?.title === "Message Board" || t?.url?.includes("/message_boards/"),
    )
    if (!boardTool?.url) return ""
    const board = await bcGet(boardTool.url, token).catch(() => null)
    const messagesUrl = board?.messages_url || boardTool.url.replace(/\.json$/, "/messages.json")
    const messages = await fetchAllPages(messagesUrl, token).catch(() => [])
    const wantLoose = norm(loose)
    const wantExact = exact ? norm(exact) : ""
    const candidates = messages
      .filter((m: any) => norm(m?.subject).includes(wantLoose))
      .sort(
        (a: any, b2: any) =>
          Number(wantExact && norm(b2?.subject).includes(wantExact)) -
          Number(wantExact && norm(a?.subject).includes(wantExact)),
      )
    for (const message of candidates) {
      const chunks: string[] = [String(message?.content || "")]
      const full = message?.url ? await bcGet(message.url, token).catch(() => null) : null
      if (full?.content) chunks.push(String(full.content))
      const commentsUrl =
        message?.comments_url ||
        full?.comments_url ||
        `${apiBase}/buckets/${bucketId}/recordings/${message.id}/comments.json`
      const comments = await fetchAllPages(commentsUrl, token).catch(() => [])
      for (const c of comments) chunks.push(String(c?.content || ""))
      const html = chunks.filter(Boolean).join("\n")
      if (html.trim()) {
        logger.info({ projectId, subject: message?.subject }, "Basecamp: message found")
        return html
      }
    }
    return ""
  } catch (e: any) {
    logger.warn({ error: e.message }, "Basecamp message lookup failed (non-fatal)")
    return ""
  }
}

export async function getReviewsWidgetFromBasecamp(
  projectId: string | null | undefined,
  projectName?: string | null,
): Promise<{ id: string; bid: string } | null> {
  const html = await getMessageBoardHtml(projectId, projectName, TARGET_LOOSE, TARGET)
  return extractWidget(html)
}

/**
 * Chatbot + Virtual Consultation install codes from Basecamp Message Board.
 *   • Cliff Hanger Code (enables the chatbot + launcher buttons):
 *       chatbot.growth99.com/assets/js/integration.js  +  data-id="<bid>"
 *   • Virtual Consultation Code:
 *       app.growth99.com/assets/static/composer.html?bid=<bid>&fid=<fid>
 * Returns the identifying markers to look for in the site's page source.
 */
export async function getChatbotConsultationCodes(
  projectId: string | null | undefined,
  projectName?: string | null,
): Promise<{
  cliffhanger: { found: boolean; scriptSrc: string; businessId: string }
  vc: { found: boolean; composer: string; bid: string; fid: string }
}> {
  const [cliffHtml, vcHtml] = await Promise.all([
    getMessageBoardHtml(projectId, projectName, "cliff hanger", "cliff hanger code"),
    getMessageBoardHtml(projectId, projectName, "virtual consultation", "virtual consultation code"),
  ])

  const scriptSrc = (cliffHtml.match(/https?:\/\/chatbot\.growth99\.com\/assets\/js\/integration\.js/i) || [""])[0]
  const businessId = (cliffHtml.match(/data-id=["']?(\d+)/i) || [null, ""])[1] || ""

  const composer = (vcHtml.match(/https?:\/\/app\.growth99\.com\/assets\/static\/composer\.html[^"'<> ]*/i) || [""])[0]
  const vcBid = (vcHtml.match(/[?&](?:amp;)?bid=(\d+)/i) || [null, ""])[1] || ""
  const vcFid = (vcHtml.match(/[?&](?:amp;)?fid=(\d+)/i) || [null, ""])[1] || ""

  return {
    cliffhanger: { found: !!scriptSrc || !!businessId, scriptSrc, businessId },
    vc: { found: !!composer || !!vcFid, composer, bid: vcBid, fid: vcFid },
  }
}

/**
 * Growth99 contact-form embed from the Basecamp Message Board.
 *
 * The client's Basecamp Message Board carries a "G99+ Contact Form Code" message
 * with the exact embed to use (the markup differs PER project — host, ids, and
 * shape all vary). We resolve the Basecamp project by the TED project name, read
 * that message, and return the code EXACTLY as pasted there (verbatim <script>/
 * <iframe> block, entity-decoded) — never a rebuilt template. `snippet` is what
 * QACC suggests, unchanged, for the developer to place on every page's contact
 * section. `bid`/`fid` are surfaced for logging only. found:false when no such
 * message exists or it carries no recoverable code.
 */
export async function getContactFormCodeFromBasecamp(
  projectId: string | null | undefined,
  projectName?: string | null,
): Promise<{ found: boolean; snippet: string; bid: string; fid: string; iframeSrc: string }> {
  const html = await getMessageBoardHtml(
    projectId,
    projectName,
    "contact form",
    "contact form code",
  )
  // Recover the code EXACTLY as pasted into the message: Basecamp stores pasted
  // markup HTML-escaped, so decode entities first, then lift the verbatim embed.
  // We suggest THIS code unchanged — never a rebuilt template — so whatever embed
  // shape the project actually uses is exactly what QACC hands back.
  const decoded = decodeHtmlEntities(String(html))
  // Verbatim <script>/<iframe> block(s), in the order they appear in the message.
  let snippet = (
    decoded.match(
      /<script\b[^>]*>[\s\S]*?<\/script>|<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,
    ) || []
  )
    .map((s) => s.trim())
    .join("\n")
    .trim()
  // Fallback: some projects paste the code inside a <pre>/<code> block with no
  // real tags left after decode — take that block's text verbatim.
  if (!snippet) {
    const pre = decoded.match(/<(?:pre|code)\b[^>]*>([\s\S]*?)<\/(?:pre|code)>/i)
    if (pre) snippet = pre[1].replace(/<[^>]+>/g, "").trim()
  }
  const bid = (decoded.match(/[?&]bid=(\d+)/i) || [null, ""])[1] || ""
  const fid = (decoded.match(/[?&]fid=(\d+)/i) || [null, ""])[1] || ""
  const iframeSrc =
    (decoded.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/i) || [null, ""])[1] || ""
  // Found only when we actually recovered code to suggest — never a fabricated one.
  const found = !!snippet
  return { found, snippet, bid, fid, iframeSrc }
}

/**
 * Growth99 single-script embed (the "G99+ Cliff Hanger Code") from the Basecamp
 * Message Board. Same message QACC reads for the chatbot, returned here as the
 * reconstructed site-wide loader snippet so the fix can inject it into the footer:
 *   <div id="buisness-id" data-id="<bid>"></div>
 *   <script id="integration-script" src="https://chatbot.growth99.com/assets/js/integration.js"></script>
 * The data-id (business id) differs per client. Returns found:false on a miss.
 */
export async function getSingleScriptCodeFromBasecamp(
  projectId: string | null | undefined,
  projectName?: string | null,
): Promise<{ found: boolean; businessId: string; scriptSrc: string; snippet: string }> {
  const html = await getMessageBoardHtml(
    projectId,
    projectName,
    "cliff hanger",
    "cliff hanger code",
  )
  const dec = String(html).replace(/&amp;/gi, "&")
  const scriptSrc =
    (dec.match(/https?:\/\/chatbot\.growth99\.com\/assets\/js\/integration\.js/i) || [""])[0] ||
    "https://chatbot.growth99.com/assets/js/integration.js"
  const businessId = (dec.match(/data-id=["']?(\d+)/i) || [null, ""])[1] || ""
  const found = /chatbot\.growth99\.com\/assets\/js\/integration\.js/i.test(dec) || !!businessId
  const snippet = found
    ? `<div id="buisness-id" data-id="${businessId}"></div><script id="integration-script" src="${scriptSrc}"></script>`
    : ""
  return { found, businessId, scriptSrc, snippet }
}
