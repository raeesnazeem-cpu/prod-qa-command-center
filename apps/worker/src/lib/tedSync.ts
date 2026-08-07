import { supabase } from "./supabase"
import pino from "pino"
import sharp from "sharp"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

// Post a comment to a TED task, preferring the newer /comments/ai endpoint
// (X-Api-Key + idempotent eventKey); fall back to the proven /comments (Bearer).
// Returns true on success.
export async function postTedComment(
  tedTaskId: string,
  text: string,
  eventKey: string,
): Promise<boolean> {
  const xApiKey = process.env.X_API_KEY
  const bearer = process.env.TED_API_TOKEN
  const isJsonOk = (r: Response) =>
    r.ok && (r.headers.get("content-type") || "").includes("application/json")

  // 1. Preferred: /comments/ai with X-Api-Key + eventKey.
  if (xApiKey) {
    try {
      const r = await fetch(
        `https://ted.growth99.com/api/tasks/${tedTaskId}/comments/ai`,
        {
          method: "POST",
          headers: {
            "X-Api-Key": xApiKey,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text, eventKey }),
        },
      )
      if (isJsonOk(r)) {
        logger.info({ tedTaskId }, "Posted TED comment via /comments/ai.")
        return true
      }
      const preview = (await r.text().catch(() => "")).slice(0, 200)
      logger.warn(
        { tedTaskId, status: r.status, preview },
        "/comments/ai unavailable; falling back to /comments (Bearer).",
      )
    } catch (err: any) {
      logger.warn(
        { tedTaskId, error: err?.message },
        "/comments/ai threw; falling back to /comments (Bearer).",
      )
    }
  } else {
    logger.info(
      { tedTaskId },
      "X_API_KEY not set in worker; using /comments (Bearer) directly.",
    )
  }

  // 2. Fallback: /comments with Bearer (the currently-working endpoint).
  if (!bearer) {
    logger.error({ tedTaskId }, "No TED_API_TOKEN for /comments fallback.")
    return false
  }
  try {
    const r = await fetch(
      `https://ted.growth99.com/api/tasks/${tedTaskId}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    )
    if (isJsonOk(r)) {
      logger.info({ tedTaskId }, "Posted TED comment via /comments (Bearer).")
      return true
    }
    const preview = (await r.text().catch(() => "")).slice(0, 200)
    logger.error(
      { tedTaskId, status: r.status, preview },
      "Failed to post TED comment via /comments (response not JSON).",
    )
    return false
  } catch (err: any) {
    logger.error(
      { tedTaskId, error: err?.message },
      "Error posting TED comment via /comments.",
    )
    return false
  }
}

// Screenshot embedding: TED renders base64 data-URI <img> (proven on task
// 9065); remote <img src=url> is NOT reliable. So we fetch each screenshot,
// downscale + webp-compress it, and inline it as a data-URI — plus a text link
// as a fallback / route to the full-res original. A running size budget guards
// against oversized comments: once exhausted, remaining shots become link-only.
const MAX_IMG_WIDTH = 480
const WEBP_QUALITY = 75
const IMG_BUDGET_BYTES = 4 * 1024 * 1024 // ~4MB of base64 across the whole report

async function renderScreenshotsHtml(
  screenshotUrl: string,
  budget: { remaining: number },
): Promise<string> {
  const urls = screenshotUrl
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  let html = ""
  for (const url of urls) {
    // Try to inline as a base64 webp data-URI (the format TED actually renders).
    if (budget.remaining > 0) {
      try {
        const resp = await fetch(url)
        if (resp.ok) {
          const srcBuf = Buffer.from(await resp.arrayBuffer())
          const out = await sharp(srcBuf)
            .resize({ width: MAX_IMG_WIDTH, withoutEnlargement: true })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer({ resolveWithObject: true })
          const dataUri = `data:image/webp;base64,${out.data.toString("base64")}`
          if (dataUri.length <= budget.remaining) {
            budget.remaining -= dataUri.length
            // Bare <img> with real pixel width/height ATTRIBUTES (not style — TED
            // strips style). Locks aspect ratio + caps size so TED CSS can't stretch it.
            html += `<img src="${dataUri}" width="${out.info.width}" height="${out.info.height}" alt="screenshot" /><br>`
          } else {
            logger.warn({ url }, "Screenshot skipped inline embed: report image budget exhausted; using link only.")
          }
        } else {
          logger.warn({ url, status: resp.status }, "Screenshot fetch not OK; using link only.")
        }
      } catch (err: any) {
        logger.warn({ url, error: err?.message }, "Screenshot inline embed failed; using link only.")
      }
    }
    // Always emit a short text link (fallback + route to the full-res original).
    html += `<a href="${url}">🔍 View full-size screenshot</a><br>`
  }
  return html
}

// ---- Report formatting: group by check, dedupe, render as bullet LISTS ----
// TED's sanitizer strips inline style and mangles <table>, but renders
// <p>/<strong>/<ul>/<li> cleanly (the format the TED team itself uses). So we
// use plain grouped lists, one heading per check.

const FRIENDLY: Record<string, string> = {
  dead_links: "Dead Links & Broken Anchors",
  broken_links: "Broken Links",
  external_links: "External Links",
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
  learn_more_buttons: "Learn More Buttons",
  url_tab_compare: "URL & Tab Comparison",
  url_matching: "URL Matching",
  text_share: "Text Share Metadata",
  gsr_check: "General Search Result (GSR)",
  project_plan: "Project Plan",
  paid_media: "Paid Media",
  spelling: "Spelling",
  meta_tags: "Meta Tags",
  dummy_content: "Dummy Content",
  console_errors: "Console Errors",
  image_compliance: "Image Compliance",
  accessibility: "Accessibility",
  visual_regression: "Visual Regression",
}

const titleCase = (s: string) =>
  (s || "other").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// A "tool lapse" is a QACC-internal failure/skip (an errored or skipped check,
// missing credentials, timeouts, AI errors) — NOT a real site defect. These are
// kept OUT of every TED report so QACC's own hiccups never appear unprofessional.
// Matches only phrases QACC itself emits; real site findings (e.g. "Hero video
// failed to load") are left untouched.
export function isToolLapseFinding(f: any): boolean {
  const t = String(f?.title || "").toLowerCase()
  const d = String(f?.description || "").toLowerCase()
  const s = `${t} ${d}`
  return (
    /check (failed|error)\b/.test(t) ||
    /failed or timed out/.test(t) ||
    /(check )?skipped/.test(t) ||
    /not configured|no password|was not provided/.test(s) ||
    /process aborted gracefully/.test(d) ||
    /encountered an (unexpected )?error/.test(d) ||
    /encountered a timeout/.test(d) ||
    /request failed with status code/.test(d) ||
    /google_places_api_key/.test(s) ||
    /could not obtain|ai triage failed/.test(s)
  )
}

// Dead-links descriptions are a JSON array, a markdown table, or bullets.
function parseLinks(desc?: string | null): any[] {
  if (!desc) return []
  try {
    const j = JSON.parse(desc)
    if (Array.isArray(j)) return j
  } catch {}
  const rows: any[] = []
  if (desc.includes("|")) {
    for (const line of desc.split("\n")) {
      const t = line.trim()
      if (!t.startsWith("|") || t.includes("---")) continue
      if (/error\s*\|\s*url/i.test(t)) continue
      const p = t.split("|").map((x) => x.trim())
      if (p.length >= 5) rows.push({ reason: p[1], url: p[2], link_text: p[3].replace(/`/g, ""), found_on: p[4] })
    }
  }
  return rows
}

// image_quality stores its rows as a JSON array in context_text.
function parseImageIssues(ctx?: string | null): any[] {
  if (!ctx) return []
  try {
    const j = JSON.parse(ctx)
    if (Array.isArray(j)) return j
  } catch {}
  return []
}

function dedupeFindings(group: any[]): any[] {
  const seen = new Set<string>()
  const out: any[] = []
  for (const f of group) {
    const key = `${f.title || ""}|${f.description || ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

function genericTable(findings: any[]): string {
  let h = `<ul>`
  for (const f of findings) {
    const desc = (f.description || "").replace(/\n/g, "<br>")
    h += `<li><strong>${esc(f.title || f.check_factor)}</strong>${desc ? `<br>${desc}` : ""}</li>`
  }
  return h + `</ul>`
}

function linkTable(rows: any[]): string {
  let h = `<ul>`
  for (const r of rows) {
    const url = esc(r.url || "")
    const found = esc(r.found_on || "")
    h += `<li><a href="${url}">${url}</a> — ${esc(r.reason || "")}${esc(r.link_text || r["Link text"] || "") ? ` (link: ${esc(r.link_text || r["Link text"])})` : ""}${found ? ` — found on <a href="${found}">${found}</a>` : ""}</li>`
  }
  return h + `</ul>`
}

function imageTable(rows: any[]): string {
  let h = `<ul>`
  for (const r of rows) {
    const src = esc(r.src || "")
    h += `<li><strong>${esc(r.type || "")}</strong> — <a href="${src}">${src}</a>${r.note ? ` (${esc(r.note)})` : ""}</li>`
  }
  return h + `</ul>`
}

// Render one check-group: a single merged table + its (deduped) screenshots.
async function renderGroup(
  factor: string,
  group: any[],
  budget: { remaining: number },
): Promise<string> {
  const isLinks = factor === "dead_links" || factor === "broken_links" || factor === "external_links"
  const isImages = factor === "image_quality"
  let html = ""
  const shots: string[] = []
  const seenShot = new Set<string>()
  const addShots = (val?: string | null) => {
    for (const u of (val || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!seenShot.has(u)) {
        seenShot.add(u)
        shots.push(u)
      }
    }
  }

  if (isLinks) {
    const rows: any[] = []
    const seen = new Set<string>()
    for (const f of group)
      for (const l of parseLinks(f.description)) {
        const k = `${l.url}|${l.found_on}`
        if (seen.has(k)) continue
        seen.add(k)
        rows.push(l)
      }
    html += rows.length ? linkTable(rows) : genericTable(dedupeFindings(group))
  } else if (isImages) {
    const rows: any[] = []
    const seen = new Set<string>()
    for (const f of group)
      for (const it of parseImageIssues(f.context_text)) {
        const k = `${it.type}|${it.src}`
        if (seen.has(k)) continue
        seen.add(k)
        rows.push(it)
        addShots(it.thumb)
      }
    html += rows.length ? imageTable(rows) : genericTable(dedupeFindings(group))
  } else {
    const uniq = dedupeFindings(group)
    html += genericTable(uniq)
    for (const f of uniq) addShots(f.screenshot_url)
  }

  if (shots.length) html += await renderScreenshotsHtml(shots.join(","), budget)
  return html
}

// Interim comment posted AFTER the QA report and BEFORE the AI-fix pass, so the
// TED task shows a clear hand-off. Only posts when the AI Fix module is enabled
// (otherwise there is no fix pass to announce).
export async function postScanCompleteComment(tedTaskId: string, runId: string) {
  if (process.env.AI_FIX_MODULE_ENABLED !== "true") return
  const text = `<p>✅ <strong>QA scan complete.</strong> QACC AI Fix is now generating and applying corrections in the background — the fix report will follow shortly.</p>`
  await postTedComment(tedTaskId, text, `ext:qacc-scan-complete-${runId}`).catch(() => {})
}

export async function postFinalReportToTED(runId: string, tedTaskId: string) {
  try {
    const apiToken = process.env.TED_API_TOKEN
    if (!apiToken) {
      logger.warn("TED_API_TOKEN is not configured in worker environment. Skipping TED report.")
      return
    }

    // Idempotency claim: a run can be finalized by several completion paths
    // (runChecksJob / crawlPageJob, RPC + fallback). Atomically stamp
    // ted_report_posted_at so exactly ONE caller proceeds to post the report.
    const { data: claim, error: claimErr } = await supabase
      .from("qa_runs")
      .update({ ted_report_posted_at: new Date().toISOString() })
      .eq("id", runId)
      .is("ted_report_posted_at", null)
      .select("id")

    if (claimErr) {
      logger.error({ runId, error: claimErr.message }, "Failed to claim TED report; skipping to avoid duplicates")
      return
    }
    if (!claim || claim.length === 0) {
      logger.info({ runId }, "TED final report already posted by another completion path; skipping.")
      return
    }

    // Fetch findings for the run
    const { data: findings, error: findingsError } = await supabase
      .from("findings")
      .select("*")
      .eq("run_id", runId)

    if (findingsError) {
      logger.error({ error: findingsError.message }, "Error fetching findings for TED sync")
      return
    }

    // Hide QACC-internal lapses (errored/skipped checks) — keep only real findings.
    const shown = (findings || []).filter((f) => !isToolLapseFinding(f))

    let reportText = `<strong>QACC Automated QA Run Completed</strong><br><br>`

    if (shown.length === 0) {
      logger.info({ runId }, "No reportable findings for run; reporting clean pass to TED.")
      reportText += `🎉 All checks passed successfully! 0 issues found.`
    } else {
      // Group findings by check type → ONE heading per check, all its findings
      // merged into a single deduped table, screenshots once per group.
      const imgBudget = { remaining: IMG_BUDGET_BYTES }
      const groups = new Map<string, any[]>()
      for (const f of shown) {
        const k = f.check_factor || "other"
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k)!.push(f)
      }
      reportText += `Found issues across ${groups.size} check${groups.size > 1 ? "s" : ""}.<br>`
      for (const [factor, group] of groups) {
        const label = FRIENDLY[factor] || titleCase(factor)
        reportText += `<h3>${esc(label)}</h3>`
        reportText += await renderGroup(factor, group, imgBudget)
      }
    } // End of findings else block

    logger.info({ tedTaskId }, "Sending final report to TED")

    // Try /comments/ai (X-Api-Key + idempotent eventKey) first, else /comments.
    const posted = await postTedComment(
      tedTaskId,
      reportText.trim(),
      `ext:qacc-report-${runId}`,
    )

    if (posted) {
      logger.info({ tedTaskId }, "Successfully posted final report back to TED!")
    } else {
      logger.error(
        { tedTaskId },
        "Failed to post final report to TED via both /comments/ai and /comments.",
      )
      // Release the claim so a retry / another completion path can post it later.
      await supabase
        .from("qa_runs")
        .update({ ted_report_posted_at: null })
        .eq("id", runId)
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "Exception while syncing report to TED")
    // Release the claim on unexpected failure so the report isn't lost forever.
    await supabase
      .from("qa_runs")
      .update({ ted_report_posted_at: null })
      .eq("id", runId)
      .then(undefined, () => {})
  }
}
