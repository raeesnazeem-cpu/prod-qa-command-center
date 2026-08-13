import fs from "fs"
import path from "path"

/**
 * Classic-theme page provisioner — the classic-PHP counterpart to the WP
 * Playground blueprint seed used for block/FSE repos.
 *
 * In a CLASSIC theme the content model is "one page = one `page-<slug>.php`
 * template" and pages are auto-created on theme activation by the `$pages` array
 * in `functions.php` (the `after_switch_theme` provisioner). So the repo-native
 * way to add a page here is NOT a blueprint runPHP step (a classic Bedrock repo
 * usually has no blueprint) — it is:
 *   1. write `page-<slug>.php` (a `Template Name:` template that renders the
 *      content between get_header()/get_footer()), and
 *   2. register the page in the theme's `functions.php` `$pages` array so the
 *      activation hook provisions it (title + slug + template).
 *
 * Purely additive and idempotent: skips the template file if it already exists,
 * and skips the functions.php edit if the page (by slug or template file) is
 * already registered. Returns { changed:false } when no classic theme with a
 * functions.php can be resolved, so callers can fall back to the blueprint seed.
 */

const THEME_BASES = ["web/app/themes", "wp-content/themes"]

export interface ClassicProvisionResult {
  changed: boolean
  files: string[]
  description: string
  note: string
}

/**
 * Resolve the active CLASSIC theme directory (repo-relative). Prefers a non-core
 * (non-Twenty*) theme that has functions.php and NO theme.json (i.e. classic,
 * not block). Returns null when none is found.
 */
export function resolveClassicThemeDir(
  workDir: string,
): { folder: string; dirRel: string } | null {
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
      const themeAbs = path.join(abs, name)
      const hasFunctions = fs.existsSync(path.join(themeAbs, "functions.php"))
      const hasThemeJson = fs.existsSync(path.join(themeAbs, "theme.json"))
      if (hasFunctions && !hasThemeJson) {
        return { folder: name, dirRel: `${base}/${name}` }
      }
    }
  }
  return null
}

/** True when functions.php already registers this page (by slug or template). */
function alreadyRegistered(functionsSrc: string, slug: string, templateFile: string): boolean {
  const slugRe = new RegExp(`['"]slug['"]\\s*=>\\s*['"]${slug}['"]`, "i")
  return slugRe.test(functionsSrc) || functionsSrc.includes(templateFile)
}

/**
 * Insert a `$pages` entry right after the array opener (`$pages = [` or
 * `$pages = array(`). Returns the edited source, or null if no `$pages` array
 * could be located (caller keeps the template file and notes it).
 */
function insertPageEntry(
  functionsSrc: string,
  entryLine: string,
): string | null {
  const opener = functionsSrc.match(/\$pages\s*=\s*(\[|array\s*\()/)
  if (!opener || opener.index === undefined) return null
  const insertAt = opener.index + opener[0].length
  return (
    functionsSrc.slice(0, insertAt) +
    "\n" +
    entryLine +
    functionsSrc.slice(insertAt)
  )
}

export async function provisionClassicPage(
  workDir: string,
  opts: { title: string; slug: string; templateFile: string; templatePhp: string },
): Promise<ClassicProvisionResult> {
  const theme = resolveClassicThemeDir(workDir)
  if (!theme) {
    return { changed: false, files: [], description: "", note: "no classic theme with functions.php found" }
  }

  const changedFiles: string[] = []
  const notes: string[] = []

  // 1. Page template file (page-<slug>.php).
  const tplRel = `${theme.dirRel}/${opts.templateFile}`
  const tplAbs = path.resolve(workDir, tplRel)
  if (fs.existsSync(tplAbs)) {
    notes.push(`${opts.templateFile} already exists`)
  } else {
    await fs.promises.writeFile(tplAbs, opts.templatePhp, "utf8")
    changedFiles.push(tplRel)
    notes.push(`created ${opts.templateFile}`)
  }

  // 2. Register in functions.php $pages so after_switch_theme provisions it.
  const fnRel = `${theme.dirRel}/functions.php`
  const fnAbs = path.resolve(workDir, fnRel)
  if (fs.existsSync(fnAbs)) {
    const src = await fs.promises.readFile(fnAbs, "utf8")
    if (alreadyRegistered(src, opts.slug, opts.templateFile)) {
      notes.push("page already registered in functions.php")
    } else {
      const entryLine = `        ['title' => '${opts.title.replace(/'/g, "\\'")}', 'slug' => '${opts.slug}', 'template' => '${opts.templateFile}'],`
      const next = insertPageEntry(src, entryLine)
      if (next && next !== src) {
        await fs.promises.writeFile(fnAbs, next, "utf8")
        changedFiles.push(fnRel)
        notes.push("registered page in functions.php $pages")
      } else {
        notes.push("could not locate a $pages array in functions.php (template file still added; assign it in Pages → Template)")
      }
    }
  } else {
    notes.push("no functions.php in theme (template file still added)")
  }

  if (changedFiles.length === 0) {
    return { changed: false, files: [], description: "", note: notes.join("; ") }
  }

  const provisioned = changedFiles.includes(fnRel)
  return {
    changed: true,
    files: changedFiles,
    description: `Added a classic-theme "${opts.title}" page: created ${opts.templateFile} in ${theme.folder}${
      provisioned
        ? " and registered it in functions.php so theme activation auto-creates the page"
        : " (assign it to a page under Pages → Template — no $pages array was found to auto-provision)"
    }.`,
    note: notes.join("; "),
  }
}
