import fs from "fs"
import path from "path"
import type { ThemeType } from "./themeType"
import { provisionClassicPage, resolveClassicThemeDir } from "./classicPageProvisioner"

/**
 * Reviews-page provisioner — the deterministic fix for the Project Plan check
 * when an Accelerator-plan site is missing the Growth99 reviews widget.
 *
 * The widget must live on a "reviews" PAGE (global header + footer), with the
 * embed in an HTML block in the body, centered horizontally:
 *   • if a /reviews page already exists → add the HTML block to it;
 *   • else → create the /reviews page and put the block in its body.
 *
 * Theme-aware, mirroring the privacy-policy fix:
 *   • BLOCK / unknown → WP Playground blueprint runPHP seed (wp_insert_post /
 *     wp_update_post) — the only repo lever that creates page CONTENT in a
 *     code-first (Bedrock) repo. Page content is a Gutenberg wp:html block.
 *   • CLASSIC theme → a page-reviews.php template (get_header()/get_footer()
 *     with the centered embed) registered in functions.php $pages.
 *
 * The per-client id/bid are dynamic (Basecamp "Review and Reputation Code"
 * message → TED notes fallback). When unresolved we DON'T write broken markup —
 * we return changed:false with the exact snippet as manualSnippet so the report
 * marks "review code not found" and asks a human to paste it.
 */

const MARKER = "QACC:reviews-page-seed"

export interface ReviewsWidgetFixResult {
  changed: boolean
  files: string[]
  description: string
  note: string
  /** The exact embed to paste manually when the fix can't be applied. */
  manualSnippet?: string
}

/** The raw Website-Configuration embed (script + ReviewsWidget iframe). */
export function reviewsEmbedSnippet(id: string, bid: string): string {
  return [
    `<script src="https://reviews.growth99.com/reviews.js"></script>`,
    `<iframe style="width: 100%;" frameborder="0" class="myIframe" scrolling="no" id="ReviewsWidget" src="https://reviews.growth99.com/widget/?id=${id}&bid=${bid}"></iframe>`,
  ].join("\n")
}

/** Center the embed horizontally in a constrained container. */
function centeredHtml(snippet: string): string {
  return `<div style="max-width:1100px;margin:0 auto;text-align:center">\n${snippet}\n</div>`
}

/** A Gutenberg HTML block wrapping the centered embed (block theme page body). */
function htmlBlock(snippet: string): string {
  return `<!-- wp:html -->\n${centeredHtml(snippet)}\n<!-- /wp:html -->`
}

/** classic page-reviews.php: global header/footer + centered embed in body. */
function reviewsTemplatePhp(snippet: string): string {
  return [
    "<?php /* Template Name: Reviews */ ?>",
    "<?php get_header(); ?>",
    '<main id="main">',
    '  <section style="max-width:1100px;margin:0 auto;padding:64px 24px;text-align:center">',
    snippet,
    "  </section>",
    "</main>",
    "<?php get_footer();",
    "",
  ].join("\n")
}

function blueprintPath(workDir: string): string {
  return path.resolve(workDir, "playground", "blueprint.json")
}

/** runPHP that creates the /reviews page, or adds the block to an existing one. */
function buildReviewsRunPhp(block: string): string {
  return [
    `<?php /* ${MARKER} */ require_once '/wordpress/wp-load.php';`,
    `$slug = 'reviews';`,
    `$title = 'Reviews';`,
    `$content = <<<'QACC_RV_HTML'`,
    block,
    `QACC_RV_HTML;`,
    `$existing = get_page_by_path( $slug );`,
    `if ( $existing ) {`,
    `  if ( strpos( (string) $existing->post_content, 'ReviewsWidget' ) === false ) {`,
    `    wp_update_post( array( 'ID' => $existing->ID, 'post_content' => $existing->post_content . "\\n\\n" . $content, 'post_status' => 'publish' ) );`,
    `  }`,
    `} else {`,
    `  wp_insert_post( array( 'post_title' => $title, 'post_name' => $slug, 'post_status' => 'publish', 'post_type' => 'page', 'post_content' => $content ) );`,
    `}`,
  ].join("\n")
}

/** Block/unknown path: seed the /reviews page via the blueprint runPHP step. */
async function seedReviewsPageBlueprint(
  workDir: string,
  block: string,
): Promise<{ changed: boolean; file: string; note: string }> {
  const rel = path.join("playground", "blueprint.json")
  const abs = blueprintPath(workDir)
  if (!fs.existsSync(abs)) return { changed: false, file: rel, note: "no playground/blueprint.json in repo" }

  let json: any
  let raw: string
  try {
    raw = await fs.promises.readFile(abs, "utf8")
    json = JSON.parse(raw)
  } catch (e: any) {
    return { changed: false, file: rel, note: `blueprint.json unreadable: ${e?.message}` }
  }
  if (!Array.isArray(json.steps)) json.steps = []

  const step = { step: "runPHP", code: buildReviewsRunPhp(block) }
  const idx = json.steps.findIndex(
    (s: any) => s && s.step === "runPHP" && typeof s.code === "string" && s.code.includes(MARKER),
  )
  if (idx >= 0) json.steps[idx] = step
  else json.steps.push(step)

  const next = JSON.stringify(json, null, 2) + "\n"
  if (next === raw) return { changed: false, file: rel, note: "blueprint already up to date (no change)" }

  await fs.promises.writeFile(abs, next, "utf8")
  return { changed: true, file: rel, note: idx >= 0 ? "updated reviews seed step" : "added reviews seed step" }
}

/**
 * Provision the /reviews page carrying the reviews widget, theme-aware.
 * Returns changed:false + manualSnippet when id/bid are unknown or no writable
 * surface exists (real Bedrock repo with no blueprint / no classic theme).
 */
export async function provisionReviewsPage(
  workDir: string,
  themeType: ThemeType | undefined,
  widget: { id: string; bid: string } | null,
): Promise<ReviewsWidgetFixResult> {
  if (!widget?.id) {
    return {
      changed: false,
      files: [],
      description: "",
      note: "reviews widget code not found (Basecamp / TED)",
      manualSnippet: reviewsEmbedSnippet("{REVIEW_WIDGET_ID}", "{BID}"),
    }
  }
  const snippet = reviewsEmbedSnippet(widget.id, widget.bid)
  const manualSnippet = snippet

  // CLASSIC → edit an existing page-reviews.php if present, else create one.
  if (themeType === "classic") {
    const theme = resolveClassicThemeDir(workDir)
    if (theme) {
      const tplRel = `${theme.dirRel}/page-reviews.php`
      const tplAbs = path.resolve(workDir, tplRel)
      if (fs.existsSync(tplAbs)) {
        const src = await fs.promises.readFile(tplAbs, "utf8").catch(() => "")
        if (src.includes("ReviewsWidget")) {
          return { changed: false, files: [], description: "", note: "reviews widget already present in page-reviews.php", manualSnippet }
        }
        // Edit existing template: inject the centered embed just before get_footer().
        const inject = `<section style="max-width:1100px;margin:0 auto;padding:64px 24px;text-align:center">\n${snippet}\n</section>\n`
        const next = src.match(/get_footer\s*\(/)
          ? src.replace(/(<\?php\s*)?get_footer\s*\(/, `?>\n${inject}<?php get_footer(`)
          : src + `\n?>\n${inject}`
        await fs.promises.writeFile(tplAbs, next, "utf8")
        return {
          changed: true,
          files: [tplRel],
          description: `Added the Growth99 reviews widget to the existing ${theme.folder}/page-reviews.php — embed centered in the page body between the global header and footer.`,
          note: "edited existing page-reviews.php",
          manualSnippet,
        }
      }
    }
    const res = await provisionClassicPage(workDir, {
      title: "Reviews",
      slug: "reviews",
      templateFile: "page-reviews.php",
      templatePhp: reviewsTemplatePhp(snippet),
    }).catch((e: any) => ({ changed: false, files: [] as string[], description: "", note: `classic provision threw: ${e?.message}` }))
    if (res.changed) {
      return {
        changed: true,
        files: res.files,
        description: `${res.description} The reviews widget embed is centered in the page body between the global header and footer.`,
        note: res.note,
        manualSnippet,
      }
    }
    // No classic theme resolvable → fall through to blueprint (a classic repo
    // may still carry one).
  }

  // BLOCK / unknown (or classic with no theme) → blueprint page seed.
  const seed = await seedReviewsPageBlueprint(workDir, htmlBlock(snippet)).catch(
    (e: any) => ({ changed: false, file: "playground/blueprint.json", note: `seed threw: ${e?.message}` }),
  )
  if (seed.changed) {
    return {
      changed: true,
      files: [seed.file],
      description: `Provisioned the /reviews page via playground/blueprint.json — created if missing (or the HTML block added if it already exists) with the reviews widget embed centered in an HTML block, using the site's global header and footer.`,
      note: seed.note,
      manualSnippet,
    }
  }

  // Nothing writable → honest manual report.
  return {
    changed: false,
    files: [],
    description: "",
    note: seed.note,
    manualSnippet,
  }
}
