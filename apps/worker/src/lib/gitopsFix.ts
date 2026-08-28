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
import { getSingleScriptCodeFromBasecamp } from "./basecampClient"
import {
  resolveRequiredUserwayTier,
  userwaySnippet,
  USERWAY_ACCOUNTS,
  tierLabel,
} from "./userway"
import {
  readJson,
  writeJson,
  listResources,
  findElementorNodes,
  validateResource,
  mediaRefResolves,
  ALLOWED_SEO_FIELDS,
  ResourceRef,
  ElementorNode,
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
// accessibility_check — install/correct the UserWay widget as a global script.
//
// G99 ships ADA compliance via a site-wide UserWay widget, tier chosen by the
// client's HubSpot "Accessibility Plan Add-On" (Complete → PRO, Basic → FREE).
// The scan flags when the site has the wrong tier or none; this fix writes the
// correct widget as an Elementor custom-code snippet (body end, all pages) —
// the same resource shape the repo already uses for global JS
// (resources/cpt/elementor_snippet/<slug>/cpt.json). It is self-contained, so
// it lands even when the header/footer templates are empty.
//
// The required tier comes from HubSpot (source of truth), keyed on the project
// name — never from the finding text. No HubSpot plan → we can't pick a tier,
// so it's a clean non-fix.
// ---------------------------------------------------------------------------

const USERWAY_SNIPPET_DIR = "resources/cpt/elementor_snippet/userway-accessibility"

export async function applyAccessibilityGitops(
  workDir: string,
  finding: Finding,
  ctx: { projectName?: string | null },
): Promise<GitopsFixResult> {
  const title = (finding.title || "").toLowerCase()
  // Act only on the two real defects: wrong tier or not installed.
  const isDefect = /not installed/.test(title) || /mismatch/.test(title)
  if (!isDefect) {
    return miss("accessibility finding is not a UserWay not-installed/mismatch defect")
  }

  const { tier, planRaw } = await resolveRequiredUserwayTier(ctx.projectName).catch(() => ({
    tier: null as "pro" | "free" | null,
    planRaw: null as string | null,
  }))
  if (!tier) {
    return miss(
      "HubSpot has no Accessibility Plan Add-On for this client — cannot decide PRO vs FREE UserWay tier",
    )
  }

  const relPath = `${USERWAY_SNIPPET_DIR}/cpt.json`
  const account = USERWAY_ACCOUNTS[tier]

  // Idempotency: already the correct tier's account installed via this snippet.
  const existing = readJson<any>(workDir, relPath)
  if (existing && typeof existing.content === "string" && existing.content.includes(`data-account="${account}"`)) {
    return miss(`UserWay ${tierLabel(tier)} widget already installed (data-account ${account})`)
  }

  const snippet = {
    schema_version: 1,
    git_id: "cpt-elementor-snippet-userway-accessibility",
    type: "elementor_snippet",
    slug: "userway-accessibility",
    title: "UserWay Accessibility Widget",
    status: "publish",
    content: userwaySnippet(tier),
    meta: {
      _elementor_location: "body_end",
      _elementor_conditions: ["include/general"],
    },
    media: [] as any[],
  }
  // Guard: never write empty/garbage content (would ship a broken global script).
  if (!snippet.content.includes(account)) {
    return miss("internal: generated UserWay snippet is missing the account id")
  }
  writeJson(workDir, relPath, snippet)

  const verb = existing ? "Corrected" : "Installed"
  return {
    applied: true,
    files: [relPath],
    description: `${verb} the ${tierLabel(tier)} UserWay accessibility widget (data-account ${account}) as a site-wide Elementor custom-code snippet (loads at body end on all pages), matching the HubSpot Accessibility Plan Add-On ("${planRaw}").`,
    note: `accessibility_check UserWay ${tier} snippet written to ${relPath}`,
  }
}

// ---------------------------------------------------------------------------
// chatbot_consultation — inject the Growth99 "Cliff Hanger" integration snippet
// into the site-wide FOOTER template as an Elementor HTML widget.
//
// The JSON format does NOT forbid this: the reconciler stores an HTML widget's
// settings.html verbatim (no script stripping), so a <script> survives. What
// makes it non-trivial are three real preconditions, each caught here as a
// clean non-fix (never a throw) rather than a broken write:
//   1. The footer template must have a design in the repo — the one site-wide
//      carrier. An empty/absent footer means nowhere to inject (and the
//      validator refuses empty-elements writes anyway).
//   2. The exact snippet + this client's business id come from Basecamp
//      ("G99+ Cliff Hanger Code"); we never rebuild it. No message → no fix.
//   3. Load order: the snippet is a mount <div> + a <script>. Appending the
//      WHOLE snippet at the END of the footer guarantees the div exists and the
//      page is parsed before the script runs — so correct placement IS the
//      load-order fix, no separate step.
// ---------------------------------------------------------------------------

const INTEGRATION_MARK = "chatbot.growth99.com/assets/js/integration.js"

/** A footer elementor_library template ref, or null. */
function findFooterTemplate(workDir: string): ResourceRef | null {
  const resources = listResources(workDir)
  return (
    resources.find((r) => {
      const slug = String(r.resource?.slug || "").toLowerCase()
      const title = String(r.resource?.title || "").toLowerCase()
      const type = String(r.resource?.type || "").toLowerCase()
      const isTemplate = r.groupSlug.startsWith("templates/") || type === "elementor_library"
      return isTemplate && (slug === "footer" || /\bfooter\b/.test(title) || /\bfooter\b/.test(slug))
    }) || null
  )
}

/** A fresh 7-hex Elementor element id not already used in `taken`. */
function newElementorId(taken: Set<string>): string {
  for (let i = 0; i < 1000; i++) {
    const id = Math.floor(Math.random() * 0x10000000)
      .toString(16)
      .padStart(7, "0")
      .slice(0, 7)
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
  }
  // Astronomically unlikely fallback.
  return (Date.now().toString(16) + "0000000").slice(0, 7)
}

export async function applyChatbotGitops(
  workDir: string,
  finding: Finding,
  ctx: { projectId?: string | null; projectName?: string | null },
): Promise<GitopsFixResult> {
  // Only act on the "not installed" defect (script absent from the source). The
  // "needs manual review" case means the script IS present but not rendering —
  // a load-order/theme issue, not a missing-code one — so re-injecting would
  // only duplicate it.
  if (!/not installed/i.test(finding.title || "")) {
    return miss("chatbot finding is not the 'not installed' case (nothing to inject)")
  }

  // Precondition 1: a footer template with a real design must exist.
  const footer = findFooterTemplate(workDir)
  if (!footer) {
    return miss("no footer elementor template in repo — cannot inject site-wide (backfill footer first)")
  }
  const elementor = readJson<any>(workDir, footer.elementorRel)
  if (!elementor || !Array.isArray(elementor.elements) || elementor.elements.length === 0) {
    return miss(
      "footer template has no design yet (empty elements) — backfill the footer before injecting the chatbot",
    )
  }

  // Idempotency: bail if the integration script is already anywhere in the footer.
  const already = findElementorNodes(
    elementor,
    (n) => typeof n.settings?.html === "string" && n.settings.html.includes(INTEGRATION_MARK),
  )
  if (already.length) {
    return miss("Cliff Hanger integration script already present in the footer template")
  }

  // Precondition 2: the exact snippet + business id come from Basecamp.
  const ss = await getSingleScriptCodeFromBasecamp(ctx.projectId, ctx.projectName).catch(
    () => null,
  )
  if (!ss || !ss.found || !ss.snippet) {
    return miss(
      "Cliff Hanger code not found in Basecamp for this project — add it under 'G99+ Cliff Hanger Code' first",
    )
  }

  // Build a new top-level container holding one HTML widget with the snippet,
  // and APPEND it (precondition 3: last in the footer → correct load order).
  const taken = new Set<string>()
  findElementorNodes(elementor, (n) => {
    if (n.id) taken.add(String(n.id))
    return false
  })
  const widgetNode = {
    id: newElementorId(taken),
    elType: "widget",
    settings: { html: ss.snippet },
    elements: [] as any[],
    widgetType: "html",
  }
  const containerNode = {
    id: newElementorId(taken),
    elType: "container",
    settings: {},
    elements: [widgetNode],
    isInner: false,
  }
  elementor.elements.push(containerNode)

  const res = commitResource(
    workDir,
    footer,
    [{ rel: footer.elementorRel, value: elementor }],
    `Installed the Growth99 chatbot (Cliff Hanger, business id ${ss.businessId}) as an HTML widget at the end of the footer template, so it loads site-wide.`,
    `chatbot_consultation injected into ${footer.elementorRel}`,
  )
  return res
}

// ---------------------------------------------------------------------------
// false_breakpoint — LOCATE the overflowing Elementor element in the repo.
//
// The scan reports horizontal-overflow culprits by their LIVE DOM selector
// (e.g. `div.elementor-element.elementor-element-5d285f8`). It does NOT auto-fix
// the width: overflow has many causes (a fixed px width, an unwrapped image, a
// wide table, a negative margin) and the right correction is element-specific —
// a blanket width/overflow rule risks hiding content or breaking the design.
//
// What IS deterministic and additive: when a culprit selector carries the
// Elementor element id, map it to the exact repo node (which resource file and
// which widget) so a human edits the right JSON. Culprits with no element id
// are theme/plugin markup with no repo target → fall through to manual.
// ---------------------------------------------------------------------------

/** Find the resource + node that owns a given Elementor element id. */
function locateElementorNodeById(
  workDir: string,
  id: string,
): { groupSlug: string; elementorRel: string; label: string } | null {
  for (const ref of listResources(workDir)) {
    const elementor = readJson<any>(workDir, ref.elementorRel)
    if (!elementor) continue
    const hit = findElementorNodes(elementor, (n) => String(n.id || "") === id)[0]
    if (hit) {
      const label = hit.widgetType
        ? `${hit.widgetType} widget`
        : hit.elType
          ? `${hit.elType}`
          : "element"
      return { groupSlug: ref.groupSlug, elementorRel: ref.elementorRel, label }
    }
  }
  return null
}

export function applyFalseBreakpointGitops(workDir: string, finding: Finding): GitopsFixResult {
  const hay = `${finding.description || ""}\n${finding.context_text || ""}`
  // Elementor wraps every element in `.elementor-element-<id>` (7–8 hex).
  const ids = Array.from(
    new Set(
      Array.from(hay.matchAll(/elementor-element-([0-9a-f]{7,8})\b/gi)).map((m) => m[1].toLowerCase()),
    ),
  )
  if (!ids.length) {
    return miss(
      "overflow culprit is not tied to an Elementor element id — review the culprit selectors listed in the finding manually",
    )
  }

  const located: string[] = []
  for (const id of ids) {
    const node = locateElementorNodeById(workDir, id)
    if (node) {
      located.push(`${node.groupSlug} → ${node.label} (element ${id}) in ${node.elementorRel}`)
    }
  }
  if (!located.length) {
    return miss(
      `overflow culprit element id(s) ${ids.join(", ")} not found in any repo resource (likely header/footer template or theme/plugin markup)`,
    )
  }

  return {
    applied: false,
    files: [],
    description:
      `The horizontal-overflow culprit maps to ${located.length} Elementor element(s) in the repo. ` +
      `Set a responsive width/overflow on the right element (the correct value is design-specific, so it is not auto-written):\n` +
      located.map((l) => `• ${l}`).join("\n"),
    note: `false_breakpoint located ${located.length} repo element(s); width fix needs review (not auto-applied)`,
  }
}

// ---------------------------------------------------------------------------
// top_bar_sticky — make the header sticky in the header template.
//
// The check measures whether the header stays pinned on scroll. When it does
// NOT, the fix is deterministic: Elementor pins a header by setting motion-
// effect keys on the header's outermost section/container — `sticky: "top"`
// and `sticky_on: ["desktop","tablet","mobile"]` — which the reconciler writes
// straight through. We set them on the header template's top-level node,
// leaving every element id and existing setting untouched.
//
// Gated like the chatbot fix: the header template must have a design in the
// repo (empty header = nothing to pin, and the validator refuses empty writes).
// ---------------------------------------------------------------------------

/** A header elementor_library template ref, or null (never the footer). */
function findHeaderTemplate(workDir: string): ResourceRef | null {
  return (
    listResources(workDir).find((r) => {
      const slug = String(r.resource?.slug || "").toLowerCase()
      const title = String(r.resource?.title || "").toLowerCase()
      const type = String(r.resource?.type || "").toLowerCase()
      const isTemplate = r.groupSlug.startsWith("templates/") || type === "elementor_library"
      const isHeader = slug === "header" || /\bheader\b/.test(title) || /\bheader\b/.test(slug)
      const isFooter = /\bfooter\b/.test(slug) || /\bfooter\b/.test(title)
      return isTemplate && isHeader && !isFooter
    }) || null
  )
}

export function applyStickyHeaderGitops(workDir: string, finding: Finding): GitopsFixResult {
  const signal = `${finding.description || ""}\n${finding.context_text || ""}`.toLowerCase()
  // Only act when the check actually measured "not sticky". "Pinned" / an
  // unmeasured ("n/a") run is not a confirmed defect → don't guess.
  const notSticky = /not pinned|did not stay pinned|did not stay/i.test(signal)
  const isPinned = /stayed pinned|sticky observed: pinned/i.test(signal)
  if (!notSticky || isPinned) {
    return miss("header stickiness was not measured as failing (nothing to fix)")
  }

  const header = findHeaderTemplate(workDir)
  if (!header) {
    return miss("no header elementor template in repo — cannot set sticky (backfill header first)")
  }
  const elementor = readJson<any>(workDir, header.elementorRel)
  if (!elementor || !Array.isArray(elementor.elements) || elementor.elements.length === 0) {
    return miss(
      "header template has no design yet (empty elements) — backfill the header before making it sticky",
    )
  }

  const top = elementor.elements[0]
  if (!top || typeof top !== "object") {
    return miss("header template's top-level node is not an element")
  }
  top.settings = top.settings || {}
  if (top.settings.sticky) {
    return miss(`header top element already has sticky="${top.settings.sticky}"`)
  }
  top.settings.sticky = "top"
  top.settings.sticky_on = ["desktop", "tablet", "mobile"]

  return commitResource(
    workDir,
    header,
    [{ rel: header.elementorRel, value: elementor }],
    "Made the header sticky: set the header container to pin to the top on scroll (desktop, tablet and mobile) in the header template.",
    `top_bar_sticky sticky set on ${header.elementorRel}`,
  )
}

// ---------------------------------------------------------------------------
// hero_media — LOCATE the hero image in the repo (homepage).
//
// These repos hand-author the hero as raw HTML inside an Elementor HTML widget
// (settings.html), not a structured image/background_image node. So there is no
// safe deterministic value to auto-write — the "right" hero image is a judgement
// call, and string-editing an HTML blob is fragile. What IS deterministic and
// additive: pin the exact repo node (which resource, which html widget) that
// holds the hero — matched by the failing image URL the finding carries, else by
// hero markup markers — so a human edits the right blob. Video autoplay/stream
// findings have no JSON target and fall through.
// ---------------------------------------------------------------------------

/** The configured front-page resource (hero check is homepage-only). */
function findFrontPageResource(workDir: string): ResourceRef | null {
  const resources = listResources(workDir)
  const site = readJson<any>(workDir, "resources/site.json")
  const frontId = site?.front_page_git_id
  if (frontId) {
    const byId = resources.find((r) => r.resource?.git_id === frontId)
    if (byId) return byId
  }
  return resources.find((r) => String(r.resource?.slug || "").toLowerCase() === "home") || null
}

const HERO_MARKUP = /c-hero|hero__media|hero-section|hero-banner|class="[^"]*\bhero\b/i

export function applyHeroMediaGitops(workDir: string, finding: Finding): GitopsFixResult {
  const title = (finding.title || "").toLowerCase()
  // Only image-presence / broken-image cases map to the repo. Video autoplay,
  // stream-timing and "loading delay" findings are not JSON-fixable here.
  const imageCase =
    /image failed to load|background image failed to load|broken image in the hero|no hero media found|no fallback image/i.test(
      title,
    )
  if (!imageCase) {
    return miss("hero finding is not an image-presence case with a repo target")
  }

  const front = findFrontPageResource(workDir)
  if (!front) return miss("could not resolve the front-page resource in the repo")
  const elementor = readJson<any>(workDir, front.elementorRel)
  if (!elementor) return miss("front-page resource has no elementor.json")

  const hay = `${finding.description || ""}\n${finding.context_text || ""}`
  const urls = Array.from(new Set(Array.from(hay.matchAll(/https?:\/\/[^\s"'<>)]+/gi)).map((m) => m[0])))
  const site = readJson<any>(workDir, "resources/site.json")
  const siteHost = String(site?.source_url || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "")

  // 1) Prefer the html widget that literally contains the failing image URL.
  const located: string[] = []
  for (const url of urls) {
    const hit = findElementorNodes(
      elementor,
      (n) => typeof n.settings?.html === "string" && n.settings.html.includes(url),
    )[0]
    if (hit) {
      let host = ""
      try {
        host = new URL(url).host.replace(/^www\./i, "")
      } catch {}
      const foreign = host && siteHost && !host.endsWith(siteHost.replace(/^www\./i, ""))
      located.push(
        `${front.groupSlug} → html widget (element ${hit.id}) in ${front.elementorRel} — image ${url}` +
          (foreign ? ` (⚠ points at ${host}, not this site — replace with a repo media ref / {{SITE_URL}})` : ""),
      )
    }
  }

  // 2) Otherwise, pin the hero html widget by its markup markers.
  if (!located.length) {
    const hero = findElementorNodes(
      elementor,
      (n) => typeof n.settings?.html === "string" && HERO_MARKUP.test(n.settings.html),
    )[0]
    if (hero) {
      located.push(
        `${front.groupSlug} → hero html widget (element ${hero.id}) in ${front.elementorRel} — edit the hero image in its markup`,
      )
    }
  }

  if (!located.length) {
    return miss("could not pin a hero element in the front-page elementor (hero may be in a template or theme)")
  }

  return {
    applied: false,
    files: [],
    description:
      `Located the hero in the repo (the hero image is hand-authored HTML, so the correct image is set by hand — not auto-written):\n` +
      located.map((l) => `• ${l}`).join("\n"),
    note: `hero_media located ${located.length} repo node(s); image edit needs review (not auto-applied)`,
  }
}

// ---------------------------------------------------------------------------
// contact_form — replicate the client's contact form onto a page missing it, by
// COPYING the exact block from a page that already has it.
//
// The check verifies the contact form is present PER PAGE (one "not found"
// finding per page that lacks it). Rather than guess where/how to paste the
// embed, we copy the pattern the site already uses: find a donor page whose
// elementor already contains the Growth99 form, deep-clone the whole top-level
// container that holds it, regenerate every element id, and insert it into the
// target page at the same position the donor uses. This carries the client's
// real embed AND its real placement/wrapper — no rebuilt template.
//
// If NO page has the form yet, there is no pattern to copy — we do NOT blind-
// paste; the fix reports that the embed must be added to one page first (or
// placed by hand). Gated on a populated target page; idempotent when present.
// ---------------------------------------------------------------------------

const CONTACT_FORM_MARKS = [
  "widget-ui.growth99.com/assets/widgets/new-form.html",
  "app.growth99.com/assets/static/form.html",
  "app.growth99.com/assets/js/form-tracking.js",
]

const nodeHasFormMark = (n: ElementorNode): boolean =>
  typeof n.settings?.html === "string" && CONTACT_FORM_MARKS.some((m) => n.settings!.html.includes(m))

/** Deep-clone an elementor subtree, assigning every node a fresh unique id. */
function cloneWithNewIds(node: any, taken: Set<string>): any {
  const copy: any = Array.isArray(node) ? [] : {}
  for (const k of Object.keys(node)) {
    if (k === "id" && typeof node.id === "string") {
      copy.id = newElementorId(taken)
    } else if (k === "elements" && Array.isArray(node.elements)) {
      copy.elements = node.elements.map((c: any) => cloneWithNewIds(c, taken))
    } else if (node[k] && typeof node[k] === "object") {
      copy[k] = cloneWithNewIds(node[k], taken)
    } else {
      copy[k] = node[k]
    }
  }
  return copy
}

export function applyContactFormGitops(
  workDir: string,
  finding: Finding,
  ctx: { pageUrl?: string | null },
): GitopsFixResult {
  if (!/not found/i.test(finding.title || "")) {
    return miss("contact_form finding is not the 'not found' case (nothing to inject)")
  }

  const target = resolveResourceByUrl(workDir, ctx.pageUrl || "")
  if (!target) {
    return miss(`could not map page URL "${ctx.pageUrl || ""}" to a resource — cannot place the contact form`)
  }
  const elementor = readJson<any>(workDir, target.elementorRel)
  if (!elementor || !Array.isArray(elementor.elements) || elementor.elements.length === 0) {
    return miss(
      `page ${target.groupSlug} has no design yet (empty elements) — backfill it before placing the form`,
    )
  }

  // Idempotency: the embed is already on this page.
  if (findElementorNodes(elementor, nodeHasFormMark).length) {
    return miss(`contact form already present on ${target.groupSlug}`)
  }

  // Find a DONOR page that already has the form, and the top-level container in
  // it that holds the form (so we copy the real wrapper + placement).
  let donorRef: ResourceRef | null = null
  let donorIndex = -1
  let donorContainer: any = null
  for (const ref of listResources(workDir)) {
    if (ref.resourceRel === target.resourceRel) continue
    const doc = readJson<any>(workDir, ref.elementorRel)
    if (!doc || !Array.isArray(doc.elements)) continue
    const idx = doc.elements.findIndex((top: any) => findElementorNodes(top, nodeHasFormMark).length)
    if (idx >= 0) {
      donorRef = ref
      donorIndex = idx
      donorContainer = doc.elements[idx]
      break
    }
  }
  if (!donorContainer) {
    return miss(
      "no page in the repo has the contact form yet — nothing to copy the pattern from; add the embed to one page (or place it by hand) first",
    )
  }

  // Clone the donor's form container with fresh ids (unique within the target),
  // and insert it at the same relative position the donor uses.
  const taken = new Set<string>()
  findElementorNodes(elementor, (n) => {
    if (n.id) taken.add(String(n.id))
    return false
  })
  const clone = cloneWithNewIds(donorContainer, taken)
  const insertAt = Math.min(donorIndex, elementor.elements.length)
  elementor.elements.splice(insertAt, 0, clone)

  return commitResource(
    workDir,
    target,
    [{ rel: target.elementorRel, value: elementor }],
    `Added the contact form to ${target.groupSlug} by copying the exact block already used on ${donorRef!.groupSlug} (same embed and placement).`,
    `contact_form copied from ${donorRef!.groupSlug} into ${target.elementorRel}`,
  )
}
