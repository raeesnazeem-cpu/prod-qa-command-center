import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { completeText, describeImage } from "../lib/aiFallback"
import { resolveBetaSiteRepo } from "../lib/tedClient"
import { postTedComment } from "../lib/tedSync"
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
 * AI Fix module (pure additive) — runs AFTER the QA report is posted to TED.
 *
 * DELIVERY WORKFLOW (locked — the only acceptable path): fixes go ONLY through
 * Git. Never touches the live site / WP directly. It clones the site's repo
 * (betaSiteRepo on the beta_site.env task), creates a branch, applies AI
 * corrections (commit each), pushes the branch, and opens a Pull Request to
 * main via the GitHub API. A human reviews + merges; FlyWP (GitHub Action on
 * the repo) then auto-deploys. The module never merges and never pushes to main.
 *
 * Gating: master switch AI_FIX_MODULE_ENABLED=true. Push/PR only when
 * GIT_FIX_TOKEN is set and AI_FIX_DRY_RUN !== "true"; otherwise it just posts
 * the categorized proposal comment (safe dry-run).
 */

const BUCKET_LABELS: Record<string, string> = {
  fully_ai: "✅ Fully solvable by AI",
  partial_ai: "🟡 Partially solvable by AI",
  manual: "🖐️ Inevitably manual",
  not_possible: "⛔ Cannot be done by AI",
}
const VALID = new Set(Object.keys(BUCKET_LABELS))
const MAX_FINDINGS = 20
const MAX_EDIT_FILES = 400 // cap repo file list handed to the model

interface Edit {
  path: string
  find: string
  replace: string
}
interface Triaged {
  title: string
  category: string
  fix: string
  applied: boolean
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
    logger.info({ runId }, "AI Fix module disabled (AI_FIX_MODULE_ENABLED != true); skipping.")
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

  if (!findings || findings.length === 0) {
    await postTedComment(
      tedTaskId,
      `<strong>🤖 QACC AI Fix</strong><br><br>No actionable findings to fix — nothing to propose.`,
      `ext:qacc-aifix-${runId}`,
    )
    return
  }

  // Resolve the target repo.
  const { data: run } = await supabase.from("qa_runs").select("project_id").eq("id", runId).single()
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", run?.project_id)
    .single()
  const repoUrl = await resolveBetaSiteRepo(project?.name).catch(() => null)
  const ownerRepo = repoUrl ? ownerRepoFromUrl(repoUrl) : null

  // --- Clone + branch (only when we will actually push) ---
  const willPush = !dryRun && !!repoUrl && !!ownerRepo
  const branch = `qacc-ai-fix/${runId}`
  let workDir = ""
  let fileList: string[] = []
  let committed = 0

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
      await git(["checkout", "-b", branch])
      const { stdout } = await git(["ls-files"])
      fileList = stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((p) => /\.(css|scss|less|php|html?|js|jsx|ts|tsx|twig|vue)$/i.test(p))
        .slice(0, MAX_EDIT_FILES)
    } catch (e: any) {
      logger.error({ runId, error: e.message }, "AI Fix: clone/branch failed; falling back to dry-run comment.")
      workDir = ""
    }
  }

  // --- Triage each finding (+ apply edits when pushing) ---
  const triaged: Triaged[] = []
  for (const f of findings.slice(0, MAX_FINDINGS)) {
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
      'Respond with STRICT JSON only: {"category":"fully_ai|partial_ai|manual|not_possible","fix":"<concise fix or why manual>","edits":[{"path":"<repo file>","find":"<exact substring to replace>","replace":"<new substring>"}]}',
      "Only include edits when you are confident the `find` substring exists verbatim in that file. Empty edits array if unsure.",
    ].join("\n")

    let category = "not_possible"
    let fix = "Could not obtain an AI proposal."
    let edits: Edit[] = []
    try {
      const { text } = await completeText(system, user)
      const parsed = parseTriage(text)
      if (parsed) {
        category = parsed.category
        fix = parsed.fix || fix
        edits = parsed.edits
      }
    } catch (e: any) {
      fix = `AI triage failed: ${e.message}`
    }

    // Apply edits to the branch (search/replace; commit per finding).
    let applied = false
    if (workDir && edits.length > 0) {
      let changedAny = false
      for (const ed of edits) {
        try {
          const abs = path.join(workDir, ed.path)
          if (!abs.startsWith(workDir)) continue // path traversal guard
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
          logger.warn({ runId, error: e.message }, "AI Fix: commit failed for a finding.")
        }
      }
    }
    // If we meant to fix in code but couldn't apply, it's really manual for now.
    if (!applied && (category === "fully_ai" || category === "partial_ai") && workDir) {
      category = "manual"
    }
    triaged.push({ title: f.title || f.check_factor, category, fix, applied })
  }

  // --- Push branch + open PR ---
  let prUrl = ""
  if (workDir && committed > 0 && ownerRepo) {
    try {
      await git(["push", "origin", branch])
      const body = {
        title: `QACC AI Fix — run ${runId} (${committed} fix${committed > 1 ? "es" : ""})`,
        head: branch,
        base: "main",
        body: `Automated corrections from QACC AI Fix for run ${runId}.\n\nEach commit maps to one QA finding. Review and merge to deploy (FlyWP).`,
      }
      const r = await fetch(`https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
      const j: any = await r.json().catch(() => ({}))
      if (r.ok && j.html_url) prUrl = j.html_url
      else logger.error({ runId, status: r.status, msg: j.message }, "AI Fix: PR creation failed.")
    } catch (e: any) {
      logger.error({ runId, error: e.message }, "AI Fix: push/PR failed.")
    }
  }

  // --- Build the second TED comment ---
  let comment = `<strong>🤖 QACC AI Fix — proposed resolutions</strong><br>`
  comment += repoUrl ? `Target repo: <a href="${repoUrl}">${repoUrl}</a><br>` : `Target repo: <em>not resolved</em><br>`
  if (prUrl) comment += `Pull request: <a href="${prUrl}">${prUrl}</a> — review &amp; merge to deploy (FlyWP).<br>`
  else if (dryRun) comment += `<em>DRY_RUN: proposals only — no branch/PR created.</em><br>`
  else comment += `<em>No code changes could be auto-applied; see manual items below.</em><br>`
  comment += `<br>`

  for (const bucket of Object.keys(BUCKET_LABELS)) {
    const items = triaged.filter((t) => t.category === bucket)
    if (items.length === 0) continue
    comment += `<strong>${BUCKET_LABELS[bucket]} (${items.length})</strong><br>`
    for (const it of items) {
      const badge = it.applied ? "✔ committed — " : ""
      comment += `• ${badge}<strong>${it.title}</strong><br>${it.fix.replace(/\n/g, "<br>")}<br><br>`
    }
  }

  const posted = await postTedComment(tedTaskId, comment.trim(), `ext:qacc-aifix-${runId}`)
  logger.info({ runId, tedTaskId, posted, committed, prUrl }, "AI Fix module finished")

  // Cleanup the clone.
  if (workDir) await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
}
