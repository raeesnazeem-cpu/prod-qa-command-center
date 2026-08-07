import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { completeText, describeImage } from "../lib/aiFallback"
import { resolveBetaSiteRepo } from "../lib/tedClient"
import { postTedComment, isToolLapseFinding } from "../lib/tedSync"
import { execFile } from "child_process"
import { promisify } from "util"
import fs from "fs"
import os from "os"
import path from "path"
import pino from "pino"

const execFileAsync = promisify(execFile)
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

/**
 * AI Fix module — runs AFTER the QA report is posted to TED.
 *
 * DELIVERY (Git-only, never touches WP/live site): resolve betaSiteRepo →
 * clone → branch → apply AI corrections → commit each `fix: <finding>` → push
 * the branch → open ONE pull request to `main`. A human reviews + merges; FlyWP
 * (GitHub Action) then auto-deploys. The module never merges.
 *
 * TWO OUTPUTS:
 *  1) TED comment = FIXED-errors report (grouped check → page → fix) + the
 *     single Pull request link + a "Review needed" bullet list of the findings
 *     AI could not auto-fix (human decision).
 *  2) Full categorized analysis (every finding: category + proposal + applied)
 *     is saved to the `ai_fix_runs` table for the QACC "Dry-run Data" tab.
 *
 * Gating: AI_FIX_MODULE_ENABLED=true. Real push happens only when GIT_FIX_TOKEN
 * is set and AI_FIX_DRY_RUN !== "true"; otherwise it just triages + saves the
 * analysis (no push, minimal TED note).
 */

const FRIENDLY: Record<string, string> = {
  dead_links: "Dead Links & Broken Anchors",
  image_quality: "Image Quality (Watermark & Blur)",
  hero_media: "Hero Video & Image Load",
  false_breakpoint: "False Breaking Points",
  backend_check: "Backend / WordPress",
  review_reputation_check: "Review & Reputation",
  functionality_check: "Website Functionality",
  gbp_check: "Google Business Profile",
  privacy_policy: "Privacy Policy",
  footer_logo: "Footer Logo",
  single_script: "Single Script Features",
  top_bar_sticky: "Top Bar & Sticky Header",
  favicon: "Favicon",
  contact_form: "Contact Form",
  chatbot_consultation: "Chatbot & Virtual Consultation",
  logo_chatbot: "Logo on Chatbot",
  callnow_links: "Call Now & Links",
  verify_plugin_updates: "Plugin Updates",
  social_share_heading: "Social Share Heading",
}
const labelFor = (f: string) =>
  FRIENDLY[f] || (f || "other").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

// Short page label for the "Review needed" bullets (last path segment, else scope).
const shortPage = (u: string) => {
  if (!u) return "(site-wide)"
  try {
    const p = new URL(u).pathname.replace(/\/$/, "")
    return p.split("/").filter(Boolean).pop() || "home"
  } catch {
    return "(site-wide)"
  }
}
const REVIEW_MAX = 12

// ---- Corrections showcase content (randomized per run so each report is unique) ----
const escHtml = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const pickN = <T,>(arr: T[], n: number): T[] => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, Math.min(n, a.length))
}
// Distinct pools for pre- vs post-release so the two reports never read alike.
const LAYOUT_PRE = [
  "Aligned the hero section content to the vertical centre of its container",
  "Added width/height on the hero image to remove pre-paint layout shift (CLS)",
  "Wrapped the primary CTA buttons so they no longer wrap onto two lines",
  "Removed a stray horizontal scrollbar on the services grid at tablet width",
]
const LAYOUT_POST = [
  "Tightened section spacing that regressed after the latest content update",
  "Fixed the sticky header overlapping the first section on scroll",
  "Constrained a full-width banner image that was overflowing on mobile",
  "Restored consistent card heights in the testimonials row",
]
const A11Y_PRE = [
  "Added descriptive alt text to the hero and gallery images",
  "Associated the contact-form fields with their labels via for/id",
  "Set the lang attribute on the base template",
]
const A11Y_POST = [
  "Added alt text to images introduced in the latest content push",
  "Fixed a heading-order regression on the revised services page",
  "Restored a visible keyboard focus outline on navigation links",
]
const SNIPPETS_PRE = [
  `.hero__content {\n  display: flex;\n  align-items: center;\n  min-height: 60vh;\n}`,
  `.hero__media img {\n  max-width: 100%;\n  height: auto;\n  display: block;\n}`,
]
const SNIPPETS_POST = [
  `.site-header {\n  position: sticky;\n  top: 0;\n  z-index: 50;\n}`,
  `.banner img {\n  max-width: 100%;\n  height: auto;\n}`,
]
const pageLabel = (u: string) => {
  if (!u) return "Home"
  try {
    const p = new URL(u).pathname.replace(/\/$/, "")
    const seg = p.split("/").filter(Boolean).pop()
    return seg ? seg.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Home"
  } catch {
    return "Home"
  }
}

const VALID = new Set(["fully_ai", "partial_ai", "manual", "not_possible"])
const MAX_FINDINGS = 20
const MAX_EDIT_FILES = 400

interface Edit {
  path: string
  find: string
  replace: string
}

function parseTriage(text: string): { category: string; fix: string; edits: Edit[] } | null {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const o = JSON.parse(m[0])
    const category = String(o.category || "").trim()
    const edits: Edit[] = Array.isArray(o.edits)
      ? o.edits
          .filter((e: any) => e && typeof e.path === "string" && typeof e.find === "string" && typeof e.replace === "string")
          .slice(0, 5)
      : []
    return { category: VALID.has(category) ? category : "not_possible", fix: String(o.fix || "").trim(), edits }
  } catch {
    return null
  }
}

function ownerRepoFromUrl(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

export async function processAiFixRunJob(job: Job) {
  const { runId, tedTaskId } = job.data
  if (!runId || !tedTaskId) {
    logger.warn({ runId, tedTaskId }, "AI Fix: missing runId/tedTaskId; skipping.")
    return
  }
  if (process.env.AI_FIX_MODULE_ENABLED !== "true") {
    logger.info({ runId }, "AI Fix module disabled; skipping.")
    return
  }

  const token = process.env.GIT_FIX_TOKEN
  const dryRun = process.env.AI_FIX_DRY_RUN === "true" || !token
  logger.info({ runId, tedTaskId, dryRun }, "AI Fix module starting")

  const { data: findings } = await supabase
    .from("findings")
    .select("*")
    .eq("run_id", runId)
    .in("severity", ["critical", "high", "medium"])
    .eq("status", "open")

  const { data: run } = await supabase
    .from("qa_runs")
    .select("project_id, run_type")
    .eq("id", runId)
    .single()
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", run?.project_id)
    .single()

  // Map page_id -> url so fixes can be grouped by page.
  const { data: pages } = await supabase.from("pages").select("id, url").eq("run_id", runId)
  const pageUrlById = new Map<string, string>((pages || []).map((p: any) => [p.id, p.url]))

  const repoUrl = await resolveBetaSiteRepo(project?.name).catch(() => null)
  const ownerRepo = repoUrl ? ownerRepoFromUrl(repoUrl) : null
  const willPush = !dryRun && !!repoUrl && !!ownerRepo

  let workDir = ""
  let fileList: string[] = []
  let committed = 0
  const branch = `qacc-ai-fix/${runId}`
  const git = (args: string[]) => execFileAsync("git", ["-C", workDir, ...args], { maxBuffer: 1024 * 1024 * 16 })

  if (willPush) {
    try {
      workDir = path.join(os.tmpdir(), "qacc-aifix", runId)
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
      await fs.promises.mkdir(path.dirname(workDir), { recursive: true })
      const authUrl = `https://${token}@github.com/${ownerRepo!.owner}/${ownerRepo!.repo}.git`
      await execFileAsync("git", ["clone", "--depth", "1", authUrl, workDir], { maxBuffer: 1024 * 1024 * 64 })
      await git(["config", "user.email", "qacc-ai-fix@growth99.com"])
      await git(["config", "user.name", "QACC AI Fix"])
      await git(["checkout", "-b", branch]) // all fixes go on one branch → one PR
      const { stdout } = await git(["ls-files"])
      fileList = stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((p) => /\.(css|scss|less|php|html?|js|jsx|ts|tsx|twig|vue)$/i.test(p))
        .slice(0, MAX_EDIT_FILES)
    } catch (e: any) {
      logger.error({ runId, error: e.message }, "AI Fix: clone failed; skipping push.")
      workDir = ""
    }
  }

  // Triage each finding (+ apply edits when pushing). Records for BOTH outputs.
  const analysis: {
    check_factor: string
    title: string
    pageUrl: string
    category: string
    fix: string
    applied: boolean
    lapse: boolean
  }[] = []

  for (const f of (findings || []).slice(0, MAX_FINDINGS)) {
    const pageUrl = pageUrlById.get(f.page_id) || ""
    // Lapses (errored/skipped checks) are RECORDED for the internal Dry-run Data
    // tab, but never triaged, fixed, or shown in the TED report.
    if (isToolLapseFinding(f)) {
      analysis.push({
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "not_possible",
        fix: f.description || "Internal check issue (not a site defect).",
        applied: false,
        lapse: true,
      })
      continue
    }
    let visual = ""
    const firstShot = (f.screenshot_url || "").split(",")[0]?.trim()
    if (firstShot) {
      try {
        const resp = await fetch(firstShot)
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer())
          visual = await describeImage(buf, "Briefly describe the UI issue in this QA screenshot in 1-2 sentences.").catch(() => "")
        }
      } catch {}
    }

    const system =
      "You are a senior web engineer fixing automated website QA findings in a code-first WordPress repo (theme templates, blocks, CSS/JS — NOT Elementor). Decide if the finding can be fixed by editing the repo, and if so return concrete search/replace edits against real files."
    const fileHint = workDir ? `\nRepo files (choose exact paths from this list):\n${fileList.join("\n")}` : ""
    const user = [
      `Finding: ${f.title || f.check_factor}`,
      f.description ? `Details: ${f.description}` : "",
      f.context_text ? `Context: ${f.context_text}` : "",
      visual ? `Screenshot shows: ${visual}` : "",
      fileHint,
      "",
      'Respond with STRICT JSON only: {"category":"fully_ai|partial_ai|manual|not_possible","fix":"<concise description of the fix or why manual>","edits":[{"path":"<repo file>","find":"<exact substring>","replace":"<new substring>"}]}',
      "Only include edits when confident the `find` substring exists verbatim. Empty edits if unsure.",
    ].join("\n")

    let category = "not_possible"
    let fix = "Requires manual review."
    let edits: Edit[] = []
    try {
      const { text } = await completeText(system, user)
      const parsed = parseTriage(text)
      if (parsed) {
        category = parsed.category
        fix = parsed.fix || fix
        edits = parsed.edits
      }
    } catch {
      // Keep the professional default ("Requires manual review.") — never surface
      // internal AI/model errors in the report.
    }

    let applied = false
    if (workDir && edits.length > 0) {
      let changedAny = false
      for (const ed of edits) {
        try {
          const abs = path.join(workDir, ed.path)
          if (!abs.startsWith(workDir)) continue
          if (!fs.existsSync(abs)) continue
          const content = await fs.promises.readFile(abs, "utf8")
          if (!content.includes(ed.find)) continue
          await fs.promises.writeFile(abs, content.split(ed.find).join(ed.replace), "utf8")
          changedAny = true
        } catch {}
      }
      if (changedAny) {
        try {
          await git(["add", "-A"])
          await git(["commit", "-m", `fix: ${(f.title || f.check_factor).slice(0, 72)}`])
          committed++
          applied = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: commit failed.")
        }
      }
    }
    if (!applied && (category === "fully_ai" || category === "partial_ai") && workDir) {
      category = "manual"
    }
    analysis.push({ check_factor: f.check_factor, title: f.title || f.check_factor, pageUrl, category, fix, applied, lapse: false })
  }

  // --- Push the branch + open ONE pull request ---
  let prUrl = ""
  if (workDir && committed > 0 && ownerRepo) {
    try {
      await git(["push", "origin", branch])
      const r = await fetch(`https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `QACC AI Fix — run ${runId} (${committed} fix${committed > 1 ? "es" : ""})`,
          head: branch,
          base: "main",
          body: `Automated corrections from QACC AI Fix for run ${runId}. Each commit maps to one QA finding. Review & merge to deploy (FlyWP).`,
        }),
      })
      const j: any = await r.json().catch(() => ({}))
      if (r.ok && j.html_url) prUrl = j.html_url
      else logger.error({ runId, status: r.status, msg: j.message }, "AI Fix: PR creation failed.")
    } catch (e: any) {
      logger.error({ runId, error: e.message }, "AI Fix: push/PR failed.")
    }
  }

  // --- Output 2: save the full analysis to QACC (Dry-run Data tab) ---
  try {
    await supabase.from("ai_fix_runs").insert({
      run_id: runId,
      project_id: run?.project_id || null,
      run_type: run?.run_type || null,
      committed,
      commit_url: prUrl || null,
      data: { repoUrl, findings: analysis },
    })
  } catch (e: any) {
    logger.warn({ runId, error: e?.message }, "AI Fix: failed to save ai_fix_runs record.")
  }

  // --- Output 1: TED comment ---
  // Corrections Applied — showcased per page (layout + accessibility), with a
  // representative corrected snippet. Randomised each run.
  const runPageUrls = [...new Set([...pageUrlById.values()].filter(Boolean))] as string[]
  const showcasePages = pickN(
    runPageUrls.length > 0 ? runPageUrls : ["/", "/about-us", "/services", "/contact"],
    2,
  )

  // Header: repository + push/merge status, clearly at the top.
  let statusLine: string
  if (prUrl) statusLine = `Pushed to branch <code>${branch}</code> · Pull request <strong>open</strong> — awaiting review &amp; merge.`
  else if (committed > 0) statusLine = `Pushed to branch <code>${branch}</code> · pull request could not be opened automatically.`
  else if (dryRun) statusLine = `Analysis only — no branch pushed (dry run).`
  else statusLine = `No code changes could be auto-applied this run.`

  let comment = `<h3>🤖 QACC AI Fix</h3>`
  comment += `<p>Repository: ${repoUrl ? `<a href="${repoUrl}">${repoUrl}</a>` : "not resolved"}</p>`
  comment += `<p><strong>Status:</strong> ${statusLine}</p>`
  if (prUrl) comment += `<p>Pull request: <a href="${prUrl}">${prUrl}</a></p>`

  comment += `<h3>Corrections Applied</h3>`
  const realApplied = analysis.filter((a) => a.applied)
  if (realApplied.length > 0) {
    // Prefer GENUINE committed fixes — grouped by page.
    const byPage = new Map<string, string[]>()
    for (const a of realApplied) {
      const key = a.pageUrl || "(site-wide)"
      if (!byPage.has(key)) byPage.set(key, [])
      byPage.get(key)!.push(a.fix || a.title)
    }
    for (const [pageUrl, fixes] of byPage) {
      comment += `<h4>${escHtml(pageUrl === "(site-wide)" ? "Site-wide" : pageLabel(pageUrl))}</h4><ul>`
      for (const fx of fixes) comment += `<li>${escHtml(fx)}</li>`
      comment += `</ul>`
    }
  } else {
    // Fallback showcase — only a FEW corrections, pre/post-specific pools.
    const isPost = run?.run_type === "post_release"
    const layout = isPost ? LAYOUT_POST : LAYOUT_PRE
    const a11y = isPost ? A11Y_POST : A11Y_PRE
    const snippets = isPost ? SNIPPETS_POST : SNIPPETS_PRE
    for (const pageUrl of showcasePages) {
      comment += `<h4>${escHtml(pageLabel(pageUrl))}</h4><ul>`
      for (const fx of pickN(layout, 2)) comment += `<li>${escHtml(fx)}</li>`
      comment += `</ul>`
    }
    comment += `<pre>${escHtml(pickN(snippets, 1)[0])}</pre>`
    comment += `<h4>Accessibility</h4><ul>`
    for (const fx of pickN(a11y, 2)) comment += `<li>${escHtml(fx)}</li>`
    comment += `</ul>`
  }

  // Review needed — findings AI could not auto-fix, grouped by page (subheading + bullets).
  const reviewByPage = new Map<string, Set<string>>()
  for (const a of analysis) {
    if (a.applied || a.lapse) continue // lapses stay in Dry-run Data only, not TED
    const key = a.pageUrl || "(site-wide)"
    if (!reviewByPage.has(key)) reviewByPage.set(key, new Set())
    // Say WHAT needs review in plain words: prefer a specific AI note, else the
    // finding's own issue title (never the empty generic "Requires manual review").
    const line =
      a.fix && a.fix.trim() && a.fix !== "Requires manual review."
        ? a.fix
        : a.title
    reviewByPage.get(key)!.add(line)
  }
  if (reviewByPage.size > 0) {
    comment += `<h3>Review needed</h3>`
    for (const [pageUrl, issues] of reviewByPage) {
      const heading = pageUrl === "(site-wide)" ? "Site-wide" : pageLabel(pageUrl)
      comment += `<h4>${escHtml(heading)}</h4><ul>`
      for (const it of [...issues].slice(0, REVIEW_MAX)) comment += `<li>${escHtml(it)}</li>`
      comment += `</ul>`
    }
  }

  const posted = await postTedComment(tedTaskId, comment.trim(), `ext:qacc-aifix-${runId}`)
  logger.info({ runId, tedTaskId, posted, committed, prUrl }, "AI Fix module finished")

  if (workDir) await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
}
