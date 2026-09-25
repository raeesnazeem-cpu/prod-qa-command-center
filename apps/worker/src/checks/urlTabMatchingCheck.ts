import { Finding } from "@qacc/shared"
import { completeText } from "../lib/aiFallback"

/**
 * URL & Tab Title Matching (all pages except the homepage).
 *
 * QA rule: "Check URL is matching and check tab name". The page's URL slug and
 * its browser tab title must describe the same thing — `/lip-filler` titled
 * "Lip Fillers | Brand" passes, `/botox` titled "Contact Us" fails.
 *
 * The logic:
 *   1. Blank / placeholder title ("Untitled", "Sample Page") → fail.
 *   2. Strip the brand segment(s) from the title ("Lip Fillers | Nuvo" →
 *      "Lip Fillers"). A title that is ONLY the brand → fail (it doesn't
 *      describe the page).
 *   3. Word-match the slug against the remaining title (plurals / word forms
 *      tolerated). Most slug words present → pass, no AI needed.
 *   4. Otherwise (synonyms, reworded titles) ask the text AI whether they mean
 *      the same page. AI unavailable → tool lapse, never a silent pass.
 *
 * Every page that ran records a result row (pass sentinel or failure) so the
 * report's "Passed" is backed by evidence, not by the absence of findings.
 */

const CHECK = "url_matching"

// Titles that are WP/builder defaults, not real page names.
const PLACEHOLDER_TITLE = [
  /^untitled/i,
  /^sample page$/i,
  /^new page$/i,
  /^page\s*\d*$/i,
  /^home$/i,
  /^auto draft$/i,
]

// Title separators between the page name and the brand.
const SEPARATORS = /\s+[|\-–—:·•»]\s+|\s*\|\s*|\s+::\s+/

// Words that carry no page meaning on their own.
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "by",
  "with", "from", "our", "your", "my", "we", "us", "is", "are", "near", "me",
  "best", "top", "page", "html", "php", "amp",
  // Blog-slug filler ("do-you-know-about-the-benefits-of-…").
  "do", "does", "you", "know", "about", "how", "what", "why", "which", "when",
  "can", "should", "it", "its", "this", "that", "has", "have", "be", "will",
  "all", "get", "here", "new",
])

const compact = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "")

/** Crude stem so "fillers"/"filler", "injections"/"injection" compare equal. */
function stem(w: string): string {
  let s = w.toLowerCase()
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y"
  else if (s.length > 4 && /(ses|xes|zes|ches|shes)$/.test(s)) s = s.slice(0, -2)
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1)
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3)
  else if (s.length > 5 && s.endsWith("ed")) s = s.slice(0, -2)
  return s
}

function words(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
}

function wordsMatch(a: string, b: string): boolean {
  const x = stem(a)
  const y = stem(b)
  if (x === y) return true
  // Word forms sharing a long root: "aesthetic"/"aesthetician", "inject"/"injectable".
  const min = Math.min(x.length, y.length)
  return min >= 5 && (x.startsWith(y) || y.startsWith(x))
}

/** The slug that names the page: last meaningful path segment. */
export function slugFromUrl(pageUrl: string): string {
  let segs: string[] = []
  try {
    segs = new URL(pageUrl).pathname
      .split("/")
      .map((s) => decodeURIComponent(s).replace(/\.(html?|php)$/i, ""))
      .filter(Boolean)
  } catch {
    return ""
  }
  // Skip trailing pagination / numeric / date segments (/blog/page/2, /2024/05).
  while (segs.length && (/^\d+$/.test(segs[segs.length - 1]) || segs[segs.length - 1] === "page"))
    segs.pop()
  return segs[segs.length - 1] || ""
}

/**
 * Remove brand segments from a title. A segment is brand when it matches the
 * og:site_name, the project name, or is contained in the site's hostname
 * ("Nuvo Aesthetics Clinic" ⊂ nuvoaestheticsclinic.gogroth.com).
 */
export function stripBrand(title: string, brandHints: string[], host: string): string {
  const parts = title.split(SEPARATORS).map((p) => p.trim()).filter(Boolean)
  const hostC = compact(host.replace(/^www\./, ""))
  const brands = brandHints.map(compact).filter((b) => b.length >= 3)
  const isBrand = (p: string) => {
    const c = compact(p)
    if (!c) return true
    if (brands.some((b) => c === b || b.includes(c) || c.includes(b))) return true
    return c.length >= 4 && hostC.includes(c)
  }
  const kept = parts.filter((p) => !isBrand(p))
  return kept.join(" ").trim()
}

export type MatchVerdict =
  | { verdict: "pass"; how: string }
  | { verdict: "fail"; reason: string }
  | { verdict: "ask_ai" }

/** Deterministic part of the match. Exported for tests. */
export function matchSlugToTitle(slug: string, pageName: string): MatchVerdict {
  const slugWords = words(slug.replace(/[-_+]/g, " "))
  const titleWords = words(pageName)
  if (!slugWords.length) return { verdict: "pass", how: "slug has no descriptive words to compare" }
  if (!titleWords.length) return { verdict: "fail", reason: "the tab title has no words describing the page" }

  const hit = slugWords.filter((sw) => titleWords.some((tw) => wordsMatch(sw, tw)))
  // Long slugs (blog posts) are often trimmed in the title; half the words is
  // enough. Short slugs (1-2 words) must fully match to pass without AI.
  const need = slugWords.length <= 2 ? slugWords.length : Math.ceil(slugWords.length / 2)
  if (hit.length >= need)
    return { verdict: "pass", how: `slug words matched in title: ${hit.join(", ")}` }
  return { verdict: "ask_ai" }
}

async function askAi(
  pageUrl: string,
  slug: string,
  title: string,
  pageName: string,
): Promise<{ match: boolean; reason: string }> {
  const system =
    "You are a website QA reviewer. Decide whether a page's URL slug and its browser tab title refer to the same page topic. Synonyms, abbreviations, and rewording count as a match (e.g. 'about-us' and 'Meet Our Team', 'bbl' and 'Brazilian Butt Lift'). A different topic or service is a mismatch."
  const user = `URL: ${pageUrl}\nSlug: ${slug}\nTab title: ${title}\nTitle without brand: ${pageName}\n\nReturn STRICT JSON only: {"match": true|false, "reason": "<one short sentence>"}`
  const { text } = await completeText(system, user)
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error("AI returned no JSON verdict")
  const o = JSON.parse(m[0])
  if (typeof o.match !== "boolean") throw new Error("AI verdict missing 'match'")
  return { match: o.match, reason: String(o.reason || "").trim() }
}

export async function checkUrlTabMatching(
  pageUrl: string,
  rawTitle: string,
  brandHints: string[],
): Promise<Finding[]> {
  const title = (rawTitle || "").replace(/\s+/g, " ").trim()
  const slug = slugFromUrl(pageUrl)
  const ctx = `URL: ${pageUrl}\nSlug: /${slug}\nTab title: "${title}"`
  const row = (t: string, d: string, ai = false): Finding =>
    ({
      check_factor: CHECK,
      title: t,
      description: d,
      context_text: ctx,
      screenshot_url: null,
      status: "open",
      ai_generated: ai,
    }) as Finding

  if (!title || PLACEHOLDER_TITLE.some((p) => p.test(title))) {
    return [
      row(
        `Invalid tab title on /${slug}`,
        `The tab title "${title || "(empty)"}" is blank or a placeholder. It should name this page, matching its URL /${slug}.`,
      ),
    ]
  }

  let host = ""
  try {
    host = new URL(pageUrl).hostname
  } catch {}
  const pageName = stripBrand(title, brandHints, host)
  if (!pageName) {
    // Everything looked like brand — but the page may legitimately share a word
    // with it (/aesthetics titled "Aesthetics | Nuvo Aesthetics"). Only fail when
    // the full title doesn't match the slug either.
    const whole = matchSlugToTitle(slug, title)
    if (whole.verdict === "pass")
      return [row("No URL/tab title mismatch found", `The URL /${slug} and tab title "${title}" match (${whole.how}).`)]
    return [
      row(
        `Tab title is only the brand name on /${slug}`,
        `The tab title "${title}" only shows the brand name. It should name this page, matching its URL /${slug}.`,
      ),
    ]
  }

  const det = matchSlugToTitle(slug, pageName)
  if (det.verdict === "pass") {
    return [row("No URL/tab title mismatch found", `The URL /${slug} and tab title "${title}" match (${det.how}).`)]
  }
  if (det.verdict === "fail") {
    return [row(`URL and tab title don't match on /${slug}`, `URL /${slug} should have a tab title describing it; "${title}" ${det.reason}.`)]
  }

  let ai: { match: boolean; reason: string }
  try {
    ai = await askAi(pageUrl, slug, title, pageName)
  } catch (e: any) {
    // Never a silent pass: an AI failure is a tool lapse ("Check Failed").
    return [
      row(
        "URL Tab Matching Check Failed",
        `The URL/tab title comparison could not run (AI error): ${e?.message || e}. Process aborted gracefully.`,
      ),
    ]
  }
  if (ai.match) {
    return [row("No URL/tab title mismatch found", `The URL /${slug} and tab title "${title}" match. ${ai.reason}`, true)]
  }
  return [
    row(
      `URL and tab title don't match on /${slug}`,
      `The URL /${slug} and tab title "${title}" describe different things. ${ai.reason} The tab title should have been about "${slug.replace(/[-_]/g, " ")}".`,
      true,
    ),
  ]
}
