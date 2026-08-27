import { Job } from "bullmq"
import { Finding } from "@qacc/shared"
import { supabase } from "../lib/supabase"
import { completeText, describeImage } from "../lib/aiFallback"
import { resolveBetaSiteRepo, getReviewsWidgetId } from "../lib/tedClient"
import { provisionReviewsPage, reviewsEmbedSnippet } from "../lib/reviewsWidgetFix"
import {
  getReviewsWidgetFromBasecamp,
  getContactFormCodeFromBasecamp,
  getSingleScriptCodeFromBasecamp,
} from "../lib/basecampClient"
import { injectSingleScriptIntoFooter } from "../lib/singleScriptFix"
import { removeLearnMoreButtons } from "../lib/learnMoreFix"
import { deferChatbotScript } from "../lib/chatbotScriptFix"
import { applyFooterLogoFix } from "../lib/footerLogoFix"
import { applyStickyHeaderFix } from "../lib/stickyHeaderFix"
import {
  postTedComment,
  postSectionedReport,
  isToolLapseFinding,
  isCleanPassFinding,
  markAllTedTasksCompleted,
  type FixReportInfo,
} from "../lib/tedSync"
import {
  buildRepoIndex,
  gatherRepoContext,
  applyEdit,
  MAX_CONTEXT_FILES,
  type ApplyResult,
} from "../lib/repoContext"
import {
  seedPrivacyPolicyPage,
  seedPrivacyPolicyPageClassic,
  ensureFooterPrivacyLink,
} from "../lib/privacyPolicyFix"
import {
  deleteDefaultContentViaBlueprint,
  createCustom404,
} from "../lib/backendFix"
import { applySpellingFix } from "../lib/spellingFix"
import { detectFromRepoDir, type ThemeType } from "../lib/themeType"
import { detectRepoKind, type RepoKind } from "../lib/gitopsResource"
import {
  applySpellingGitops,
  applyBackendGitops,
  applyFaviconGitops,
  applyFooterLogoGitops,
  applyLearnMoreGitops,
  applyPrivacyPolicyGitops,
  applySeoOgGitops,
  applyAccessibilityGitops,
  applyChatbotGitops,
  type GitopsFixResult,
} from "../lib/gitopsFix"
import { renderPrivacyPolicy } from "../lib/privacyTemplate"
import { execFile } from "child_process"
import { promisify } from "util"
import fs from "fs"
import os from "os"
import path from "path"
import pino from "pino"
import pLimit from "p-limit"

const execFileAsync = promisify(execFile)
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

/**
 * AI Fix module — runs AFTER the QA report is posted to TED.
 *
 * DELIVERY (Git-only, never touches WP admin/DB directly). The repo comes
 * STRICTLY from the client's beta_site.env task (betaSiteRepo), the same source
 * for pre-release, post-release, and internal-QA runs. There is NO local/demo
 * fallback repo:
 *
 *  • Repo resolves + clonable: resolve → clone → branch → apply AI corrections
 *    → commit each `fix: <finding>` → push the branch → open ONE pull request to
 *    `main`. A human reviews + merges; FlyWP (GitHub Action) then auto-deploys.
 *    The module NEVER merges.
 *  • No repo access (unresolved or not clonable): the fix pass still computes
 *    each correction from the findings and reports it per subtask, explicitly
 *    noting the change was NOT applied because there's no repo access. Nothing
 *    is cloned or pushed.
 *
 * TWO OUTPUTS:
 *  1) TED comment = FIXED-errors report (grouped check → page → fix) + the
 *     single Pull request link (when a repo was available), or a clear
 *     "not applied — no repo access" status + a "Review needed" bullet list of
 *     the findings AI could not auto-fix (human decision).
 *  2) Full categorized analysis (every finding: category + proposal + applied)
 *     is saved to the `ai_fix_runs` table for the QACC "Dry-run Data" tab.
 *
 * Gating: AI_FIX_MODULE_ENABLED=true. Every run attempts the fix, applies it,
 * and pushes a branch to raise ONE PR. A push happens whenever the client's
 * beta_site.env repo is resolvable and a push token (GIT_FIX_TOKEN or a per-repo
 * override) is present. There is no dry-run: a push is only ever withheld by a
 * genuine repo-access gap, which the report states exactly.
 *
 * Retrieval: `lib/repoContext.ts` picks candidate files per finding and feeds the
 * model their ACTUAL contents. Edits are applied through `applyEdit`, which
 * tolerates re-indentation, refuses ambiguous or oversized matches, and reverts
 * anything that fails post-write verification.
 */

// Per-check labels, issue detail and before→after all come from the shared
// section renderer in tedSync now. Only the AI-fix status header is built here,
// so a small escape helper for the repo/fallback note is all that's left.
const escHtml = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const VALID = new Set(["fully_ai", "partial_ai", "manual", "not_possible"])
const MAX_FINDINGS = 20
const MAX_DIFF_CHARS = 6000

interface Edit {
  path: string
  find: string
  replace: string
}

// Batched triage: one LLM call carries SEVERAL findings and answers with a JSON
// ARRAY, each entry tagged with its 0-based `index` into the batch. Returns a
// result for every finding in the batch (length `n`), defaulting any missing /
// malformed entry to not_possible — so a garbled response never fabricates a
// fix and never drops a finding. Each edit is validated per entry (path/find/
// replace all strings, capped at 5) before it is trusted.
function parseTriageBatch(
  text: string,
  n: number,
): { category: string; fix: string; edits: Edit[] }[] {
  const out = Array.from({ length: n }, () => ({
    category: "not_possible",
    fix: "",
    edits: [] as Edit[],
  }))
  try {
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return out
    const arr = JSON.parse(m[0])
    if (!Array.isArray(arr)) return out
    for (const o of arr) {
      const idx = Number(o?.index)
      if (!Number.isInteger(idx) || idx < 0 || idx >= n) continue
      const category = String(o?.category || "").trim()
      const edits: Edit[] = Array.isArray(o?.edits)
        ? o.edits
            .filter(
              (e: any) =>
                e &&
                typeof e.path === "string" &&
                typeof e.find === "string" &&
                typeof e.replace === "string",
            )
            .slice(0, 5)
        : []
      out[idx] = {
        category: VALID.has(category) ? category : "not_possible",
        fix: String(o?.fix || "").trim(),
        edits,
      }
    }
  } catch {
    // Malformed JSON → every finding in the batch keeps its not_possible default.
  }
  return out
}

function ownerRepoFromUrl(repoUrl: string): { owner: string; repo: string } | null {
  // Repo names can contain dots (e.g. nuvoaestheticsclinic.gogroth.com), so we
  // must NOT stop the repo capture at the first dot — only strip a trailing
  // `.git` and any trailing slash / query / fragment.
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?(?:[?#].*)?$/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

// Per-project push token override. Some clients' beta_site.env repos live under
// a GitHub org/account the shared GIT_FIX_TOKEN cannot push to (e.g. TED client
// 1534 → G99agency/nuvoaestheticsclinic.gogroth.com, which has its own
// repo-scoped PAT). This maps a beta repo (owner/repo) to the env var holding
// its dedicated token, so the correct token is used ONLY for that one repo and
// falls back to GIT_FIX_TOKEN everywhere else.
//
// Config, never per-project code — GIT_FIX_TOKEN_OVERRIDES is a comma-separated
// list of `owner/repo=ENV_VAR_NAME`. Add a new project by adding one line:
//   GIT_FIX_TOKEN_OVERRIDES=G99agency/nuvoaestheticsclinic.gogroth.com=GH_TOKEN_NUVO
function resolveGitFixToken(
  ownerRepo: { owner: string; repo: string } | null,
): string | undefined {
  if (!ownerRepo) return undefined
  const raw = process.env.GIT_FIX_TOKEN_OVERRIDES
  if (!raw) return undefined
  const key = `${ownerRepo.owner}/${ownerRepo.repo}`.toLowerCase()
  for (const entry of raw.split(",")) {
    const [repoKey, envVar] = entry.split("=").map((s) => s.trim())
    if (!repoKey || !envVar) continue
    if (repoKey.toLowerCase() === key) {
      const val = process.env[envVar]
      if (val) return val
    }
  }
  return undefined
}

/**
 * Route a finding to a GitOps (resources/*.json) fix handler.
 *
 * Returns a result when this factor has a GitOps handler (applied or a
 * located-only proposal), or null when it doesn't — in which case the caller
 * falls through to the theme-file chain / generic LLM triage. Never throws:
 * a handler error degrades to a non-applied result so one bad fix can't abort
 * the run.
 */
async function runGitopsFix(
  f: Finding,
  workDir: string,
  ctx: {
    company: string
    siteUrl: string
    pageUrl: string
    projectId?: string | null
  },
): Promise<GitopsFixResult | null> {
  const text = `${f.title || ""} ${f.description || ""}`.toLowerCase()
  const guard = (fn: () => GitopsFixResult): GitopsFixResult => {
    try {
      return fn()
    } catch (e: any) {
      return { applied: false, files: [], description: "", note: `gitops handler threw: ${e?.message}` }
    }
  }
  const guardAsync = async (fn: () => Promise<GitopsFixResult>): Promise<GitopsFixResult> => {
    try {
      return await fn()
    } catch (e: any) {
      return { applied: false, files: [], description: "", note: `gitops handler threw: ${e?.message}` }
    }
  }

  switch (f.check_factor) {
    case "spelling":
    case "grammar":
      return guard(() => applySpellingGitops(workDir, f))
    case "backend_check":
      return guard(() => applyBackendGitops(workDir, f))
    case "favicon":
      return guard(() => applyFaviconGitops(workDir))
    case "footer_logo":
      return guard(() => applyFooterLogoGitops(workDir))
    case "learn_more_buttons":
      return guard(() => applyLearnMoreGitops(workDir))
    case "meta_tags":
    case "text_share":
      return guard(() =>
        applySeoOgGitops(workDir, f, { company: ctx.company, pageUrl: ctx.pageUrl }),
      )
    case "accessibility_check":
      return guard(() => applyAccessibilityGitops(workDir, f))
    case "chatbot_consultation":
      return guardAsync(() =>
        applyChatbotGitops(workDir, f, {
          projectId: ctx.projectId,
          projectName: ctx.company,
        }),
      )
    case "privacy_policy": {
      // Only act on a genuine "missing/blank policy" defect.
      if (!/privacy/.test(text)) return null
      const { html } = renderPrivacyPolicy({ company: ctx.company, url: ctx.siteUrl })
      // Created as a draft for human review (publish is a deliberate follow-up).
      return guard(() =>
        applyPrivacyPolicyGitops(workDir, {
          company: ctx.company,
          contentHtml: html,
          publish: false,
        }),
      )
    }
    default:
      return null
  }
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

  // Shared default push token. A per-repo override may replace it once the beta
  // repo is resolved (see resolveGitFixToken below) — a project may have an
  // override token even without a shared GIT_FIX_TOKEN.
  const baseToken = process.env.GIT_FIX_TOKEN
  logger.info({ runId, tedTaskId }, "AI Fix module starting")

  const { data: findings } = await supabase
    .from("findings")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "open")

  const { data: run } = await supabase
    .from("qa_runs")
    .select(
      "project_id, run_type, ted_subtask_map, site_url, enabled_checks, released_site_url",
    )
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

  // Repo resolution — STRICTLY the client's beta_site.env repo (betaSiteRepo),
  // the same source for pre-release, internal-QA, and post-release runs. There
  // is NO local/demo fallback repo anymore:
  //   • repo resolves & clones → clone from GitHub → branch → apply → push →
  //     open ONE pull request to `main` (never merged; a human reviews + merges,
  //     then FlyWP auto-deploys).
  //   • repo missing / not clonable → the fix pass still computes each correction
  //     from the findings and reports it per subtask, explicitly noting the
  //     change was NOT applied because there's no repo access. Nothing is pushed.
  const repoUrl: string | null = await resolveBetaSiteRepo(project?.name).catch(
    () => null,
  )

  const ownerRepo = repoUrl ? ownerRepoFromUrl(repoUrl) : null
  // Prefer a repo-scoped override token for this exact beta repo (e.g. client
  // 1534's G99agency repo → GH_TOKEN_NUVO); otherwise the shared token.
  const overrideToken = resolveGitFixToken(ownerRepo)
  const token = overrideToken ?? baseToken
  logger.info(
    { runId, tokenSource: overrideToken ? "override" : baseToken ? "shared" : "none", ownerRepo },
    "AI Fix: push token resolved",
  )
  // Every run attempts the fix, applies it, and pushes a branch to raise ONE PR.
  // There is no dry-run: the ONLY thing that can withhold a push is a genuine
  // lack of repo access (no repo URL, or no/invalid push token), reported with
  // the exact reason. When a repo + token are present, we always push.
  const canClone = !!repoUrl && !!ownerRepo && !!token
  const willPush = canClone

  // No usable repo → we can't clone/apply/push, but we CAN still determine the
  // corrections from the findings and report them per subtask, clearly flagged as
  // NOT applied (no repo access). So we DON'T bail out here: the per-finding loop
  // below computes each known fix, and the run-level status line makes clear the
  // changes were not applied. A repo, when present, adds the branch/PR clause.
  const noRepo = !repoUrl
  if (noRepo) {
    logger.info(
      { runId, project: project?.name, siteUrl: run?.site_url },
      "AI Fix: no beta_site.env repository access — reporting fixes per subtask without applying.",
    )
  }

  let workDir = ""
  // True when a repo WAS resolved but we couldn't clone it (bad/absent push
  // token, revoked access, private repo). Treated the same as noRepo for
  // reporting: the exact "no repo access" reason, stated in the report.
  let cloneFailed = false
  let repoIndex: string[] = []
  // Theme type detected directly from the cloned working tree — the most precise
  // signal (it sees the actual template files). Drives the classic-vs-block
  // variant of the deterministic fixes (e.g. 404.php vs templates/404.html).
  let repoThemeType: ThemeType = "unknown"
  // Repo shape: a GitOps content repo (resources/*.json + g99-control) takes a
  // completely different fix path than a theme repo — the theme-file handlers
  // write parts/footer.html / functions.php, none of which exist here.
  let repoKind: RepoKind = "theme"
  let committed = 0
  const branch = `qacc-ai-fix/${runId}`
  const git = (args: string[]) => execFileAsync("git", ["-C", workDir, ...args], { maxBuffer: 1024 * 1024 * 16 })

  if (canClone) {
    try {
      workDir = path.join(os.tmpdir(), "qacc-aifix", runId)
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
      await fs.promises.mkdir(path.dirname(workDir), { recursive: true })
      const authUrl = `https://${token}@github.com/${ownerRepo!.owner}/${ownerRepo!.repo}.git`
      await execFileAsync("git", ["clone", "--depth", "1", authUrl, workDir], { maxBuffer: 1024 * 1024 * 64 })
      await git(["config", "user.email", "ai-fix@growth99.com"])
      await git(["config", "user.name", "AI Fix"])
      await git(["checkout", "-b", branch]) // all fixes go on one branch → one PR
      repoIndex = await buildRepoIndex(workDir)
      repoThemeType = detectFromRepoDir(workDir)
      repoKind = detectRepoKind(workDir)
      logger.info(
        { runId, files: repoIndex.length, themeType: repoThemeType, repoKind, source: "github" },
        "AI Fix: repo cloned and indexed",
      )
    } catch (e: any) {
      logger.error({ runId, error: e.message }, "AI Fix: clone failed; triaging without repo context.")
      workDir = ""
      cloneFailed = true
    }
  }

  // No usable repo access: no repo resolved (noRepo), a resolved repo we couldn't
  // clone (cloneFailed: bad/revoked token, private repo), or a resolved repo with
  // no push token at all. All three are reported with the exact "no repo access"
  // reason, and must NEVER suppress documenting a determined fix. For every real
  // failing finding the correction is still stated ("✅ Fixed: …"); only checks
  // that genuinely need no fix say so. Repo access decides whether we PUSH, never
  // whether we DOCUMENT.
  const noRepoAccess = noRepo || cloneFailed || (!!repoUrl && !token)

  // Triage each finding (+ apply edits when pushing). Records for BOTH outputs.
  const analysis: {
    findingId: string | null
    check_factor: string
    title: string
    pageUrl: string
    category: string
    fix: string
    applied: boolean
    proposed: boolean
    lapse: boolean
    filesOffered?: string[]
    filesChanged?: string[]
    editNotes?: string[]
    // Literal before (`find`) → after (`replace`) for each edit that landed, so
    // the TED report can show the real correction instead of a paraphrase.
    edits?: { path: string; find: string; replace: string }[]
    diff?: string
    // Set ONLY when an edit was located in the repo but the OVERWRITE genuinely
    // failed after 3 retries (write/verification error) — never for a "text not
    // in the repo" mismatch. Surfaced verbatim in the report so a real technical
    // failure is stated exactly, never silently skipped.
    applyError?: { find: string; replace: string; reason: string }
    // Set when the finding is a real defect with NO automated fix that could ever
    // exist in code/config (e.g. "Project Plan not set" — the plan lives in TED
    // notes / HubSpot, not the site). Renders a plain "Suggested Fix … — no
    // automated fix possible" line, never "✅ Fixed" and never an AI-Fix banner.
    noAutoFix?: boolean
    suggestedFix?: string
    // Set for assisted-manual fixes that produced the exact code to place plus
    // where to put it (e.g. contact_form's per-client G99+ embed from Basecamp).
    // The report must SURFACE `fix` (the snippet + instructions), not the generic
    // "REST API access needed" boilerplate.
    placeCode?: boolean
  }[] = []

  // Findings that fall through every deterministic handler below need the
  // generic LLM triage. That triage is slow and INDEPENDENT per finding, so we
  // don't run it inline — we collect the findings here and triage them
  // concurrently after this loop (Phase A), then apply + commit serially
  // (Phase B). The deterministic handlers keep committing inline, unchanged.
  const llmFindings: any[] = []

  for (const f of (findings || []).slice(0, MAX_FINDINGS)) {
    const pageUrl = pageUrlById.get(f.page_id) || ""
    // Lapses (errored/skipped checks) are RECORDED for the internal Dry-run Data
    // tab, but never triaged, fixed, or shown in the TED report.
    if (isToolLapseFinding(f)) {
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "not_possible",
        fix: f.description || "Internal check issue (not a site defect).",
        applied: false,
        proposed: false,
        lapse: true,
      })
      continue
    }

    // --- GitOps content repo: JSON/Elementor fix path --------------------
    // In a GitOps repo the fix targets are resources/*.json + elementor.json,
    // not theme files. Route the mechanical fixes here and `continue` so the
    // theme-file handlers below never run against a repo that has no theme.
    // Findings this router does not handle fall through to the generic LLM
    // pass, which can still grep/edit the JSON resources directly.
    if (repoKind === "gitops" && workDir) {
      const g = await runGitopsFix(f, workDir, {
        company: project?.name || "",
        siteUrl: run?.site_url || "",
        pageUrl,
        projectId: run?.project_id,
      })
      if (g) {
        if (g.applied) committed++
        let diff = ""
        if (g.applied && g.files.length) {
          try {
            const { stdout } = await git(["diff", "--unified=3", "--", ...g.files])
            diff = stdout.slice(0, MAX_DIFF_CHARS)
          } catch {}
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: g.applied ? "fully_ai" : "manual",
          fix: g.description || g.note,
          applied: g.applied,
          // Located-but-not-applied (needs review) is a proposal, not a lapse.
          proposed: !g.applied,
          lapse: false,
          filesOffered: g.files,
          filesChanged: g.applied ? g.files : [],
          editNotes: [g.note],
          diff,
        })
        continue
      }
      // g === null → this factor has no GitOps handler; fall through.
    }

    // --- Dead/Broken Links: never auto-fix -------------------------------
    // A dead link is a content/URL decision (retarget or remove) that cannot
    // be safely automated, so this check has NO fix. Always report it as a
    // manual review, short-circuiting before any repo/LLM triage. dead_links
    // is the link check TED enqueues; broken_links is retired but kept here
    // defensively in case a manual run still enables it.
    if (f.check_factor === "dead_links" || f.check_factor === "broken_links") {
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: "Review the links manually.",
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }

    // --- Chatbot & Virtual Consultation ----------------------------------
    // Two distinct findings:
    //   • "needs manual review" = the install script IS in the source but the
    //     widgets don't render → a load-order race. AUTO-FIX: defer the script,
    //     and the next run re-verifies whether it renders.
    //   • "not installed" = script absent → a per-client REQUIREMENT decision;
    //     never auto-add. Manual: confirm the requirement first.
    if (f.check_factor === "chatbot_consultation" && /manual review/i.test(f.title || "")) {
      const res = workDir
        ? await deferChatbotScript(workDir).catch((e: any) => ({ changed: false, files: [] as string[], note: `defer threw: ${e?.message}` }))
        : { changed: false, files: [] as string[], note: "no repo cloned" }
      if (res.changed) {
        let landed = false
        let diff = ""
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", ...res.files])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: chatbot defer commit failed.")
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: landed ? "fully_ai" : "manual",
          fix: `Deferred the Cliff Hanger chatbot script (${res.note}) so it runs after the DOM is ready — the next QA run re-verifies the widgets render.`,
          // Applied = the edit landed and was committed locally (past tense).
          // Whether it was pushed is a separate fact stated in the push
          // disclaimer; a committed-but-unpushed fix is still an applied fix.
          applied: landed,
          proposed: false,
          lapse: false,
          filesOffered: res.files,
          filesChanged: landed ? res.files : [],
          editNotes: [res.note],
          edits: [],
          diff,
        })
        continue
      }
      // No repo access → still document the determined correction (not applied).
      if (noRepoAccess) {
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: "fully_ai",
          fix: "Deferred the Cliff Hanger chatbot script so it runs after the DOM is ready — the chatbot and virtual-consultation widgets render.",
          applied: false,
          proposed: true,
          lapse: false,
          filesOffered: [],
          filesChanged: [],
        })
        continue
      }
      // Script is in DB/page content — nothing to defer in the repo → manual.
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: `The chatbot script is present but the widgets don't render, and it isn't in the theme/mu-plugin repo to defer (${res.note}). Add a \`defer\` to the Cliff Hanger script manually and re-verify.`,
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }
    if (f.check_factor === "chatbot_consultation" && /not installed/i.test(f.title || "")) {
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: "No automatic fix — first confirm whether the chatbot and virtual consultation are required for this client; if required, add the Cliff Hanger + Virtual Consultation codes (from Basecamp) to the site.",
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }

    // --- Page Speed: no auto-fix -----------------------------------------
    // A low PageSpeed score is resolved by optimization work (images, caching,
    // scripts, CDN) — not a deterministic repo edit. Report it as manual.
    if (f.check_factor === "page_speed" && /needs optimization/i.test(f.title || "")) {
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: "No automatic fix — optimize page speed manually (compress/next-gen images, defer non-critical JS, enable caching/CDN, reduce render-blocking resources), then re-run.",
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }

    // --- Paid Media: no fix possible -------------------------------------
    // API-only check with no repo lever. When details are missing, the fix is
    // to add them manually in TED/HubSpot — never an auto/LLM fix. Only the FAIL
    // finding is short-circuited; the PASS is a clean-pass sentinel.
    if (
      f.check_factor === "paid_media" &&
      /not found/i.test(f.title || "")
    ) {
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: "No fix possible — add the paid media details manually in TED/HubSpot.",
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }

    // --- Deterministic Privacy Policy fix ---------------------------------
    // Two repo-native levers depending on the theme type:
    //   • CLASSIC theme → write a page-privacy-policy.php template + register it
    //     in functions.php $pages (the classic content model — see
    //     classicPageProvisioner). Preferred when the repo is classic.
    //   • BLOCK/unknown (or classic with no theme found) → the WP Playground
    //     blueprint seed (wp_insert_post via runPHP), the block content lever.
    // When a privacy page is flagged missing/empty, create it (idempotent) with
    // the shared policy template + the client's company name + site URL. Bypasses
    // the LLM triage entirely.
    const privacyDefect =
      f.check_factor === "privacy_policy" &&
      /missing|not found|no privacy|empty|content match:\s*no/i.test(
        `${f.title || ""} ${f.description || ""} ${f.context_text || ""}`,
      )
    if (workDir && privacyDefect) {
      const seedOpts = { company: project?.name || "", url: run?.site_url || "" }
      const seedFail = (e: any) => ({
        changed: false,
        file: "playground/blueprint.json",
        files: undefined as string[] | undefined,
        description: "",
        note: `seed threw: ${e?.message}`,
      })
      // Classic → try the classic-native provisioner first; if it can't resolve
      // a classic theme, fall back to the blueprint seed (a classic repo may
      // still carry one). Block/unknown → blueprint seed as before.
      let seed =
        repoThemeType === "classic"
          ? await seedPrivacyPolicyPageClassic(workDir, seedOpts).catch(seedFail)
          : await seedPrivacyPolicyPage(workDir, seedOpts).catch(seedFail)
      if (repoThemeType === "classic" && !seed.changed) {
        const bp = await seedPrivacyPolicyPage(workDir, seedOpts).catch(seedFail)
        if (bp.changed) seed = bp
      }
      // Additive: also ensure the footer carries a Privacy Policy link (the seed
      // only creates the PAGE). Non-destructive + idempotent; may change on its
      // own even when the page already existed.
      const footer = await ensureFooterPrivacyLink(workDir, repoThemeType).catch(
        () => ({ changed: false, files: [] as string[], note: "footer link threw" }),
      )
      // Footer link couldn't be auto-placed (nav block / no anchor cluster) →
      // note it so a human/AI adds it among the footer links.
      const footerNeedsManual = !footer.changed && !!(footer as any).needsPlacement
      if (seed.changed || footer.changed) {
        const seedFiles = [...(seed.changed ? (seed.files ?? [seed.file]) : []), ...footer.files]
        const parts = [
          seed.changed ? seed.description : "",
          footer.changed ? "Added a Privacy Policy link beside the existing footer links." : "",
          footerNeedsManual ? "Note: add a Privacy Policy link among the existing footer links manually (the footer uses a navigation block that can't be auto-edited safely)." : "",
        ].filter(Boolean)
        const combinedDesc = parts.join(" ")
        const combinedNote = [
          seed.changed ? `${(seed.files ?? [seed.file]).join(", ")}: ${seed.note}` : "",
          footer.changed ? `${footer.files.join(", ")}: ${footer.note}` : "",
        ].filter(Boolean).join(" | ")
        let landed = false
        let diff = ""
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", ...seedFiles])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: privacy seed commit failed.")
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: landed ? "fully_ai" : "manual",
          fix: combinedDesc,
          // Applied = the edit landed and was committed locally (past tense).
          // Whether it was pushed is a separate fact stated in the push
          // disclaimer; a committed-but-unpushed fix is still an applied fix.
          applied: landed,
          proposed: false,
          lapse: false,
          filesOffered: seedFiles,
          filesChanged: landed ? seedFiles : [],
          editNotes: [combinedNote],
          edits: [],
          diff,
        })
        continue
      }
      // No classic theme AND no blueprint (real Bedrock beta repo), or already
      // seeded → fall through to normal triage, which reports it honestly as a
      // manual page/DB fix.
    }

    // --- Deterministic backend / WordPress fixes -------------------------
    // Only the sub-defects the user asked to auto-fix: delete the default
    // "Hello world!" post and "Sample Page" (DB content → blueprint), and
    // create a simple custom 404 template when none is detected (theme file).
    // Gated on the DEFECT titles so the new clean-pass findings never trigger a
    // fix. Tagline / comments / contact-number fall through to manual.
    if (workDir && f.check_factor === "backend_check") {
      const t = (f.title || "").toLowerCase()
      let res: import("../lib/backendFix").BackendFixResult | null = null
      if (/hello world/.test(t) && /present/.test(t)) {
        res = await deleteDefaultContentViaBlueprint(workDir, {
          slug: "hello-world",
          postType: "post",
          label: '"Hello world!" post',
        }).catch(() => null)
      } else if (/sample page/.test(t) && /present/.test(t)) {
        res = await deleteDefaultContentViaBlueprint(workDir, {
          slug: "sample-page",
          postType: "page",
          label: '"Sample Page"',
        }).catch(() => null)
      } else if (/custom 404/.test(t) && /not detected/.test(t)) {
        // Theme-aware: classic → 404.php, block → templates/404.html.
        res = await createCustom404(workDir, repoThemeType).catch(() => null)
      }

      if (res && res.changed) {
        let landed = false
        let diff = ""
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", res.file])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: backend fix commit failed.")
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: landed ? "fully_ai" : "manual",
          fix: res.description,
          // Applied = the edit landed and was committed locally (past tense).
          // Whether it was pushed is a separate fact stated in the push
          // disclaimer; a committed-but-unpushed fix is still an applied fix.
          applied: landed,
          proposed: false,
          lapse: false,
          filesOffered: [res.file],
          filesChanged: landed ? [res.file] : [],
          editNotes: [`${res.file}: ${res.note}`],
          edits: [],
          diff,
        })
        continue
      }
      // Not auto-fixable here (no blueprint/theme, or a sub the user didn't ask
      // to auto-fix) → fall through to normal triage / manual reporting.
    }

    // --- Deterministic reviews-page fix (Project Plan) -------------------
    // Accelerator-plan sites must carry the Growth99 reviews widget on a
    // /reviews page. When the check flags it MISSING, provision that page
    // theme-aware (block → blueprint page seed; classic → page-reviews.php),
    // with the embed centered in an HTML block between global header/footer.
    // The per-client code comes from Basecamp (Message Board "Review and
    // Reputation Code" → Website Configuration Code); when unresolved we report
    // a manual paste-in instead of writing broken markup.
    const reviewsDefect =
      f.check_factor === "project_plan" &&
      /reviews widget missing/i.test(`${f.title || ""} ${f.description || ""}`)
    if (reviewsDefect) {
      // Primary source: Basecamp Message Board "Review and Reputation Code".
      // Fallback: the TED-notes embed line. Neither → review code not found.
      let widget = await getReviewsWidgetFromBasecamp(run?.project_id, project?.name).catch(() => null)
      if (!widget) widget = await getReviewsWidgetId(project?.name).catch(() => null)
      const res = workDir
        ? await provisionReviewsPage(workDir, repoThemeType, widget).catch(
            (e: any) => ({ changed: false, files: [], description: "", note: `provision threw: ${e?.message}`, manualSnippet: undefined }),
          )
        : { changed: false, files: [], description: "", note: "no repo cloned", manualSnippet: widget ? reviewsEmbedSnippet(widget.id, widget.bid) : reviewsEmbedSnippet("{REVIEW_WIDGET_ID}", "{BID}") }

      if (res.changed) {
        let landed = false
        let diff = ""
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", ...res.files])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: reviews widget commit failed.")
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: landed ? "fully_ai" : "manual",
          fix: res.description,
          // Applied = the edit landed and was committed locally (past tense).
          // Whether it was pushed is a separate fact stated in the push
          // disclaimer; a committed-but-unpushed fix is still an applied fix.
          applied: landed,
          proposed: false,
          lapse: false,
          filesOffered: res.files,
          filesChanged: landed ? res.files : [],
          editNotes: [`${res.files.join(", ")}: ${res.note}`],
          edits: [],
          diff,
        })
        continue
      }

      // No repo access → still document the determined correction (not applied).
      if (noRepoAccess) {
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: "fully_ai",
          fix: `Added the Growth99 reviews widget to a /reviews page (HTML block in the body, centered, within the global header/footer). Snippet:\n${res.manualSnippet || reviewsEmbedSnippet("{REVIEW_WIDGET_ID}", "{BID}")}`,
          applied: false,
          proposed: true,
          lapse: false,
          filesOffered: [],
          filesChanged: [],
          edits: [],
        })
        continue
      }
      // Could not apply (no code found, or no writable surface) → honest manual
      // report carrying the exact snippet + where it goes.
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: `Add the Growth99 reviews widget to a /reviews page (HTML block in the body, centered, global header/footer) — ${res.note}. Paste this snippet:\n${res.manualSnippet || reviewsEmbedSnippet("{REVIEW_WIDGET_ID}", "{BID}")}`,
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
        editNotes: [res.note],
        edits: [],
      })
      continue
    }

    // --- Project Plan: no-automated-fix cases ----------------------------
    // Any project_plan finding that reached here is NOT the reviews-widget
    // defect (that block `continue`d above). The remaining failing cases —
    // "Project Plan not set" (no plan in HubSpot/TED/notes) and "Project Plan
    // — could not reach TED" — are DATA issues that live in TED notes / HubSpot,
    // not in the site's code. No automated fix can ever exist for them, so we
    // NEVER run them through the LLM triage (which would fabricate a "✅ Fixed"
    // line). We report them honestly as a suggestion the human must act on.
    if (f.check_factor === "project_plan") {
      const suggested = /could not reach ted/i.test(f.title || "")
        ? "Retry once TED is reachable, or add the Growth99 plan to the client's TED notes / HubSpot growth99_plan field."
        : "Add the Growth99 project plan to the client notes, or set the growth99_plan field in HubSpot / the TED client record."
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: suggested,
        applied: false,
        proposed: false,
        lapse: false,
        noAutoFix: true,
        suggestedFix: suggested,
        filesOffered: [],
        filesChanged: [],
        edits: [],
      })
      continue
    }

    // --- Deterministic Learn More buttons fix ----------------------------
    // The check flags generic CTA buttons ("Learn More"/"Read More"/…). The fix
    // is to REMOVE them. We strip matching Gutenberg button blocks + plain
    // anchors/buttons from the theme repo; when the button is DB/page content
    // (not in the repo) nothing matches and we report a manual removal.
    const learnMoreDefect =
      f.check_factor === "learn_more_buttons" &&
      /\d+\s+generic CTA button/i.test(f.title || "")
    if (learnMoreDefect) {
      const res = workDir
        ? await removeLearnMoreButtons(workDir, repoThemeType).catch(
            (e: any) => ({ changed: false, files: [] as string[], removed: 0, description: "", note: `remove threw: ${e?.message}` }),
          )
        : { changed: false, files: [] as string[], removed: 0, description: "", note: "no repo cloned" }

      if (res.changed) {
        let landed = false
        let diff = ""
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", ...res.files])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: learn-more removal commit failed.")
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: landed ? "fully_ai" : "manual",
          fix: res.description,
          // Applied = the edit landed and was committed locally (past tense).
          // Whether it was pushed is a separate fact stated in the push
          // disclaimer; a committed-but-unpushed fix is still an applied fix.
          applied: landed,
          proposed: false,
          lapse: false,
          filesOffered: res.files,
          filesChanged: landed ? res.files : [],
          editNotes: [res.note],
          edits: [],
          diff,
        })
        continue
      }

      // No repo access → still document the determined correction (not applied).
      if (noRepoAccess) {
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: "fully_ai",
          fix: `Removed the generic "Learn More"-style CTA button(s).`,
          applied: false,
          proposed: true,
          lapse: false,
          filesOffered: [],
          filesChanged: [],
        })
        continue
      }
      // Not in the repo (DB/page content) → honest manual removal.
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: `Remove the generic "Learn More"-style CTA button(s) — ${res.note}.`,
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }

    // --- Deterministic Footer Logo fix -----------------------------------
    // Add a "Developed & maintained by <Growth99 logo>" credit into the footer.
    // AI determines the variant: it reads the footer background from the evidence
    // screenshot and picks the WHITE SVG for dark footers or the COLOUR WebP for
    // light ones. The logo height is set in `em` so it resizes to the credit text
    // next to it (see footerLogoFix). Runs on a real footer-logo defect (wrong/
    // missing logo, tagline present, or vision-unverified), not tool lapses.
    const footerLogoDefect =
      f.check_factor === "footer_logo" &&
      !/check failed/i.test(f.title || "") &&
      /issue|not verified|missing|tagline|logo/i.test(`${f.title || ""} ${f.description || ""}`)
    if (footerLogoDefect) {
      // AI: classify the footer background (dark → white logo, light → colour).
      let variant: "white" | "color" = "white"
      const shot = (f.screenshot_url || "").split(",")[0]?.trim()
      if (shot) {
        try {
          const resp = await fetch(shot)
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer())
            const verdict = await describeImage(
              buf,
              'Look ONLY at the footer background colour in this screenshot. Reply with ONE word: "DARK" if the footer background is dark (white logo needed) or "LIGHT" if it is light/white (dark/colour logo needed).',
            ).catch(() => "")
            if (/light/i.test(verdict)) variant = "color"
            else if (/dark/i.test(verdict)) variant = "white"
          }
        } catch {}
      }

      const res = workDir
        ? await applyFooterLogoFix(workDir, repoThemeType, { variant }).catch(
            (e: any) => ({ changed: false, files: [] as string[], note: `footer logo fix threw: ${e?.message}`, variant }),
          )
        : { changed: false, files: [] as string[], note: "no repo cloned", variant }

      const variantLabel = variant === "white" ? "white (dark background)" : "colour (light background)"
      if (res.changed) {
        let landed = false
        let diff = ""
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", ...res.files])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: footer logo commit failed.")
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: landed ? "fully_ai" : "manual",
          fix: `Added the "Developed & maintained by Growth99" footer credit using the ${variantLabel} logo, sized to the adjacent text.`,
          applied: landed,
          proposed: false,
          lapse: false,
          filesOffered: res.files,
          filesChanged: landed ? res.files : [],
          editNotes: [res.note],
          edits: [],
          diff,
        })
        continue
      }

      // No repo access → document the determined correction (not applied).
      if (noRepoAccess) {
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: "fully_ai",
          fix: `Add the "Developed & maintained by Growth99" footer credit using the ${variantLabel} logo (white SVG on dark footers, colour WebP on light), sized to the adjacent text.`,
          applied: false,
          proposed: true,
          lapse: false,
          filesOffered: [],
          filesChanged: [],
        })
        continue
      }
      // Repo present but no footer template to edit → honest manual report.
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: `Add the "Developed & maintained by Growth99" footer credit (${variantLabel} logo) manually — ${res.note}.`,
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }

    // --- Deterministic Sticky Header fix ---------------------------------
    // The top_bar_sticky check passes a header that stays pinned after scroll OR
    // declares computed position:sticky. When neither holds (reported inline as
    // "did NOT stay pinned"), the fix is to make it sticky: inject a CSS rule
    // that sets position:sticky;top:0 (+ z-index) on the header element into the
    // theme's header template. Block → parts/header.html; classic → header.php.
    const stickyDefect =
      f.check_factor === "top_bar_sticky" &&
      !/check failed/i.test(f.title || "") &&
      /did not stay pinned|not pinned/i.test(
        `${f.title || ""} ${f.description || ""} ${(f as any).context_text || ""}`,
      )
    if (stickyDefect) {
      const res = workDir
        ? await applyStickyHeaderFix(workDir, repoThemeType).catch((e: any) => ({
            changed: false,
            files: [] as string[],
            note: `sticky header fix threw: ${e?.message}`,
          }))
        : { changed: false, files: [] as string[], note: "no repo cloned" }

      if (res.changed) {
        let landed = false
        let diff = ""
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", ...res.files])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: sticky header commit failed.")
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: landed ? "fully_ai" : "manual",
          fix: `Made the header sticky — added position:sticky;top:0 to the header element in the theme's header template.`,
          applied: landed,
          proposed: false,
          lapse: false,
          filesOffered: res.files,
          filesChanged: landed ? res.files : [],
          editNotes: [res.note],
          edits: [],
          diff,
        })
        continue
      }

      // No repo access → document the determined correction (not applied).
      if (noRepoAccess) {
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: "fully_ai",
          fix: `Make the header sticky — add position:sticky;top:0 to the header element in the theme's header template.`,
          applied: false,
          proposed: true,
          lapse: false,
          filesOffered: [],
          filesChanged: [],
        })
        continue
      }
      // Repo present but no header template to edit → honest manual report.
      analysis.push({
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        fix: `Make the header sticky (position:sticky;top:0) manually — ${res.note}.`,
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }

    // --- Contact Form not found → pull the client's G99+ embed from Basecamp
    // The correct contact-form embed (bid/fid differ per client) lives on the
    // client's Basecamp Message Board ("G99+ Contact Form Code"). Resolve the
    // Basecamp project by the TED project name, read that message, and hand the
    // developer the exact snippet to place on the contact spaces of every page.
    // Reported as MANUAL (developer placement across per-client "desired spaces"
    // on all pages) — carrying the real code, never a bare suggestion.
    if (f.check_factor === "contact_form" && /not found/i.test(f.title || "")) {
      const cf = await getContactFormCodeFromBasecamp(run?.project_id, project?.name).catch(
        () => null,
      )
      const base = {
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
        category: "manual",
        applied: false,
        proposed: false,
        lapse: false,
        placeCode: true,
        filesOffered: [] as string[],
        filesChanged: [] as string[],
      }
      if (cf?.found) {
        analysis.push({
          ...base,
          fix: `No contact form was found in the page source. Add this project's contact-form code — the exact embed from its Basecamp Message Board "G99+ Contact Form Code" message — to the contact section of every page:\n${cf.snippet}`,
        })
      } else {
        analysis.push({
          ...base,
          fix: `No contact form was found in the page source, and the "G99+ Contact Form Code" message could not be read from this project's Basecamp Message Board. Open that message in Basecamp, copy the exact embed it contains, and add it to the contact section of every page.`,
        })
      }
      continue
    }

    // --- Single Script not installed → inject the Cliff Hanger embed -------
    // The site-wide loader (the "G99+ Cliff Hanger Code" on the client's Basecamp
    // Message Board — a business-id div + integration.js, data-id differs per
    // client) is a ONE-TIME site-wide snippet. We read it from Basecamp and
    // inject it into the FOOTER template so it loads on every page. Committed +
    // pushed like the other deterministic fixers.
    if (f.check_factor === "single_script" && /not installed/i.test(f.title || "")) {
      const ss = await getSingleScriptCodeFromBasecamp(run?.project_id, project?.name).catch(
        () => null,
      )
      const baseRec = {
        findingId: f.id ? String(f.id) : null,
        check_factor: f.check_factor,
        title: f.title || f.check_factor,
        pageUrl,
      }
      if (ss?.found) {
        const res = workDir
          ? await injectSingleScriptIntoFooter(workDir, repoThemeType, {
              businessId: ss.businessId,
              scriptSrc: ss.scriptSrc,
            }).catch((e: any) => ({ changed: false, files: [] as string[], note: `inject threw: ${e?.message}` }))
          : { changed: false, files: [] as string[], note: "no repo cloned" }

        if (res.changed) {
          let landed = false
          let diff = ""
          try {
            const { stdout } = await git(["diff", "--unified=3", "--", ...res.files])
            diff = stdout.slice(0, MAX_DIFF_CHARS)
          } catch {}
          try {
            // Edit is in the working tree; all fixes are committed once, together,
            // right before push (Task 6 — one commit per run, not per finding).
            committed++
            landed = true
          } catch (e: any) {
            logger.warn({ runId, error: e.message }, "AI Fix: single-script inject commit failed.")
          }
          analysis.push({
            ...baseRec,
            category: landed ? "fully_ai" : "manual",
            fix: `Injected the Growth99 single-script embed (Cliff Hanger, data-id=${ss.businessId || "?"}) into the footer template so it loads site-wide on every page.`,
            applied: landed,
            proposed: false,
            lapse: false,
            filesOffered: res.files,
            filesChanged: landed ? res.files : [],
            editNotes: [res.note],
            edits: [],
            diff,
          })
          continue
        }

        // No repo access → document the determined correction (not applied).
        if (noRepoAccess) {
          analysis.push({
            ...baseRec,
            category: "fully_ai",
            fix: `Inject the Growth99 single-script embed (Cliff Hanger, data-id=${ss.businessId || "?"}) into the footer so it loads site-wide:\n${ss.snippet}`,
            applied: false,
            proposed: true,
            lapse: false,
            filesOffered: [],
            filesChanged: [],
          })
          continue
        }
        // Repo present but no footer template to edit → honest manual report.
        analysis.push({
          ...baseRec,
          category: "manual",
          fix: `Add the Growth99 single-script embed (Cliff Hanger, data-id=${ss.businessId || "?"}) to the footer so it loads site-wide — ${res.note}:\n${ss.snippet}`,
          applied: false,
          proposed: false,
          lapse: false,
          filesOffered: [],
          filesChanged: [],
        })
        continue
      }
      // Couldn't read the Cliff Hanger code from Basecamp → honest manual report.
      analysis.push({
        ...baseRec,
        category: "manual",
        fix: `The single-script embed is missing, and the "G99+ Cliff Hanger Code" message could not be read from this project's Basecamp Message Board. Get the Cliff Hanger code (business-id div + chatbot.growth99.com/assets/js/integration.js) from Basecamp and add it to the footer so it loads site-wide.`,
        applied: false,
        proposed: false,
        lapse: false,
        filesOffered: [],
        filesChanged: [],
      })
      continue
    }

    // --- Deterministic spelling fix --------------------------------------
    // A misspelling carries its own exact word + suggestion, so the fix is a
    // mechanical whole-word swap — no LLM, no anchor guessing. When the word is
    // in a theme file we correct every occurrence; when it isn't, it's DB page
    // content and we fall through to an honest manual report.
    if (workDir && f.check_factor === "spelling") {
      const sp = await applySpellingFix(workDir, f).catch((e: any) => ({
        changed: false,
        description: "",
        note: `spelling fix threw: ${e?.message}`,
        filesChanged: [] as string[],
        edits: [] as { path: string; find: string; replace: string }[],
      }))
      if (sp.changed) {
        let landed = false
        let diff = ""
        try {
          const { stdout } = await git([
            "diff",
            "--unified=3",
            "--",
            ...sp.filesChanged,
          ])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: spelling commit failed.")
        }
        analysis.push({
          findingId: f.id ? String(f.id) : null,
          check_factor: f.check_factor,
          title: f.title || f.check_factor,
          pageUrl,
          category: landed ? "fully_ai" : "manual",
          fix: sp.description,
          // Applied = the edit landed and was committed locally (past tense).
          // Whether it was pushed is a separate fact stated in the push
          // disclaimer; a committed-but-unpushed fix is still an applied fix.
          applied: landed,
          proposed: false,
          lapse: false,
          filesOffered: sp.filesChanged,
          filesChanged: landed ? sp.filesChanged : [],
          editNotes: [sp.note],
          edits: sp.edits,
          diff,
        })
        continue
      }
      // Word not in the codebase (DB/page content) → fall through to normal
      // triage, which reports it honestly as a manual page/DB fix.
    }

    // Fell through every deterministic handler → generic LLM triage. Triage
    // (context retrieval + the model call) is the slow, INDEPENDENT part, so we
    // don't run it inline; collect the finding and triage the whole batch
    // CONCURRENTLY below (Phase A), then apply + commit SERIALLY (Phase B).
    llmFindings.push(f)
  }

  // ===================== Phase A: triage (concurrent) =====================
  // Two sub-stages, both git-free (read-only + network) so both parallelize:
  //   A1 — per finding, gather its screenshot description + candidate-file
  //        context and build that finding's prompt block.
  //   A2 — send SEVERAL findings per LLM call (a JSON-array response), a few
  //        batched calls instead of one-per-finding. Fewer round-trips = less
  //        total wait and less chance of tripping provider rate limits.
  // Both bounded so we never hammer the provider. Kept at 3 (override via
  // AI_FIX_TRIAGE_CONCURRENCY); batch size via AI_FIX_TRIAGE_BATCH_SIZE.
  const TRIAGE_CONCURRENCY = Math.max(
    1,
    Number(process.env.AI_FIX_TRIAGE_CONCURRENCY || 3),
  )
  const TRIAGE_BATCH_SIZE = Math.max(
    1,
    Number(process.env.AI_FIX_TRIAGE_BATCH_SIZE || 4),
  )
  type TriageResult = {
    f: any
    pageUrl: string
    repoCtx: Awaited<ReturnType<typeof gatherRepoContext>> | null
    category: string
    fix: string
    edits: Edit[]
  }

  // --- A1: build each finding's prompt block (concurrent, git-free) ---
  type Prepared = {
    f: any
    pageUrl: string
    repoCtx: Awaited<ReturnType<typeof gatherRepoContext>> | null
    block: string
  }
  const prepLimit = pLimit(TRIAGE_CONCURRENCY)
  const prepared: Prepared[] = await Promise.all(
    llmFindings.map((f) =>
      prepLimit(async (): Promise<Prepared> => {
        const pageUrl = pageUrlById.get(f.page_id) || ""

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

        // Retrieval: pick the files most likely to hold the fix and read them, so
        // the model writes `find` strings by copying real text instead of guessing.
        let repoCtx: Awaited<ReturnType<typeof gatherRepoContext>> | null = null
        if (workDir) {
          repoCtx = await gatherRepoContext(workDir, repoIndex, f).catch(() => null)
        }

        const fileSection =
          repoCtx && repoCtx.files.length > 0
            ? [
                "",
                `Candidate files (${repoCtx.files.length} of the repo's most relevant, contents below):`,
                repoCtx.files.map((p) => `- ${p}`).join("\n"),
                "",
                repoCtx.block,
              ].join("\n")
            : workDir
              ? "\nNo candidate files could be retrieved for this finding — return an empty edits array."
              : "\nNo repository is available this run, so you cannot return code edits — return an empty edits array. STILL classify whether this finding is fixable (fully_ai/partial_ai) and describe the exact correction you would make in `fix` (concrete and specific, e.g. the corrected text)."
        // Per-finding block: everything the model needs to judge THIS finding.
        // The response-format/rules live once in the batch header below, so the
        // block itself carries no output instructions. `path` scoping is enforced
        // both in the prompt (candidate files are listed per finding) and again
        // at apply time (applyEdit rejects any path not in this finding's files).
        const block = [
          `Finding: ${f.title || f.check_factor}`,
          repoThemeType !== "unknown"
            ? `Repository theme type: ${repoThemeType} — ${repoThemeType === "classic" ? "a CLASSIC PHP theme (page-*.php templates + functions.php; content is hardcoded HTML in the PHP template files, NOT theme.json/templates/*.html)" : "a BLOCK/FSE theme (theme.json + templates/*.html + patterns)"}. Prefer edits to the matching file kind.`
            : "",
          f.description ? `Details: ${f.description}` : "",
          f.context_text ? `Context: ${f.context_text}` : "",
          visual ? `Screenshot shows: ${visual}` : "",
          repoCtx && repoCtx.anchors.length > 0
            ? `Literal strings from this finding that were searched for in the repo: ${repoCtx.anchors.map((a) => JSON.stringify(a)).join(", ")}`
            : "",
          fileSection,
        ]
          .filter(Boolean)
          .join("\n")

        return { f, pageUrl, repoCtx, block }
      }),
    ),
  )

  // --- A2: batch the LLM triage calls (concurrent) ---
  const batches: Prepared[][] = []
  for (let i = 0; i < prepared.length; i += TRIAGE_BATCH_SIZE)
    batches.push(prepared.slice(i, i + TRIAGE_BATCH_SIZE))

  const system =
    "You are a senior web engineer fixing automated website QA findings in a code-first WordPress repo (block themes, classic theme templates, patterns, CSS/JS — NOT Elementor). You are given SEVERAL findings, each with the ACTUAL contents of its own candidate files. For each finding, decide whether it can be fixed by editing this repo, and if so return concrete search/replace edits."

  const batchLimit = pLimit(TRIAGE_CONCURRENCY)
  const triagedNested: TriageResult[][] = await Promise.all(
    batches.map((batch) =>
      batchLimit(async (): Promise<TriageResult[]> => {
        const user = [
          `You are given ${batch.length} finding${batch.length > 1 ? "s" : ""}, numbered 0..${batch.length - 1} below.`,
          'Respond with STRICT JSON only — an ARRAY with exactly one object per finding:',
          '[{"index":<0-based finding number>,"category":"fully_ai|partial_ai|manual|not_possible","fix":"<concise description of the code or config change that resolves that finding>","edits":[{"path":"<one of THAT finding\'s candidate file paths>","find":"<substring copied byte-for-byte from that file>","replace":"<replacement>"}]}]',
          "Rules for `edits`:",
          "- `index` MUST match the finding number the edit belongs to.",
          "- `path` MUST be one of the candidate file paths listed under THAT finding. Never invent a path and never use another finding's file.",
          "- `find` MUST be copied verbatim from the shown contents of that file, long enough to occur exactly once (include surrounding markup if needed). Never write a snippet from memory.",
          "- Where contents are shown as excerpts, only quote text that is actually displayed — regions marked as omitted are not available.",
          "- Return an empty `edits` array for a finding when its resolution is a content/config or WordPress admin/database change rather than a source-code edit, or when the repository does not contain the relevant code.",
          "",
          ...batch.map(
            (p, i) => `===== FINDING ${i} =====\n${p.block}`,
          ),
        ].join("\n")

        let parsed = batch.map(() => ({
          category: "not_possible",
          fix: "",
          edits: [] as Edit[],
        }))
        try {
          const { text } = await completeText(system, user)
          parsed = parseTriageBatch(text, batch.length)
        } catch {
          // Never surface internal AI/model errors in the report. Every finding
          // in the batch keeps its not_possible default; the reporter falls back
          // to the finding's own title as the proposal.
        }

        return batch.map((p, i) => ({
          f: p.f,
          pageUrl: p.pageUrl,
          repoCtx: p.repoCtx,
          category: parsed[i].category,
          fix: parsed[i].fix,
          edits: parsed[i].edits,
        }))
      }),
    ),
  )
  const triaged: TriageResult[] = triagedNested.flat()

  // ===================== Phase B: serial apply + commit =====================
  // Applying edits mutates the ONE git working tree + index, so this MUST run
  // one finding at a time — never concurrently, or git corrupts. Each triage
  // result carries everything the apply step needs from Phase A.
  for (const t of triaged) {
    const { f, pageUrl, repoCtx } = t
    let category = t.category
    let fix = t.fix
    const edits = t.edits

    // Apply through applyEdit: whitespace-tolerant, refuses ambiguous or
    // oversized matches, reverts anything that fails post-write verification.
    let landed = false
    const filesChanged: string[] = []
    const editNotes: string[] = []
    // Only edits that actually applied — these carry the real before→after the
    // report shows. An edit the model proposed but that failed to apply is NOT
    // recorded as a fix.
    const landedEdits: Edit[] = []
    let diff = ""

    // Genuine overwrite/write failures (NOT "text not in the repo" mismatches),
    // captured after the retries below so the report can state them exactly.
    const overwriteFailures: { find: string; replace: string; reason: string }[] = []
    // A write/verification failure is technical and worth retrying; a logical
    // mismatch (text absent, ambiguous, path not offered, no-op) returns the same
    // result every time, so retrying it is pointless — those are DB-content, not
    // failures to overwrite.
    const isOverwriteFailure = (reason: string) =>
      /verification after write failed|replacement not found after write|apply threw|EACCES|EPERM|EBUSY|ENOSPC/i.test(
        reason,
      )

    if (workDir && edits.length > 0) {
      for (const ed of edits) {
        // Retry the apply up to 3 times before giving up — a write/overwrite
        // failure must NEVER be an easy way to skip a fix. Break the instant it
        // lands. (A deterministic mismatch just exhausts the attempts harmlessly.)
        let res: ApplyResult = { ok: false, reason: "not attempted" }
        for (let attempt = 1; attempt <= 3; attempt++) {
          res = await applyEdit(workDir, ed, repoCtx?.files || []).catch(
            (e: any) => ({ ok: false, reason: `apply threw: ${e?.message}` }),
          )
          if (res.ok) break
          if (attempt < 3 && isOverwriteFailure(res.reason))
            logger.warn(
              { runId, path: ed.path, attempt, reason: res.reason },
              "AI Fix: overwrite failed; retrying",
            )
          else if (!isOverwriteFailure(res.reason)) break // no point retrying a mismatch
        }
        editNotes.push(`${ed.path}: ${res.reason}`)
        if (res.ok) {
          const rel = ed.path.replace(/^\.?\//, "")
          if (!filesChanged.includes(rel)) filesChanged.push(rel)
          landedEdits.push(ed)
        } else if (isOverwriteFailure(res.reason)) {
          overwriteFailures.push({
            find: ed.find,
            replace: ed.replace,
            reason: res.reason,
          })
        }
      }

      if (filesChanged.length > 0) {
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", ...filesChanged])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Edit is in the working tree; all fixes are committed once, together,
          // right before push (Task 6 — one commit per run, not per finding).
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: commit failed.")
        }
      }
    }

    // Applied = the edit landed and was committed locally (past tense),
    // independent of push. The no-repo branch below sets `proposed` for
    // corrections we determined but could not commit (no repository this run).
    let applied = landed
    let proposed = false
    // The edits shown in the report — the ones that actually landed in a repo,
    // or (no repo) the ones we KNOW the correction for from the finding itself.
    let reportEdits: Edit[] = landedEdits

    // --- No repository this run: still report the fix, in the past tense. ------
    // We know the correction even without a repo to apply it to. For a spelling
    // finding the exact before→after is in the finding; for other AI-fixable
    // findings the model's `fix` description is the correction. Marked as done
    // (proposed=true, which the report renders as "✅ Fixed"); the run-level
    // status line says nothing was pushed (no repo).
    if (!workDir && !landed) {
      if (f.check_factor === "spelling" && reportEdits.length === 0) {
        const hay = `${f.title || ""}\n${f.description || ""}\n${f.context_text || ""}`
        const word = /misspell(?:ed|ing)?[:\s]+["“']?([A-Za-z][\w'-]*)/i.exec(hay)?.[1]?.trim()
        const sugg = /suggest(?:ion|ed)?[:\s]+["“']?([A-Za-z][\w'-]*)/i.exec(hay)?.[1]?.trim()
        if (word && sugg && word.toLowerCase() !== sugg.toLowerCase()) {
          reportEdits = [{ path: "", find: word, replace: sugg }]
          if (!fix) fix = `Corrected "${word}" to "${sugg}"`
        }
      }
      // With no repo we cannot verify whether the text lives in code or the DB,
      // so we NEVER downgrade a real defect to a generic "manual / REST API
      // needed" label — that would be an assumption. Every real finding is a
      // failing check that needs a fix, so document the correction: the model's
      // `fix` if it gave one, otherwise the finding's own text (its failing
      // condition, per subtask). Only a genuine no-defect finding stays blank.
      if (!fix.trim() && reportEdits.length === 0) {
        const derived = (f.description || f.context_text || f.title || "").trim()
        if (derived) fix = derived
      }
      const known = reportEdits.length > 0 || !!fix.trim()
      if (known) proposed = true
    }

    // Never let a claim of AI-fixability survive when no edit actually landed
    // AND we're in a repo (in-repo: an unapplied edit is not a real fix). With
    // no repo the known-fix branch above already decided reportability.
    if (!landed && (category === "fully_ai" || category === "partial_ai") && workDir) {
      category = "manual"
    }

    if (edits.length > 0 && !landed) {
      logger.info(
        { runId, checkFactor: f.check_factor, editNotes },
        "AI Fix: proposed edits did not apply",
      )
    }

    analysis.push({
      findingId: f.id ? String(f.id) : null,
      check_factor: f.check_factor,
      title: f.title || f.check_factor,
      pageUrl,
      category,
      fix,
      applied,
      proposed,
      lapse: false,
      filesOffered: repoCtx?.files || [],
      filesChanged,
      editNotes,
      edits: reportEdits.map((e) => ({
        path: e.path,
        find: e.find,
        replace: e.replace,
      })),
      diff,
      // Only when nothing landed for this finding AND the reason was a genuine
      // overwrite failure (not a text-not-in-repo mismatch). Reported verbatim.
      applyError:
        !landed && overwriteFailures.length > 0
          ? overwriteFailures[0]
          : undefined,
    })
  }

  // --- Task 6: ONE commit for every fix that landed this run ---
  // The fix helpers above each wrote their edit to the working tree and bumped
  // `committed` (the count of fixes, used for the PR title/status), but none of
  // them committed. Stage + commit them all here — two git spawns instead of the
  // old add+commit per finding (~2×N). If this commit fails there is nothing real
  // to push, so the push gate below skips and `commitError` explains why.
  let commitError = ""
  if (workDir && committed > 0) {
    try {
      await git(["add", "-A"])
      await git([
        "commit",
        "-m",
        `fix: AI Fix run ${runId} — ${committed} fix${committed > 1 ? "es" : ""}`,
      ])
    } catch (e: any) {
      commitError = String(e?.message || e)
      logger.error({ runId, error: commitError }, "AI Fix: single commit failed.")
    }
  }

  // --- Push the branch + open ONE pull request (real beta/post-release repo only) ---
  let prUrl = ""
  let pushed = false
  // Captured verbatim so the report can state the EXACT push/PR failure instead
  // of a generic "not pushed".
  let pushError = ""
  let prError = ""
  if (willPush && workDir && committed > 0 && !commitError && ownerRepo) {
    try {
      await git(["push", "origin", branch])
      pushed = true
      const r = await fetch(`https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `AI Fix — run ${runId} (${committed} fix${committed > 1 ? "es" : ""})`,
          head: branch,
          base: "main",
          body: `Automated corrections from AI Fix for run ${runId}, bundled into a single commit (per-finding mapping is recorded in QACC). Review & merge to deploy (FlyWP).`,
        }),
      })
      const j: any = await r.json().catch(() => ({}))
      if (r.ok && j.html_url) prUrl = j.html_url
      else {
        prError = String(j.message || `GitHub API HTTP ${r.status}`)
        logger.error({ runId, status: r.status, msg: j.message }, "AI Fix: PR creation failed.")
      }
    } catch (e: any) {
      pushError = String(e?.message || e)
      logger.error({ runId, error: e.message }, "AI Fix: push/PR failed.")
    }
  }

  // Applied = the fix was committed locally. We do NOT downgrade committed fixes
  // to "proposed" when a push doesn't happen — they were still applied. Every run
  // is meant to push; the only reasons it wouldn't are genuine repo-access gaps
  // or a real push/PR error, stated EXACTLY (never a vague "not pushed"). There
  // is no dry-run. Priority: repo-access reasons first (they also explain a
  // zero-commit run), then a real push/PR error.
  const notPushedReason = noRepo
    ? "no repository is linked to this client — the beta_site.env task carries no repo URL"
    : cloneFailed
      ? "the repository could not be cloned — the GitHub token is invalid/revoked or the repo is private/inaccessible"
      : !token
        ? "no GitHub token is configured for this client, so the branch cannot be authenticated to push"
        : committed === 0
          ? "no fix edits landed in the repository, so there was nothing to push"
          : commitError
            ? `the fixes were applied but could not be committed: ${commitError}`
            : pushError
              ? `the git push failed: ${pushError}`
              : prError
                ? `the branch pushed but the pull request could not be opened: ${prError}`
                : "the push did not complete"

  // --- Output 2: save the full analysis to QACC (Dry-run Data tab) ---
  try {
    await supabase.from("ai_fix_runs").insert({
      run_id: runId,
      project_id: run?.project_id || null,
      run_type: run?.run_type || null,
      committed,
      commit_url: prUrl || null,
      data: {
        repoUrl: repoUrl,
        pushed,
        prUrl: prUrl || null,
        repoCloned: !!workDir,
        repoIndexedFiles: repoIndex.length,
        contextFilesPerFinding: MAX_CONTEXT_FILES,
        findings: analysis,
      },
    })
  } catch (e: any) {
    logger.warn({ runId, error: e?.message }, "AI Fix: failed to save ai_fix_runs record.")
  }

  // --- Output 1: TED comment ---
  // Header: repository + push/merge status, clearly at the top.
  const proposedList = analysis.filter((a) => a.proposed)
  const fixesDone = analysis.filter((a) => (a.applied || a.proposed) && !a.lapse)
  let statusLine: string
  if (prUrl)
    statusLine = `Applied and pushed to branch <code>${branch}</code> · pull request <strong>created</strong> — not merged.`
  else if (pushed)
    statusLine = `Applied and pushed to branch <code>${branch}</code> · pull request could not be opened automatically: ${escHtml(prError || "unknown error")}.`
  else
    statusLine = `${
      committed > 0
        ? `${committed} fix${committed > 1 ? "es" : ""} applied`
        : `No fixes applied`
    } — not pushed because ${escHtml(notPushedReason)}.`

  // --- Output 1: the section-wise TED report (issue → fix → pass) ---
  // Join each landed fix back to its finding by id, so the shared renderer can
  // show the real before → after directly under the issue it corrects. Never
  // fabricated: only findings whose edits actually applied get a fix entry.
  const fixMap = new Map<string, FixReportInfo>()
  for (const a of analysis) {
    if (!a.findingId || a.lapse) continue
    // A real defect we triaged but neither applied nor proposed a fix for is
    // reported honestly as "manual" — never left blank and never shown as a
    // bare suggestion. The most common cause on this flow is that the flagged
    // text isn't in the repo (it's page/database content), so the code-editing
    // fix pass structurally can't touch it.
    const manual = !a.applied && !a.proposed
    // Two non-applied outcomes:
    //  • apply_failed — the edit WAS located in a file but the overwrite failed
    //    after 3 retries (a genuine, rare technical failure). Stated verbatim.
    //  • rest_api — the flagged text lives in the WordPress database (page/post
    //    content or wp_options like tagline/phone), not in any file the
    //    code-editing pass can touch, so it needs REST API write access.
    const applyFailed = manual && !!a.applyError
    // A real defect with no automated fix that could ever exist in code/config
    // (project_plan not-set). Rendered as a plain suggestion, never "✅ Fixed".
    const noAutoFix = manual && !!a.noAutoFix
    // Assisted-manual fix that produced the exact code + placement (contact_form).
    // Surface `fix` verbatim, never the generic REST-API boilerplate.
    const placeCode = manual && !!a.placeCode
    fixMap.set(a.findingId, {
      applied: a.applied,
      proposed: a.proposed,
      manual,
      manualKind: manual
        ? noAutoFix
          ? "no_auto_fix"
          : placeCode
            ? "place_code"
            : applyFailed
              ? "apply_failed"
              : "rest_api"
        : undefined,
      manualReason: noAutoFix
        ? a.suggestedFix || a.fix
        : placeCode
          ? a.fix
          : applyFailed
            ? `couldn't correct \`${a.applyError!.find}\` to \`${a.applyError!.replace}\` as overwriting failed`
            : undefined,
      fix: a.fix,
      edits: a.edits,
      filesChanged: a.filesChanged,
    })
  }

  // Repo + push/PR status, shown once atop the summary and (compactly) atop each
  // subtask comment.
  const repoLabel = noRepoAccess
    ? repoUrl
      ? `<a href="${repoUrl}">${repoUrl}</a> — no repo access`
      : "not resolved (no repo access)"
    : `<a href="${repoUrl}">${repoUrl}</a>`
  let summaryHeaderHtml = `<p>🤖 <strong>AI Fix</strong> · Repository: ${repoLabel}</p>`
  summaryHeaderHtml += `<p><strong>Fix status:</strong> ${statusLine}</p>`
  if (prUrl) summaryHeaderHtml += `<p>Pull request: <a href="${prUrl}">${prUrl}</a></p>`
  // Count-free version of the status, so each subtask banner can prepend its OWN
  // per-check fix count. `statusLine` (run-wide) still heads the parent summary.
  let pushClause: string
  if (prUrl)
    pushClause = `Applied · pushed to branch <code>${branch}</code>; pull request opened — not merged.`
  else if (pushed)
    pushClause = `Applied · pushed to branch <code>${branch}</code>; pull request could not be opened automatically: ${escHtml(prError || "unknown error")}.`
  else
    pushClause = `Applied · not pushed because ${escHtml(notPushedReason)}.`

  // Report against ALL of the run's findings (not just the open ones the fix
  // pass triaged) so passing and errored checks are represented too.
  const { data: reportFindings } = await supabase
    .from("findings")
    .select("*")
    .eq("run_id", runId)

  // --- Run summary for the MAIN thread (parent task), all run types ----------
  // How many issues were detected, how many fixes were done, and a short bullet
  // list of what was fixed. Posted on the parent (not per subtask) because it
  // rides in summaryHeaderHtml, which postSectionedReport puts on the parent.
  const realDefects = (reportFindings || []).filter(
    (f: any) => !isCleanPassFinding(f) && !isToolLapseFinding(f),
  )
  // Clip to a whole word (never mid-word) so a bullet never ends "...in the p".
  const clipWords = (s: string, n: number): string => {
    const t = String(s || "").replace(/\s+/g, " ").trim()
    if (t.length <= n) return t
    const cut = t.slice(0, n)
    const sp = cut.lastIndexOf(" ")
    return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[,;:.]+$/, "") + "…"
  }
  // Applied = the edit actually landed and was committed in the repo;
  // proposed = the correction was determined but NOT applied (no repo
  // access). They are counted and worded SEPARATELY — calling a proposed-only
  // correction "done" (when the fix status says "nothing was pushed") is what
  // made the old summary read as fake.
  const appliedList = fixesDone.filter((a) => a.applied)
  const proposedOnly = fixesDone.filter((a) => a.proposed && !a.applied)
  const fixBullets = fixesDone
    .slice(0, 12)
    .map((a) => {
      const tag = a.applied ? "Applied" : "Proposed (not applied)"
      const e = a.edits && a.edits[0]
      const before = e?.find ? String(e.find).replace(/\s+/g, " ").trim() : ""
      const after = e?.replace ? String(e.replace).replace(/\s+/g, " ").trim() : ""
      const issue = clipWords(a.title, 120)
      // For an applied edit with a small literal change, show the real before →
      // after; otherwise give the full (word-clipped) description of the fix.
      const how =
        before && after && before.length <= 60 && after.length <= 60
          ? `changed “${escHtml(before)}” → “${escHtml(after)}”`
          : escHtml(clipWords(a.fix || a.title, 240))
      return (
        `<li><strong>${escHtml(a.check_factor)}</strong> — ${tag}.` +
        (issue ? ` Issue: ${escHtml(issue)}.` : "") +
        (how ? ` Fix: ${how}` : "") +
        `</li>`
      )
    })
    .join("")
  const moreFixes =
    fixesDone.length > 12 ? `<li>…and ${fixesDone.length - 12} more</li>` : ""
  // Honest verb: only edits that actually landed are "applied"; everything else
  // is "proposed (not applied)". Never label a proposed-only run as "done".
  const doneClause =
    appliedList.length && proposedOnly.length
      ? `${appliedList.length} applied, ${proposedOnly.length} proposed (not applied)`
      : appliedList.length
        ? `${appliedList.length} applied`
        : proposedOnly.length
          ? `${proposedOnly.length} proposed (not applied)`
          : `no fixes applied`
  const summaryBlock =
    `<p>📋 <strong>Summary:</strong> ${realDefects.length} issue${realDefects.length !== 1 ? "s" : ""} detected · ${doneClause}.</p>` +
    (fixesDone.length ? `<ul>${fixBullets}${moreFixes}</ul>` : "")
  // Prepend the summary so it heads the parent comment.
  summaryHeaderHtml = summaryBlock + summaryHeaderHtml

  const reportTally = await postSectionedReport({
    runId,
    tedTaskId,
    findings: reportFindings || findings || [],
    runMeta: run,
    fixMap,
    summaryHeaderHtml,
    perTargetFix: { pushClause },
    eventKeyPrefix: "qacc-report",
  }).catch((e: any) => {
    logger.error({ runId, error: e?.message }, "Failed to post section-wise TED report.")
    return null
  })

  logger.info(
    {
      runId,
      tedTaskId,
      reportTally,
      committed,
      prUrl,
      pushed,
      applied: analysis.filter((a) => a.applied).length,
      proposed: proposedList.length,
      repoIndexedFiles: repoIndex.length,
    },
    "AI Fix module finished",
  )

  if (workDir) await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})

  // The fix pass is done — close out every TED
  // task and subtask for this run as Completed so nothing is left pending and the
  // release flow can advance. Best-effort; never throws.
  await markAllTedTasksCompleted(runId, tedTaskId)
}
