/**
 * GitOps deterministic fix handlers.
 *
 * These are the resources/*.json equivalents of the theme-file *Fix.ts
 * handlers. Each locates the exact JSON field a finding refers to, mutates it
 * in place, VALIDATES the resource the way the site would, and only then writes
 * — a malformed fix would abort the whole release on deploy.
 *
 * Only genuinely mechanical fixes auto-apply (an exact word correction, a known
 * site.json key, a page-create from a template). Anything whose "correct" value
 * is a judgement call (new CTA copy, an SEO title) is LOCATED and returned as a
 * proposal (`applied:false`) rather than guessed.
 *
 * See gitopsResource.ts for the primitives and the safety rules.
 */

import { Finding } from "@qacc/shared"
import { parseSpellingFinding } from "./spellingFix"
import {
  readJson,
  writeJson,
  listResources,
  findElementorNodes,
  validateResource,
  mediaRefResolves,
  ALLOWED_SEO_FIELDS,
  ResourceRef,
} from "./gitopsResource"
import * as fs from "fs"
import * as path from "path"

export interface GitopsFixResult {
  /** true = a file was written; false = located-only / manual. */
  applied: boolean
  /** Relative paths written (empty when not applied). */
  files: string[]
  /** Human-facing description of what changed (for the TED report). */
  description: string
  /** Short internal note (why applied / why not). */
  note: string
}

const miss = (note: string): GitopsFixResult => ({
  applied: false,
  files: [],
  description: "",
  note,
})

/** Copy the capitalization of the found token onto the replacement. */
function matchCase(orig: string, repl: string): string {
  if (orig === orig.toUpperCase() && orig !== orig.toLowerCase()) return repl.toUpperCase()
  if (orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase())
    return repl.charAt(0).toUpperCase() + repl.slice(1)
  return repl
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Replace every whole-word (case-insensitive) occurrence, preserving case. */
function replaceWord(text: string, bad: string, good: string): { text: string; n: number } {
  const re = new RegExp(`\\b${escapeRe(bad)}\\b`, "gi")
  let n = 0
  const out = text.replace(re, (m) => {
    n++
    return matchCase(m, good)
  })
  return { text: out, n }
}

/**
 * Validate then write. If validation fails, nothing is written and the issues
 * are surfaced — better a reported non-fix than a committed release-breaker.
 */
function commitResource(
  workDir: string,
  ref: ResourceRef,
  writes: { rel: string; value: any }[],
  description: string,
  note: string,
): GitopsFixResult {
  const issues = validateResource(workDir, ref)
  if (issues.length) {
    return miss(
      `validation blocked write: ${issues.map((i) => `${i.file}: ${i.message}`).join("; ")}`,
    )
  }
  for (const w of writes) writeJson(workDir, w.rel, w.value)
  return { applied: true, files: writes.map((w) => w.rel), description, note }
}

// ---------------------------------------------------------------------------
// spelling / grammar — exact word correction in Elementor + classic content.
// ---------------------------------------------------------------------------

export function applySpellingGitops(workDir: string, finding: Finding): GitopsFixResult {
  const pair = parseSpellingFinding(finding)
  if (!pair) return miss("no parseable misspelled→suggestion pair in finding")
  const { bad, good } = pair

  const resources = listResources(workDir)
  const filesChanged: string[] = []
  let totalReplacements = 0

  for (const ref of resources) {
    let changedHere = false

    // Elementor docs: heading.title, text-editor.editor, button.text.
    const elementor = readJson<any>(workDir, ref.elementorRel)
    if (elementor) {
      const nodes = findElementorNodes(elementor, (n) => !!n.settings)
      for (const node of nodes) {
        const settings = node.settings
        if (!settings) continue
        for (const key of ["title", "editor", "text"]) {
          const val = settings[key]
          if (typeof val === "string" && val) {
            const { text, n } = replaceWord(val, bad, good)
            if (n > 0) {
              settings[key] = text
              totalReplacements += n
              changedHere = true
            }
          }
        }
      }
      if (changedHere) {
        const res = commitResource(
          workDir,
          ref,
          [{ rel: ref.elementorRel, value: elementor }],
          "",
          "",
        )
        if (!res.applied) return res // validation failed → stop, report
        filesChanged.push(ref.elementorRel)
      }
    }

    // Classic content lives in resource.json.content.
    const content = ref.resource?.content
    if (typeof content === "string" && content) {
      const { text, n } = replaceWord(content, bad, good)
      if (n > 0) {
        ref.resource.content = text
        totalReplacements += n
        const res = commitResource(
          workDir,
          ref,
          [{ rel: ref.resourceRel, value: ref.resource }],
          "",
          "",
        )
        if (!res.applied) return res
        filesChanged.push(ref.resourceRel)
      }
    }
  }

  if (!totalReplacements) {
    return miss(`"${bad}" not found in any resource (likely non-content text)`)
  }
  return {
    applied: true,
    files: filesChanged,
    description: `Corrected "${bad}" → "${good}" (${totalReplacements} occurrence${totalReplacements === 1 ? "" : "s"}) across ${filesChanged.length} resource file(s).`,
    note: `spelling fix applied to ${filesChanged.length} file(s)`,
  }
}

// ---------------------------------------------------------------------------
// backend_check — default tagline + open comments live in site.json.
// ---------------------------------------------------------------------------

const DEFAULT_TAGLINES = new Set([
  "just another wordpress site",
  "just another site",
])

export function applyBackendGitops(workDir: string, finding: Finding): GitopsFixResult {
  const site = readJson<any>(workDir, "resources/site.json")
  if (!site) return miss("no resources/site.json in repo")

  const text = `${finding.title || ""} ${finding.description || ""}`.toLowerCase()
  const files: string[] = []
  const changes: string[] = []

  // Placeholder tagline → clear it (blogdescription).
  const wantsTagline = /tagline|blogdescription|just another/.test(text)
  if (wantsTagline && typeof site.blogdescription === "string") {
    if (DEFAULT_TAGLINES.has(site.blogdescription.trim().toLowerCase())) {
      site.blogdescription = ""
      changes.push("cleared the placeholder tagline")
    }
  }

  // Comments open → close them (default_comment_status).
  const wantsComments = /comment/.test(text)
  if (wantsComments && site.default_comment_status !== "closed") {
    site.default_comment_status = "closed"
    changes.push("set default comment status to closed")
  }

  if (!changes.length) {
    return miss("no site.json tagline/comment change applicable to this finding")
  }
  writeJson(workDir, "resources/site.json", site)
  files.push("resources/site.json")
  return {
    applied: true,
    files,
    description: `Updated site settings: ${changes.join("; ")}.`,
    note: "backend_check site.json fix applied",
  }
}

// ---------------------------------------------------------------------------
// favicon / footer_logo — site.json media pointers. Only when the media pair
// already exists in the repo (we never invent an image).
// ---------------------------------------------------------------------------

/** First media ref whose sidecar/filename hints at the given purpose. */
function findMediaByHint(workDir: string, hints: RegExp): string | null {
  const dir = path.join(workDir, "resources/media")
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    return null
  }
  for (const f of entries) {
    const ref = f.replace(/\.json$/, "")
    const sidecar = readJson<{ file?: string }>(workDir, `resources/media/${f}`)
    if (hints.test(ref) || (sidecar?.file && hints.test(sidecar.file))) {
      if (mediaRefResolves(workDir, ref)) return `media:${ref}`
    }
  }
  return null
}

export function applyFaviconGitops(workDir: string): GitopsFixResult {
  const site = readJson<any>(workDir, "resources/site.json")
  if (!site) return miss("no resources/site.json in repo")
  if (site.site_icon) return miss("site_icon already set")
  const ref = findMediaByHint(workDir, /favicon|site[-_]?icon|fav/i)
  if (!ref) return miss("no favicon media in resources/media (needs one supplied)")
  site.site_icon = ref
  writeJson(workDir, "resources/site.json", site)
  return {
    applied: true,
    files: ["resources/site.json"],
    description: `Set the site icon (favicon) to ${ref}.`,
    note: "favicon site.json fix applied",
  }
}

export function applyFooterLogoGitops(workDir: string): GitopsFixResult {
  const site = readJson<any>(workDir, "resources/site.json")
  if (!site) return miss("no resources/site.json in repo")
  const ref = findMediaByHint(workDir, /logo/i)
  if (!ref) return miss("no logo media in resources/media (footer logo may be in a template)")
  if (site.custom_logo === ref) return miss("custom_logo already set to this media")
  site.custom_logo = ref
  writeJson(workDir, "resources/site.json", site)
  return {
    applied: true,
    files: ["resources/site.json"],
    description: `Set the site logo to ${ref}.`,
    note: "footer_logo site.json fix applied",
  }
}

// ---------------------------------------------------------------------------
// privacy_policy — create a new page resource (first-class repo operation).
// Created as a DRAFT for human review by default.
// ---------------------------------------------------------------------------

export function applyPrivacyPolicyGitops(
  workDir: string,
  opts: { company: string; contentHtml: string; publish?: boolean },
): GitopsFixResult {
  const slug = "privacy-policy"
  const dirRel = `resources/pages/${slug}`
  if (fs.existsSync(path.join(workDir, dirRel, "resource.json"))) {
    return miss("privacy-policy page already exists in repo")
  }
  const resource = {
    schema_version: 1,
    git_id: "page-privacy-policy",
    type: "page",
    slug,
    title: "Privacy Policy",
    status: opts.publish ? "publish" : "draft",
    publication_approved: !!opts.publish,
    excerpt: "",
    menu_order: 0,
    content: opts.contentHtml,
  }
  const seo = {
    schema_version: 1,
    provider: "rank_math",
    fields: {
      rank_math_title: `Privacy Policy — ${opts.company}`,
      rank_math_description: `The privacy policy for ${opts.company}.`,
    },
  }
  const ref: ResourceRef = {
    groupSlug: `pages/${slug}`,
    resourceRel: `${dirRel}/resource.json`,
    elementorRel: `${dirRel}/elementor.json`,
    seoRel: `${dirRel}/seo.json`,
    resource,
  }
  return commitResource(
    workDir,
    ref,
    [
      { rel: ref.resourceRel, value: resource },
      { rel: ref.seoRel, value: seo },
    ],
    `Created a ${opts.publish ? "published" : "draft"} Privacy Policy page.`,
    "privacy_policy page-create applied",
  )
}

// ---------------------------------------------------------------------------
// learn_more_buttons — LOCATE generic CTA button widgets. New copy is a
// judgement call, so this reports located targets rather than guessing.
// ---------------------------------------------------------------------------

const GENERIC_CTA = /^(learn|read|know|see|find out)\s+more$/i

export function applyLearnMoreGitops(workDir: string): GitopsFixResult {
  const resources = listResources(workDir)
  const located: string[] = []
  for (const ref of resources) {
    const elementor = readJson<any>(workDir, ref.elementorRel)
    if (!elementor) continue
    const buttons = findElementorNodes(
      elementor,
      (n) =>
        n.widgetType === "button" &&
        typeof n.settings?.text === "string" &&
        GENERIC_CTA.test(n.settings.text.trim()),
    )
    for (const b of buttons) {
      located.push(`${ref.groupSlug} → button "${b.settings!.text}" (id ${b.id})`)
    }
  }
  if (!located.length) return miss("no generic CTA button widgets found in elementor resources")
  return {
    applied: false,
    files: [],
    description:
      `Located ${located.length} generic CTA button(s) needing more descriptive copy:\n` +
      located.map((l) => `• ${l}`).join("\n"),
    note: "learn_more located; new copy needs review (not auto-applied)",
  }
}

// ---------------------------------------------------------------------------
// meta_tags / text_share — Open Graph (share preview) fields in seo.json.
//
// Mechanical only: we make the page's EXISTING SEO title/description explicit on
// the OG tags (rank_math_facebook_*), and point the OG image at a social-share
// media that already lives in the repo. We never invent copy — if the source
// value isn't in the repo, we skip that field. og:site_name maps to the
// site-wide blogname, handled separately (only overwrites a known placeholder).
// ---------------------------------------------------------------------------

const PLACEHOLDER_SITE_NAME = /^(my site|my blog|wordpress|site title|just another.*)$/i

/** Map a live page URL to its resource dir by URL slug (or front page). */
function resolveResourceByUrl(workDir: string, pageUrl: string): ResourceRef | null {
  const resources = listResources(workDir)
  if (!resources.length) return null

  let pathname = ""
  try {
    pathname = new URL(pageUrl).pathname
  } catch {
    pathname = pageUrl || ""
  }
  const segs = pathname.split("/").filter(Boolean)

  // Homepage ("/") → the configured front page.
  if (segs.length === 0) {
    const site = readJson<any>(workDir, "resources/site.json")
    const frontId = site?.front_page_git_id
    if (frontId) {
      const byId = resources.find((r) => r.resource?.git_id === frontId)
      if (byId) return byId
    }
    return resources.find((r) => r.resource?.slug === "home") || null
  }

  const slug = segs[segs.length - 1].toLowerCase()
  return resources.find((r) => String(r.resource?.slug || "").toLowerCase() === slug) || null
}

/**
 * Write seo.json then validate the whole resource the way the site would; on any
 * validation issue, roll the file back to its prior state and report a non-fix.
 * (validateResource reads from disk, so we must write first to validate the new
 * value — but never leave a bad file behind.)
 */
function commitSeoPostValidate(
  workDir: string,
  ref: ResourceRef,
  seo: any,
  description: string,
  note: string,
): GitopsFixResult {
  // Defensive allowlist check on exactly what we're about to write.
  for (const key of Object.keys(seo.fields || {})) {
    if (!ALLOWED_SEO_FIELDS.has(key) && !/_image_id$/.test(key)) {
      return miss(`refusing to write non-allowlisted seo field "${key}"`)
    }
  }
  const abs = path.join(workDir, ref.seoRel)
  const existed = fs.existsSync(abs)
  const prior = existed ? fs.readFileSync(abs, "utf8") : null

  writeJson(workDir, ref.seoRel, seo)
  const issues = validateResource(workDir, ref)
  if (issues.length) {
    if (prior !== null) fs.writeFileSync(abs, prior, "utf8")
    else fs.rmSync(abs, { force: true })
    return miss(
      `validation blocked write: ${issues.map((i) => `${i.file}: ${i.message}`).join("; ")}`,
    )
  }
  return { applied: true, files: [ref.seoRel], description, note }
}

export function applySeoOgGitops(
  workDir: string,
  finding: Finding,
  ctx: { company: string; pageUrl: string },
): GitopsFixResult {
  const title = (finding.title || "").toLowerCase()
  const wantsOgTitle = /og:title|open graph title/.test(title)
  const wantsOgDesc = /og:description|open graph description/.test(title)
  const wantsOgImage = /og:image|open graph image/.test(title)
  const wantsSiteName = /site name|og:site_name/.test(title)

  if (!wantsOgTitle && !wantsOgDesc && !wantsOgImage && !wantsSiteName) {
    return miss("finding is not an OG title/description/image/site-name defect")
  }

  // og:site_name is site-wide (blogname), not per-page. Only replace a known
  // placeholder with the real business name; a real name is left untouched.
  if (wantsSiteName && !wantsOgTitle && !wantsOgDesc && !wantsOgImage) {
    const site = readJson<any>(workDir, "resources/site.json")
    if (!site) return miss("no resources/site.json in repo")
    const current = String(site.blogname || "").trim()
    if (!ctx.company) return miss("no business name available to set og:site_name")
    if (current && !PLACEHOLDER_SITE_NAME.test(current)) {
      return miss(`blogname already a real business name ("${current}")`)
    }
    site.blogname = ctx.company
    writeJson(workDir, "resources/site.json", site)
    return {
      applied: true,
      files: ["resources/site.json"],
      description: `Set the site name (og:site_name source) to "${ctx.company}".`,
      note: "og:site_name blogname fix applied",
    }
  }

  const ref = resolveResourceByUrl(workDir, ctx.pageUrl)
  if (!ref) return miss(`could not map page URL "${ctx.pageUrl}" to a resource`)

  const seo =
    readJson<any>(workDir, ref.seoRel) || {
      schema_version: 1,
      provider: "rank_math",
      fields: {},
    }
  if (!seo.fields || typeof seo.fields !== "object") seo.fields = {}

  const changes: string[] = []

  if (wantsOgTitle && !seo.fields.rank_math_facebook_title) {
    const src = seo.fields.rank_math_title || ref.resource?.title
    if (src) {
      seo.fields.rank_math_facebook_title = src
      changes.push(`OG title → "${src}"`)
    }
  }
  if (wantsOgDesc && !seo.fields.rank_math_facebook_description) {
    const src = seo.fields.rank_math_description
    if (src) {
      seo.fields.rank_math_facebook_description = src
      changes.push("OG description (from the page's SEO description)")
    }
  }
  if (wantsOgImage && !seo.fields.rank_math_facebook_image_id) {
    const media = findMediaByHint(workDir, /social[-_]?share|og[-_]?image|share[-_]?image/i)
    if (media) {
      seo.fields.rank_math_facebook_image_id = media
      changes.push(`OG image → ${media}`)
    }
  }

  if (!changes.length) {
    return miss("nothing to backfill (OG field already set, or no source value in the repo)")
  }

  return commitSeoPostValidate(
    workDir,
    ref,
    seo,
    `Backfilled social-share (Open Graph) metadata on ${ref.groupSlug}: ${changes.join("; ")}.`,
    `seo_og fix applied to ${ref.seoRel}`,
  )
}

// ---------------------------------------------------------------------------
// accessibility_check — LOCATE media that renders as <img> with no alt text.
//
// Alt text describes an image, so the "correct" value is a judgement call we
// never guess. But the fixable data IS in the repo: every image's alt lives in
// its media sidecar (resources/media/<ref>.json). We report the sidecars with
// an empty alt so a human/AI fills them — the per-finding LLM retrieval is
// theme-oriented and won't surface these JSON sidecars on its own.
// ---------------------------------------------------------------------------

export function applyAccessibilityGitops(workDir: string, finding: Finding): GitopsFixResult {
  const title = (finding.title || "").toLowerCase()
  const desc = (finding.description || "").toLowerCase()
  // Match ONLY the real missing-alt defect ("Accessibility: Images missing alt"
  // / "N image(s) have no alt attribute"). The passing finding ("No
  // accessibility issues found") also lists "alt text" in its description, so a
  // bare /alt/ test would wrongly fire on a page that passed. Labels/lang/
  // headings have no editable JSON target here → fall through.
  const isMissingAlt = /images missing alt/.test(title) || /no alt attribute/.test(desc)
  if (!isMissingAlt) {
    return miss("accessibility finding is not a missing-alt-text defect")
  }

  const dir = path.join(workDir, "resources/media")
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    return miss("no resources/media directory in repo")
  }

  const emptyAlt: string[] = []
  for (const f of entries) {
    const sidecar = readJson<{ ref?: string; file?: string; alt?: string }>(
      workDir,
      `resources/media/${f}`,
    )
    if (!sidecar) continue
    const alt = String(sidecar.alt ?? "").trim()
    if (alt === "") {
      emptyAlt.push(sidecar.file || sidecar.ref || f.replace(/\.json$/, ""))
    }
  }

  if (!emptyAlt.length) {
    return miss("every media sidecar already has alt text")
  }

  const CAP = 25
  const shown = emptyAlt.slice(0, CAP)
  const more = emptyAlt.length - shown.length
  return {
    applied: false,
    files: [],
    description:
      `${emptyAlt.length} media file(s) in the repo have empty alt text. ` +
      `Add descriptive alt to each media sidecar (resources/media/<ref>.json → "alt"):\n` +
      shown.map((f) => `• ${f}`).join("\n") +
      (more > 0 ? `\n• …and ${more} more` : ""),
    note: `accessibility located ${emptyAlt.length} empty-alt media (alt text needs review, not auto-applied)`,
  }
}
