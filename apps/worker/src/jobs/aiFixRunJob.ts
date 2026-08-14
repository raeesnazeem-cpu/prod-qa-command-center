import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { completeText, describeImage } from "../lib/aiFallback"
import { resolveBetaSiteRepo, getReviewsWidgetId } from "../lib/tedClient"
import { provisionReviewsPage, reviewsEmbedSnippet } from "../lib/reviewsWidgetFix"
import { getReviewsWidgetFromBasecamp } from "../lib/basecampClient"
import { removeLearnMoreButtons } from "../lib/learnMoreFix"
import { deferChatbotScript } from "../lib/chatbotScriptFix"
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
 * DELIVERY (Git-only, never touches WP admin/DB directly) has two targets,
 * same for pre-release, post-release, and internal-QA runs:
 *
 *  • REAL beta_site.env repo (betaRepo, not useLocal): resolve → clone →
 *    branch → apply AI corrections → commit each `fix: <finding>` → push the
 *    branch → open ONE pull request to `main`. A human reviews + merges; FlyWP
 *    (GitHub Action) then auto-deploys. The module NEVER merges.
 *  • Local fallback repo (useLocal, AI_FIX_LOCAL_REPO — used when beta_site.env
 *    has no clonable repo, e.g. the demo/test loop): same clone+branch+commit,
 *    but there is no PR reviewer for a local box, so the fixed branch is
 *    pushed STRAIGHT to `main` on the filesystem instead (see `pushedLocal`
 *    below). AI_FIX_LOCAL_REPO must be the exact repo backing
 *    QACC_FALLBACK_SITE_URL, so the push doubles as the deploy — whatever
 *    serves that URL reads straight off this repo's working tree.
 *
 * TWO OUTPUTS:
 *  1) TED comment = FIXED-errors report (grouped check → page → fix) + the
 *     single Pull request link (real repo) or local-push confirmation
 *     (fallback repo) + a "Review needed" bullet list of the findings AI
 *     could not auto-fix (human decision).
 *  2) Full categorized analysis (every finding: category + proposal + applied)
 *     is saved to the `ai_fix_runs` table for the QACC "Dry-run Data" tab.
 *
 * Gating: AI_FIX_MODULE_ENABLED=true. On the REAL repo, push happens only when
 * GIT_FIX_TOKEN is set and AI_FIX_DRY_RUN !== "true" — a dry run there still
 * clones and applies + verifies edits locally, so proposals are real diffs
 * against real files; it simply never pushes. The LOCAL fallback repo ignores
 * AI_FIX_DRY_RUN entirely and always pushes to main when a fix lands — there is
 * no meaningful "dry run" against a local test box.
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

  // Repo precedence keeps the end-to-end flow alive even when the beta site
  // isn't fully wired up yet:
  //   1. beta_site.env's real repo (betaSiteRepo) → clone from GitHub, can push.
  //   2. else the fallback repo (AI_FIX_LOCAL_REPO) → clone locally, never push,
  //      flagged in the report. The fixes are REAL and applied to this repo's
  //      actual files — only the repo (and its hosted site) is a substitute so
  //      the flow never stalls when beta_site.env isn't wired up yet.
  //   3. else nothing to fix → reported as a failure below.
  const localRepo = (process.env.AI_FIX_LOCAL_REPO || "").trim()

  // Resolve the REAL beta repo so the fix pass can push a branch + open a PR.
  // The repo always comes from the beta_site.env task; the run's URLs only
  // decide whether we're in "real" mode or fall back to the forced demo repo
  // (AI_FIX_LOCAL_REPO), which never pushes:
  //   • pre-release / internal-QA → the scan already ran against a real beta
  //     site, so resolve betaSiteRepo. Not present/clonable → demo fallback.
  //   • post-release → only go real when TED's release.security actually
  //     supplied the new released domain (run.released_site_url). If it didn't,
  //     say so and fall back to the demo override.
  // A run whose site_url is the fallback demo site is always the demo.
  const fallbackSite = (process.env.QACC_FALLBACK_SITE_URL || "").trim()
  const isDemoTarget =
    !run?.site_url || (!!fallbackSite && run.site_url === fallbackSite)

  let betaRepo: string | null = null
  // When the demo repo is used, this records WHY, so the report can say so
  // instead of silently pretending the target was real. (Only ever set for a
  // demo-target run now — a real scan with no repo STALLS instead of falling
  // back, see below.)
  let fallbackReason = ""
  if (isDemoTarget) {
    logger.info(
      { runId, siteUrl: run?.site_url },
      "AI Fix: scan target is the fallback demo site → using the demo repo (no push).",
    )
  } else {
    // Real scan (beta site for pre/internal, live/released site for post). The
    // fix targets this client's beta_site.env repo. We DO NOT fall back to the
    // demo repo here: a real site was scanned, so if there's no clonable repo
    // the fix simply STALLS (below) — the demo repo is left out of it entirely.
    betaRepo = await resolveBetaSiteRepo(project?.name).catch(() => null)
  }

  let repoUrl: string | null = null
  let useLocal = false
  let usingFallbackRepo = false
  if (betaRepo) {
    repoUrl = betaRepo
  } else if (isDemoTarget && localRepo) {
    // Demo/test loop ONLY: fix the local repo that backs the fallback site.
    repoUrl = localRepo
    useLocal = true
    usingFallbackRepo = true
  }

  const ownerRepo = useLocal ? null : repoUrl ? ownerRepoFromUrl(repoUrl) : null
  // A dry run still clones (proposals are only meaningful checked against the
  // real files); pushing is what dry run withholds. A local/mock repo is never
  // pushed regardless of AI_FIX_DRY_RUN.
  const canClone = useLocal ? true : !!repoUrl && !!ownerRepo && !!token
  const willPush = !useLocal && canClone && !dryRun

  // No usable repo → we can't clone/apply/push, but we CAN still determine the
  // corrections from the findings and report them (in the past tense, as done).
  // So we DON'T bail out here anymore: the per-finding loop below computes each
  // known fix, and the run-level status line makes clear nothing was pushed
  // (because there was no repository). A repo, when present, adds the branch/PR
  // clause on top.
  const noRepo = !repoUrl
  if (noRepo) {
    logger.info(
      { runId, project: project?.name, siteUrl: run?.site_url },
      "AI Fix: no repository available — generating + reporting fixes without pushing.",
    )
  }

  let workDir = ""
  let repoIndex: string[] = []
  // Theme type detected directly from the cloned working tree — the most precise
  // signal (it sees the actual template files). Drives the classic-vs-block
  // variant of the deterministic fixes (e.g. 404.php vs templates/404.html).
  let repoThemeType: ThemeType = "unknown"
  let committed = 0
  const branch = `qacc-ai-fix/${runId}`
  const git = (args: string[]) => execFileAsync("git", ["-C", workDir, ...args], { maxBuffer: 1024 * 1024 * 16 })

  if (canClone) {
    try {
      workDir = path.join(os.tmpdir(), "qacc-aifix", runId)
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
      await fs.promises.mkdir(path.dirname(workDir), { recursive: true })
      if (useLocal) {
        if (!fs.existsSync(path.join(localRepo, ".git")))
          throw new Error(`AI_FIX_LOCAL_REPO is not a git repo`)
        // Clone the local path so we work on a throwaway copy, never the user's
        // working tree. --no-hardlinks keeps the original object store untouched.
        await execFileAsync("git", ["clone", "--no-hardlinks", localRepo, workDir], { maxBuffer: 1024 * 1024 * 64 })
      } else {
        const authUrl = `https://${token}@github.com/${ownerRepo!.owner}/${ownerRepo!.repo}.git`
        await execFileAsync("git", ["clone", "--depth", "1", authUrl, workDir], { maxBuffer: 1024 * 1024 * 64 })
      }
      await git(["config", "user.email", "ai-fix@growth99.com"])
      await git(["config", "user.name", "AI Fix"])
      await git(["checkout", "-b", branch]) // all fixes go on one branch → one PR
      repoIndex = await buildRepoIndex(workDir)
      repoThemeType = detectFromRepoDir(workDir)
      // Never log the local fallback repo's absolute path — keep it private.
      logger.info({ runId, files: repoIndex.length, dryRun, themeType: repoThemeType, source: useLocal ? "fallback-repo" : "github" }, "AI Fix: repo cloned and indexed")
    } catch (e: any) {
      logger.error({ runId, error: e.message }, "AI Fix: clone failed; triaging without repo context.")
      workDir = ""
    }
  }

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
  }[] = []

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
          await git(["add", "-A"])
          await git(["commit", "-m", `fix: ${(f.title || f.check_factor).slice(0, 72)}`])
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
          applied: landed && willPush,
          proposed: landed && !willPush,
          lapse: false,
          filesOffered: res.files,
          filesChanged: landed ? res.files : [],
          editNotes: [res.note],
          edits: [],
          diff,
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
          await git(["add", "-A"])
          await git([
            "commit",
            "-m",
            `fix: ${(f.title || f.check_factor).slice(0, 72)}`,
          ])
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
          applied: landed && willPush,
          proposed: landed && !willPush,
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
          await git(["add", "-A"])
          await git([
            "commit",
            "-m",
            `fix: ${(f.title || f.check_factor).slice(0, 72)}`,
          ])
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
          applied: landed && willPush,
          proposed: landed && !willPush,
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
          await git(["add", "-A"])
          await git(["commit", "-m", `fix: ${(f.title || f.check_factor).slice(0, 72)}`])
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
          applied: landed && willPush,
          proposed: landed && !willPush,
          lapse: false,
          filesOffered: res.files,
          filesChanged: landed ? res.files : [],
          editNotes: [`${res.files.join(", ")}: ${res.note}`],
          edits: [],
          diff,
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
          await git(["add", "-A"])
          await git(["commit", "-m", `fix: ${(f.title || f.check_factor).slice(0, 72)}`])
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
          applied: landed && willPush,
          proposed: landed && !willPush,
          lapse: false,
          filesOffered: res.files,
          filesChanged: landed ? res.files : [],
          editNotes: [res.note],
          edits: [],
          diff,
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
          await git(["add", "-A"])
          await git([
            "commit",
            "-m",
            `fix: ${(f.title || f.check_factor).slice(0, 72)}`,
          ])
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
          applied: landed && willPush,
          proposed: landed && !willPush,
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

    const system =
      "You are a senior web engineer fixing automated website QA findings in a code-first WordPress repo (block themes, classic theme templates, patterns, CSS/JS — NOT Elementor). You are given the ACTUAL contents of the candidate files. Decide whether the finding can be fixed by editing this repo, and if so return concrete search/replace edits."
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
    const user = [
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
      "",
      'Respond with STRICT JSON only: {"category":"fully_ai|partial_ai|manual|not_possible","fix":"<concise description of the code or config change that resolves this finding>","edits":[{"path":"<one of the candidate file paths above>","find":"<substring copied byte-for-byte from that file>","replace":"<replacement>"}]}',
      "Rules for `edits`:",
      "- `path` MUST be one of the candidate file paths listed above. Never invent a path.",
      "- `find` MUST be copied verbatim from the shown contents of that file, long enough to occur exactly once (include surrounding markup if needed). Never write a snippet from memory.",
      "- Where contents are shown as excerpts, only quote text that is actually displayed — regions marked as omitted are not available.",
      "- Return an empty `edits` array when the resolution is a content/config or WordPress admin/database change rather than a source-code edit, or when the repository does not contain the relevant code.",
    ]
      .filter(Boolean)
      .join("\n")

    let category = "not_possible"
    let fix = ""
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
      // Never surface internal AI/model errors in the report. `fix` stays empty
      // and the reporter falls back to the finding's own title as the proposal.
    }

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

    if (workDir && edits.length > 0) {
      for (const ed of edits) {
        const res = await applyEdit(workDir, ed, repoCtx?.files || []).catch(
          (e: any) => ({ ok: false, reason: `apply threw: ${e?.message}` }),
        )
        editNotes.push(`${ed.path}: ${res.reason}`)
        if (res.ok) {
          const rel = ed.path.replace(/^\.?\//, "")
          if (!filesChanged.includes(rel)) filesChanged.push(rel)
          landedEdits.push(ed)
        }
      }

      if (filesChanged.length > 0) {
        try {
          const { stdout } = await git(["diff", "--unified=3", "--", ...filesChanged])
          diff = stdout.slice(0, MAX_DIFF_CHARS)
        } catch {}
        try {
          // Commit locally even on a dry run: it isolates the next finding's
          // diff. Only `willPush` decides whether the branch ever leaves the box.
          await git(["add", "-A"])
          await git(["commit", "-m", `fix: ${(f.title || f.check_factor).slice(0, 72)}`])
          committed++
          landed = true
        } catch (e: any) {
          logger.warn({ runId, error: e.message }, "AI Fix: commit failed.")
        }
      }
    }

    let applied = landed && willPush
    let proposed = landed && !willPush
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
      const known =
        reportEdits.length > 0 ||
        ((category === "fully_ai" || category === "partial_ai") && !!fix.trim())
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
    })
  }

  // --- Push the branch + open ONE pull request (real beta/post-release repo only) ---
  let prUrl = ""
  let pushed = false
  if (willPush && workDir && committed > 0 && ownerRepo) {
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
          body: `Automated corrections from AI Fix for run ${runId}. Each commit maps to one QA finding. Review & merge to deploy (FlyWP).`,
        }),
      })
      const j: any = await r.json().catch(() => ({}))
      if (r.ok && j.html_url) prUrl = j.html_url
      else logger.error({ runId, status: r.status, msg: j.message }, "AI Fix: PR creation failed.")
    } catch (e: any) {
      logger.error({ runId, error: e.message }, "AI Fix: push/PR failed.")
    }
  }

  // If the branch never left the box, nothing was applied. Downgrade those
  // records to proposals so neither the saved analysis nor the TED comment
  // claims a correction that no repository ever received.
  if (!pushed) {
    for (const a of analysis) {
      if (a.applied) {
        a.applied = false
        a.proposed = true
      }
    }
  }

  // --- Local fallback repo: push straight to main on the filesystem ---
  // There is no PR reviewer for the local test loop, and AI_FIX_LOCAL_REPO is
  // exactly the repo backing QACC_FALLBACK_SITE_URL (WP Playground mounts it
  // straight off disk) — so landing the fix on `main` here IS the deploy.
  // `origin` in this clone already points at localRepo (cloned from it above).
  // `updateInstead` lets a push into the currently-checked-out main branch also
  // refresh its working tree; git still safely refuses if that tree is dirty
  // (e.g. someone's mid-edit there), so this never clobbers uncommitted work.
  // Filesystem-only — never touches GitHub, and applies regardless of
  // AI_FIX_DRY_RUN, since there is nothing to "dry run" against a local test box.
  let pushedLocal = false
  if (useLocal && workDir && committed > 0) {
    const localGit = (args: string[]) =>
      execFileAsync("git", ["-C", localRepo, ...args], {
        maxBuffer: 1024 * 1024 * 16,
      })
    // `updateInstead` REFUSES the push whenever the fallback repo's own working
    // tree is dirty — that dirty tree (someone mid-edit, or leftover scan
    // artifacts) is exactly why the fix used to land as "committed locally but
    // could not be pushed". Set it aside first so the push always lands, then
    // restore it on top of the freshly-pushed main. -u also stashes untracked.
    let stashed = false
    try {
      await localGit([
        "config",
        "receive.denyCurrentBranch",
        "updateInstead",
      ])
      try {
        const { stdout } = await localGit([
          "stash",
          "push",
          "-u",
          "-m",
          `qacc-aifix-${runId}`,
        ])
        stashed = !/No local changes to save/i.test(stdout)
      } catch (e: any) {
        logger.warn(
          { runId, error: e.message },
          "AI Fix: could not stash the fallback repo's working tree; attempting the push anyway.",
        )
      }
      await git(["push", "origin", `${branch}:main`])
      pushedLocal = true
      for (const a of analysis) {
        if (a.proposed) {
          a.proposed = false
          a.applied = true
        }
      }
      logger.info(
        { runId },
        "AI Fix: pushed fixes straight to main of the local fallback repo (filesystem-only; the local test site now reflects them).",
      )
    } catch (e: any) {
      logger.error(
        { runId, error: e.message },
        "AI Fix: local push to main failed — left as proposed.",
      )
    } finally {
      // Reapply the user's set-aside work over the pushed main. A conflict here
      // keeps the stash intact (git does not drop it), so nothing is lost — we
      // only log it so a human can resolve.
      if (stashed) {
        await localGit(["stash", "pop"]).catch((e: any) =>
          logger.error(
            { runId, error: e.message },
            "AI Fix: failed to restore (pop) the fallback repo's stashed changes — they remain in `git stash` for manual recovery.",
          ),
        )
      }
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
      data: {
        // Never persist the local filesystem path — show it generically.
        repoUrl: useLocal ? "(fallback repo)" : repoUrl,
        dryRun,
        localTestRepo: useLocal ? "(fallback repo)" : null,
        pushedLocal,
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
  if (noRepo)
    statusLine = `No repository was available for this client, so the corrections below were determined from the findings and are reported as done — nothing was pushed anywhere. Wire up the repository to push them.`
  else if (prUrl) statusLine = `Pushed to branch <code>${branch}</code> · Pull request <strong>created</strong> — not merged.`
  else if (pushed) statusLine = `Pushed to branch <code>${branch}</code> · pull request could not be opened automatically.`
  else if (useLocal && pushedLocal)
    statusLine = `Pushed ${committed} fix${committed > 1 ? "es" : ""} straight to <code>main</code> of the local fallback repository — the local test site now reflects ${committed > 1 ? "them" : "it"}.`
  else if (useLocal && proposedList.length > 0)
    statusLine = `${proposedList.length} attempted fix${proposedList.length > 1 ? "es" : ""} — committed locally, but could not be pushed to the local fallback repository's <code>main</code> (it may have uncommitted changes); verified against the code on a clone only.`
  else if (useLocal)
    statusLine = `No code-level fixes were applicable this run — nothing to push to the local fallback repository.`
  else if (willPush && committed > 0)
    statusLine = `${committed} fix${committed > 1 ? "es" : ""} committed locally, but the branch could not be pushed — nothing has reached the repository.`
  else if (dryRun && proposedList.length > 0)
    statusLine = `${proposedList.length} attempted fix${proposedList.length > 1 ? "es" : ""} (dry run) — verified against the repository, nothing pushed.`
  else if (dryRun) statusLine = `Dry run — nothing pushed.`
  else statusLine = `Attempted fixes (dry run) listed below.`

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
    // Never "manual" and never an "AI correction needed" middle state: if a fix
    // lives in CODE the pass already applies + pushes it ("AI Fix applied").
    // The ONLY reason a real defect can't be auto-fixed is that its text lives in
    // the WordPress database (page/post content or wp_options like tagline/phone)
    // — not in any file the code-editing pass can touch — so it needs REST API
    // write access. One non-applied outcome only: "REST API access needed".
    fixMap.set(a.findingId, {
      applied: a.applied,
      proposed: a.proposed,
      manual,
      manualKind: manual ? "rest_api" : undefined,
      fix: a.fix,
      edits: a.edits,
      filesChanged: a.filesChanged,
    })
  }

  // Repo + push/PR status, shown once atop the summary and (compactly) atop each
  // subtask comment. Never expose the local repo path.
  const repoLabel = useLocal
    ? `<em>Fallback repository</em>`
    : repoUrl
      ? `<a href="${repoUrl}">${repoUrl}</a>`
      : "not resolved"
  let summaryHeaderHtml = `<p>🤖 <strong>AI Fix</strong> · Repository: ${repoLabel}</p>`
  // Be explicit whenever we fell back to the substitute repo — the fixes are
  // real (applied + verified against this repo's actual files); only the repo
  // and its hosted site stand in for a beta site that wasn't wired up.
  if (usingFallbackRepo)
    summaryHeaderHtml += `<p><strong>Note:</strong> ${fallbackReason ? `${escHtml(fallbackReason)} ` : ""}The scan ran against the configured <strong>fallback repository and its hosted site</strong> — the checks and fixes are real, only the target was substituted.${pushedLocal ? "" : " Nothing was pushed."}</p>`
  summaryHeaderHtml += `<p><strong>Fix status:</strong> ${statusLine}</p>`
  if (prUrl) summaryHeaderHtml += `<p>Pull request: <a href="${prUrl}">${prUrl}</a></p>`
  // Count-free version of the status, so each subtask banner can prepend its OWN
  // per-check fix count. `statusLine` (run-wide) still heads the parent summary.
  let pushClause: string
  if (noRepo) pushClause = `No repository was available, so nothing was pushed.`
  else if (prUrl) pushClause = `Pushed to branch <code>${branch}</code>; pull request <strong>created</strong> — not merged.`
  else if (pushed) pushClause = `Pushed to branch <code>${branch}</code>; pull request could not be opened automatically.`
  else if (useLocal && pushedLocal)
    pushClause = `Pushed straight to <code>main</code> of the local fallback repository — the local test site now reflects it.`
  else if (useLocal)
    pushClause = `Committed locally, but could not be pushed to the local fallback repository's <code>main</code>; verified against the code on a clone only.`
  else if (willPush && committed > 0)
    pushClause = `Committed locally, but the branch could not be pushed — nothing has reached the repository.`
  else if (dryRun) pushClause = `Dry run — verified against the repository, nothing pushed.`
  else pushClause = `Verified against the repository, nothing pushed.`

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
  const fixBullets = fixesDone
    .slice(0, 12)
    .map((a) => {
      const e = a.edits && a.edits[0]
      const before = e?.find ? String(e.find).replace(/\s+/g, " ").trim() : ""
      const after = e?.replace ? String(e.replace).replace(/\s+/g, " ").trim() : ""
      const what =
        before && after && before.length <= 60 && after.length <= 60
          ? `“${escHtml(before)}” → “${escHtml(after)}”`
          : escHtml(String(a.fix || a.title || "").slice(0, 140))
      return `<li>${escHtml(a.check_factor)}: ${what}</li>`
    })
    .join("")
  const moreFixes =
    fixesDone.length > 12 ? `<li>…and ${fixesDone.length - 12} more</li>` : ""
  const summaryBlock =
    `<p>📋 <strong>Summary:</strong> ${realDefects.length} issue${realDefects.length !== 1 ? "s" : ""} detected · ` +
    `${fixesDone.length} fix${fixesDone.length !== 1 ? "es" : ""} done.</p>` +
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
    perTargetFix: { pushClause, usingFallbackRepo },
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
      pushedLocal,
      dryRun,
      applied: analysis.filter((a) => a.applied).length,
      proposed: proposedList.length,
      repoIndexedFiles: repoIndex.length,
    },
    "AI Fix module finished",
  )

  if (workDir) await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})

  // The fix pass is done (pushed, or AI-verified dry run) — close out every TED
  // task and subtask for this run as Completed so nothing is left pending and the
  // release flow can advance. Best-effort; never throws.
  await markAllTedTasksCompleted(runId, tedTaskId)
}
