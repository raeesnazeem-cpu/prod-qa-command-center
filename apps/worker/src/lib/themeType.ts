import fs from "fs"
import path from "path"
import axios from "axios"
import { resolveBetaSiteRepo } from "./tedClient"

/**
 * Theme-type detection — tells the checks/fixes whether the target is a CLASSIC
 * PHP theme (page-*.php templates + functions.php, no theme.json) or a BLOCK
 * (FSE) theme (theme.json + templates/*.html). Purely ADDITIVE: every consumer
 * defaults to the existing (block) behaviour when the type is "unknown", so a
 * detection miss never changes what runs today.
 *
 * Hybrid resolution (see resolveThemeType):
 *   1. Repo-preferred — peek the source repo when it is available, either the
 *      local fallback repo (AI_FIX_LOCAL_REPO, read straight off disk) or the
 *      client's beta_site.env repo (GitHub tree, read via the API). This is the
 *      authoritative signal because it sees the actual template files.
 *   2. Front-end fallback — when no repo can be peeked, classify from the
 *      RENDERED HTML of the live site (block themes emit wp-block-* markup and a
 *      global-styles stylesheet; a classic WP site has neither).
 *
 * The AI-fix job already clones the repo, so it re-detects directly from its
 * working tree via detectFromRepoDir(workDir) — the most precise signal of all.
 */

export type ThemeType = "classic" | "block" | "unknown"

const THEME_BASES = ["web/app/themes", "wp-content/themes"]

/** A theme folder that ships as a WP default (Twenty*) — never the site's theme. */
function isCoreTheme(folder: string): boolean {
  return /^twenty/i.test(folder)
}

/**
 * Classify from a flat list of repo-relative paths (works for both a local FS
 * walk and a GitHub git-tree listing). Prefers a non-core theme; block wins over
 * classic when a theme carries both signals (a block theme may still ship a
 * functions.php).
 */
export function classifyFromPaths(paths: string[]): ThemeType {
  const norm = paths.map((p) => p.replace(/\\/g, "/").replace(/^\.?\//, ""))

  // Group the interesting files by theme folder: themes/<base>/<folder>/<rest>.
  type Sig = { themeJson: boolean; templatesHtml: boolean; functionsPhp: boolean; classicTpl: boolean }
  const themes = new Map<string, Sig>()
  const sigFor = (folder: string): Sig => {
    let s = themes.get(folder)
    if (!s) {
      s = { themeJson: false, templatesHtml: false, functionsPhp: false, classicTpl: false }
      themes.set(folder, s)
    }
    return s
  }

  for (const p of norm) {
    for (const base of THEME_BASES) {
      const prefix = `${base}/`
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf("/")
      if (slash <= 0) continue
      const folder = rest.slice(0, slash)
      const tail = rest.slice(slash + 1)
      const s = sigFor(folder)
      if (tail === "theme.json") s.themeJson = true
      else if (/^templates\/.+\.html$/i.test(tail)) s.templatesHtml = true
      else if (tail === "functions.php") s.functionsPhp = true
      else if (/^(index|front-page|page(-[^/]*)?|single|archive|404)\.php$/i.test(tail)) s.classicTpl = true
      break
    }
  }

  const entries = [...themes.entries()]
  const nonCore = entries.filter(([f]) => !isCoreTheme(f))
  const pool = nonCore.length > 0 ? nonCore : entries

  // A theme.json (esp. with templates/*.html) is the definitive block signal.
  const block = pool.find(([, s]) => s.themeJson || s.templatesHtml)
  if (block) return "block"
  // functions.php + classic php templates and no theme.json → classic.
  const classic = pool.find(([, s]) => s.functionsPhp && s.classicTpl)
  if (classic) return "classic"
  return "unknown"
}

/** Recursively list files under a dir (bounded), returning workDir-relative paths. */
function listRepoFiles(workDir: string, maxEntries = 4000): string[] {
  const out: string[] = []
  const walk = (absDir: string, relDir: string, depth: number) => {
    if (out.length >= maxEntries || depth > 6) return
    let names: string[]
    try {
      names = fs.readdirSync(absDir)
    } catch {
      return
    }
    for (const name of names) {
      if (out.length >= maxEntries) return
      if (name === "node_modules" || name === ".git") continue
      const abs = path.join(absDir, name)
      const rel = relDir ? `${relDir}/${name}` : name
      let stat: fs.Stats
      try {
        stat = fs.statSync(abs)
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(abs, rel, depth + 1)
      else out.push(rel)
    }
  }
  // Only walk the theme bases (keeps it fast on a full Bedrock repo).
  for (const base of THEME_BASES) {
    const abs = path.resolve(workDir, base)
    if (fs.existsSync(abs)) walk(abs, base, 0)
  }
  return out
}

/**
 * Detect from a cloned/local repo working directory. Authoritative — reads the
 * actual theme template files. Returns "unknown" if the themes dir is absent.
 */
export function detectFromRepoDir(workDir: string): ThemeType {
  try {
    if (!workDir || !fs.existsSync(workDir)) return "unknown"
    return classifyFromPaths(listRepoFiles(workDir))
  } catch {
    return "unknown"
  }
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

/**
 * Classify from the rendered HTML of the live site. Block themes emit wp-block-*
 * classes and a global-styles inline stylesheet; a classic WP site has WordPress
 * markers (wp-content / wp-json / generator) but none of the block signals.
 */
export function classifyFromHtml(html: string): ThemeType {
  const h = html || ""
  const hasBlock =
    /wp-block-template-part/i.test(h) ||
    /class="[^"]*wp-block-/i.test(h) ||
    /id="global-styles-inline-css"/i.test(h) ||
    /is-layout-(flow|constrained)/i.test(h)
  if (hasBlock) return "block"
  const isWordPress =
    /\/wp-content\//i.test(h) ||
    /\/wp-json/i.test(h) ||
    /\/wp-includes\//i.test(h) ||
    /<meta[^>]+name=["']generator["'][^>]+WordPress/i.test(h)
  if (isWordPress) return "classic"
  return "unknown"
}

/** Detect from the live site's rendered HTML. Best-effort; "unknown" on error. */
export async function detectFromUrl(url: string): Promise<ThemeType> {
  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
      responseType: "text",
      transformResponse: [(d) => d],
      validateStatus: () => true,
    })
    return classifyFromHtml(typeof resp.data === "string" ? resp.data : String(resp.data ?? ""))
  } catch {
    return "unknown"
  }
}

function ownerRepoFromUrl(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

/**
 * Peek a GitHub repo's file tree (one recursive git-tree call) and classify
 * without cloning. Best-effort — needs GIT_FIX_TOKEN; returns "unknown" on any
 * error or rate limit.
 */
async function detectFromGitHub(repoUrl: string): Promise<ThemeType> {
  const token = (process.env.GIT_FIX_TOKEN || "").trim()
  const or = ownerRepoFromUrl(repoUrl)
  if (!token || !or) return "unknown"
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "qacc-theme-detect",
  }
  try {
    const meta = await axios.get(`https://api.github.com/repos/${or.owner}/${or.repo}`, {
      headers,
      timeout: 15000,
      validateStatus: () => true,
    })
    const branch = meta?.data?.default_branch || "main"
    const tree = await axios.get(
      `https://api.github.com/repos/${or.owner}/${or.repo}/git/trees/${branch}?recursive=1`,
      { headers, timeout: 20000, validateStatus: () => true },
    )
    const paths: string[] = Array.isArray(tree?.data?.tree)
      ? tree.data.tree.map((t: any) => String(t?.path || "")).filter(Boolean)
      : []
    if (paths.length === 0) return "unknown"
    return classifyFromPaths(paths)
  } catch {
    return "unknown"
  }
}

/**
 * Hybrid resolver used at scan start. Repo-preferred (local fallback repo → beta
 * repo on GitHub), then the rendered-HTML fallback. Never throws.
 */
export async function resolveThemeType(opts: {
  projectName?: string | null
  siteUrl?: string | null
}): Promise<{ themeType: ThemeType; source: "local-repo" | "github-repo" | "front-end" | "none" }> {
  // 1a. Local fallback repo — read straight off disk (the local-deploy case).
  const localRepo = (process.env.AI_FIX_LOCAL_REPO || "").trim()
  if (localRepo && fs.existsSync(path.join(localRepo, ".git"))) {
    const t = detectFromRepoDir(localRepo)
    if (t !== "unknown") return { themeType: t, source: "local-repo" }
  }

  // 1b. Beta_site.env repo on GitHub — one API call, no clone.
  try {
    const repoUrl = await resolveBetaSiteRepo(opts.projectName || null).catch(() => null)
    if (repoUrl) {
      const t = await detectFromGitHub(repoUrl)
      if (t !== "unknown") return { themeType: t, source: "github-repo" }
    }
  } catch {}

  // 2. Front-end fallback — classify from the rendered site.
  if (opts.siteUrl) {
    const t = await detectFromUrl(opts.siteUrl)
    if (t !== "unknown") return { themeType: t, source: "front-end" }
  }

  return { themeType: "unknown", source: "none" }
}
