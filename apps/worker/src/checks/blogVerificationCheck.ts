import { Finding } from "@qacc/shared"
import { supabase } from "../lib/supabase"
import { getClientDomain } from "../lib/tedClient"
import { DESKTOP_UA } from "../lib/browserContext"

/**
 * Blog Verification check.
 * ------------------------
 * Confirms the beta site's blog posts match the client's LIVE site before
 * release. Login-free — reads the public WordPress REST API (`wp/v2/posts`) on
 * both sites. A site that is not WordPress (or has REST disabled) falls back to
 * its RSS / Atom feed, then to blog-post URLs in its sitemap — so a client
 * moving from Squarespace / Wix / Shopify / Webflow to WordPress still compares.
 *
 * Outcomes (each posts to the "Blog" pre-release subtask, which is then closed):
 *   1. Beta site has NO blog posts        → FAIL "No blogs found" (no fix).
 *   2. Beta has blogs but we can't compare → FAIL "Blogs found but no mention of
 *      the client's live site to compare it to" (no live URL in the client
 *      notes, or the live site has no detectable blog).
 *   3. Beta has blogs, live has blogs, and EVERY live blog is present on beta
 *      → PASS.
 *   4. Beta is missing some of the live site's blogs → FAIL. Fix: copy over the
 *      missing blog posts manually.
 *
 * check_factor: "blog_verification"
 */
const CHECK_FACTOR = "blog_verification"

interface BlogPost {
  title: string
  slug: string
  link: string
}

/** origin (scheme+host) of a URL, tolerant of a bare domain or trailing slash. */
function originOf(raw: string): string {
  const s = (raw || "").trim()
  if (!s) return ""
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).origin
  } catch {
    return s.replace(/\/+$/, "")
  }
}

/** Comparable form of a post title: entity-stripped, alphanumeric-only, lower. */
function normTitle(raw: string): string {
  return String(raw || "")
    .replace(/&[a-z#0-9]+;/gi, " ") // decode-away HTML entities
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

const FETCH_TIMEOUT_MS = 20000
const MAX_REST_PAGES = 10

/** GET a URL as text with a real browser UA and a hard timeout. Never throws. */
async function fetchText(url: string, accept = "*/*"): Promise<{ ok: boolean; ctype: string; text: string; headers: Headers | null }> {
  try {
    const resp = await fetch(url, {
      headers: { Accept: accept, "User-Agent": DESKTOP_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const text = resp.ok ? await resp.text() : ""
    return { ok: resp.ok, ctype: resp.headers.get("content-type") || "", text, headers: resp.headers }
  } catch {
    return { ok: false, ctype: "", text: "", headers: null }
  }
}

/** Minimal XML entity / CDATA decode for feed and sitemap text. */
function xmlText(raw: string): string {
  return String(raw || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .trim()
}

/** Last non-empty path segment of a URL — a post's slug. */
function slugOf(link: string): string {
  try {
    return new URL(link).pathname.split("/").filter(Boolean).pop() || ""
  } catch {
    return ""
  }
}

/**
 * Fetch published blog posts via the public WP REST API (all pages, capped).
 * Returns the posts, or `null` when the endpoint is unreachable / not JSON
 * (can't tell "no blog" apart from "REST disabled" — the caller decides).
 * Tries pretty-permalink `/wp-json/` first, then `?rest_route=` for sites on
 * plain permalinks.
 */
async function fetchWpPosts(origin: string): Promise<BlogPost[] | null> {
  const bases = [`${origin}/wp-json/wp/v2/posts?`, `${origin}/?rest_route=/wp/v2/posts&`]
  for (const base of bases) {
    const all: BlogPost[] = []
    let ok = false
    for (let page = 1; page <= MAX_REST_PAGES; page++) {
      const r = await fetchText(`${base}per_page=100&page=${page}&_fields=title,slug,link&status=publish`, "application/json")
      if (!r.ok || !r.ctype.includes("json")) break
      let json: any
      try {
        json = JSON.parse(r.text)
      } catch {
        break
      }
      if (!Array.isArray(json)) break
      ok = true
      for (const p of json)
        all.push({
          title: p?.title?.rendered ?? p?.title ?? "",
          slug: String(p?.slug || ""),
          link: String(p?.link || ""),
        })
      const totalPages = Number(r.headers?.get("x-wp-totalpages") || "1")
      if (json.length < 100 || page >= totalPages) break
    }
    if (ok) return all
  }
  return null
}

/** Parse RSS <item> / Atom <entry> posts. `null` when the text is not a feed. */
function parseFeed(xml: string): BlogPost[] | null {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) return null
  const out: BlogPost[] = []
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || []
  for (const b of blocks) {
    const title = xmlText(b.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    const link =
      xmlText(b.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "") ||
      b.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ||
      ""
    if (title || link) out.push({ title, slug: slugOf(link), link })
  }
  return out
}

/**
 * RSS / Atom feed: the homepage's advertised feed first, then the usual paths
 * per platform (WordPress, Squarespace, Wix, Shopify, Ghost / Hugo / static).
 */
async function fetchFeedPosts(origin: string): Promise<BlogPost[] | null> {
  const candidates: string[] = []
  const home = await fetchText(`${origin}/`, "text/html")
  if (home.ok) {
    for (const m of home.text.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0]
      if (!/rel=["']?alternate/i.test(tag) || !/application\/(rss|atom)\+xml/i.test(tag)) continue
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
      if (!href || /comments/i.test(href)) continue
      try {
        candidates.push(new URL(href.replace(/&amp;/g, "&"), `${origin}/`).href)
      } catch {}
    }
  }
  for (const p of ["/feed/", "/blog/feed/", "/blog-feed.xml", "/blog?format=rss", "/blogs/news.atom", "/rss.xml", "/feed.xml", "/atom.xml", "/blog/rss.xml", "/rss/", "/index.xml"])
    candidates.push(`${origin}${p}`)
  for (const url of [...new Set(candidates)].slice(0, 14)) {
    const r = await fetchText(url, "application/rss+xml, application/atom+xml, application/xml, text/xml")
    if (!r.ok) continue
    const posts = parseFeed(r.text)
    if (posts) return posts
  }
  return null
}

// A post-style URL: /blog/<slug>, /news/<slug>, /post/<slug> (Wix),
// /blogs/<blog>/<slug> (Shopify), /YYYY/MM/<slug>. Listing pages are excluded.
const POST_URL_RE = /\/(blog|blogs|news|post|posts|articles?|journal|insights|stories)\/[^?#]+|\/(19|20)\d{2}\/\d{1,2}\/[^/?#]+/i
const LISTING_RE = /\/(category|categories|tag|tags|author|page)\/|\/feed\/?$/i

/**
 * Blog posts listed in the sitemap. `null` when no sitemap is readable OR it
 * lists no post-style URLs — a sitemap is not proof the site has no blog (its
 * posts may live at the root), so that stays "could not tell".
 */
async function fetchSitemapPosts(origin: string): Promise<BlogPost[] | null> {
  const locs = (xml: string) => Array.from(xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)).map((m) => xmlText(m[1]))
  let root: string[] = []
  for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    const r = await fetchText(`${origin}${p}`, "application/xml, text/xml")
    if (r.ok && /<(urlset|sitemapindex)\b/i.test(r.text)) {
      root = /<sitemapindex\b/i.test(r.text) ? locs(r.text).map((u) => `sitemap:${u}`) : locs(r.text)
      break
    }
  }
  if (!root.length) return null
  // A sitemap index: read the post / blog child sitemaps first (capped).
  let urls = root.filter((u) => !u.startsWith("sitemap:"))
  const children = root.filter((u) => u.startsWith("sitemap:")).map((u) => u.slice(8))
  const ordered = [...children.filter((u) => /post|blog|article|news/i.test(u)), ...children.filter((u) => !/post|blog|article|news/i.test(u))]
  for (const child of ordered.slice(0, 6)) {
    const r = await fetchText(child, "application/xml, text/xml")
    if (r.ok) urls = urls.concat(locs(r.text))
  }
  const posts = urls
    .filter((u) => POST_URL_RE.test(u) && !LISTING_RE.test(u))
    .map((u) => {
      const slug = slugOf(u)
      // No title in a sitemap; the slug normalises to the same key a title does
      // ("my-first-post" ~ "My First Post"), so compare on that.
      return { title: slug.replace(/[-_]+/g, " "), slug, link: u }
    })
    .filter((p) => p.slug)
  return posts.length ? posts : null
}

/**
 * Blog posts from whichever source the site exposes, most precise first.
 * `null` = no source could be read, so the caller cannot tell "no blog".
 */
async function fetchPosts(origin: string): Promise<{ posts: BlogPost[]; via: string } | null> {
  if (!origin) return null
  const wp = await fetchWpPosts(origin)
  if (wp) return { posts: wp, via: "WordPress REST API" }
  const feed = await fetchFeedPosts(origin)
  if (feed) return { posts: feed, via: "RSS/Atom feed" }
  const map = await fetchSitemapPosts(origin)
  if (map) return { posts: map, via: "sitemap" }
  return null
}

/** Resolve the client's live-site URL: explicit run value first, else the TED client page Website URL. */
async function resolveLiveSite(
  liveSiteUrl?: string | null,
  projectId?: string | null,
  tedClientId?: string | number | null,
): Promise<string> {
  if (liveSiteUrl && liveSiteUrl.trim()) return originOf(liveSiteUrl)
  // Prefer the real TED client id; the project name is synthetic for full scans.
  if (tedClientId != null && String(tedClientId).trim()) {
    const domain = await getClientDomain(String(tedClientId).trim()).catch(() => null)
    return domain ? originOf(domain) : ""
  }
  if (!projectId) return ""
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single()
    const name = project?.name || ""
    if (!name) return ""
    const domain = await getClientDomain(name).catch(() => null)
    return domain ? originOf(domain) : ""
  } catch {
    return ""
  }
}

export async function checkBlogVerification(
  pageUrl: string,
  runId: string,
  liveSiteUrl?: string | null,
  projectId?: string | null,
  onProgress?: (progress: number, message: string) => Promise<void>,
  // OPTIONAL: the real TED client id stored on the run (qa_runs.ted_client_id).
  tedClientId?: string | number | null,
): Promise<Finding[]> {
  const betaOrigin = originOf(pageUrl)

  if (onProgress) await onProgress(15, "Reading blog posts from the beta site...")
  const betaRes = await fetchPosts(betaOrigin)

  // No source readable → could-not-complete lapse (never a false "no blogs").
  if (betaRes === null) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blog Verification Check Failed",
        description:
          "The beta site's blog posts could not be read: the WordPress REST API, RSS/Atom feed and sitemap were all unreachable or listed no posts. Process aborted gracefully; QACC will retry on the next run.",
        context_text: `Beta site: ${betaOrigin}\nSystem Error`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  const betaPosts = betaRes.posts

  // 1. No blogs on the beta site → FAIL, no fix.
  if (betaPosts.length === 0) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "No blogs found",
        description:
          "No blog posts were found on the beta site. If the client's live site has a blog, its posts still need to be migrated over.",
        context_text: `Beta site: ${betaOrigin}\nBeta blog posts: 0 (read via ${betaRes.via})`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  if (onProgress) await onProgress(50, "Resolving the client's live site to compare against...")
  const liveOrigin = await resolveLiveSite(liveSiteUrl, projectId, tedClientId)

  // 2a. No live site URL on the TED client page → cannot compare → FAIL.
  if (!liveOrigin) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blogs found but no live site to compare against",
        description:
          "Blogs found but no mention of the client's live site to compare it to. Add the client's Website URL on the TED client page so the beta blogs can be checked against the live blogs.",
        context_text: `Beta site: ${betaOrigin}\nBeta blog posts: ${betaPosts.length}\nClient live site: (no Website URL on the TED client page)`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  if (onProgress) await onProgress(70, "Reading blog posts from the client's live site...")
  const liveRes = await fetchPosts(liveOrigin)

  // The live site itself unreachable (down, or a bot wall answering every
  // request) is QACC not being able to look — a lapse, not "no blog".
  if (liveRes === null && !(await fetchText(`${liveOrigin}/`, "text/html")).ok) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blog Verification Check Failed",
        description: `The client's live site (${liveOrigin}) could not be reached, so its blog posts could not be read for comparison. Process aborted gracefully; QACC will retry on the next run.`,
        context_text: `Beta site: ${betaOrigin} (${betaPosts.length} posts via ${betaRes.via})\nClient live site: ${liveOrigin} (unreachable)\nSystem Error`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
  // A feed only carries the newest posts. When the beta side came from a feed,
  // compare only that many of the live site's newest posts — older live posts
  // can't be proven missing from a list that never includes them.
  const livePosts =
    betaRes.via === "RSS/Atom feed"
      ? (liveRes?.posts || []).slice(0, Math.max(betaPosts.length, 1))
      : liveRes?.posts || []

  // 2b. Live site has no detectable blog → nothing to compare against → FAIL.
  if (livePosts.length === 0) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blogs found but the live site has no blog to compare against",
        description: `Blogs found but no mention of the client's live site to compare it to — the live site (${liveOrigin}) has no detectable blog posts (checked its WordPress REST API, RSS/Atom feed and sitemap), so the beta blogs cannot be verified against it.`,
        context_text: `Beta site: ${betaOrigin} (${betaPosts.length} posts)\nClient live site: ${liveOrigin} (no blog detected)`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // 3/4. Compare: every LIVE blog must be present on the beta site (by title,
  // slug as a fallback). The live site is the source of truth.
  const betaTitles = new Set(betaPosts.map((p) => normTitle(p.title)).filter(Boolean))
  const betaSlugs = new Set(betaPosts.map((p) => p.slug).filter(Boolean))
  // Slugs normalised like titles too, so a sitemap-only side (slug as title)
  // still matches a REST / feed side.
  const betaSlugKeys = new Set(betaPosts.map((p) => normTitle(p.slug)).filter(Boolean))
  const missing = livePosts.filter((lp) => {
    const t = normTitle(lp.title)
    return !(
      (t && betaTitles.has(t)) ||
      (lp.slug && betaSlugs.has(lp.slug)) ||
      (t && betaSlugKeys.has(t)) ||
      (lp.slug && betaTitles.has(normTitle(lp.slug)))
    )
  })

  if (missing.length === 0) {
    // PASS — clean-pass phrasing so the report marks the subtask passed.
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blogs match the client's live site",
        description: `No issues found. All ${livePosts.length} blog post(s) from the client's live site are present on the beta site.`,
        context_text: `Beta site: ${betaOrigin} (${betaPosts.length} posts via ${betaRes.via})\nClient live site: ${liveOrigin} (${livePosts.length} posts via ${liveRes?.via})`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // 4. Not equal → FAIL, manual fix.
  const missingList = missing
    .slice(0, 30)
    .map((p) => `- ${p.title || p.slug} (${p.link})`)
    .join("\n")
  return [
    {
      check_factor: CHECK_FACTOR,
      title: `Beta site is missing ${missing.length} blog post(s) from the live site`,
      description: `The beta site's blogs do not match the client's live site: ${missing.length} of ${livePosts.length} live blog post(s) are not present on the beta site. Fix: copy over the missing blog posts manually.`,
      context_text: `Beta site: ${betaOrigin} (${betaPosts.length} posts via ${betaRes.via})\nClient live site: ${liveOrigin} (${livePosts.length} posts via ${liveRes?.via})\nMissing on beta:\n${missingList}${missing.length > 30 ? `\n…and ${missing.length - 30} more` : ""}`,
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
