import fs from "fs"
import path from "path"
import type { ThemeType } from "./themeType"

/**
 * Deterministic repo fix for a missing/wrong footer logo.
 *
 * Adds a "Developed & maintained by <Growth99 logo>" credit line into the site
 * footer template. Two brand assets, picked by the FOOTER BACKGROUND:
 *   • dark background  → the white full logo (SVG)
 *   • light background → the colour full logo (WebP), where black text is legible
 * The caller decides the variant (a vision/luminance read of the footer
 * screenshot — see aiFixRunJob). The logo height is set in `em`, so it always
 * resizes to the credit text sitting next to it. Block theme → parts/footer.html
 * (wrapped as a wp:html block); classic theme → footer.php (before </footer>).
 *
 * Idempotent (skips when the credit is already present) and additive — it never
 * edits or removes existing footer markup. Returns { changed:false } when no
 * footer template can be resolved so the caller reports it as a manual fix.
 */

// White full logo for DARK footers (URL supplied by the team).
export const GROWTH99_LOGO_WHITE_SVG =
  "https://growth99.com/storage/2024/09/logo-white-full-growth99.svg"
// Colour full logo for LIGHT footers. NOTE: confirm this WebP URL with the team
// — only the white SVG URL was provided; this is the same storage path with the
// non-white asset name and may need correcting.
export const GROWTH99_LOGO_COLOR_WEBP =
  "https://growth99.com/storage/2024/09/logo-full-growth99.webp"

const CREDIT_MARKER = "qacc-dev-credit"
const THEME_BASES = ["web/app/themes", "wp-content/themes"]

export interface FooterLogoFixResult {
  changed: boolean
  files: string[]
  note: string
  variant?: "white" | "color"
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

/** The credit line markup. `em` height ties the logo size to the adjacent text. */
function creditHtml(logoUrl: string): string {
  return (
    `<p class="${CREDIT_MARKER}" style="display:flex;align-items:center;justify-content:center;gap:8px;margin:12px 0;font-size:14px;line-height:1.4;">` +
    `<span>Developed &amp; maintained by</span>` +
    `<a href="https://growth99.com" target="_blank" rel="noopener">` +
    `<img src="${logoUrl}" alt="Growth99" style="height:1.4em;width:auto;vertical-align:middle;display:inline-block;">` +
    `</a></p>`
  )
}

export async function applyFooterLogoFix(
  workDir: string,
  themeType: ThemeType | undefined,
  opts: { variant: "white" | "color" },
): Promise<FooterLogoFixResult> {
  const logoUrl =
    opts.variant === "white" ? GROWTH99_LOGO_WHITE_SVG : GROWTH99_LOGO_COLOR_WEBP
  const credit = creditHtml(logoUrl)
  const dirRel = resolveThemeDirRel(workDir, themeType)
  if (!dirRel) return { changed: false, files: [], note: "no theme dir for footer logo" }

  // BLOCK → parts/footer.html (wrap the credit as a wp:html block).
  const blockRel = `${dirRel}/parts/footer.html`
  const blockAbs = path.resolve(workDir, blockRel)
  if (themeType !== "classic" && fs.existsSync(blockAbs)) {
    const src = await fs.promises.readFile(blockAbs, "utf8").catch(() => "")
    if (src.includes(CREDIT_MARKER)) {
      return { changed: false, files: [], note: "footer already carries the Growth99 credit", variant: opts.variant }
    }
    const block = `\n<!-- wp:html -->\n${credit}\n<!-- /wp:html -->\n`
    // Append inside the footer part (it renders within the footer region).
    await fs.promises.writeFile(blockAbs, src.replace(/\s*$/, "\n") + block, "utf8")
    return {
      changed: true,
      files: [blockRel],
      note: `added the Growth99 ${opts.variant} logo credit to parts/footer.html`,
      variant: opts.variant,
    }
  }

  // CLASSIC → footer.php, before </footer> (else before wp_footer()/at end).
  const phpRel = `${dirRel}/footer.php`
  const phpAbs = path.resolve(workDir, phpRel)
  if (fs.existsSync(phpAbs)) {
    const src = await fs.promises.readFile(phpAbs, "utf8").catch(() => "")
    if (src.includes(CREDIT_MARKER)) {
      return { changed: false, files: [], note: "footer already carries the Growth99 credit", variant: opts.variant }
    }
    let next: string
    if (/<\/footer>/i.test(src)) {
      next = src.replace(/<\/footer>/i, `${credit}\n</footer>`)
    } else if (/<\?php\s+wp_footer/i.test(src)) {
      next = src.replace(/(<\?php\s+wp_footer)/i, `${credit}\n$1`)
    } else {
      next = src.replace(/\s*$/, "\n") + credit + "\n"
    }
    await fs.promises.writeFile(phpAbs, next, "utf8")
    return {
      changed: true,
      files: [phpRel],
      note: `added the Growth99 ${opts.variant} logo credit to footer.php`,
      variant: opts.variant,
    }
  }

  return { changed: false, files: [], note: "no footer template (parts/footer.html or footer.php) found", variant: opts.variant }
}
