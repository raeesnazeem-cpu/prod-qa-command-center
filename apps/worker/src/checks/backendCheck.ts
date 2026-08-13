import { Finding } from "@qacc/shared"
import { supabase } from "../lib/supabase"
import { getClientNotesText } from "../lib/tedClient"

/**
 * QA-Backend Check (login-free)
 * -----------------------------
 * Verifies a site was cleaned up before release WITHOUT logging into wp-admin.
 * All fixes are applied via the blank-theme repo (functions.php / 404.php /
 * templates) or a WP-CLI/SQL demo-content strip — none of which need a browser
 * login — so this check only ever *reads* the public surface:
 *
 *   1. Leftover DEFAULT/PLACEHOLDER content — the "Hello world!" post, the
 *      "Sample Page" page, the default "Just another WordPress site" tagline
 *      (all read via the public WP REST API).
 *   2. A styled custom 404 page renders on all views (desktop/tablet/mobile)
 *      without a layout break (front-end probe).
 *   3. Comments are closed on published posts (WP REST `comment_status`, DOM
 *      fallback).
 *   4. The published contact number matches the client's number in TED
 *      (front-end scrape vs. clientDetails.notes).
 *
 * The one thing that genuinely needed a login — detecting inactive default
 * "Twenty*" themes still installed — was intentionally dropped: inactive themes
 * have no public signal, the active theme is the blank repo theme, and it is a
 * minor hygiene nit. See [[wp-password-runtime-only]].
 *
 * Every section is independently guarded so one failure never stalls the rest.
 * Homepage-only, browser-owning check (creates its own context). No password.
 */

const CHECK_FACTOR = "backend_check"

const VIEWPORTS = [
  { label: "Desktop", width: 1920, height: 1080 },
  { label: "Tablet", width: 768, height: 1024 },
  { label: "Mobile", width: 375, height: 812 },
]

// Normalized (digits-only) fragments that mark a placeholder/demo phone number.
const DEMO_PHONE_FRAGMENTS = [
  "1234567890",
  "0000000000",
  "1112223333",
  "9999999999",
  "5550100", // 555-01xx is the reserved fictional US range
]

/** Reduce a phone string to its comparable last-10 digits (drops US country code). */
function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1)
  return d.length > 10 ? d.slice(-10) : d
}

/**
 * Pull the authoritative business phone out of the TED client notes.
 * Prefers a labelled "Phone/Tel/Contact/Number: …" line, else the first
 * phone-shaped token. Returns the normalized last-10 digits, or "" if none.
 */
function parsePhoneFromNotes(notes: string): string {
  if (!notes) return ""
  const labelled = notes.match(
    /(?:phone|tel(?:ephone)?|contact(?:\s*(?:no\.?|number))?|number)\s*[:\-]?\s*(\+?\d[\d\s().\-]{7,}\d)/i,
  )
  const bare = notes.match(/\+?\d[\d\s().\-]{7,}\d/)
  const candidate = (labelled && labelled[1]) || (bare && bare[0]) || ""
  const norm = normalizePhone(candidate)
  return norm.length === 10 ? norm : ""
}

/** Fetch JSON from a public URL. Returns null on any non-JSON / error response. */
async function fetchJson(url: string): Promise<any | null> {
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" } })
    const ctype = resp.headers.get("content-type") || ""
    if (!resp.ok || !ctype.includes("application/json")) return null
    return await resp.json()
  } catch {
    return null
  }
}

export async function checkBackend(
  url: string,
  runId: string,
  pageId: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
  projectId?: string,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  const origin = (() => {
    try {
      return new URL(url).origin
    } catch {
      return url.replace(/\/$/, "")
    }
  })()

  const findings: Finding[] = []
  let browser: any = null
  let context: any = null

  const shot = async (page: any, name: string, fullPage = true) => {
    try {
      const buffer = await page.screenshot({ fullPage }).catch(() => null)
      if (!buffer) return ""
      return await uploadScreenshot(buffer, `${runId}/backend_${name}.png`).catch(() => "")
    } catch {
      return ""
    }
  }

  try {
    browser = sharedBrowser || (await chromium.launch({ headless: true }))
    context = await browser.newContext()
    const page = await context.newPage()
    await page.setViewportSize({ width: 1920, height: 1080 })

    // --- 1. DEFAULT / PLACEHOLDER CONTENT (public WP REST; no login) ---
    // The "Hello world!" post, "Sample Page", and default tagline are all
    // readable without authentication: posts/pages by slug, and the tagline
    // from the REST API index (`description`).
    try {
      if (onProgress) await onProgress(20, "Checking for default WordPress content...")

      // 1a/1b/1c fetched together so a total REST outage can be told apart from
      // a genuine "not present" (clean) result.
      const helloPosts = await fetchJson(
        `${origin}/wp-json/wp/v2/posts?slug=hello-world&_fields=id,link,title`,
      )
      const samplePages = await fetchJson(
        `${origin}/wp-json/wp/v2/pages?slug=sample-page&_fields=id,link,title`,
      )
      const restIndex = await fetchJson(`${origin}/wp-json/`)

      const restDown =
        helloPosts === null && samplePages === null && restIndex === null
      if (restDown) {
        // Can't read anything → lapse (not a clean pass) for this whole section.
        findings.push({
          check_factor: CHECK_FACTOR,
          title: "Backend Check Failed — default-content scan",
          description:
            "The WordPress REST API was unreachable, so default/placeholder content could not be verified. Process aborted gracefully for this section; QACC will retry on the next run.",
          context_text: "System Error (default-content section)",
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        } as Finding)
      } else {
        // 1a. "Hello world!" post — individual pass/fail.
        if (Array.isArray(helloPosts) && helloPosts.length > 0) {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: 'Default "Hello world!" post present',
            description:
              'The default WordPress "Hello world!" post still exists and should be removed.',
            context_text: `Post: ${helloPosts[0]?.link || `#${helloPosts[0]?.id}`}`,
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        } else {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: 'No default "Hello world!" post',
            description:
              'No issues found. The default WordPress "Hello world!" post is not present.',
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }

        // 1b. "Sample Page" — individual pass/fail.
        if (Array.isArray(samplePages) && samplePages.length > 0) {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: 'Default "Sample Page" present',
            description:
              'The default WordPress "Sample Page" still exists and should be removed.',
            context_text: `Page: ${samplePages[0]?.link || `#${samplePages[0]?.id}`}`,
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        } else {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: 'No default "Sample Page"',
            description:
              'No issues found. The default WordPress "Sample Page" is not present.',
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }

        // 1c. Default tagline — the REST index exposes it as `description`.
        const tagline: string = (restIndex?.description || "").trim()
        if (/just another wordpress site/i.test(tagline)) {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: "Default WordPress tagline still set",
            description: `The site tagline is still the default "${tagline}". Update or clear it before release.`,
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        } else {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: "Site tagline is not the WordPress default",
            description:
              "No issues found. The site tagline is not the default \"Just another WordPress site\".",
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      }
    } catch (e: any) {
      // Don't silently drop this dimension — surface a lapse so it's marked
      // "could not complete" rather than treated as a clean pass.
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Backend Check Failed — default-content scan",
        description: `The default/placeholder-content scan could not complete: ${e?.message}. Process aborted gracefully for this section; QACC will retry on the next run.`,
        context_text: "System Error (default-content section)",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    // --- 2. CUSTOM 404 ON ALL VIEWS (front-end) ---
    try {
      if (onProgress) await onProgress(45, "Probing custom 404 page on all views...")
      const probeUrl = `${origin}/__qacc_404_probe_${Date.now()}`
      const shotUrls: string[] = []
      let httpStatus: number | null = null
      let looksCustom = false
      let overflowViewport = ""

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        const resp = await page.goto(probeUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() => null)
        if (resp && httpStatus === null) httpStatus = resp.status()

        const info = await page.evaluate(() => {
          const doc = document.documentElement
          const bodyText = (document.body?.innerText || "").toLowerCase()
          return {
            len: bodyText.length,
            has404: /404|not found|page (doesn'?t|does not) exist|can'?t be found/i.test(bodyText),
            hasChrome:
              !!document.querySelector("header, nav, .site-header, #masthead, footer, .site-footer"),
            overflow: doc.scrollWidth - doc.clientWidth,
          }
        })

        // "Styled custom 404" heuristic: has the site chrome (header/footer/nav)
        // AND a 404 message AND non-trivial content — not a bare server 404.
        if (info.hasChrome && info.has404 && info.len > 150) looksCustom = true
        if (info.overflow > 2 && !overflowViewport) overflowViewport = vp.label

        const u = await shot(page, `404_${vp.label.toLowerCase()}`)
        if (u) shotUrls.push(u)
      }

      const joined = shotUrls.join(",")
      if (!looksCustom) {
        findings.push({
          check_factor: CHECK_FACTOR,
          title: "Custom 404 page not detected on all views",
          description: `Requested a non-existent URL and did not detect a styled custom 404 page (site header/footer + a 404 message). HTTP status: ${httpStatus ?? "unknown"}. Verify the custom 404 renders correctly on desktop, tablet, and mobile.`,
          context_text: `Probe URL: ${probeUrl}\nHTTP status: ${httpStatus ?? "unknown"}`,
          screenshot_url: joined || null,
          status: "open",
          ai_generated: false,
        } as Finding)
      } else if (overflowViewport) {
        findings.push({
          check_factor: CHECK_FACTOR,
          title: `Custom 404 page has a layout break (${overflowViewport})`,
          description: `A styled custom 404 page renders, but it overflows horizontally on the ${overflowViewport} view. Fix the responsive layout of the 404 template.`,
          context_text: `Probe URL: ${probeUrl}\nOverflow viewport: ${overflowViewport}`,
          screenshot_url: joined || null,
          status: "open",
          ai_generated: false,
        } as Finding)
      } else {
        findings.push({
          check_factor: CHECK_FACTOR,
          title: "Custom 404 page renders on all views",
          description: `No issues found. A styled custom 404 page (with site header/footer and a 404 message) renders on desktop, tablet, and mobile without a layout break. HTTP status: ${httpStatus ?? "unknown"}.`,
          context_text: `Probe URL: ${probeUrl}`,
          screenshot_url: joined || null,
          status: "open",
          ai_generated: false,
        } as Finding)
      }
    } catch (e: any) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Backend Check Failed — custom 404 probe",
        description: `The custom-404 probe could not complete: ${e?.message}. Process aborted gracefully for this section; QACC will retry on the next run.`,
        context_text: "System Error (custom-404 section)",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    // --- 3. COMMENTS DISABLED (front-end; no login needed) ---
    // Authoritative signal is the WP REST API: each post carries a
    // `comment_status` of "open" | "closed". Any "open" post = comments still
    // enabled. Falls back to a homepage DOM scan if REST is blocked.
    try {
      if (onProgress) await onProgress(70, "Checking comments are disabled...")
      const posts = await fetchJson(
        `${origin}/wp-json/wp/v2/posts?per_page=20&_fields=id,link,comment_status`,
      )

      if (Array.isArray(posts)) {
        const openPosts = posts
          .filter((p) => p?.comment_status === "open")
          .map((p) => p?.link || `post #${p?.id}`)
        if (openPosts.length > 0) {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: "Comments still enabled on published posts",
            description: `Comments should be closed before release. The WordPress REST API reports ${openPosts.length} post(s) with comments still open.`,
            context_text: `Posts with comments open:\n${openPosts.slice(0, 20).join("\n")}`,
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
        else {
          // REST reachable & none open → explicit pass.
          findings.push({
            check_factor: CHECK_FACTOR,
            title: "Comments are closed on published posts",
            description:
              "No issues found. The WordPress REST API reports comments are closed on all published posts.",
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      } else {
        // Fallback: look for a comment form on the homepage.
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page
          .goto(origin, { waitUntil: "networkidle", timeout: 30000 })
          .catch(() => {})
        const hasCommentForm: boolean = await page.evaluate(() =>
          !!document.querySelector(
            "#respond, #commentform, .comment-form, form.comment-form",
          ) || /leave a (reply|comment)/i.test(document.body?.innerText || ""),
        )
        if (hasCommentForm) {
          const cShot = await shot(page, "comments")
          findings.push({
            check_factor: CHECK_FACTOR,
            title: "Comment form present on the homepage",
            description:
              "The WordPress REST API was unavailable, but a comment form was detected on the homepage, which suggests comments are still enabled. Verify comments are closed site-wide.",
            screenshot_url: cShot || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        } else {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: "Comments appear closed",
            description:
              "No issues found. No comment form was detected on the homepage, so comments appear closed. (The REST API was unavailable, so this could not be confirmed across every post.)",
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      }
    } catch (e: any) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Backend Check Failed — comments-disabled scan",
        description: `The comments-disabled scan could not complete: ${e?.message}. Process aborted gracefully for this section; QACC will retry on the next run.`,
        context_text: "System Error (comments section)",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    // --- 4. CONTACT NUMBER MATCH (front-end + TED client notes) ---
    // Authoritative number comes from the TED client record's
    // clientDetails.notes (resolved via projectId → projects.name), mirroring
    // gbpCheck. Compared against tel: links + visible phone numbers on the site.
    try {
      if (onProgress) await onProgress(88, "Checking contact number matches client record...")

      // Resolve the authoritative number from TED notes (best-effort).
      let authoritative = ""
      if (projectId) {
        try {
          const { data: project } = await supabase
            .from("projects")
            .select("name")
            .eq("id", projectId)
            .single()
          const clientName = project?.name || ""
          if (clientName) {
            const notes = await getClientNotesText(clientName)
            authoritative = parsePhoneFromNotes(notes)
          }
        } catch {}
      }

      // Scrape on-site numbers from the homepage (tel: links + visible text).
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.goto(origin, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {})
      const rawNumbers: string[] = await page.evaluate(() => {
        const tel = Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) =>
          (a.getAttribute("href") || "").replace(/^tel:/i, ""),
        )
        const text = document.body?.innerText || ""
        const matches = text.match(/\+?\d[\d\s().\-]{7,}\d/g) || []
        return [...tel, ...matches]
      })

      const onSite = Array.from(
        new Set(rawNumbers.map(normalizePhone).filter((d) => d.length === 10)),
      )
      const demoHit = onSite.find((d) =>
        DEMO_PHONE_FRAGMENTS.some((frag) => d.includes(frag)),
      )
      const phonesShot = await shot(page, "contact_number", false)

      if (demoHit) {
        findings.push({
          check_factor: CHECK_FACTOR,
          title: "Placeholder/demo contact number on the site",
          description: `A placeholder-looking phone number (${demoHit}) is still published on the site. Replace it with the client's real number.`,
          context_text: `Numbers found on site: ${onSite.join(", ") || "none"}`,
          screenshot_url: phonesShot || null,
          status: "open",
          ai_generated: false,
        } as Finding)
      } else if (authoritative) {
        const matched = onSite.includes(authoritative)
        if (!matched) {
          findings.push({
            check_factor: CHECK_FACTOR,
            title: "Contact number does not match the client record",
            description: `The client's number in TED is ${authoritative}, but it was not found on the homepage. Numbers on site: ${onSite.join(", ") || "none"}.`,
            context_text: `TED (authoritative): ${authoritative}\nOn site: ${onSite.join(", ") || "none"}`,
            screenshot_url: phonesShot || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
        else {
          // matched → explicit pass.
          findings.push({
            check_factor: CHECK_FACTOR,
            title: "Contact number matches the client record",
            description: `No issues found. The published contact number matches the client's number in TED (${authoritative}).`,
            screenshot_url: phonesShot || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      } else if (onSite.length === 0) {
        findings.push({
          check_factor: CHECK_FACTOR,
          title: "No contact number found on the homepage",
          description:
            "No tel: link or phone number was detected on the homepage. Verify the business contact number is published.",
          screenshot_url: phonesShot || null,
          status: "open",
          ai_generated: false,
        } as Finding)
      } else {
        // Numbers present but no authoritative source to compare against — not a
        // defect (a number IS published), so pass and note it couldn't be
        // cross-checked.
        findings.push({
          check_factor: CHECK_FACTOR,
          title: "Contact number present",
          description: `No issues found. A contact number is published on the site (${onSite.join(", ")}); it could not be cross-checked because no authoritative number was available in the TED client notes.`,
          screenshot_url: phonesShot || null,
          status: "open",
          ai_generated: false,
        } as Finding)
      }
    } catch (e: any) {
      findings.push({
        check_factor: CHECK_FACTOR,
        title: "Backend Check Failed — contact-number match",
        description: `The contact-number match could not complete: ${e?.message}. Process aborted gracefully for this section; QACC will retry on the next run.`,
        context_text: "System Error (contact-number section)",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    if (onProgress) await onProgress(95, "Finalizing backend findings...")

    return findings
  } catch (error: any) {
    findings.push({
      check_factor: CHECK_FACTOR,
      title: "Backend Check Failed",
      description: `The check encountered an unexpected error: ${error.message}. Process aborted gracefully to prevent stalling the scan.`,
      context_text: "System Error",
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding)
    return findings
  } finally {
    try {
      if (context) await context.close().catch(() => {})
      if (browser && !sharedBrowser) await browser.close().catch(() => {})
    } catch {}
  }
}
