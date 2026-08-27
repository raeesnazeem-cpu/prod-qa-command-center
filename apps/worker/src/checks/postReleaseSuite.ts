import { Finding } from "@qacc/shared"
import pLimit from "p-limit"

/**
 * Concurrent plugin lookups. Each slug costs two independent requests (the
 * site's readme.txt and api.wordpress.org). Kept modest: production runs
 * qa-api + qa-worker on one 2 vCPU / 4 GB box with WORKER_CONCURRENCY=3.
 */
const PLUGIN_CHECK_CONCURRENCY = Math.max(
  1,
  Number(process.env.PLUGIN_CHECK_CONCURRENCY || 6),
)

/**
 * =========================================================================
 * Post-Release credential-free checks
 * -------------------------------------------------------------------------
 * These checks run on human-free TED post-release runs, so they must NOT
 * require the WordPress admin password. Plugin state is derived from public
 * front-end artifacts (asset paths, plugin readme.txt, /wp-json) and the
 * public api.wordpress.org plugin registry.
 * =========================================================================
 */

// Plugins we intentionally do not fail on (premium / managed / expected on a
// released G99 site). Kept in sync with the note in the old wp-admin check.
const IGNORED_PLUGIN_SLUGS = new Set<string>([
  "all-in-one-wp-migration",
  "litespeed-cache",
  "wp-rocket",
  "elementor",
  "elementor-pro",
  "woocommerce",
])

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "")
}

/** Compare two dot-separated version strings. Returns -1/0/1 (a vs b). */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10))
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0
    const y = Number.isFinite(pb[i]) ? pb[i] : 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "QACC-PostRelease/1.0" },
    })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// Both plugin checks (`plugin_number` and `verify_plugin_updates`) discover
// slugs from the same homepage HTML. When both are enabled they ran back to
// back and downloaded that page twice. One short-lived memo per base URL
// collapses it to a single fetch; the TTL keeps the check honest across runs
// rather than pinning a site's HTML for the worker's lifetime.
const SLUG_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.PLUGIN_SLUG_CACHE_TTL_MS || 5 * 60 * 1000),
)
const slugCache = new Map<string, { at: number; promise: Promise<string[]> }>()

/**
 * Discover installed plugin slugs credential-free by scanning the homepage
 * HTML for `/wp-content/plugins/<slug>/` asset references.
 */
async function discoverPluginSlugs(baseUrl: string): Promise<string[]> {
  const now = Date.now()
  const hit = slugCache.get(baseUrl)
  if (hit && now - hit.at < SLUG_CACHE_TTL_MS) return hit.promise

  const entry = { at: now, promise: discoverPluginSlugsUncached(baseUrl) }
  slugCache.set(baseUrl, entry)
  const result = await entry.promise.catch((e) => {
    if (slugCache.get(baseUrl) === entry) slugCache.delete(baseUrl)
    throw e
  })
  // An empty result usually means the homepage fetch failed — don't cache it,
  // or a transient blip silently reports "no plugins" for the whole TTL.
  if (result.length === 0 && slugCache.get(baseUrl) === entry) {
    slugCache.delete(baseUrl)
  }
  return result
}

async function discoverPluginSlugsUncached(baseUrl: string): Promise<string[]> {
  const html = await fetchText(baseUrl)
  const slugs = new Set<string>()
  if (html) {
    const re = /\/wp-content\/plugins\/([^/'"?\s)]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      const slug = m[1].trim()
      if (slug && slug !== "index.php") slugs.add(slug)
    }
  }
  return Array.from(slugs).sort()
}

/** Installed version from a plugin's public readme.txt `Stable tag:`. */
async function readInstalledVersion(
  baseUrl: string,
  slug: string,
): Promise<string | null> {
  const readme = await fetchText(
    `${normalizeBase(baseUrl)}/wp-content/plugins/${slug}/readme.txt`,
  )
  if (!readme) return null
  const m = readme.match(/Stable tag:\s*([0-9][0-9A-Za-z.\-]*)/i)
  return m ? m[1].trim() : null
}

/** Latest version from the public WordPress.org plugin registry. */
async function readLatestVersion(slug: string): Promise<string | null> {
  const json = await fetchText(
    `https://api.wordpress.org/plugins/info/1.0/${slug}.json`,
  )
  if (!json) return null
  try {
    const data = JSON.parse(json)
    if (data && typeof data.version === "string") return data.version
  } catch {
    /* not in registry (premium / custom) */
  }
  return null
}

/**
 * =========================================================================
 * CHECK: Verify total number of plugins (plugin_number)
 * Credential-free — derives the plugin set from front-end asset paths.
 * =========================================================================
 */
export async function checkPluginCount(
  url: string,
  _runId?: string,
  _pageId?: string,
  _sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  try {
    if (onProgress) await onProgress(20, "Scanning front-end for plugin assets...")
    const slugs = await discoverPluginSlugs(url)
    if (onProgress) await onProgress(90, "Counting plugins...")

    const list = slugs.length
      ? slugs.map((s) => `• ${s}`).join("\n")
      : "(none detected from front-end assets)"

    return [
      {
        check_factor: "plugin_number",
        title: `Detected ${slugs.length} plugin${slugs.length === 1 ? "" : "s"} (front-end)`,
        description:
          "Plugin set derived credential-free from `/wp-content/plugins/<slug>/` asset references on the live site. " +
          "Verify the count matches the expected set for a released G99 site (no leftover/dev plugins). " +
          "Note: front-end scanning only sees plugins that emit assets on the homepage, so this is a lower bound.",
        context_text: `URL: ${url}\nDetected plugins (${slugs.length}):\n${list}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } catch (e: any) {
    return [
      {
        check_factor: "plugin_number",
        title: "Plugin Count Check Failed",
        description: `The check encountered an unexpected error: ${e?.message || e}.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}

/**
 * =========================================================================
 * CHECK: Verify ALL plug-ins are updated (verify_plugin_updates)
 * Credential-free rewrite — compares readme.txt Stable tag vs the public
 * api.wordpress.org registry. No wp-admin login.
 * =========================================================================
 */
export async function checkPluginUpdatesCredentialFree(
  url: string,
  _runId?: string,
  _pageId?: string,
  _sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  try {
    if (onProgress) await onProgress(15, "Discovering installed plugins...")
    const slugs = (await discoverPluginSlugs(url)).filter(
      (s) => !IGNORED_PLUGIN_SLUGS.has(s),
    )

    const outdated: string[] = []
    const indeterminate: string[] = []
    const upToDate: string[] = []

    // Two levels of parallelism, both safe: the site's readme.txt and the
    // wp.org registry are different hosts and independent of each other, and
    // one slug's result never affects another's. A typical G99 site carries
    // 20-40 plugins, so the old strictly-serial version issued 40-80
    // back-to-back requests with 15 s timeouts.
    //
    // Concurrency stays modest — this shares a 2 vCPU / 4 GB box with the API
    // and up to WORKER_CONCURRENCY other jobs.
    const limit = pLimit(PLUGIN_CHECK_CONCURRENCY)
    let done = 0

    const results = await Promise.all(
      slugs.map((slug) =>
        limit(async () => {
          const [installed, latest] = await Promise.all([
            readInstalledVersion(url, slug),
            readLatestVersion(slug),
          ])
          done++
          if (onProgress)
            await onProgress(
              15 + Math.round((done / Math.max(slugs.length, 1)) * 75),
              `Checking ${slug}...`,
            )
          return { slug, installed, latest }
        }),
      ),
    )

    // Classified in slug order so the report reads the same as before.
    for (const { slug, installed, latest } of results) {
      if (!installed || !latest) {
        // Premium / custom plugin, or no public record → cannot assert.
        indeterminate.push(
          `${slug} (installed: ${installed || "unknown"}, registry: ${latest || "no record"})`,
        )
        continue
      }
      if (compareVersions(installed, latest) < 0) {
        outdated.push(`${slug}: ${installed} → ${latest}`)
      } else {
        upToDate.push(`${slug}: ${installed}`)
      }
    }

    if (onProgress) await onProgress(95, "Summarizing plugin update status...")

    const hasProblems = outdated.length > 0
    const parts: string[] = []
    if (outdated.length)
      parts.push(`Outdated (${outdated.length}):\n${outdated.map((s) => `• ${s}`).join("\n")}`)
    if (indeterminate.length)
      parts.push(
        `Indeterminate — premium/no public record (${indeterminate.length}):\n${indeterminate.map((s) => `• ${s}`).join("\n")}`,
      )
    if (upToDate.length)
      parts.push(`Up to date (${upToDate.length}):\n${upToDate.map((s) => `• ${s}`).join("\n")}`)
    if (!parts.length) parts.push("No public plugins detected from front-end assets.")

    return [
      {
        check_factor: "verify_plugin_updates",
        title: hasProblems
          ? `${outdated.length} plugin${outdated.length === 1 ? "" : "s"} out of date`
          : indeterminate.length
            ? `Plugins current; ${indeterminate.length} indeterminate`
            : "All detected plugins up to date",
        description:
          "Compared each plugin's readme.txt `Stable tag:` against api.wordpress.org (credential-free, no wp-admin login). " +
          "Indeterminate plugins are premium/custom with no public version record, so the scan could not auto-confirm them — they are NOT counted as passing.",
        context_text: `URL: ${url}\n\n${parts.join("\n\n")}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } catch (e: any) {
    return [
      {
        check_factor: "verify_plugin_updates",
        title: "Verify Plugin Updates Check Failed",
        description: `The check encountered an unexpected error: ${e?.message || e}.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}

/** Canonical hostname for comparison: lower-cased, `www.` stripped. */
function canonicalHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

/**
 * =========================================================================
 * CHECK: Cross-verify the live site link / domain (live_site_link)
 * -------------------------------------------------------------------------
 * Primary assertion: the URL released in the TED `release.security` task
 * matches the canonical site URL from the HubSpot client notes (both resolved
 * via TED at webhook time). Also confirms the released site resolves over a
 * valid HTTPS cert and is NOT still on a *.gogroth.com staging host.
 *
 * `notesUrl`    — canonical domain from HubSpot client notes (via TED)
 * `releasedUrl` — URL released in the release.security task (via TED)
 * `fallbackUrl` — crawl URL, only used for the health probe if neither resolves
 * =========================================================================
 */
export async function checkLiveSiteLink(
  urls: {
    notesUrl?: string | null
    releasedUrl?: string | null
    fallbackUrl?: string | null
  },
  _runId?: string,
  _pageId?: string,
  _sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { notesUrl, releasedUrl, fallbackUrl } = urls
  try {
    if (onProgress) await onProgress(20, "Comparing released URL vs client notes...")

    const issues: string[] = []

    // 1. PRIMARY: released URL (release.security) must match the client-notes URL.
    if (!notesUrl) {
      issues.push(
        "Could not resolve the canonical site URL from the HubSpot client notes (via TED). Cannot confirm the released domain is correct.",
      )
    }
    if (!releasedUrl) {
      issues.push(
        "Could not resolve the released URL from the TED `release.security` task. Cannot confirm the site went live on the correct domain.",
      )
    }
    if (notesUrl && releasedUrl) {
      const notesHost = canonicalHost(notesUrl)
      const releasedHost = canonicalHost(releasedUrl)
      if (!notesHost || !releasedHost) {
        issues.push(
          `Could not parse one of the URLs (notes: ${notesUrl}, released: ${releasedUrl}).`,
        )
      } else if (notesHost !== releasedHost) {
        issues.push(
          `Released domain \`${releasedHost}\` does NOT match the client-notes domain \`${notesHost}\`. The site may have gone live on the wrong URL.`,
        )
      }
    }

    // 2. Health of the actual live URL (released preferred, then notes, then crawl).
    const target = releasedUrl || notesUrl || fallbackUrl || ""
    let hostname = ""
    let protocol = ""
    if (target) {
      try {
        const u = new URL(target)
        hostname = u.hostname.toLowerCase()
        protocol = u.protocol
      } catch {
        issues.push(`Could not parse the target URL: ${target}`)
      }
    }

    // Staging-host leak — the released site must not live on gogroth.
    if (hostname && /(^|\.)gogroth\.com$/i.test(hostname)) {
      issues.push(
        `Site is still on a staging host (\`${hostname}\`). The released site must resolve to its final client domain, not \`*.gogroth.com\`.`,
      )
    }
    // HTTPS enforced.
    if (hostname && protocol && protocol !== "https:") {
      issues.push(`Site is served over \`${protocol}\` — expected HTTPS.`)
    }

    // Resolve + reachable over HTTPS with a valid cert.
    let reachable = false
    let statusInfo = ""
    if (hostname) {
      if (onProgress) await onProgress(60, "Probing live URL over HTTPS...")
      let pathname = "/"
      try {
        pathname = new URL(target).pathname
      } catch {
        /* keep default */
      }
      const httpsUrl = `https://${hostname}${pathname}`
      try {
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 15000)
        const res = await fetch(httpsUrl, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": "QACC-PostRelease/1.0" },
        })
        clearTimeout(t)
        reachable = true
        statusInfo = `HTTP ${res.status}`
        const finalHost = new URL(res.url).hostname.toLowerCase()
        if (finalHost !== hostname) {
          statusInfo += ` (redirected to ${finalHost})`
          if (/(^|\.)gogroth\.com$/i.test(finalHost)) {
            issues.push(
              `Final URL after redirects lands on a staging host (\`${finalHost}\`).`,
            )
          }
        }
        if (!res.ok) {
          issues.push(`Live URL returned ${res.status} — page not served cleanly.`)
        }
      } catch (e: any) {
        // fetch rejects on DNS failure, connection refused, or an invalid/expired
        // TLS certificate — all of which mean the live link is not healthy.
        issues.push(
          `Could not reach the site over HTTPS (DNS, connection, or TLS certificate failure): ${e?.message || e}`,
        )
      }
    }

    if (onProgress) await onProgress(95, "Finalizing verdict...")

    const ok = issues.length === 0
    return [
      {
        check_factor: "live_site_link",
        title: ok
          ? `Released domain matches client notes (${hostname})`
          : "Live site link issues",
        description:
          "Confirms the URL released in the TED `release.security` task matches the canonical site URL from the HubSpot client notes, resolves over a valid HTTPS certificate, and is not still on a `*.gogroth.com` staging host.",
        context_text:
          `Client-notes URL (HubSpot via TED): ${notesUrl || "unresolved"}\n` +
          `Released URL (release.security via TED): ${releasedUrl || "unresolved"}\n` +
          `Probed: ${hostname ? `${protocol}//${hostname}` : "n/a"} — ${reachable ? statusInfo : "unreachable"}\n\n` +
          (ok ? "No issues detected — released domain matches and is healthy." : `Issues:\n${issues.map((s) => `• ${s}`).join("\n")}`),
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } catch (e: any) {
    return [
      {
        check_factor: "live_site_link",
        title: "Live Site Link Check Failed",
        description: `The check encountered an unexpected error: ${e?.message || e}.`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}
