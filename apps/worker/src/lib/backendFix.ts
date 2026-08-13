import fs from "fs"
import path from "path"
import type { ThemeType } from "./themeType"

/**
 * Deterministic repo fixes for the backend / WordPress check.
 *
 *   • Default "Hello world!" post and "Sample Page" are DB content — removed via
 *     an idempotent WP Playground blueprint runPHP step (wp_delete_post), the
 *     same repo lever the privacy-page seed uses.
 *   • A missing custom 404 is a THEME file, and WHICH file depends on the theme
 *     type: a BLOCK/FSE theme renders `templates/404.html` (block markup), a
 *     CLASSIC PHP theme renders `404.php` (get_header()/get_footer()). We create
 *     the matching one in the active theme if neither already exists — so the
 *     404 fix actually takes effect on a classic theme instead of writing an
 *     inert block template.
 *
 * All of this only applies to a WP-Playground-style repo (demo/fallback and any
 * beta repo built on it). On a real Bedrock beta repo with no blueprint / no
 * discoverable theme, these return { changed: false } and the AI-fix pass falls
 * back to reporting the finding as a manual (page/DB) fix — the honest outcome.
 */

export interface BackendFixResult {
  changed: boolean
  file: string
  description: string
  note: string
}

function blueprintPath(workDir: string): string {
  return path.resolve(workDir, "playground", "blueprint.json")
}

/**
 * Add (or refresh) an idempotent runPHP step that deletes a default post/page by
 * slug. Marked so re-runs replace rather than duplicate it.
 */
export async function deleteDefaultContentViaBlueprint(
  workDir: string,
  opts: { slug: string; postType: "post" | "page"; label: string },
): Promise<BackendFixResult> {
  const rel = path.join("playground", "blueprint.json")
  const abs = blueprintPath(workDir)
  const miss: BackendFixResult = { changed: false, file: rel, description: "", note: "" }
  if (!fs.existsSync(abs)) return { ...miss, note: "no playground/blueprint.json in repo" }

  let json: any
  let raw: string
  try {
    raw = await fs.promises.readFile(abs, "utf8")
    json = JSON.parse(raw)
  } catch (e: any) {
    return { ...miss, note: `blueprint.json unreadable: ${e?.message}` }
  }
  if (!Array.isArray(json.steps)) json.steps = []

  const marker = `QACC:delete-${opts.postType}-${opts.slug}`
  const code = [
    `<?php /* ${marker} */ require_once '/wordpress/wp-load.php';`,
    `$slug = '${opts.slug}';`,
    `$existing = get_page_by_path( $slug, OBJECT, '${opts.postType}' );`,
    `if ( ! $existing ) { $q = get_posts( array( 'name' => $slug, 'post_type' => '${opts.postType}', 'post_status' => 'any', 'numberposts' => 1 ) ); if ( $q ) { $existing = $q[0]; } }`,
    `if ( $existing ) { wp_delete_post( $existing->ID, true ); }`,
  ].join("\n")
  const step = { step: "runPHP", code }

  const idx = json.steps.findIndex(
    (s: any) => s && s.step === "runPHP" && typeof s.code === "string" && s.code.includes(marker),
  )
  if (idx >= 0) json.steps[idx] = step
  else json.steps.push(step)

  const next = JSON.stringify(json, null, 2) + "\n"
  if (next === raw) return { ...miss, note: "blueprint already up to date (no change)" }

  await fs.promises.writeFile(abs, next, "utf8")
  return {
    changed: true,
    file: rel,
    description: `Removed the default WordPress ${opts.label} via playground/blueprint.json (deleted the "${opts.slug}" ${opts.postType}).`,
    note: idx >= 0 ? "updated existing delete step" : "added delete step",
  }
}

/** Resolve the active theme folder: prefer the blueprint's activateTheme step. */
function resolveActiveThemeFolder(workDir: string): string | null {
  try {
    const abs = blueprintPath(workDir)
    if (fs.existsSync(abs)) {
      const json = JSON.parse(fs.readFileSync(abs, "utf8"))
      const step = (json.steps || []).find(
        (s: any) => s && s.step === "activateTheme" && s.themeFolderName,
      )
      if (step?.themeFolderName) return String(step.themeFolderName)
    }
  } catch {}
  // Fallback: a non-core theme dir. Prefer a block theme (theme.json); if none,
  // accept a classic theme (functions.php) so a classic beta repo still resolves
  // an active theme for the 404 fix instead of bailing out.
  const candidates: { block: string[]; classic: string[] } = { block: [], classic: [] }
  for (const base of ["web/app/themes", "wp-content/themes"]) {
    const dir = path.resolve(workDir, base)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (/^twenty/i.test(name)) continue
      if (fs.existsSync(path.join(dir, name, "theme.json"))) candidates.block.push(name)
      else if (fs.existsSync(path.join(dir, name, "functions.php"))) candidates.classic.push(name)
    }
  }
  return candidates.block[0] || candidates.classic[0] || null
}

/** Find the on-disk theme directory (repo-relative) for a theme folder name. */
function themeDir(workDir: string, folder: string): string | null {
  for (const base of ["web/app/themes", "wp-content/themes"]) {
    const rel = path.join(base, folder)
    if (fs.existsSync(path.resolve(workDir, rel))) return rel
  }
  return null
}

const CUSTOM_404_HTML = `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->

<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->
<main class="wp-block-group">
  <!-- wp:heading {"level":1,"textAlign":"center"} -->
  <h1 class="wp-block-heading has-text-align-center">404 — Page Not Found</h1>
  <!-- /wp:heading -->

  <!-- wp:paragraph {"align":"center"} -->
  <p class="has-text-align-center">Sorry, the page you are looking for does not exist. It may have been moved or removed.</p>
  <!-- /wp:paragraph -->

  <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
  <div class="wp-block-buttons">
    <!-- wp:button -->
    <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/">Return to the homepage</a></div>
    <!-- /wp:button -->
  </div>
  <!-- /wp:buttons -->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
`

// Classic-theme 404. WordPress' classic template hierarchy renders `404.php`
// (NOT templates/404.html, which only a block theme reads), so a classic theme
// needs this PHP template with get_header()/get_footer() for the backend
// check's "styled custom 404" probe (site chrome + a 404 message) to pass.
const CUSTOM_404_PHP = `<?php
/**
 * Custom 404 template — Growth99 QACC AI Fix.
 * Renders the shared header/footer (site chrome) plus a 404 message so missing
 * URLs return a styled, on-brand not-found page instead of a bare server 404.
 */
get_header(); ?>
<main id="main" style="max-width:720px;margin:0 auto;padding:96px 24px;text-align:center">
  <h1>404 — Page Not Found</h1>
  <p>Sorry, the page you are looking for does not exist. It may have been moved or removed.</p>
  <p><a href="<?php echo esc_url( home_url( '/' ) ); ?>">Return to the homepage</a></p>
</main>
<?php get_footer();
`

/**
 * Create a simple custom 404 template in the active theme, if one is missing.
 * The site chrome + 404 message is exactly what the backend check's "styled
 * custom 404" probe looks for.
 *
 * Theme-aware: a BLOCK theme gets `templates/404.html` (block markup); a CLASSIC
 * theme gets `404.php` (get_header()/get_footer()). When the type is unknown we
 * keep the previous behaviour (block template). The classic path is what makes
 * this fix actually take effect on a classic PHP theme instead of writing an
 * inert block template WordPress never loads.
 */
export async function createCustom404(
  workDir: string,
  themeType?: ThemeType,
): Promise<BackendFixResult> {
  const folder = resolveActiveThemeFolder(workDir)
  if (!folder) return { changed: false, file: "", description: "", note: "could not resolve active theme" }
  const dirRel = themeDir(workDir, folder)
  if (!dirRel) return { changed: false, file: "", description: "", note: `theme dir not found for ${folder}` }

  const relHtml = path.join(dirRel, "templates", "404.html")
  const absHtml = path.resolve(workDir, relHtml)
  const relPhp = path.join(dirRel, "404.php")
  const absPhp = path.resolve(workDir, relPhp)

  // Already has a 404 template (block or classic) → nothing to do.
  if (fs.existsSync(absHtml) || fs.existsSync(absPhp)) {
    return { changed: false, file: relPhp, description: "", note: "a 404 template already exists" }
  }

  // Classic theme → 404.php. Block/unknown → templates/404.html (unchanged).
  if (themeType === "classic") {
    await fs.promises.writeFile(absPhp, CUSTOM_404_PHP, "utf8")
    return {
      changed: true,
      file: relPhp,
      description: `Created a classic-theme custom 404 template (${relPhp}) that calls get_header()/get_footer() and shows a 404 message, so missing URLs render a styled 404 page.`,
      note: "created 404.php (classic theme)",
    }
  }

  await fs.promises.mkdir(path.dirname(absHtml), { recursive: true })
  await fs.promises.writeFile(absHtml, CUSTOM_404_HTML, "utf8")
  return {
    changed: true,
    file: relHtml,
    description: `Created a simple custom 404 template (${relHtml}) with the site header/footer and a 404 message, so missing URLs render a styled 404 page.`,
    note: "created templates/404.html",
  }
}
