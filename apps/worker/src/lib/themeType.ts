import fs from "fs"
import path from "path"
import axios from "axios"
import { resolveBetaSiteRepo } from "./tedClient"
import { ownerRepoFromUrl, resolveGitFixToken } from "./githubRepo"
import { repoKindFromPaths, type RepoKind } from "./gitopsResource"

/**
 * Theme-type detection — tells the checks/fixes whether the target is a CLASSIC
 * PHP theme (page-*.php templates + functions.php, no theme.json) or a BLOCK
 * (FSE) theme (theme.json + templates/*.html). Purely ADDITIVE: every consumer
 * defaults to the existing (block) behaviour when the type is "unknown", so a
 * detection miss never changes what runs today.
 *
 * Hybrid resolution (see resolveThemeType):
 *   1. Repo-preferred — peek the client's GitHub repo (TED client page) when available
 *      (GitHub tree, read via the API). This is the authoritative signal because
 *      it sees the actual template files. (There is NO local fallback repo.)
 *      The same tree also tells the repo kind: a GitOps content repo
 *      (resources/ + g99-control) carries no theme files, so its theme type
 *      comes from step 2.
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

/**
 * Peek a GitHub repo's file tree (one recursive git-tree call, no clone) and
 * classify both the repo kind and — for theme repos — the theme type.
 * Uses the per-repo token override when set, else GIT_FIX_TOKEN. Stops after the
 * first call when GitHub says the repo is missing or not readable (404/403),
 * so no further requests go to a repo that can't be opened. Best-effort:
 * { repoKind: null, themeType: "unknown" } on any miss.
 */
async function detectFromGitHub(
  repoUrl: string,
): Promise<{ repoKind: RepoKind | null; themeType: ThemeType }> {
  const none = { repoKind: null, themeType: "unknown" as ThemeType }
  const or = ownerRepoFromUrl(repoUrl)
  const token = (resolveGitFixToken(or) ?? process.env.GIT_FIX_TOKEN ?? "").trim()
  if (!token || !or) return none
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
    if (meta.status !== 200 || !meta.data?.default_branch) return none
    const branch = meta.data.default_branch
    const tree = await axios.get(
      `https://api.github.com/repos/${or.owner}/${or.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers, timeout: 20000, validateStatus: () => true },
    )
    const paths: string[] = Array.isArray(tree?.data?.tree)
      ? tree.data.tree.map((t: any) => String(t?.path || "")).filter(Boolean)
      : []
    if (paths.length === 0) return none
    const repoKind = repoKindFromPaths(paths)
    // A GitOps repo holds page content, not theme files — no theme signal here.
    return { repoKind, themeType: repoKind === "gitops" ? "unknown" : classifyFromPaths(paths) }
  } catch {
    return none
  }
}

/**
 * Hybrid resolver used at scan start. Repo-preferred (the TED client page
 * GitHub repo), then the rendered-HTML fallback. Never throws. No local fallback repo.
 * `clientKey` is the TED client id (preferred) or name used to find the repo.
 * Also returns the repo kind (gitops | theme) when the repo could be read.
 */
export async function resolveThemeType(opts: {
  clientKey?: string | null
  siteUrl?: string | null
}): Promise<{
  themeType: ThemeType
  source: "github-repo" | "front-end" | "none"
  repoKind: RepoKind | null
}> {
  // 1. TED client page GitHub repo — two API calls, no clone.
  let repoKind: RepoKind | null = null
  try {
    const repoUrl = await resolveBetaSiteRepo(opts.clientKey || null).catch(() => null)
    if (repoUrl) {
      const r = await detectFromGitHub(repoUrl)
      repoKind = r.repoKind
      if (r.themeType !== "unknown") return { themeType: r.themeType, source: "github-repo", repoKind }
    }
  } catch {}
  // 2. Front-end fallback — classify from the rendered site (the only signal for
  //    a GitOps repo, and for any repo that could not be read).
  if (opts.siteUrl) {
    const t = await detectFromUrl(opts.siteUrl)
    if (t !== "unknown") return { themeType: t, source: "front-end", repoKind }
  }
  return { themeType: "unknown", source: "none", repoKind }
}
