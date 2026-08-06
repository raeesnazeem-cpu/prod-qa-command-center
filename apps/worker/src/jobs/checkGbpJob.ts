import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { getClientNotesText } from "../lib/tedClient"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
})

const CHECK_FACTOR = "gbp_check"

// Full set of page-scan checks (ALL_PAGES + HOMEPAGE_ONLY, incl. the new ones).
// Used to decide isApiOnly progress + whether THIS job should mark the run
// completed (it must NOT if crawl_page jobs are still finishing).
const PAGE_CHECKS = [
  "visual_regression", "accessibility", "performance", "spelling",
  "console_errors", "seo", "dummy_content", "dead_links", "learn_more_buttons",
  "url_matching", "url_tab_compare", "contact_form", "false_breakpoint",
  "functionality_check", "privacy_policy", "callnow_links", "hero_media",
  "footer_logo", "single_script", "top_bar_sticky", "favicon",
  "chatbot_consultation", "text_share", "verify_plugin_updates",
  "social_share_heading", "logo_chatbot", "gsr_check", "backend_check",
  "review_reputation_check",
]

// Detect the GBP add-on being active in the client notes (format varies).
const GBP_KEYWORDS = [
  "google business profile",
  "google my business",
  "gbp",
  "gmb",
  "google business",
]

const normalizeDomain = (u: string) =>
  (u || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .trim()

interface PlaceSummary {
  name: string
  address: string
  phone: string
  website: string
  hasHours: boolean
  photoCount: number
  rating: number | null
  reviews: number | null
  mapsUrl: string
}

async function placesTextSearch(query: string, key: string): Promise<string[]> {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`
  const r = await fetch(url)
  const body: any = await r.json().catch(() => ({}))
  if (body.status && body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    throw new Error(`Places TextSearch: ${body.status} ${body.error_message || ""}`)
  }
  return (body.results || []).map((p: any) => p.place_id).filter(Boolean)
}

async function placeDetails(placeId: string, key: string): Promise<PlaceSummary | null> {
  const fields =
    "name,formatted_address,formatted_phone_number,website,opening_hours,rating,user_ratings_total,url,photos"
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${key}`
  const r = await fetch(url)
  const body: any = await r.json().catch(() => ({}))
  const p = body.result
  if (!p) return null
  return {
    name: p.name || "",
    address: p.formatted_address || "",
    phone: p.formatted_phone_number || "",
    website: p.website || "",
    hasHours: !!p.opening_hours,
    photoCount: Array.isArray(p.photos) ? p.photos.length : 0,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviews: typeof p.user_ratings_total === "number" ? p.user_ratings_total : null,
    mapsUrl: p.url || "",
  }
}

export async function processCheckGbpJob(job: Job) {
  const { runId, projectId, isRetry } = job.data
  if (!runId || !projectId) throw new Error("Missing required data for checkGbp job")

  logger.info({ runId, projectId }, "Processing GBP check job")

  const { data: runConfig } = await supabase
    .from("qa_runs")
    .select("enabled_checks, site_url, live_site_url")
    .eq("id", runId)
    .single()

  const isApiOnly = !runConfig?.enabled_checks?.some((c: string) =>
    PAGE_CHECKS.includes(c),
  )

  const { data: firstPage } = await supabase
    .from("pages")
    .select("id")
    .eq("run_id", runId)
    .limit(1)
    .single()
  const pageId = firstPage?.id
  if (!pageId) {
    logger.warn({ runId }, "No pages found for run. Skipping GBP check.")
    return
  }

  if (isApiOnly) {
    await supabase
      .from("pages")
      .update({ status: "processing", progress: 0, current_step: "Initializing GBP check..." })
      .eq("id", pageId)
  }

  const updateProgress = async (progress: number, step: string) => {
    if (pageId && isApiOnly) {
      await supabase.from("pages").update({ progress, current_step: step }).eq("id", pageId)
    }
    const channel = supabase.channel(`run:${runId}`)
    await channel.send({
      type: "broadcast",
      event: "page_progress",
      payload: { pageId, progress, current_step: step },
    })
  }

  const findings: any[] = []

  try {
    if (isApiOnly) await updateProgress(10, "Resolving client & Google Business Profile add-on...")

    // Client name = QACC project name (that's how projects are keyed to TED clients).
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single()
    const clientName = project?.name || ""

    const notesText = await getClientNotesText(clientName)
    const lower = notesText.toLowerCase()
    const addonActive = GBP_KEYWORDS.some((k) => lower.includes(k))

    if (!addonActive) {
      findings.push({
        check_factor: CHECK_FACTOR,
        severity: "low",
        title: "GBP add-on not detected in client notes — skipped",
        description:
          "No Google Business Profile / GMB add-on reference was found in the client notes, so the GBP optimization check was skipped. If this client does have the GBP add-on, verify the client notes mention it.",
        status: "open",
        ai_generated: false,
      })
    } else {
      const key = process.env.GOOGLE_PLACES_API_KEY
      if (!key) {
        if (isApiOnly) await updateProgress(100, "Skipped (no API key)")
        findings.push({
          check_factor: CHECK_FACTOR,
          severity: "medium",
          title: "GBP check skipped — GOOGLE_PLACES_API_KEY not configured",
          description:
            "The GBP add-on is active but GOOGLE_PLACES_API_KEY is not set in the worker environment, so Google Business Profile optimization could not be verified automatically.",
          status: "open",
          ai_generated: false,
        })
      } else {
        if (isApiOnly) await updateProgress(40, "Searching Google Places for locations...")
        const siteDomain = normalizeDomain(runConfig?.live_site_url || runConfig?.site_url || "")

        const placeIds = await placesTextSearch(clientName, key)
        if (placeIds.length === 0) {
          findings.push({
            check_factor: CHECK_FACTOR,
            severity: "high",
            title: `No Google Business Profile found for "${clientName}"`,
            description: `Google Places returned no results for "${clientName}". Verify the business has a Google Business Profile and that its name matches.`,
            status: "open",
            ai_generated: false,
          })
        } else {
          const capped = placeIds.slice(0, 5)
          if (isApiOnly) await updateProgress(60, `Auditing ${capped.length} location(s)...`)

          for (let i = 0; i < capped.length; i++) {
            const p = await placeDetails(capped[i], key).catch(() => null)
            if (!p) continue

            const gaps: string[] = []
            if (!p.phone) gaps.push("phone number")
            if (!p.website) gaps.push("website")
            else if (siteDomain && normalizeDomain(p.website) !== siteDomain)
              gaps.push(`website mismatch (GBP: ${normalizeDomain(p.website)} vs site: ${siteDomain})`)
            if (!p.hasHours) gaps.push("opening hours")
            if (p.photoCount === 0) gaps.push("photos")
            if (!p.reviews) gaps.push("reviews")

            const detail = [
              `Location: ${p.name}`,
              `Address: ${p.address || "—"}`,
              `Phone: ${p.phone || "❌"}`,
              `Website: ${p.website || "❌"}`,
              `Hours: ${p.hasHours ? "✓" : "❌"}`,
              `Photos: ${p.photoCount}`,
              `Rating: ${p.rating ?? "—"} (${p.reviews ?? 0} reviews)`,
              `Profile: ${p.mapsUrl}`,
            ].join("\n")

            findings.push({
              check_factor: CHECK_FACTOR,
              severity: gaps.length === 0 ? "low" : gaps.length >= 3 ? "high" : "medium",
              title:
                gaps.length === 0
                  ? `GBP optimized: ${p.name}`
                  : `GBP gaps for ${p.name}: ${gaps.join(", ")}`,
              description: detail,
              context_text: `Client: ${clientName}\nPlace ID: ${capped[i]}`,
              status: "open",
              ai_generated: false,
            })
          }
        }
      }
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "Error in GBP check")
    findings.push({
      check_factor: CHECK_FACTOR,
      severity: "medium",
      title: "GBP Check Error",
      description: `Failed to verify Google Business Profile: ${error.message}.`,
      status: "open",
      ai_generated: false,
    })
  }

  if (isApiOnly) await updateProgress(100, "Done")

  if (findings.length > 0) {
    const withIds = findings.map((f) => ({ ...f, page_id: pageId, run_id: runId }))
    await supabase.from("findings").insert(withIds)
  }

  const progressChannel = supabase.channel(`run:${runId}`)
  await progressChannel.send({
    type: "broadcast",
    event: "progress",
    payload: { status: "done", message: "GBP check completed" },
  })

  // Mark completion ONLY if this run has no page-scan checks (else crawl_page's
  // completion path owns it — and will post the TED report incl. these findings).
  const needsPageScan = runConfig?.enabled_checks?.some((c: string) =>
    PAGE_CHECKS.includes(c),
  )
  if (!needsPageScan && !isRetry) {
    const { qaQueue } = require("../lib/queue")
    const { data: runData } = await supabase
      .from("qa_runs")
      .select("pages_total")
      .eq("id", runId)
      .single()
    await supabase
      .from("qa_runs")
      .update({
        status: "completed",
        pages_processed: runData?.pages_total || 0,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
    qaQueue.add("generate_embeddings", { runId }).catch(() => {})
  }
}
