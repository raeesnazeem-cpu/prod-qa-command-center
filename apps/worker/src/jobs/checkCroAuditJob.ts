import { Job } from "bullmq"
import pino from "pino"
import { supabase } from "../lib/supabase"
import { runWebAuditCro, WebAuditCroResult, webAuditBaseUrl } from "../lib/webAuditClient"
import { CRO_PASS_SCORE, croBand, formatCroContext, highImpactFailed } from "../lib/croReport"

// CRO (conversion) check — FULL SCAN ONLY, scan only (no fix).
//
// Runs as its own job next to the page crawl (like paid_media), and the report
// gate waits for it. It does not hold the CRO logic itself: it calls G99
// WebAudit for the homepage plus up to 3 conversion pages, one page at a time
// (WebAudit is a single container and its Gemini quota is small), and turns
// WebAudit's CRO section into QACC findings.

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

export const CRO_CHECK = "cro_audit"
const MAX_EXTRA_PAGES = 3

const pathOf = (u: string): string => {
  try {
    return new URL(u).pathname.replace(/\/+$/, "").toLowerCase() || "/"
  } catch {
    return String(u || "").toLowerCase()
  }
}
const sameSite = (u: string) =>
  String(u || "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .toLowerCase()

// Conversion pages, in priority order. One page per group at most.
const KEY_PAGE_GROUPS: RegExp[] = [
  /contact/,
  /book|appointment|schedule|consult|request/,
  /services?(\/|$)|treatments?(\/|$)/,
  /pricing|prices|specials|offers/,
]
const SKIP_PATH = /\/(blog|news|tag|category|author|page)\b|\/\d{4}\/\d{2}\/|thank-?you|privacy|terms|sitemap/

/**
 * Homepage first, then up to 3 conversion pages (contact, booking/consult,
 * services, pricing). Shortest URL wins inside a group. Exported for tests.
 */
export function pickCroPages<T extends { url: string }>(pages: T[], siteUrl: string): T[] {
  const picked: T[] = []
  const home =
    pages.find((p) => sameSite(p.url) === sameSite(siteUrl)) ||
    pages.find((p) => pathOf(p.url) === "/")
  if (home) picked.push(home)
  const rest = pages
    .filter((p) => p !== home && !SKIP_PATH.test(pathOf(p.url)))
    .sort((a, b) => pathOf(a.url).length - pathOf(b.url).length)
  for (const group of KEY_PAGE_GROUPS) {
    if (picked.length >= 1 + MAX_EXTRA_PAGES) break
    const hit = rest.find((p) => !picked.includes(p) && group.test(pathOf(p.url)))
    if (hit) picked.push(hit)
  }
  if (picked.length === 0 && pages.length > 0) picked.push(pages[0])
  return picked
}

/**
 * One finding per page, pass or fail, always carrying WebAudit's full CRO
 * result (score, issues found, recommended fixes, high-impact failed checks)
 * in context_text — see lib/croReport. Pass/fail follows WebAudit's own score
 * bands: Poor (<70) fails; Average and Excellent pass. Exported for tests.
 */
export function croFindingFor(url: string, cro: WebAuditCroResult): any {
  const band = croBand(cro.score)
  const passed = cro.score >= CRO_PASS_SCORE
  const firstFix = cro.recommendations[0] || highImpactFailed(cro)[0]?.remediation || ""
  return {
    check_factor: CRO_CHECK,
    // Pass titles state absence ("no major … issues found") so the shared
    // verdict rules read them as a clean pass; fail titles do not.
    title: passed
      ? `CRO score ${cro.score}/100 (${band}) — no major conversion issues found`
      : `CRO score ${cro.score}/100 (${band}) — conversion problems on this page`,
    description: passed
      ? `WebAudit rates this page ${band}. ${firstFix ? `Top suggestion: ${firstFix}` : ""}`.trim()
      : firstFix || "Review the page's calls to action, value proposition and trust signals.",
    context_text: formatCroContext(url, cro),
    status: "open",
    ai_generated: false,
  }
}

const lapseFinding = (msg: string) => ({
  check_factor: CRO_CHECK,
  title: "Check Failed",
  description: `The ${CRO_CHECK} check encountered an unexpected error: ${msg}. Process aborted gracefully.`,
  context_text: "System Error",
  status: "open",
  ai_generated: false,
})

async function auditWithRetry(url: string): Promise<WebAuditCroResult> {
  try {
    return await runWebAuditCro(url)
  } catch (first: any) {
    logger.warn({ url, error: first?.message }, "WebAudit CRO failed; retrying once")
    await new Promise((r) => setTimeout(r, 15000))
    return runWebAuditCro(url)
  }
}

export async function processCheckCroAuditJob(job: Job) {
  const { runId } = job.data
  if (!runId) throw new Error("Missing runId for cro_audit job")

  const { data: run } = await supabase
    .from("qa_runs")
    .select("run_type, site_url")
    .eq("id", runId)
    .single()
  if (run?.run_type !== "full_scan") {
    logger.info({ runId, runType: run?.run_type }, "cro_audit is full-scan only; skipping")
    return
  }

  const { data: pages } = await supabase
    .from("pages")
    .select("id, url")
    .eq("run_id", runId)
  if (!pages || pages.length === 0) {
    logger.warn({ runId }, "cro_audit: no pages for run; skipping")
    return
  }

  const targets = pickCroPages(pages, run.site_url || pages[0].url)
  logger.info(
    { runId, webAudit: webAuditBaseUrl(), pages: targets.map((p) => p.url) },
    "Running CRO check via WebAudit",
  )

  const broadcast = (message: string) =>
    supabase
      .channel(`run:${runId}`)
      .send({ type: "broadcast", event: "progress", payload: { status: "running", message } })
      .catch(() => undefined)

  const rows: any[] = []
  for (let i = 0; i < targets.length; i++) {
    const page = targets[i]
    await broadcast(`CRO check ${i + 1}/${targets.length}: ${page.url}`)
    let findings: any[]
    try {
      const cro = await auditWithRetry(page.url)
      findings = [croFindingFor(page.url, cro)]
      logger.info({ runId, url: page.url, score: cro.score }, "CRO page done")
    } catch (e: any) {
      logger.error({ runId, url: page.url, error: e?.message }, "CRO page could not complete")
      findings = [lapseFinding(e?.message || String(e))]
    }
    rows.push(...findings.map((f) => ({ ...f, page_id: page.id, run_id: runId })))
  }

  // One attempt per job (see startRunJob), but clear old rows anyway so a
  // manual re-run never doubles the CRO findings.
  await supabase.from("findings").delete().eq("run_id", runId).eq("check_factor", CRO_CHECK)
  if (rows.length > 0) {
    const { error } = await supabase.from("findings").insert(rows)
    if (error) logger.error({ runId, error: error.message }, "Failed to insert CRO findings")
  }

  await supabase
    .channel(`run:${runId}`)
    .send({
      type: "broadcast",
      event: "progress",
      payload: { status: "done", message: "CRO check completed" },
    })
    .catch(() => undefined)
}
