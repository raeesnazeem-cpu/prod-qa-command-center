import fs from "fs"
import path from "path"
import type { ThemeType } from "./themeType"

/**
 * Deterministic repo fix for the Learn More Buttons check.
 *
 * The check flags generic CTA buttons/links whose text is "Learn More", "Read
 * More", "Know More" or "See More". The fix is to REMOVE the offending element.
 *
 * Theme-aware only in WHICH files we scan (block templates/parts/patterns/*.html
 * + patterns/*.php; classic theme *.php templates). The removal itself covers:
 *   • a Gutenberg button block: `<!-- wp:button … -->…<!-- /wp:button -->`
 *     (and the empty `<!-- wp:buttons -->` wrapper if it's left with none), and
 *   • a plain `<a …>…</a>` / `<button …>…</button>` whose text matches.
 *
 * Only touches the theme repo. When the button lives in DB/page content (the
 * usual case for a WP page), nothing matches in the repo and this returns
 * { changed:false } so the AI-fix pass reports it as a manual removal.
 */

const PHRASES = ["learn more", "read more", "know more", "see more"]
const THEME_BASES = ["web/app/themes", "wp-content/themes"]
const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", "build", ".git"])

export interface LearnMoreFixResult {
  changed: boolean
  files: string[]
  removed: number
  description: string
  note: string
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ")
function hasPhrase(html: string): boolean {
  const t = stripTags(html).toLowerCase()
  return PHRASES.some((p) => t.includes(p))
}

/** Resolve the active non-core theme dir (repo-relative). Prefer the theme type. */
function resolveThemeDir(workDir: string, themeType?: ThemeType): string | null {
  const classic: string[] = []
  const block: string[] = []
  for (const base of THEME_BASES) {
    const abs = path.resolve(workDir, base)
    if (!fs.existsSync(abs)) continue
    let names: string[] = []
    try {
      names = fs.readdirSync(abs)
    } catch {
      continue
    }
    for (const name of names) {
      if (/^twenty/i.test(name)) continue
      const dir = path.join(abs, name)
      if (!fs.existsSync(path.join(dir, "functions.php")) && !fs.existsSync(path.join(dir, "theme.json"))) continue
      const rel = `${base}/${name}`
      if (fs.existsSync(path.join(dir, "theme.json"))) block.push(rel)
      else classic.push(rel)
    }
  }
  const pick =
    themeType === "classic"
      ? classic[0] || block[0]
      : themeType === "block"
        ? block[0] || classic[0]
        : block[0] || classic[0]
  return pick || null
}

/** Recursively collect .html/.php files under a dir (repo-relative paths). */
function collectFiles(workDir: string, relDir: string, out: string[] = []): string[] {
  const abs = path.resolve(workDir, relDir)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue
    const rel = `${relDir}/${e.name}`
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      collectFiles(workDir, rel, out)
    } else if (/\.(html?|php)$/i.test(e.name)) {
      out.push(rel)
    }
  }
  return out
}

/** Remove matching CTA elements from one file's source. Returns [next, removed]. */
export function stripLearnMore(src: string): { next: string; removed: number } {
  let removed = 0
  let out = src

  // 1. Gutenberg buttons wrappers: drop matching wp:button blocks, and the
  //    whole wp:buttons wrapper if it ends up with no buttons.
  out = out.replace(
    /<!--\s*wp:buttons\b[\s\S]*?<!--\s*\/wp:buttons\s*-->/gi,
    (wrapper) => {
      const inner = wrapper.replace(
        /<!--\s*wp:button\b[\s\S]*?<!--\s*\/wp:button\s*-->/gi,
        (btn) => {
          if (hasPhrase(btn)) {
            removed++
            return ""
          }
          return btn
        },
      )
      // No wp:button left inside → remove the wrapper entirely.
      if (!/<!--\s*wp:button\b/i.test(inner)) return ""
      return inner
    },
  )

  // 2. Standalone Gutenberg button blocks (not inside a wrapper).
  out = out.replace(
    /<!--\s*wp:button\b[\s\S]*?<!--\s*\/wp:button\s*-->/gi,
    (btn) => {
      if (hasPhrase(btn)) {
        removed++
        return ""
      }
      return btn
    },
  )

  // 3. Plain anchors / buttons whose visible text matches.
  out = out.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (el) => {
    if (hasPhrase(el)) {
      removed++
      return ""
    }
    return el
  })
  out = out.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, (el) => {
    if (hasPhrase(el)) {
      removed++
      return ""
    }
    return el
  })

  return { next: out, removed }
}

export async function removeLearnMoreButtons(
  workDir: string,
  themeType?: ThemeType,
): Promise<LearnMoreFixResult> {
  const miss: LearnMoreFixResult = { changed: false, files: [], removed: 0, description: "", note: "" }
  const themeDir = resolveThemeDir(workDir, themeType)
  if (!themeDir) return { ...miss, note: "could not resolve an active theme dir" }

  const files = collectFiles(workDir, themeDir)
  const changedFiles: string[] = []
  let total = 0

  for (const rel of files) {
    const abs = path.resolve(workDir, rel)
    let src: string
    try {
      src = await fs.promises.readFile(abs, "utf8")
    } catch {
      continue
    }
    if (!hasPhrase(src)) continue
    const { next, removed } = stripLearnMore(src)
    if (removed > 0 && next !== src) {
      // Tidy any empty buttons container left behind.
      const cleaned = next.replace(/<div class="wp-block-buttons[^"]*"[^>]*>\s*<\/div>/gi, "")
      await fs.promises.writeFile(abs, cleaned, "utf8")
      changedFiles.push(rel)
      total += removed
    }
  }

  if (changedFiles.length === 0) {
    return { ...miss, note: "no Learn More markup found in the theme repo (likely page/database content)" }
  }
  return {
    changed: true,
    files: changedFiles,
    removed: total,
    description: `Removed ${total} generic "Learn More"-style CTA ${total === 1 ? "button" : "buttons"} from the theme (${changedFiles.join(", ")}).`,
    note: `stripped ${total} CTA element(s) from ${changedFiles.length} file(s)`,
  }
}
