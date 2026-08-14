import { Finding } from "@qacc/shared"
import { supabase } from "../lib/supabase"
import { getClientDomain } from "../lib/tedClient"

/**
 * Blog Verification check.
 * ------------------------
 * Confirms the beta site's blog posts match the client's LIVE site before
 * release. Login-free — reads the public WordPress REST API (`wp/v2/posts`) on
 * both sites.
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

/**
 * Fetch published blog posts via the public WP REST API.
 * Returns the posts, or `null` when the endpoint is unreachable / not JSON
 * (can't tell "no blog" apart from "REST disabled" — the caller decides).
 */
async function fetchPosts(origin: string): Promise<BlogPost[] | null> {
  if (!origin) return null
  try {
    const resp = await fetch(
      `${origin}/wp-json/wp/v2/posts?per_page=100&_fields=title,slug,link&status=publish`,
      { headers: { Accept: "application/json" } },
    )
    const ctype = resp.headers.get("content-type") || ""
    if (!resp.ok || !ctype.includes("application/json")) return null
    const json = await resp.json()
    if (!Array.isArray(json)) return null
    return json.map((p: any) => ({
      title: p?.title?.rendered ?? p?.title ?? "",
      slug: String(p?.slug || ""),
      link: String(p?.link || ""),
    }))
  } catch {
    return null
  }
}

/** Resolve the client's live-site URL: explicit run value first, else TED notes. */
async function resolveLiveSite(
  liveSiteUrl?: string | null,
  projectId?: string | null,
): Promise<string> {
  if (liveSiteUrl && liveSiteUrl.trim()) return originOf(liveSiteUrl)
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
): Promise<Finding[]> {
  const betaOrigin = originOf(pageUrl)

  if (onProgress) await onProgress(15, "Reading blog posts from the beta site...")
  const betaPosts = await fetchPosts(betaOrigin)

  // REST unreachable → could-not-complete lapse (never a false "no blogs").
  if (betaPosts === null) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blog Verification Check Failed",
        description:
          "The WordPress REST API was unreachable on the beta site, so its blog posts could not be read. Process aborted gracefully; QACC will retry on the next run.",
        context_text: `Beta site: ${betaOrigin}\nSystem Error`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  // 1. No blogs on the beta site → FAIL, no fix.
  if (betaPosts.length === 0) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "No blogs found",
        description:
          "No blog posts were found on the beta site. If the client's live site has a blog, its posts still need to be migrated over.",
        context_text: `Beta site: ${betaOrigin}\nBeta blog posts: 0`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  if (onProgress) await onProgress(50, "Resolving the client's live site to compare against...")
  const liveOrigin = await resolveLiveSite(liveSiteUrl, projectId)

  // 2a. No live site URL in the client notes → cannot compare → FAIL.
  if (!liveOrigin) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blogs found but no live site to compare against",
        description:
          "Blogs found but no mention of the client's live site to compare it to. Add the client's live website URL to the notes so the beta blogs can be checked against the live blogs.",
        context_text: `Beta site: ${betaOrigin}\nBeta blog posts: ${betaPosts.length}\nClient live site: (not found in notes)`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

  if (onProgress) await onProgress(70, "Reading blog posts from the client's live site...")
  const livePosts = await fetchPosts(liveOrigin)

  // 2b. Live site has no detectable blog → nothing to compare against → FAIL.
  if (livePosts === null || livePosts.length === 0) {
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blogs found but the live site has no blog to compare against",
        description: `Blogs found but no mention of the client's live site to compare it to — the live site (${liveOrigin}) has no detectable blog posts via its public REST API, so the beta blogs cannot be verified against it.`,
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
  const missing = livePosts.filter((lp) => {
    const t = normTitle(lp.title)
    return !(betaTitles.has(t) || (lp.slug && betaSlugs.has(lp.slug)))
  })

  if (missing.length === 0) {
    // PASS — clean-pass phrasing so the report marks the subtask passed.
    return [
      {
        check_factor: CHECK_FACTOR,
        title: "Blogs match the client's live site",
        description: `No issues found. All ${livePosts.length} blog post(s) from the client's live site are present on the beta site.`,
        context_text: `Beta site: ${betaOrigin} (${betaPosts.length} posts)\nClient live site: ${liveOrigin} (${livePosts.length} posts)`,
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
      context_text: `Beta site: ${betaOrigin} (${betaPosts.length} posts)\nClient live site: ${liveOrigin} (${livePosts.length} posts)\nMissing on beta:\n${missingList}${missing.length > 30 ? `\n…and ${missing.length - 30} more` : ""}`,
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
