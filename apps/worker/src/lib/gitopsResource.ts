/**
 * GitOps resource layer for AI fixes.
 *
 * A G99 GitOps site repo is NOT a WordPress/Bedrock tree — it has no themes,
 * no functions.php, no parts/footer.html. It is a desired-state content repo:
 * every page/post/product lives under `resources/<group>/<slug>/` as
 * `resource.json` (+ optional `elementor.json`, `seo.json`), and a `g99-control`
 * MU plugin reconciles it into the live site. See
 * docs/25-08-2026-gitops-fix-target-structure.md.
 *
 * The theme-file fix handlers (footerLogoFix, learnMoreFix, …) all resolve a
 * theme dir by functions.php/theme.json and write parts/footer.html etc. NONE
 * of those paths exist here, so against a GitOps repo every one of them reports
 * "manual". This module is the replacement target: it reads and mutates the
 * JSON resources directly.
 *
 * Hard safety rules encoded here (a malformed fix aborts the WHOLE release, not
 * just the bad resource, so we validate before writing):
 *   - Never regenerate an Elementor element `id` (Elementor CSS/popups key off
 *     them). Mutate `settings` in place.
 *   - Never write `"elements": []` into a template that has a live design —
 *     `ElementorV3Adapter::apply()` has no empty-guard, so an empty array would
 *     wipe the live header/footer on the next deploy.
 *   - Only allowlisted `seo.json` `fields` keys.
 *   - Every `"media:<ref>"` must resolve to an existing sidecar + file.
 *   - Emit `{{SITE_URL}}` for internal absolute URLs (portable across domains).
 */

import * as fs from "fs"
import * as path from "path"

export type RepoKind = "gitops" | "theme"

/** Canonical portable-URL token (matches UrlRewriter::SITE_URL_TOKEN). */
export const SITE_URL_TOKEN = "{{SITE_URL}}"

/**
 * A GitOps repo is identified by BOTH a top-level `resources/` tree and the
 * `g99-control` MU plugin that reconciles it. Requiring both avoids a false
 * positive on some unrelated repo that merely has a `resources/` folder.
 */
export function detectRepoKind(workDir: string): RepoKind {
  try {
    const hasResources = fs.existsSync(path.join(workDir, "resources"))
    const hasControl = fs.existsSync(
      path.join(workDir, "web/app/mu-plugins/g99-control"),
    )
    return hasResources && hasControl ? "gitops" : "theme"
  } catch {
    return "theme"
  }
}

// ---------------------------------------------------------------------------
// JSON read / write with stable, reviewable formatting.
// ---------------------------------------------------------------------------

/** Read+parse a JSON resource file. Returns null if absent or unparseable. */
export function readJson<T = any>(workDir: string, relPath: string): T | null {
  try {
    const abs = path.join(workDir, relPath)
    if (!fs.existsSync(abs)) return null
    return JSON.parse(fs.readFileSync(abs, "utf8")) as T
  } catch {
    return null
  }
}

/**
 * Write a JSON resource with 2-space indent and a trailing newline so the diff
 * stays small and reviewable. Key order is preserved from the in-memory object
 * (mutate fields in place rather than rebuilding to keep it stable).
 */
export function writeJson(workDir: string, relPath: string, value: any): void {
  const abs = path.join(workDir, relPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(value, null, 2) + "\n", "utf8")
}

// ---------------------------------------------------------------------------
// Resource discovery.
// ---------------------------------------------------------------------------

export interface ResourceRef {
  /** e.g. "pages/home" — the dir under resources/ (group/slug). */
  groupSlug: string
  /** resources/<group>/<slug>/resource.json relative path. */
  resourceRel: string
  elementorRel: string
  seoRel: string
  resource: any
}

/**
 * List every resource directory that has a resource.json. Groups other than the
 * special loaders (media/templates/cpt handled separately) — but we include
 * templates too since callers may need them; skip `media`.
 */
export function listResources(workDir: string): ResourceRef[] {
  const out: ResourceRef[] = []
  const resourcesDir = path.join(workDir, "resources")
  let groups: string[] = []
  try {
    groups = fs
      .readdirSync(resourcesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "media")
      .map((d) => d.name)
  } catch {
    return out
  }
  for (const group of groups) {
    const groupDir = path.join(resourcesDir, group)
    let slugs: string[] = []
    try {
      slugs = fs
        .readdirSync(groupDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      continue
    }
    for (const slug of slugs) {
      const resourceRel = `resources/${group}/${slug}/resource.json`
      const resource = readJson(workDir, resourceRel)
      if (!resource) continue
      out.push({
        groupSlug: `${group}/${slug}`,
        resourceRel,
        elementorRel: `resources/${group}/${slug}/elementor.json`,
        seoRel: `resources/${group}/${slug}/seo.json`,
        resource,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Elementor tree walker. Never touches `id` — only `settings`.
// ---------------------------------------------------------------------------

export interface ElementorNode {
  id?: string
  elType?: string
  widgetType?: string
  settings?: Record<string, any>
  elements?: ElementorNode[]
  [k: string]: any
}

/** Depth-first visit of every node in an elementor.json `elements` tree. */
export function walkElementor(
  doc: { elements?: ElementorNode[] } | null,
  visit: (node: ElementorNode) => void,
): void {
  if (!doc || !Array.isArray(doc.elements)) return
  const stack = [...doc.elements]
  while (stack.length) {
    const node = stack.pop()!
    visit(node)
    if (Array.isArray(node.elements)) stack.push(...node.elements)
  }
}

/** All nodes matching a predicate, in DFS order. */
export function findElementorNodes(
  doc: { elements?: ElementorNode[] } | null,
  pred: (node: ElementorNode) => boolean,
): ElementorNode[] {
  const hits: ElementorNode[] = []
  walkElementor(doc, (n) => {
    if (pred(n)) hits.push(n)
  })
  return hits
}

// ---------------------------------------------------------------------------
// URL portability.
// ---------------------------------------------------------------------------

/**
 * Replace absolute URLs pointing at this site with {{SITE_URL}}. External
 * domains, mailto:, tel:, anchors and relative URLs are left untouched. Pass
 * the site's own host(s) (from site.json.source_url or the run's site_url).
 */
export function tokenizeSiteUrl(value: string, siteHosts: string[]): string {
  if (!value) return value
  const hosts = siteHosts
    .map((h) => h.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, ""))
    .filter(Boolean)
  let out = value
  for (const host of hosts) {
    const re = new RegExp(`https?://(?:www\\.)?${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi")
    out = out.replace(re, SITE_URL_TOKEN)
  }
  return out
}

// ---------------------------------------------------------------------------
// Client-side validator — mirrors the site's Validator::validate() so a bad
// fix is caught HERE and never committed (a validation failure on deploy would
// abort the entire release, including any editor's pending work).
// ---------------------------------------------------------------------------

/** Rank Math fields the site allowlists (SeoAdapter::ALLOWED_FIELDS + image refs). */
export const ALLOWED_SEO_FIELDS = new Set<string>([
  "rank_math_title",
  "rank_math_description",
  "rank_math_focus_keyword",
  "rank_math_canonical_url",
  "rank_math_robots",
  "rank_math_advanced_robots",
  "rank_math_breadcrumb_title",
  "rank_math_pillar_content",
  "rank_math_facebook_title",
  "rank_math_facebook_description",
  "rank_math_facebook_image_id",
  "rank_math_twitter_title",
  "rank_math_twitter_description",
  "rank_math_twitter_card_type",
  "rank_math_twitter_image_id",
  "rank_math_rich_snippet",
])

export interface ValidationIssue {
  file: string
  message: string
}

/** True when `ref` ("media:<id>" or bare "<id>") has BOTH sidecar and file. */
export function mediaRefResolves(workDir: string, ref: string): boolean {
  const id = ref.replace(/^media:/, "").trim()
  if (!id) return false
  const sidecarRel = `resources/media/${id}.json`
  const sidecar = readJson<{ file?: string }>(workDir, sidecarRel)
  if (!sidecar || !sidecar.file) return false
  return fs.existsSync(path.join(workDir, "resources/media", sidecar.file))
}

/**
 * Validate a single resource dir the way the site would. Returns [] when clean.
 * Deliberately conservative: any doubt is an issue, because a false "valid"
 * that fails on deploy blocks every other pending change on the site.
 */
export function validateResource(
  workDir: string,
  ref: {
    resourceRel: string
    elementorRel: string
    seoRel: string
    resource: any
  },
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const r = ref.resource
  if (!r || typeof r !== "object") {
    issues.push({ file: ref.resourceRel, message: "resource.json missing/not an object" })
    return issues
  }
  if (!r.git_id) issues.push({ file: ref.resourceRel, message: "git_id required" })
  if (!r.slug) issues.push({ file: ref.resourceRel, message: "slug required" })
  if (!r.title) issues.push({ file: ref.resourceRel, message: "title required" })
  if (r.status && !["draft", "publish", "private"].includes(r.status)) {
    issues.push({ file: ref.resourceRel, message: `invalid status "${r.status}"` })
  }

  // elementor.json (if present): must have a non-empty elements array. An empty
  // array on a template with a live design is a data-loss landmine.
  const elementor = readJson<{ elements?: any[] }>(workDir, ref.elementorRel)
  if (elementor) {
    if (!Array.isArray(elementor.elements)) {
      issues.push({ file: ref.elementorRel, message: "elements must be an array" })
    } else if (elementor.elements.length === 0) {
      issues.push({
        file: ref.elementorRel,
        message: "refusing empty elements array (would wipe the live design on deploy)",
      })
    }
    // Every media ref inside must resolve.
    const refs = collectMediaRefs(elementor)
    for (const m of refs) {
      if (!mediaRefResolves(workDir, m)) {
        issues.push({ file: ref.elementorRel, message: `dangling media ref "${m}"` })
      }
    }
  }

  // seo.json (if present): fields keys strictly allowlisted; schema keys prefixed.
  const seo = readJson<{ fields?: Record<string, any>; schema?: Record<string, any> }>(
    workDir,
    ref.seoRel,
  )
  if (seo) {
    if (!seo.fields && !seo.schema) {
      issues.push({ file: ref.seoRel, message: "seo.json needs fields and/or schema" })
    }
    for (const key of Object.keys(seo.fields || {})) {
      if (!ALLOWED_SEO_FIELDS.has(key) && !/_image_id$/.test(key)) {
        issues.push({ file: ref.seoRel, message: `seo field "${key}" not allowlisted` })
      }
    }
    for (const key of Object.keys(seo.schema || {})) {
      if (!/^rank_math_schema_/.test(key)) {
        issues.push({ file: ref.seoRel, message: `schema key "${key}" must start with rank_math_schema_` })
      }
    }
  }

  return issues
}

/** Every "media:<ref>" string anywhere in an object tree. */
export function collectMediaRefs(obj: any): string[] {
  const out = new Set<string>()
  const stack = [obj]
  while (stack.length) {
    const cur = stack.pop()
    if (cur == null) continue
    if (typeof cur === "string") {
      if (cur.startsWith("media:")) out.add(cur)
    } else if (Array.isArray(cur)) {
      stack.push(...cur)
    } else if (typeof cur === "object") {
      for (const v of Object.values(cur)) stack.push(v)
    }
  }
  return Array.from(out)
}
