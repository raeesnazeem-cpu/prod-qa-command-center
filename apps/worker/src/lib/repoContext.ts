import { execFile } from "child_process"
import { promisify } from "util"
import fs from "fs"
import path from "path"

const execFileAsync = promisify(execFile)

/**
 * Repo retrieval for the AI Fix module.
 *
 * The model used to receive only a truncated `git ls-files` path list and was
 * asked to invent exact `find` substrings — so the substrings usually did not
 * exist and the PRs applied nothing. On a full WordPress checkout the truncation
 * was worse than useless: `wp-admin/**` sorts before `wp-content/**`, so a
 * 400-path slice could contain zero theme files.
 *
 * This module fixes both halves:
 *   1. RANKING — theme/template/mu-plugin code outranks WP core, vendor, minified
 *      bundles and uploads, so truncation never hides the files that matter.
 *   2. CONTENT — candidate files are selected per finding (literal anchors from
 *      the finding text, via `git grep`, plus per-check heuristics) and their
 *      ACTUAL contents are handed to the model, so `find` strings can be copied
 *      verbatim instead of guessed.
 */

const CODE_EXT = /\.(css|scss|less|php|html?|js|jsx|ts|tsx|twig|vue|json)$/i
const HARD_EXCLUDE = /(^|\/)(node_modules|vendor|dist|build|\.git)\//i
const WP_CORE = /^wp-(admin|includes)\//i
const UPLOADS = /^(wp-content\/)?uploads\//i
const MINIFIED = /[.-]min\.(css|js)$/i
const LOCKFILE = /(package-lock|composer\.lock|yarn\.lock)/i

export const MAX_INDEX_FILES = 600
export const MAX_CONTEXT_FILES = 5
export const MAX_FILE_BYTES = 12_000
export const MAX_TOTAL_CONTEXT_BYTES = 44_000
const EXCERPT_CONTEXT_LINES = 40

/** Higher = more likely to be the file a QA finding is actually fixed in. */
export function scorePath(p: string): number {
  let s = 0
  if (/^(wp-content\/)?themes\//i.test(p)) s += 100
  else if (/^(wp-content\/)?mu-plugins\//i.test(p)) s += 40
  else if (/^(wp-content\/)?plugins\//i.test(p)) s += 5
  else s += 60 // theme-only repo: templates live at the repo root

  if (
    /(^|\/)(functions|header|footer|index|front-page|home|single|page|archive|sidebar|searchform|comments)\.php$/i.test(
      p,
    )
  )
    s += 30
  if (/(^|\/)(style|theme|editor-style)\.(css|json)$/i.test(p)) s += 25
  if (
    /(^|\/)(parts|templates|template-parts|patterns|blocks|partials|inc|includes)\//i.test(
      p,
    )
  )
    s += 20
  if (/\.(php|html?|twig)$/i.test(p)) s += 10
  else if (/\.(css|scss|less)$/i.test(p)) s += 6
  else if (/\.(js|jsx|ts|tsx|vue)$/i.test(p)) s += 4
  else s += 2

  s -= Math.min(p.split("/").length, 12) // prefer shallower paths
  return s
}

/**
 * Ranked list of editable files in the clone. Truncation happens AFTER ranking,
 * so theme code always survives it.
 */
export async function buildRepoIndex(workDir: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", workDir, "ls-files"], {
    maxBuffer: 1024 * 1024 * 32,
  })
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(
      (p) =>
        p &&
        CODE_EXT.test(p) &&
        !HARD_EXCLUDE.test(p) &&
        !WP_CORE.test(p) &&
        !UPLOADS.test(p) &&
        !MINIFIED.test(p) &&
        !LOCKFILE.test(p),
    )
    .sort((a, b) => scorePath(b) - scorePath(a) || a.localeCompare(b))
    .slice(0, MAX_INDEX_FILES)
}

const STOPWORDS = new Set([
  "the",
  "and",
  "not",
  "found",
  "missing",
  "page",
  "site",
  "image",
  "link",
  "links",
  "error",
  "check",
  "present",
  "absent",
  "none",
  "html",
  "http",
  "https",
  "strong",
  "code",
  "true",
  "false",
  "null",
])

const stripTags = (s: string) => s.replace(/<\/?[a-z][^>]*>/gi, " ")

/**
 * Literal strings from a finding that are likely to appear verbatim in the repo:
 * quoted text, <code> spans, CSS selectors, URL path segments, filenames.
 * These are what make a `find` substring match on the first try.
 */
export function extractAnchors(f: {
  title?: string | null
  description?: string | null
  context_text?: string | null
}): string[] {
  const raw = [f.title, f.description, f.context_text]
    .filter(Boolean)
    .join("\n")
  const out = new Set<string>()

  for (const m of raw.matchAll(/<code>([^<]{3,80})<\/code>/gi))
    out.add(m[1].trim())

  // Attribute values from markup quoted in the finding — class/href/src/alt land
  // verbatim in templates, so they are the strongest anchors available. Must be
  // read BEFORE tags are stripped.
  for (const m of raw.matchAll(
    /\b(?:class|id|href|src|srcset|alt|title|aria-label|data-[\w-]+)=["']([^"'\n]{3,120})["']/gi,
  )) {
    const v = m[1].trim()
    out.add(v)
    // A class attribute is a list; each class is independently greppable.
    if (/\s/.test(v) && !/[/<>]/.test(v))
      for (const cls of v.split(/\s+/)) if (cls.length >= 5) out.add(cls)
  }

  const text = stripTags(raw)

  for (const m of text.matchAll(/["'“”]([^"'“”\n]{4,80})["'“”]/g))
    out.add(m[1].trim())
  for (const m of text.matchAll(/(?:^|[\s(>])([.#][A-Za-z_][\w-]{3,60})/g))
    out.add(m[1])
  for (const m of text.matchAll(
    /[\w-]{2,40}\.(?:php|css|js|json|twig|html?)\b/gi,
  ))
    out.add(m[0])
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    try {
      const u = new URL(m[0])
      const p = u.pathname.replace(/\/$/, "")
      if (p && p !== "/") {
        out.add(p)
        const seg = p.split("/").filter(Boolean).pop()
        if (seg && seg.length >= 4) out.add(seg)
      }
    } catch {}
  }
  // Longest bare phrase in the title — catches dummy copy and stale headings.
  const phrase = text.match(/[A-Z][A-Za-z0-9 ,'-]{14,70}/)
  if (phrase) out.add(phrase[0].trim())

  return [...out]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(
      (s) =>
        s.length >= 4 &&
        s.length <= 80 &&
        !STOPWORDS.has(s.toLowerCase()) &&
        !/^[\d\s.,%-]+$/.test(s),
    )
    .slice(0, 12)
}

/** Per-check bias for which files to open when the anchors find nothing. */
const FACTOR_HINTS: Record<string, RegExp> = {
  hero_media:
    /(front-page|home|hero|cover|header|index)\.(php|html?)$|(patterns|parts|templates)\/|style\.css$|theme\.json$/i,
  privacy_policy: /(footer|privacy)/i,
  footer_logo: /footer/i,
  top_bar_sticky: /(header|style\.css|theme\.json)/i,
  favicon: /(functions\.php|header\.php|theme\.json|site-icon|favicon)/i,
  dead_links: /(footer|header|parts\/|templates\/|patterns\/)/i,
  contact_form: /(contact|form)/i,
  chatbot_consultation: /(functions\.php|footer)/i,
  logo_chatbot: /(functions\.php|footer|header)/i,
  callnow_links: /(header|footer|contact)/i,
  social_share_heading: /(single|share|social)/i,
  image_quality: /\.(php|html?)$/i,
  image_compliance: /\.(php|html?)$/i,
  false_breakpoint: /\.(css|scss|less)$/i,
  accessibility: /\.(php|html?|css)$/i,
  meta_check: /(header\.php|functions\.php|theme\.json)/i,
  dummy_content: /(patterns|parts|templates)\/|\.(php|html?)$/i,
  spelling: /(patterns|parts|templates)\/|\.(php|html?)$/i,
  grammar: /(patterns|parts|templates)\/|\.(php|html?)$/i,
}

const gitGrepExcludes = [
  "--",
  ":(exclude)wp-admin",
  ":(exclude)wp-includes",
  ":(exclude)**/node_modules/**",
  ":(exclude)**/vendor/**",
  ":(exclude)**/*.min.js",
  ":(exclude)**/*.min.css",
]

/** files → number of matching lines, for the given literal anchors. */
async function grepHits(
  workDir: string,
  anchors: string[],
): Promise<Map<string, number>> {
  const hits = new Map<string, number>()
  if (anchors.length === 0) return hits
  const args = [
    "-C",
    workDir,
    "grep",
    "-I", // skip binary
    "-F", // fixed strings, never regex
    "-c", // count per file
    "-i",
    ...anchors.flatMap((a) => ["-e", a]),
    ...gitGrepExcludes,
  ]
  try {
    const { stdout } = await execFileAsync("git", args, {
      maxBuffer: 1024 * 1024 * 16,
    })
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(.*):(\d+)$/)
      if (!m) continue
      const p = m[1]
      if (!CODE_EXT.test(p) || MINIFIED.test(p)) continue
      hits.set(p, (hits.get(p) || 0) + Number(m[2]))
    }
  } catch {
    // git grep exits 1 when nothing matched — not an error here.
  }
  return hits
}

export interface RepoContext {
  files: string[]
  block: string
  anchors: string[]
  matchedAnchors: boolean
}

function excerptFor(
  content: string,
  anchors: string[],
): { label: string; text: string } {
  if (Buffer.byteLength(content, "utf8") <= MAX_FILE_BYTES)
    return { label: "(full file)", text: content }

  const lines = content.split("\n")
  const lower = lines.map((l) => l.toLowerCase())
  const wanted = new Set<number>()
  for (const a of anchors) {
    const needle = a.toLowerCase()
    for (let i = 0; i < lower.length; i++) {
      if (lower[i].includes(needle)) {
        for (
          let j = Math.max(0, i - EXCERPT_CONTEXT_LINES);
          j <= Math.min(lines.length - 1, i + EXCERPT_CONTEXT_LINES);
          j++
        )
          wanted.add(j)
      }
    }
  }

  if (wanted.size === 0) {
    // No anchor in this file — show the head, which is where template markup
    // and enqueue/setup code lives.
    let acc = ""
    let n = 0
    for (const l of lines) {
      if (Buffer.byteLength(acc, "utf8") + l.length + 1 > MAX_FILE_BYTES) break
      acc += l + "\n"
      n++
    }
    return { label: `(first ${n} of ${lines.length} lines)`, text: acc }
  }

  const idx = [...wanted].sort((a, b) => a - b)
  let out = ""
  let prev = -2
  for (const i of idx) {
    if (Buffer.byteLength(out, "utf8") + lines[i].length + 1 > MAX_FILE_BYTES)
      break
    if (i !== prev + 1) out += `\n… (lines ${prev + 2}–${i} omitted) …\n`
    out += lines[i] + "\n"
    prev = i
  }
  return {
    label: `(excerpts of ${lines.length} lines — omitted regions are marked)`,
    text: out,
  }
}

/**
 * Select the files most likely to contain the fix for one finding and return
 * their real contents, ready to paste into a prompt.
 */
export async function gatherRepoContext(
  workDir: string,
  index: string[],
  finding: {
    check_factor?: string | null
    title?: string | null
    description?: string | null
    context_text?: string | null
  },
): Promise<RepoContext> {
  const anchors = extractAnchors(finding)
  const hits = await grepHits(workDir, anchors)
  const hint = FACTOR_HINTS[String(finding.check_factor || "")]

  const scored = index.map((p) => {
    let s = scorePath(p)
    const h = hits.get(p)
    if (h) s += 200 + Math.min(h, 20) * 10 // a literal match dominates
    if (hint && hint.test(p)) s += 45
    return { p, s, matched: !!h }
  })

  // git grep can surface files the (truncated) index dropped — keep those too.
  for (const [p, h] of hits) {
    if (index.includes(p)) continue
    if (HARD_EXCLUDE.test(p) || WP_CORE.test(p) || UPLOADS.test(p)) continue
    scored.push({
      p,
      s: scorePath(p) + 200 + Math.min(h, 20) * 10,
      matched: true,
    })
  }

  scored.sort((a, b) => b.s - a.s || a.p.localeCompare(b.p))
  const picked = scored.slice(0, MAX_CONTEXT_FILES)

  const parts: string[] = []
  const files: string[] = []
  let total = 0
  for (const { p } of picked) {
    const abs = path.join(workDir, p)
    if (!abs.startsWith(workDir)) continue
    let content: string
    try {
      const stat = await fs.promises.stat(abs)
      if (!stat.isFile() || stat.size > 1024 * 1024) continue
      content = await fs.promises.readFile(abs, "utf8")
    } catch {
      continue
    }
    if (content.includes("\u0000")) continue // binary
    const body = excerptFor(content, anchors)
    const chunk = `----- FILE: ${p} ${body.label} -----\n${body.text}\n----- END FILE: ${p} -----`
    const size = Buffer.byteLength(chunk, "utf8")
    if (total + size > MAX_TOTAL_CONTEXT_BYTES && files.length > 0) break
    total += size
    parts.push(chunk)
    files.push(p)
  }

  return {
    files,
    block: parts.join("\n\n"),
    anchors,
    matchedAnchors: hits.size > 0,
  }
}

export interface ApplyResult {
  ok: boolean
  reason: string
  mode?: "exact" | "whitespace" | "anchored"
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Apply one search/replace edit, tolerating the whitespace and indentation the
 * model reliably mangles. Never applies a match that is ambiguous or trivially
 * short — a bad silent edit is worse than no edit.
 */
export async function applyEdit(
  workDir: string,
  edit: { path: string; find: string; replace: string },
  allowedFiles: string[],
): Promise<ApplyResult> {
  const rel = edit.path.replace(/^\.?\//, "")
  if (allowedFiles.length > 0 && !allowedFiles.includes(rel))
    return { ok: false, reason: `path not among the files provided (${rel})` }

  const abs = path.resolve(workDir, rel)
  if (!abs.startsWith(path.resolve(workDir) + path.sep))
    return { ok: false, reason: "path escapes the repository" }
  if (!fs.existsSync(abs)) return { ok: false, reason: "file does not exist" }

  const find = edit.find
  if (!find.trim()) return { ok: false, reason: "empty find string" }
  if (find.trim().length < 8)
    return { ok: false, reason: "find string too short to be unambiguous" }
  if (find === edit.replace) return { ok: false, reason: "no-op edit" }

  const before = await fs.promises.readFile(abs, "utf8")
  let after: string | null = null
  let mode: ApplyResult["mode"] | undefined

  // 1. exact
  const exactCount = before.split(find).length - 1
  if (exactCount === 1) {
    after = before.replace(find, edit.replace)
    mode = "exact"
  } else if (exactCount > 1) {
    return {
      ok: false,
      reason: `find string occurs ${exactCount} times — ambiguous`,
    }
  } else {
    // 2. whitespace-tolerant: models re-indent and re-wrap constantly
    const flexible = new RegExp(
      find.trim().split(/\s+/).map(escapeRe).join("\\s+"),
      "g",
    )
    const matches = before.match(flexible)
    if (matches && matches.length === 1) {
      after = before.replace(flexible, () => edit.replace)
      mode = "whitespace"
    } else if (matches && matches.length > 1) {
      return {
        ok: false,
        reason: `find string matches ${matches.length} regions after whitespace normalisation — ambiguous`,
      }
    } else {
      // 3. anchored: first and last non-empty line of `find` bracket a region
      const fl = find
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
      if (fl.length >= 2) {
        const first = fl[0]
        const last = fl[fl.length - 1]
        const start = before.indexOf(first)
        const end = start >= 0 ? before.indexOf(last, start + first.length) : -1
        if (
          start >= 0 &&
          end > start &&
          before.indexOf(first, start + 1) === -1 &&
          end - start < 8000
        ) {
          after =
            before.slice(0, start) +
            edit.replace +
            before.slice(end + last.length)
          mode = "anchored"
        }
      }
    }
  }

  if (after === null)
    return { ok: false, reason: "find string not present in the file" }
  if (after === before) return { ok: false, reason: "edit changed nothing" }

  // Sanity: never let one edit rewrite the whole file.
  const beforeLen = Buffer.byteLength(before, "utf8")
  const afterLen = Buffer.byteLength(after, "utf8")
  if (
    beforeLen > 200 &&
    (afterLen < beforeLen * 0.5 || afterLen > beforeLen * 2)
  )
    return {
      ok: false,
      reason: `edit would change file size ${beforeLen}→${afterLen} bytes — rejected as unsafe`,
    }

  await fs.promises.writeFile(abs, after, "utf8")

  // Verify the write actually landed.
  const verify = await fs.promises.readFile(abs, "utf8")
  if (verify !== after) {
    await fs.promises.writeFile(abs, before, "utf8")
    return { ok: false, reason: "verification after write failed; reverted" }
  }
  if (
    edit.replace.trim() &&
    !verify.includes(edit.replace.trim().slice(0, 40))
  ) {
    await fs.promises.writeFile(abs, before, "utf8")
    return { ok: false, reason: "replacement not found after write; reverted" }
  }

  return { ok: true, reason: `applied (${mode} match)`, mode }
}
