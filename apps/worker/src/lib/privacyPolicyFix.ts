import fs from "fs"
import path from "path"
import { renderPrivacyPolicy } from "./privacyTemplate"
import { provisionClassicPage } from "./classicPageProvisioner"
import type { ThemeType } from "./themeType"

/**
 * Deterministic repo fix for a missing/empty Privacy Policy page.
 *
 * In a code-first WordPress (Bedrock) repo, page CONTENT lives in the database,
 * not in a source file — so there is no page file to edit. The one repo-level
 * lever that creates page content is the WP Playground blueprint
 * (`playground/blueprint.json`), whose `runPHP` steps seed pages via
 * `wp_insert_post`. This helper appends one idempotent step that:
 *   • creates the `/privacy-policy` page if it is missing, or
 *   • fills it in if the page exists but has no content,
 * using the shared PRIVACY_TEMPLATE with the client's company name + site URL.
 *
 * Only the demo/fallback repo (and any beta repo built on WP Playground) carries
 * a blueprint. On a real Bedrock beta repo with no blueprint there is nothing to
 * edit, so this returns { changed: false } and the AI-fix pass reports the
 * finding as a manual (page/database content) fix — the honest outcome.
 */

const MARKER = "QACC:privacy-policy-seed"

export interface PrivacySeedResult {
  changed: boolean
  file: string
  // Optional multi-file list for fixes that touch more than one file (the
  // classic-native path edits both the page template and functions.php). Block/
  // blueprint path leaves this undefined and callers fall back to [file].
  files?: string[]
  description: string
  note: string
}

function buildRunPhp(html: string): string {
  // Nowdoc (<<<'...') — no PHP interpolation, so `$` in content is literal.
  return [
    `<?php /* ${MARKER} */ require_once '/wordpress/wp-load.php';`,
    `$slug = 'privacy-policy';`,
    `$title = 'Privacy Policy';`,
    `$content = <<<'QACC_PP_HTML'`,
    html,
    `QACC_PP_HTML;`,
    `$existing = get_page_by_path( $slug );`,
    `if ( $existing ) {`,
    `  if ( trim( wp_strip_all_tags( $existing->post_content ) ) === '' ) {`,
    `    wp_update_post( array( 'ID' => $existing->ID, 'post_content' => $content, 'post_status' => 'publish' ) );`,
    `  }`,
    `} else {`,
    `  wp_insert_post( array( 'post_title' => $title, 'post_name' => $slug, 'post_status' => 'publish', 'post_type' => 'page', 'post_content' => $content ) );`,
    `}`,
  ].join("\n")
}

export async function seedPrivacyPolicyPage(
  workDir: string,
  opts: { company: string; url: string; email?: string },
): Promise<PrivacySeedResult> {
  const rel = path.join("playground", "blueprint.json")
  const abs = path.resolve(workDir, rel)
  const miss: PrivacySeedResult = {
    changed: false,
    file: rel,
    description: "",
    note: "",
  }

  if (!fs.existsSync(abs)) {
    return { ...miss, note: "no playground/blueprint.json in repo" }
  }

  let json: any
  let raw: string
  try {
    raw = await fs.promises.readFile(abs, "utf8")
    json = JSON.parse(raw)
  } catch (e: any) {
    return { ...miss, note: `blueprint.json unreadable: ${e?.message}` }
  }

  if (!Array.isArray(json.steps)) json.steps = []

  const { html } = renderPrivacyPolicy({
    company: opts.company,
    url: opts.url,
    email: opts.email,
  })
  const step = { step: "runPHP", code: buildRunPhp(html) }

  // Idempotent: if our marked step already exists, replace it (content may have
  // changed); otherwise append it.
  const idx = json.steps.findIndex(
    (s: any) =>
      s &&
      s.step === "runPHP" &&
      typeof s.code === "string" &&
      s.code.includes(MARKER),
  )
  if (idx >= 0) json.steps[idx] = step
  else json.steps.push(step)

  const next = JSON.stringify(json, null, 2) + "\n"
  if (next === raw) {
    return { ...miss, note: "blueprint already up to date (no change)" }
  }

  await fs.promises.writeFile(abs, next, "utf8")
  return {
    changed: true,
    file: rel,
    description: `Seeded a Privacy Policy page (/privacy-policy) for "${
      opts.company || "the site"
    }" via playground/blueprint.json — created if missing, populated if empty, using the standard policy template.`,
    note: idx >= 0 ? "updated existing privacy seed step" : "added privacy seed step",
  }
}

/**
 * Ensure the footer carries a Privacy Policy link — additive & non-destructive,
 * placed WITH the existing footer links.
 *
 * The page-seed fixes create/populate the /privacy-policy PAGE but never add the
 * footer link the check also requires, so a "missing footer link" case stayed
 * red. This inserts a Privacy Policy link right AFTER the last existing footer
 * link (so it sits among the other footer links, not dumped at the end), only
 * when one isn't already there; it never edits or removes existing markup.
 *
 * When the footer has NO plain-anchor link cluster (e.g. it renders links via a
 * wp:navigation block whose items are page-id comments, not <a> tags), we do NOT
 * guess a spot — we return { changed:false, needsPlacement:true } so the caller
 * can hand placement to AI triage / a human instead of misplacing the link.
 *
 * Idempotent: skips when a privacy-policy link is already present.
 */
const THEME_BASES_FL = ["web/app/themes", "wp-content/themes"]

function hasPrivacyLink(src: string): boolean {
  return /href=[^>]*privacy-policy/i.test(src) || />\s*Privacy Policy\s*</i.test(src)
}

/** Insert `insert` immediately after the last `</a>` in src; null if none. */
function insertAfterLastAnchor(src: string, insert: string): string | null {
  const idx = src.toLowerCase().lastIndexOf("</a>")
  if (idx === -1) return null
  const at = idx + "</a>".length
  return src.slice(0, at) + insert + src.slice(at)
}

function resolveThemeDirRel(workDir: string, themeType?: ThemeType): string | null {
  const classic: string[] = []
  const block: string[] = []
  for (const base of THEME_BASES_FL) {
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

export async function ensureFooterPrivacyLink(
  workDir: string,
  themeType?: ThemeType,
): Promise<{ changed: boolean; files: string[]; note: string; needsPlacement?: boolean }> {
  const dirRel = resolveThemeDirRel(workDir, themeType)
  if (!dirRel) return { changed: false, files: [], note: "no theme dir for footer link" }

  // BLOCK → parts/footer.html.
  const blockRel = `${dirRel}/parts/footer.html`
  const blockAbs = path.resolve(workDir, blockRel)
  if (themeType !== "classic" && fs.existsSync(blockAbs)) {
    const src = await fs.promises.readFile(blockAbs, "utf8").catch(() => "")
    if (hasPrivacyLink(src)) return { changed: false, files: [], note: "footer already has a Privacy Policy link" }
    // Place it next to the last existing footer link (same anchor style).
    const next = insertAfterLastAnchor(src, `<a href="/privacy-policy">Privacy Policy</a>`)
    if (!next) {
      return { changed: false, files: [], note: "footer uses a navigation block (no <a> cluster) — needs AI/manual placement", needsPlacement: true }
    }
    await fs.promises.writeFile(blockAbs, next, "utf8")
    return { changed: true, files: [blockRel], note: "inserted Privacy Policy link beside the existing footer links (parts/footer.html)" }
  }

  // CLASSIC → footer.php.
  const phpRel = `${dirRel}/footer.php`
  const phpAbs = path.resolve(workDir, phpRel)
  if (fs.existsSync(phpAbs)) {
    const src = await fs.promises.readFile(phpAbs, "utf8").catch(() => "")
    if (hasPrivacyLink(src)) return { changed: false, files: [], note: "footer already has a Privacy Policy link" }
    const link = `<a href="<?php echo esc_url( home_url( '/privacy-policy' ) ); ?>">Privacy Policy</a>`
    const next = insertAfterLastAnchor(src, link)
    if (!next) {
      return { changed: false, files: [], note: "footer.php has no <a> link cluster — needs AI/manual placement", needsPlacement: true }
    }
    await fs.promises.writeFile(phpAbs, next, "utf8")
    return { changed: true, files: [phpRel], note: "inserted Privacy Policy link beside the existing footer links (footer.php)" }
  }

  return { changed: false, files: [], note: "no footer template (parts/footer.html or footer.php) found" }
}

/** Build the classic `page-privacy-policy.php` template body. */
function buildPrivacyTemplatePhp(policyHtml: string): string {
  return [
    "<?php /* Template Name: Privacy Policy */ ?>",
    "<?php get_header(); ?>",
    '<main id="main">',
    '  <section style="max-width:820px;margin:0 auto;padding:96px 24px;line-height:1.6">',
    policyHtml,
    "  </section>",
    "</main>",
    "<?php get_footer();",
    "",
  ].join("\n")
}

/**
 * Classic-native Privacy Policy fix — the classic-theme counterpart to
 * seedPrivacyPolicyPage. Instead of a blueprint runPHP step, it writes a
 * `page-privacy-policy.php` template (with the rendered policy content) into the
 * active classic theme and registers the page in the theme's `functions.php`
 * `$pages` array so activation auto-creates it. Idempotent; returns
 * { changed:false } when no classic theme can be resolved so the caller can fall
 * back to the blueprint seed.
 *
 * Note: like the blueprint seed, this creates/populates the PAGE. Adding a
 * footer link to it (the other half of the privacy check) is left to the LLM
 * triage / manual review, since footer markup varies per theme.
 */
export async function seedPrivacyPolicyPageClassic(
  workDir: string,
  opts: { company: string; url: string; email?: string },
): Promise<PrivacySeedResult> {
  const { html } = renderPrivacyPolicy({
    company: opts.company,
    url: opts.url,
    email: opts.email,
  })
  const res = await provisionClassicPage(workDir, {
    title: "Privacy Policy",
    slug: "privacy-policy",
    templateFile: "page-privacy-policy.php",
    templatePhp: buildPrivacyTemplatePhp(html),
  })
  return {
    changed: res.changed,
    file: res.files[0] || "page-privacy-policy.php",
    files: res.files,
    description: res.changed
      ? `${res.description} Content uses the standard policy template for "${opts.company || "the site"}".`
      : res.description,
    note: res.note,
  }
}
