import { Finding } from "@qacc/shared"
import { supabase } from "../lib/supabase"
import { getClientNotesText } from "../lib/tedClient"

/**
 * GBP Optimization Check (inline, homepage-anchored).
 *
 * Runs INSIDE crawlPageJob (homepage block) so its findings stream into the
 * findings table before the run completes — guaranteeing they reach the TED
 * report (unlike the old parallel job, which could race the report post).
 *
 * Verifies each Google Business Profile location via Google Places:
 * phone / website (matches site) / hours / photos / reviews.
 * If GOOGLE_PLACES_API_KEY is missing, emits a hard FAILED finding so GBP
 * always shows in the report.
 */

const CHECK_FACTOR = "gbp_check"

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

export async function checkGbp(
  projectId: string,
  siteUrl?: string | null,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const findings: Finding[] = []

  try {
    if (onProgress) await onProgress(10, "Resolving client & GBP add-on...")

    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single()
    const clientName = project?.name || ""

    const notesText = await getClientNotesText(clientName)
    const addonActive = GBP_KEYWORDS.some((k) => notesText.toLowerCase().includes(k))

    if (!addonActive) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "GBP add-on not detected in client notes — skipped",
        description:
          "No Google Business Profile / GMB add-on reference was found in the client notes, so the GBP optimization check was skipped.",
        status: "open",
        ai_generated: false,
      } as Finding)
      return findings
    }

    const key = process.env.GOOGLE_PLACES_API_KEY
    if (!key) {
      // Hard FAILED finding so GBP always appears in the report.
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "GBP Check Failed — GOOGLE_PLACES_API_KEY not configured",
        description:
          "The Google Business Profile add-on is active, but GOOGLE_PLACES_API_KEY is not set in the worker environment, so GBP optimization could not be verified. Configure the key and re-run.",
        context_text: `Client: ${clientName}`,
        status: "open",
        ai_generated: false,
      } as Finding)
      return findings
    }

    if (onProgress) await onProgress(40, "Searching Google Places for locations...")
    const siteDomain = normalizeDomain(siteUrl || "")
    const placeIds = await placesTextSearch(clientName, key)

    if (placeIds.length === 0) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: `No Google Business Profile found for "${clientName}"`,
        description: `Google Places returned no results for "${clientName}". Verify the business has a Google Business Profile and that its name matches.`,
        status: "open",
        ai_generated: false,
      } as Finding)
      return findings
    }

    const capped = placeIds.slice(0, 5)
    if (onProgress) await onProgress(60, `Auditing ${capped.length} location(s)...`)

    let audited = 0
    for (let i = 0; i < capped.length; i++) {
      const p = await placeDetails(capped[i], key).catch(() => null)
      if (!p) continue
      audited++

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
        title:
          gaps.length === 0
            ? `GBP optimized: ${p.name}`
            : `GBP gaps for ${p.name}: ${gaps.join(", ")}`,
        description: detail,
        context_text: `Client: ${clientName}\nPlace ID: ${capped[i]}`,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    // Places returned location(s) but we could not fetch details for ANY of
    // them → we have no result. Returning the empty `findings` here would be
    // reported as a clean pass. Emit a lapse so it's marked "could not complete".
    if (audited === 0) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "GBP Check Failed — could not fetch location details",
        description: `Google Places returned ${capped.length} location(s) for "${clientName}", but the Place Details request failed for every one, so GBP optimization could not be verified. QACC will retry on the next run.`,
        context_text: `Client: ${clientName}\nLocations found: ${capped.length}\nLocations audited: 0`,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    if (onProgress) await onProgress(100, "GBP check complete")
    return findings
  } catch (error: any) {
    findings.push({
      check_factor: CHECK_FACTOR,
      title: "GBP Check Failed",
      description: `The GBP check encountered an unexpected error: ${error.message}.`,
      status: "open",
      ai_generated: false,
    } as Finding)
    return findings
  }
}
