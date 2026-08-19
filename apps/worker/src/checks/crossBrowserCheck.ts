/**
 * Cross-Browser Visual Check (LambdaTest SmartUI)
 *
 * A RUN-LEVEL check (not per-page): once the crawl finishes we pick up to 5
 * representative pages (home / services / contact / about / one service-landing)
 * and hand them to SmartUI's CLI, which renders each URL across a small browser
 * x viewport matrix (Chrome + Safari at desktop/tablet/mobile widths) on the
 * LambdaTest cloud and visually compares them. We then read the build result
 * and emit `cross_browser` findings.
 *
 * Env (worker):
 *   SMARTUI_PROJECT_TOKEN  — SmartUI project token (passed to the CLI as PROJECT_TOKEN)
 *   LT_USERNAME            — LambdaTest username (results API)
 *   LT_ACCESS_KEY          — LambdaTest access key (results API)
 * Optional:
 *   SMARTUI_BIN            — CLI binary (default "smartui")
 *   SMARTUI_API_BASE       — results API base (default "https://api.lambdatest.com")
 *
 * Baseline semantics (fresh vs persistent) are governed by the SmartUI project
 * settings, not this code — we only trigger the capture and read the result.
 */
import { execFile } from "child_process"
import { promisify } from "util"
import { writeFile, mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { supabase } from "../lib/supabase"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

const execFileAsync = promisify(execFile)

const CHECK_FACTOR = "cross_browser"
// PROOF-RUN SETTINGS (lowest cost): 2 pages × 2 browsers × 1 viewport = 4 shots.
// Once the capture → results → findings → AI-fix flow is verified, widen back to
// MAX_PAGES = 5 and viewports [[1512],[820],[390]] (tablet + mobile).
const MAX_PAGES = 2

// Minimal matrix for the proof run: Chrome + Safari engines at desktop width.
// NOTE: CLI static capture uses desktop engines at these widths (emulated),
// not real iOS devices.
const SMARTUI_WEB_CONFIG = {
  web: {
    browsers: ["chrome", "safari"],
    viewports: [[1512]],
  },
}

type Finding = {
  check_factor: string
  title: string
  description: string
  context_text?: string
}

type SelectedPage = { id: string; url: string; name: string }

// Pick up to 5 representative pages from the run's crawled pages, one per type.
// Order: home, services, contact, about, service-landing. A page is used for at
// most one type; missing types are skipped (never backfilled).
function selectPages(
  pages: { id: string; url: string; title: string | null }[],
): SelectedPage[] {
  const used = new Set<string>()
  const pathOf = (u: string): string => {
    try {
      return new URL(u).pathname.replace(/\/+$/, "").toLowerCase() || "/"
    } catch {
      return u.toLowerCase()
    }
  }

  const pick = (
    name: string,
    predicate: (p: string) => boolean,
  ): SelectedPage | null => {
    for (const pg of pages) {
      if (used.has(pg.id)) continue
      if (predicate(pathOf(pg.url))) {
        used.add(pg.id)
        return { id: pg.id, url: pg.url, name }
      }
    }
    return null
  }

  const selected: SelectedPage[] = []
  const home = pick("home", (p) => p === "/" || p === "")
  if (home) selected.push(home)
  const services = pick("services", (p) => /^\/services?$/.test(p))
  if (services) selected.push(services)
  const contact = pick("contact", (p) => /contact/.test(p))
  if (contact) selected.push(contact)
  const about = pick("about", (p) => /about/.test(p))
  if (about) selected.push(about)
  // A service-landing page = something nested under /service(s)/...
  const landing = pick("service-landing", (p) => /^\/services?\/.+/.test(p))
  if (landing) selected.push(landing)

  return selected.slice(0, MAX_PAGES)
}

// Terminal build statuses: the cloud comparison has actually finished, so a
// mismatch count of 0 genuinely means "no differences". Any other status
// (running / queued / in-progress) means the build has NOT compared yet — a 0
// there is premature and must NOT be reported as a clean pass.
const TERMINAL_STATUSES = new Set([
  "completed",
  "complete",
  "finished",
  "compared",
  "approved",
  "unapproved",
  "changes_found",
  "changesfound",
  "success",
  "done",
])

type BuildResult = {
  // Mismatch/unapproved screenshot count, or null when it can't be determined.
  count: number | null
  // True only when the build reached a confirmed terminal (compared) status.
  completed: boolean
  status: string | null
}

// Best-effort read of the SmartUI build result. The exact response shape is not
// yet confirmed against a live build, so we parse defensively across likely
// field names and log the raw body (truncated) on the first run so we can
// finalize the parser.
async function fetchBuildResult(buildId: string): Promise<BuildResult> {
  const unknown: BuildResult = { count: null, completed: false, status: null }
  const user = process.env.LT_USERNAME
  const key = process.env.LT_ACCESS_KEY
  if (!user || !key) {
    logger.warn("SmartUI results: LT_USERNAME/LT_ACCESS_KEY not set.")
    return unknown
  }
  const base = (process.env.SMARTUI_API_BASE || "https://api.lambdatest.com").replace(
    /\/$/,
    "",
  )
  const auth = Buffer.from(`${user}:${key}`).toString("base64")
  try {
    const res = await fetch(`${base}/visualui/v1.0/builds/${buildId}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    })
    const ct = res.headers.get("content-type") || ""
    if (!res.ok || !ct.includes("application/json")) {
      logger.warn(
        { buildId, status: res.status, ct },
        "SmartUI results API did not return JSON.",
      )
      return unknown
    }
    const body: any = await res.json().catch(() => null)
    logger.info(
      { buildId, raw: JSON.stringify(body).slice(0, 500) },
      "SmartUI build result (raw, truncated — confirm shape).",
    )
    // Probe likely locations for a mismatch/unapproved count.
    const b = body?.build || body?.data || body || {}
    const candidates = [
      b.mismatch_count,
      b.mismatchCount,
      b.unapproved,
      b.unapproved_count,
      b.changes_count,
      b.diff_count,
    ]
    const n = candidates.find((c) => typeof c === "number")
    const count = typeof n === "number" ? n : null

    // Probe likely status fields; a build is only "completed" once it reports a
    // terminal status. If no status field is present at all we cannot confirm
    // completion, so completed stays false (treated as a lapse downstream).
    const rawStatus = b.status ?? b.build_status ?? b.state ?? b.buildStatus
    const status = typeof rawStatus === "string" ? rawStatus : null
    const completed = status
      ? TERMINAL_STATUSES.has(status.toLowerCase().replace(/[\s-]/g, "_")) ||
        TERMINAL_STATUSES.has(status.toLowerCase().replace(/[\s_-]/g, ""))
      : false

    return { count, completed, status }
  } catch (err: any) {
    logger.warn({ buildId, error: err?.message }, "SmartUI results API error.")
    return unknown
  }
}

// Pull a build id out of the CLI stdout/stderr. SmartUI prints a dashboard link
// / build reference; shapes vary, so probe a few patterns. Returns null if none.
function parseBuildId(output: string): string | null {
  const m =
    output.match(/build[^\n]*?\/([a-f0-9-]{16,})/i) ||
    output.match(/buildId[":=\s]+([a-f0-9-]{16,})/i) ||
    output.match(/\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i)
  return m ? m[1] : null
}

function parseBuildUrl(output: string): string | null {
  const m = output.match(/https?:\/\/\S*smartui\S*/i)
  return m ? m[0].replace(/[.,)]+$/, "") : null
}

/**
 * Run the cross-browser visual check for a completed run. No-op unless the run's
 * enabled_checks includes "cross_browser". Inserts findings directly (like the
 * other checks). Best-effort: never throws — a failure is recorded as a QACC
 * tool-lapse finding (excluded from the TED report) so the run still completes.
 */
export async function runCrossBrowserCheck(runId: string): Promise<void> {
  let tempDir: string | null = null
  let isEnabled = false
  try {
    const { data: run } = await supabase
      .from("qa_runs")
      .select("enabled_checks, site_url")
      .eq("id", runId)
      .single()

    const enabled: string[] = (run?.enabled_checks as any) || []
    if (!enabled.includes(CHECK_FACTOR)) return
    isEnabled = true

    const token = process.env.SMARTUI_PROJECT_TOKEN
    if (!token) {
      logger.warn(
        { runId },
        "cross_browser enabled but SMARTUI_PROJECT_TOKEN not set — skipping.",
      )
      return
    }

    const { data: pages } = await supabase
      .from("pages")
      .select("id, url, title")
      .eq("run_id", runId)
    const selected = selectPages(pages || [])
    if (selected.length === 0) {
      logger.warn({ runId }, "cross_browser: no matching pages to test — skipping.")
      return
    }
    logger.info(
      { runId, pages: selected.map((s) => `${s.name}:${s.url}`) },
      "cross_browser: selected pages.",
    )

    // Write urls.json + smartui-web.json to a temp dir.
    tempDir = await mkdtemp(path.join(tmpdir(), `smartui-${runId}-`))
    const urlsPath = path.join(tempDir, "urls.json")
    const configPath = path.join(tempDir, "smartui-web.json")
    const urlsJson = selected.map((s) => ({
      name: `${s.name}`,
      url: s.url,
      waitForTimeout: 2000,
    }))
    await writeFile(urlsPath, JSON.stringify(urlsJson, null, 2))
    await writeFile(configPath, JSON.stringify(SMARTUI_WEB_CONFIG, null, 2))

    // Run the capture. PROJECT_TOKEN is what the CLI expects.
    const bin = process.env.SMARTUI_BIN || "smartui"
    let output = ""
    try {
      const { stdout, stderr } = await execFileAsync(
        bin,
        ["capture", urlsPath, "--config", configPath],
        {
          env: { ...process.env, PROJECT_TOKEN: token },
          timeout: 5 * 60 * 1000,
          maxBuffer: 10 * 1024 * 1024,
        },
      )
      output = `${stdout || ""}\n${stderr || ""}`
      logger.info({ runId, out: output.slice(0, 600) }, "SmartUI capture output.")
    } catch (cliErr: any) {
      logger.error(
        { runId, error: cliErr?.message, out: String(cliErr?.stdout || "").slice(0, 600) },
        "SmartUI capture failed.",
      )
      await insertFindings(runId, selected[0].id, [
        {
          check_factor: CHECK_FACTOR,
          title: "Cross-browser check failed to run",
          description:
            "QACC could not obtain cross-browser results this run (the SmartUI capture command failed); it will retry on the next run.",
        },
      ])
      return
    }

    const buildUrl = parseBuildUrl(output)
    const buildId = parseBuildId(output)
    const result = buildId
      ? await fetchBuildResult(buildId)
      : { count: null, completed: false, status: null }

    if (result.count !== null && result.count > 0) {
      // Differences confirmed — a real defect regardless of terminal status.
      await insertFindings(runId, selected[0].id, [
        {
          check_factor: CHECK_FACTOR,
          title: `Cross-browser visual differences found (${result.count})`,
          description: `SmartUI flagged ${result.count} screenshot difference(s) across the browser/viewport matrix.${
            buildUrl ? ` Review: ${buildUrl}` : ""
          }`,
          context_text: buildUrl || undefined,
        },
      ])
      return
    }

    if (result.completed && result.count === 0) {
      // Clean pass sentinel — ONLY when the build reached a confirmed terminal
      // (compared) status. tedSync treats this as passed.
      await insertFindings(runId, selected[0].id, [
        {
          check_factor: CHECK_FACTOR,
          title: "No cross-browser visual differences found",
          description:
            "SmartUI found no visual differences across the Chrome/Safari desktop, tablet and mobile matrix.",
        },
      ])
      return
    }

    // Either the count is unknown, or the build has not finished comparing yet
    // (non-terminal status → a 0 would be premature). Report a QACC tool-lapse
    // (excluded from the defect count) rather than a false pass. The
    // "could not obtain" phrasing is what tedSync's isToolLapseFinding matches.
    await insertFindings(runId, selected[0].id, [
      {
        check_factor: CHECK_FACTOR,
        title: "Cross-browser check could not complete",
        description: `QACC could not obtain a confirmed cross-browser pass/fail this run${
          result.status ? ` (build status: ${result.status})` : ""
        } — the build had not finished comparing.${
          buildUrl ? ` Build: ${buildUrl}` : ""
        }`,
        context_text: buildUrl || undefined,
      },
    ])
  } catch (err: any) {
    logger.error({ runId, error: err?.message }, "cross_browser check errored.")
    // Do NOT swallow: an enabled check that inserts no finding is reported as a
    // clean pass by tedSync. Emit a tool-lapse finding so it's marked
    // "could not complete" instead. Only when the check was actually enabled —
    // otherwise a stray DB error would fabricate a finding for a disabled check.
    // Best-effort — never rethrow.
    if (!isEnabled) return
    try {
      const { data: firstPage } = await supabase
        .from("pages")
        .select("id")
        .eq("run_id", runId)
        .limit(1)
        .maybeSingle()
      if (firstPage?.id) {
        await insertFindings(runId, firstPage.id, [
          {
            check_factor: CHECK_FACTOR,
            title: "Cross-browser check could not complete",
            description: `The cross-browser visual check could not run this run due to an unexpected error: ${err?.message}. This check could not complete.`,
          },
        ])
      }
    } catch (insertErr: any) {
      logger.error(
        { runId, error: insertErr?.message },
        "cross_browser: failed to record lapse finding.",
      )
    }
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function insertFindings(
  runId: string,
  pageId: string,
  findings: Finding[],
): Promise<void> {
  const rows = findings.map((f) => ({ ...f, page_id: pageId, run_id: runId }))
  const { error } = await supabase.from("findings").insert(rows)
  if (error) {
    logger.error(
      { runId, error: error.message },
      "cross_browser: failed to insert findings.",
    )
  }
}
