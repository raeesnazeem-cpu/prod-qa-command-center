import fs from "fs"
import path from "path"
import type { ThemeType } from "./themeType"

/**
 * Deterministic repo fix for a missing Growth99 single-script embed.
 *
 * The embed is the "G99+ Cliff Hanger Code" from the client's Basecamp Message
 * Board — a business-id div + the integration loader script (data-id differs per
 * client):
 *   <div id="buisness-id" data-id="<bid>"></div>
 *   <script id="integration-script" src="https://chatbot.growth99.com/assets/js/integration.js"></script>
 *
 * It is a one-time, SITE-WIDE snippet, so we inject it into the footer template
 * (block → parts/footer.html as a wp:html block; classic → footer.php before
 * </footer>) — the footer renders on every page, so the loader loads globally.
 *
 * Idempotent (skips when the integration loader is already in the footer) and
 * additive. Returns { changed:false } when no footer template resolves so the
 * caller reports a manual fix.
 */

const LOADER = "chatbot.growth99.com/assets/js/integration.js"
const THEME_BASES = ["web/app/themes", "wp-content/themes"]

export interface SingleScriptFixResult {
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

function snippetFor(businessId: string, scriptSrc: string): string {
  return (
    `<div id="buisness-id" data-id="${businessId}"></div>` +
    `<script id="integration-script" src="${scriptSrc}"></script>`
  )
}

export async function injectSingleScriptIntoFooter(
  workDir: string,
  themeType: ThemeType | undefined,
  opts: { businessId: string; scriptSrc: string },
): Promise<SingleScriptFixResult> {
  const snippet = snippetFor(opts.businessId, opts.scriptSrc)
  const dirRel = resolveThemeDirRel(workDir, themeType)
  if (!dirRel) return { changed: false, files: [], note: "no theme dir for single-script inject" }

  // BLOCK → parts/footer.html (wrap as a wp:html block).
  const blockRel = `${dirRel}/parts/footer.html`
  const blockAbs = path.resolve(workDir, blockRel)
  if (themeType !== "classic" && fs.existsSync(blockAbs)) {
    const src = await fs.promises.readFile(blockAbs, "utf8").catch(() => "")
    if (src.includes(LOADER)) {
      return { changed: false, files: [], note: "footer already loads the single-script embed" }
    }
    const block = `\n<!-- wp:html -->\n${snippet}\n<!-- /wp:html -->\n`
    await fs.promises.writeFile(blockAbs, src.replace(/\s*$/, "\n") + block, "utf8")
    return { changed: true, files: [blockRel], note: "injected the single-script embed into parts/footer.html (site-wide)" }
  }

  // CLASSIC → footer.php, before </footer> (else before wp_footer()/at end).
  const phpRel = `${dirRel}/footer.php`
  const phpAbs = path.resolve(workDir, phpRel)
  if (fs.existsSync(phpAbs)) {
    const src = await fs.promises.readFile(phpAbs, "utf8").catch(() => "")
    if (src.includes(LOADER)) {
      return { changed: false, files: [], note: "footer already loads the single-script embed" }
    }
    let next: string
    if (/<\/footer>/i.test(src)) {
      next = src.replace(/<\/footer>/i, `${snippet}\n</footer>`)
    } else if (/<\?php\s+wp_footer/i.test(src)) {
      next = src.replace(/(<\?php\s+wp_footer)/i, `${snippet}\n$1`)
    } else {
      next = src.replace(/\s*$/, "\n") + snippet + "\n"
    }
    await fs.promises.writeFile(phpAbs, next, "utf8")
    return { changed: true, files: [phpRel], note: "injected the single-script embed into footer.php (site-wide)" }
  }

  return { changed: false, files: [], note: "no footer template (parts/footer.html or footer.php) found" }
}
