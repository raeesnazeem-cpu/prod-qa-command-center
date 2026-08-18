import fs from "fs"
import path from "path"
import type { ThemeType } from "./themeType"

/**
 * Deterministic repo fix for a header that does not stick.
 *
 * The top_bar_sticky check now passes a header that either stays pinned after an
 * ~800px scroll OR declares computed `position:sticky`. When neither is true, the
 * fix is to make the header sticky: inject a small CSS rule that sets
 * `position:sticky; top:0` (plus a z-index so it rides above page content) on the
 * header element into the theme's header template.
 *
 * Theme-aware, mirroring the footer-logo/single-script fixers:
 *   • block theme  → parts/header.html (wrapped as a wp:html block)
 *   • classic theme → header.php (before wp_head(), else at the top)
 *
 * Idempotent (skips when the rule is already present) and additive — it never
 * edits or removes existing header markup. Returns { changed:false } when no
 * header template can be resolved so the caller reports it as a manual fix.
 */

const STICKY_MARKER = "qacc-sticky-header"
const THEME_BASES = ["web/app/themes", "wp-content/themes"]

// The header selectors mirror HEADER_SELECTOR_* in the top_bar_sticky check so
// the CSS targets the same element the check measures.
const HEADER_SELECTORS =
  "header, [role=\"banner\"], .wp-block-template-part[class*=\"header\"], .site-header, #masthead"

export interface StickyHeaderFixResult {
  changed: boolean
  files: string[]
  note: string
}

function resolveThemeDirRel(workDir: string, themeType?: ThemeType): string | null {
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
      const hasFn = fs.existsSync(path.join(dir, "functions.php"))
      const hasJson = fs.existsSync(path.join(dir, "theme.json"))
      if (!hasFn && !hasJson) continue
      const rel = `${base}/${name}`
      if (hasJson) block.push(rel)
      else classic.push(rel)
    }
  }
  if (themeType === "classic") return classic[0] || block[0] || null
  if (themeType === "block") return block[0] || classic[0] || null
  return block[0] || classic[0] || null
}

/** The sticky-header CSS, wrapped in a marked <style> so it is idempotent. */
function stickyStyle(): string {
  return (
    `<style id="${STICKY_MARKER}">` +
    `${HEADER_SELECTORS}{position:sticky;top:0;z-index:999;}` +
    `</style>`
  )
}

export async function applyStickyHeaderFix(
  workDir: string,
  themeType: ThemeType | undefined,
): Promise<StickyHeaderFixResult> {
  const style = stickyStyle()
  const dirRel = resolveThemeDirRel(workDir, themeType)
  if (!dirRel) return { changed: false, files: [], note: "no theme dir for sticky header" }

  // BLOCK → parts/header.html (prepend the style as a wp:html block so it loads
  // wherever the header part renders).
  const blockRel = `${dirRel}/parts/header.html`
  const blockAbs = path.resolve(workDir, blockRel)
  if (themeType !== "classic" && fs.existsSync(blockAbs)) {
    const src = await fs.promises.readFile(blockAbs, "utf8").catch(() => "")
    if (src.includes(STICKY_MARKER)) {
      return { changed: false, files: [], note: "header template already carries the sticky rule" }
    }
    const block = `<!-- wp:html -->\n${style}\n<!-- /wp:html -->\n`
    await fs.promises.writeFile(blockAbs, block + src, "utf8")
    return {
      changed: true,
      files: [blockRel],
      note: "added position:sticky;top:0 to the header via parts/header.html",
    }
  }

  // CLASSIC → header.php, before wp_head() (else at the very top of the file).
  const phpRel = `${dirRel}/header.php`
  const phpAbs = path.resolve(workDir, phpRel)
  if (fs.existsSync(phpAbs)) {
    const src = await fs.promises.readFile(phpAbs, "utf8").catch(() => "")
    if (src.includes(STICKY_MARKER)) {
      return { changed: false, files: [], note: "header template already carries the sticky rule" }
    }
    let next: string
    if (/<\?php\s+wp_head/i.test(src)) {
      next = src.replace(/(<\?php\s+wp_head)/i, `${style}\n$1`)
    } else if (/<\/head>/i.test(src)) {
      next = src.replace(/<\/head>/i, `${style}\n</head>`)
    } else {
      next = style + "\n" + src
    }
    await fs.promises.writeFile(phpAbs, next, "utf8")
    return {
      changed: true,
      files: [phpRel],
      note: "added position:sticky;top:0 to the header via header.php",
    }
  }

  return { changed: false, files: [], note: "no header template (parts/header.html or header.php) found" }
}
