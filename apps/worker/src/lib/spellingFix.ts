import { execFile } from "child_process"
import { promisify } from "util"
import fs from "fs"
import path from "path"

const execFileAsync = promisify(execFile)

/**
 * Deterministic spelling fix for the AI-fix pass.
 *
 * A spelling finding already carries everything a fix needs: the exact
 * misspelled word and the dictionary suggestion. Routing it through the generic
 * anchors → git grep → LLM → applyEdit pipeline used to fail at every stage:
 *   - the misspelled word was never used as a grep anchor (only quoted text /
 *     markup / one Capitalized phrase were),
 *   - `git grep -F` is single-line + whitespace-exact, so the phrase anchor
 *     broke across source line breaks and matched nothing,
 *   - even on a hit, applyEdit rejects a single short/repeated word as
 *     "too short" or "ambiguous".
 * So spelling was ALWAYS reported as a manual fix, even when the bad word sat
 * plainly in a theme file.
 *
 * This bypasses all of that. A genuine misspelling is not a real word, so every
 * whole-word occurrence of it in the theme code is wrong and gets the same
 * correction — there is no ambiguity to resolve. We locate the word with a
 * word-boundary `git grep`, then replace every whole-word occurrence in each
 * file, preserving the original capitalization per occurrence.
 *
 * When the word is NOT in any theme file it lives in the WordPress database
 * (page/post content), which a source-code edit cannot reach → returns
 * { changed: false } and the caller reports it as a manual (page/DB) fix. That
 * DB lever (wp search-replace) is a separate follow-up.
 */

export interface SpellingFixResult {
  changed: boolean
  description: string
  note: string
  filesChanged: string[]
  /** literal before → after for the TED report (one entry per corrected word). */
  edits: { path: string; find: string; replace: string }[]
}

const WORD = /^[A-Za-z]+(?:['‘’-][A-Za-z]+)*$/

/** Parse the misspelled word + suggestion out of a spelling finding. */
export function parseSpellingFinding(f: {
  title?: string | null
  description?: string | null
}): { bad: string; good: string } | null {
  const bad = String(f.title || "").match(/Misspelled:\s*(.+?)\s*$/i)?.[1]
  const good = String(f.description || "").match(/Suggestion:\s*(.+?)\s*$/i)?.[1]
  if (!bad || !good) return null // "No suggestions found …" → nothing to apply
  if (!WORD.test(bad) || !WORD.test(good)) return null
  if (bad.toLowerCase() === good.toLowerCase()) return null // no-op
  return { bad, good }
}

/** Copy the capitalization of the found token onto the replacement. */
function matchCase(orig: string, repl: string): string {
  // ALL CAPS: every cased letter is upper (and there is at least one).
  if (orig === orig.toUpperCase() && orig !== orig.toLowerCase())
    return repl.toUpperCase()
  // Title case: first letter is upper.
  if (orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase())
    return repl.charAt(0).toUpperCase() + repl.slice(1)
  return repl // lowercase / uncased → suggestion as-is
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const GREP_EXCLUDES = [
  "--",
  ":(exclude)wp-admin",
  ":(exclude)wp-includes",
  ":(exclude)**/node_modules/**",
  ":(exclude)**/vendor/**",
  ":(exclude)**/uploads/**",
  ":(exclude)**/*.min.js",
  ":(exclude)**/*.min.css",
]

const CODE_EXT = /\.(css|scss|less|php|html?|js|jsx|ts|tsx|twig|vue|json)$/i

/** Files that contain `word` as a whole word (case-insensitive). */
async function filesWithWord(workDir: string, word: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", workDir, "grep", "-I", "-F", "-w", "-i", "-l", "-e", word, ...GREP_EXCLUDES],
      { maxBuffer: 1024 * 1024 * 16 },
    )
    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((p) => p && CODE_EXT.test(p))
  } catch {
    return [] // git grep exits 1 when nothing matched
  }
}

/**
 * Replace every whole-word occurrence of a genuine misspelling with its
 * suggestion, across the theme files that contain it.
 */
export async function applySpellingFix(
  workDir: string,
  f: { title?: string | null; description?: string | null },
): Promise<SpellingFixResult> {
  const none: SpellingFixResult = {
    changed: false,
    description: "",
    note: "",
    filesChanged: [],
    edits: [],
  }
  const parsed = parseSpellingFinding(f)
  if (!parsed) return { ...none, note: "no actionable word/suggestion in finding" }
  const { bad, good } = parsed

  const files = await filesWithWord(workDir, bad)
  if (files.length === 0)
    return {
      ...none,
      note: `"${bad}" not found in theme files (likely WordPress page/database content)`,
    }

  // Whole-word, case-insensitive. Letters-only boundaries so we never edit the
  // word inside a larger word (e.g. "sed" inside "used").
  const re = new RegExp(`(?<![A-Za-z])${escapeRe(bad)}(?![A-Za-z])`, "gi")
  const filesChanged: string[] = []
  let total = 0

  for (const rel of files) {
    const abs = path.resolve(workDir, rel)
    if (!abs.startsWith(path.resolve(workDir) + path.sep)) continue
    let before: string
    try {
      before = await fs.promises.readFile(abs, "utf8")
    } catch {
      continue
    }
    let count = 0
    const after = before.replace(re, (m) => {
      count++
      return matchCase(m, good)
    })
    if (count === 0 || after === before) continue

    await fs.promises.writeFile(abs, after, "utf8")
    const verify = await fs.promises.readFile(abs, "utf8")
    if (verify !== after) {
      await fs.promises.writeFile(abs, before, "utf8") // revert
      continue
    }
    filesChanged.push(rel)
    total += count
  }

  if (filesChanged.length === 0)
    return { ...none, note: `"${bad}" located but no occurrence could be replaced` }

  return {
    changed: true,
    description: `Corrected “${bad}” → “${good}” (${total} occurrence${total > 1 ? "s" : ""} across ${filesChanged.length} file${filesChanged.length > 1 ? "s" : ""}).`,
    note: `replaced ${total} whole-word occurrence(s)`,
    filesChanged,
    edits: [{ path: filesChanged[0], find: bad, replace: good }],
  }
}
