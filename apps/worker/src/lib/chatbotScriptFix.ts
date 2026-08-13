import fs from "fs"
import path from "path"

/**
 * Deterministic fix for the "script installed but widgets don't render" case of
 * the Chatbot & Virtual Consultation check — a classic load-order/race where the
 * Cliff Hanger integration script runs before the DOM is ready. The fix is to
 * DEFER the script; the next QA run re-verifies whether the widgets now render.
 *
 * The integration script (chatbot.growth99.com/assets/js/integration.js) may be
 * added two ways, so we cover both, non-destructively + idempotently:
 *   1. Enqueued via wp_enqueue_script → add a script_loader_tag filter (a small
 *      mu-plugin) that injects `defer` onto that exact src, regardless of handle.
 *   2. A raw <script src="…integration.js"> tag in a theme/mu file → add `defer`
 *      to the tag in place.
 *
 * Returns { changed:false } when neither surface exists in the repo (e.g. the
 * script is in DB/page content), so the caller reports it as manual.
 */

const INTEGRATION = "chatbot.growth99.com/assets/js/integration.js"
const MARKER = "QACC:chatbot-defer"
const THEME_BASES = ["web/app/themes", "wp-content/themes"]
const MU_BASES = ["web/app/mu-plugins", "wp-content/mu-plugins"]
const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", "build", ".git"])

export interface ChatbotDeferResult {
  changed: boolean
  files: string[]
  note: string
}

/** First existing mu-plugins base, else the Bedrock default. */
function muBase(workDir: string): string {
  for (const base of MU_BASES) if (fs.existsSync(path.resolve(workDir, base))) return base
  return MU_BASES[0]
}

/** Recursively collect .php/.html files under a dir (repo-relative). */
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
    } else if (/\.(php|html?)$/i.test(e.name)) {
      out.push(rel)
    }
  }
  return out
}

/** Add `defer` to any raw <script …integration.js…> tag lacking it. */
export function deferRawScriptTags(src: string): { next: string; count: number } {
  let count = 0
  const next = src.replace(/<script\b[^>]*>/gi, (tag) => {
    if (!tag.includes(INTEGRATION)) return tag
    if (/\bdefer\b/i.test(tag)) return tag
    count++
    // Insert defer right after "<script".
    return tag.replace(/<script\b/i, "<script defer")
  })
  return { next, count }
}

export async function deferChatbotScript(workDir: string): Promise<ChatbotDeferResult> {
  const changedFiles: string[] = []
  const notes: string[] = []

  // 1. Patch raw <script> tags across theme + mu-plugin trees.
  const dirs = [...THEME_BASES, ...MU_BASES].filter((b) => fs.existsSync(path.resolve(workDir, b)))
  const files: string[] = []
  for (const base of dirs) collectFiles(workDir, base, files)
  let rawPatched = 0
  for (const rel of files) {
    const abs = path.resolve(workDir, rel)
    let src: string
    try {
      src = await fs.promises.readFile(abs, "utf8")
    } catch {
      continue
    }
    if (!src.includes(INTEGRATION)) continue
    const { next, count } = deferRawScriptTags(src)
    if (count > 0 && next !== src) {
      await fs.promises.writeFile(abs, next, "utf8")
      changedFiles.push(rel)
      rawPatched += count
    }
  }
  if (rawPatched > 0) notes.push(`added defer to ${rawPatched} raw script tag(s)`)

  // 2. Add the enqueue-side defer filter as a mu-plugin (covers wp_enqueue_script
  //    installs). Idempotent via marker; harmless if the script is a raw tag.
  const muRel = `${muBase(workDir)}/g99-chatbot-defer.php`
  const muAbs = path.resolve(workDir, muRel)
  const existing = fs.existsSync(muAbs) ? await fs.promises.readFile(muAbs, "utf8").catch(() => "") : ""
  if (!existing.includes(MARKER)) {
    const php = `<?php
/**
 * Plugin Name: Growth99 Chatbot Defer
 * Description: Defers the Cliff Hanger chatbot integration script so it runs after the DOM is ready. ${MARKER}
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
add_filter( 'script_loader_tag', function ( $tag, $handle, $src ) {
  if ( strpos( (string) $src, '${INTEGRATION}' ) !== false && strpos( $tag, ' defer' ) === false ) {
    $tag = str_replace( ' src=', ' defer src=', $tag );
  }
  return $tag;
}, 10, 3 );
`
    await fs.promises.mkdir(path.dirname(muAbs), { recursive: true })
    await fs.promises.writeFile(muAbs, php, "utf8")
    changedFiles.push(muRel)
    notes.push("added script_loader_tag defer filter (mu-plugin)")
  }

  if (changedFiles.length === 0) {
    return { changed: false, files: [], note: "no integration script found in the theme/mu-plugin repo (likely DB/page content)" }
  }
  return { changed: true, files: changedFiles, note: notes.join("; ") }
}
