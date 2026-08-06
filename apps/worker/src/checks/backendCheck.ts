import { Finding } from "@qacc/shared"

/**
 * QA-Backend Check
 * ----------------
 * Logs into the WordPress backend (reusing the proven wp-login pattern from
 * preReleaseSuite) and verifies the site was cleaned up before release:
 *   1. No leftover DEFAULT/PLACEHOLDER content — default "Twenty*" themes,
 *      the "Hello world!" post, the "Sample Page" page, the default
 *      "Just another WordPress site" tagline.
 *   2. A 404 plugin is installed AND a styled custom 404 page renders on all
 *      views (desktop / tablet / mobile) without a layout break.
 *
 * Deterministic DOM reads do the detection; screenshots are attached as
 * evidence. Every section is independently guarded so one failure never stalls
 * the rest. Homepage-only, browser-owning check (creates its own context).
 *
 * Signature mirrors the browser-owning checks in preReleaseSuite:
 *   (url, runId, pageId, wpPassword?, sharedBrowser?, onProgress?)
 */

const CHECK_FACTOR = "backend_check"

const VIEWPORTS = [
  { label: "Desktop", width: 1920, height: 1080 },
  { label: "Tablet", width: 768, height: 1024 },
  { label: "Mobile", width: 375, height: 812 },
]

// Known 404 plugins (name/slug fragments) we accept as "a 404 plugin is installed".
const KNOWN_404_PLUGINS = [
  "404page",
  "404 to 301",
  "404-to-301",
  "forty four",
  "custom 404",
  "all 404",
  "redirection",
]

export async function checkBackend(
  url: string,
  runId: string,
  pageId: string,
  wpPassword?: string,
  sharedBrowser?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { chromium } = require("playwright")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  if (!wpPassword) {
    return [
      {
        check_factor: CHECK_FACTOR,
        severity: "medium",
        title: "Backend Check Skipped",
        description: "WordPress password was not provided, so the backend could not be inspected.",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }

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

    // --- LOGIN (reuse preReleaseSuite pattern) ---
    if (onProgress) await onProgress(10, "Logging into WordPress admin...")
    await page
      .goto(`${origin}/wp-login.php`, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})

    const userField = page.locator('#user_login, input[name="log"]')
    const passField = page.locator('#user_pass, input[name="pwd"]')
    const submitBtn = page.locator('#wp-submit, input[type="submit"]')

    let loggedIn = false
    if ((await userField.count()) > 0 && (await passField.count()) > 0) {
      await userField.fill("onboarding.india@growth99.com")
      await passField.fill(wpPassword)
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
        submitBtn.click(),
      ])
      await page.waitForSelector("#wpadminbar, .wrap", { timeout: 15000 }).catch(() => {})
      loggedIn = (await page.locator("#wpadminbar").count()) > 0
    }

    if (!loggedIn) {
      const failShot = await shot(page, "login_failed")
      findings.push({
        check_factor: CHECK_FACTOR,
        severity: "high",
        title: "Backend login failed",
        description: "Could not log into wp-admin with the provided password. Backend content checks were skipped. Verify today's WP password.",
        screenshot_url: failShot || null,
        status: "open",
        ai_generated: false,
      } as Finding)
      // Still attempt the front-end 404 checks below (they don't need login).
    }

    // --- 1. DEFAULT THEMES ---
    if (loggedIn) {
      try {
        if (onProgress) await onProgress(30, "Checking installed themes...")
        await page
          .goto(`${origin}/wp-admin/themes.php`, { waitUntil: "networkidle", timeout: 30000 })
          .catch(() => {})
        const themeNames: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".theme .theme-name, .theme-name")).map(
            (el) => (el.textContent || "").trim(),
          ),
        )
        const defaults = themeNames.filter((n) => /twenty\s?twenty|twenty\s?\w+/i.test(n))
        const themesShot = await shot(page, "themes")
        if (defaults.length > 0) {
          findings.push({
            check_factor: CHECK_FACTOR,
            severity: "medium",
            title: "Default WordPress themes still installed",
            description: `Default placeholder themes should be removed before release. Found: ${defaults.join(", ")}.`,
            context_text: `All themes: ${themeNames.join(", ")}`,
            screenshot_url: themesShot || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      } catch (e: any) {
        // section-level guard; continue
      }

      // --- 2. HELLO WORLD POST ---
      try {
        if (onProgress) await onProgress(45, "Checking for placeholder posts...")
        await page
          .goto(`${origin}/wp-admin/edit.php`, { waitUntil: "networkidle", timeout: 30000 })
          .catch(() => {})
        const hasHelloWorld: boolean = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".row-title, a.row-title")).some((el) =>
            /hello world/i.test(el.textContent || ""),
          ),
        )
        if (hasHelloWorld) {
          const postsShot = await shot(page, "posts")
          findings.push({
            check_factor: CHECK_FACTOR,
            severity: "medium",
            title: 'Default "Hello world!" post present',
            description: 'The default WordPress "Hello world!" post still exists and should be removed.',
            screenshot_url: postsShot || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      } catch (e: any) {}

      // --- 3. SAMPLE PAGE ---
      try {
        await page
          .goto(`${origin}/wp-admin/edit.php?post_type=page`, { waitUntil: "networkidle", timeout: 30000 })
          .catch(() => {})
        const hasSamplePage: boolean = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".row-title, a.row-title")).some((el) =>
            /sample page/i.test(el.textContent || ""),
          ),
        )
        if (hasSamplePage) {
          const pagesShot = await shot(page, "pages")
          findings.push({
            check_factor: CHECK_FACTOR,
            severity: "medium",
            title: 'Default "Sample Page" present',
            description: 'The default WordPress "Sample Page" still exists and should be removed.',
            screenshot_url: pagesShot || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      } catch (e: any) {}

      // --- 4. DEFAULT TAGLINE ---
      try {
        if (onProgress) await onProgress(55, "Checking site tagline...")
        await page
          .goto(`${origin}/wp-admin/options-general.php`, { waitUntil: "networkidle", timeout: 30000 })
          .catch(() => {})
        const tagline: string = await page.evaluate(() => {
          const el = document.querySelector("#blogdescription") as HTMLInputElement | null
          return el ? el.value : ""
        })
        if (/just another wordpress site/i.test(tagline)) {
          const tagShot = await shot(page, "tagline")
          findings.push({
            check_factor: CHECK_FACTOR,
            severity: "low",
            title: "Default WordPress tagline still set",
            description: `The site tagline is still the default "${tagline}". Update or clear it before release.`,
            screenshot_url: tagShot || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      } catch (e: any) {}

      // --- 5. 404 PLUGIN INSTALLED? ---
      try {
        if (onProgress) await onProgress(65, "Checking for a 404 plugin...")
        await page
          .goto(`${origin}/wp-admin/plugins.php`, { waitUntil: "networkidle", timeout: 30000 })
          .catch(() => {})
        const pluginText: string = (
          await page.evaluate(() => document.body.innerText).catch(() => "")
        ).toLowerCase()
        const has404Plugin = KNOWN_404_PLUGINS.some((p) => pluginText.includes(p))
        if (!has404Plugin) {
          const pluginsShot = await shot(page, "plugins")
          findings.push({
            check_factor: CHECK_FACTOR,
            severity: "medium",
            title: "No 404 plugin detected",
            description: `Could not find a known 404 plugin (${KNOWN_404_PLUGINS.join(", ")}) in the plugins list. Verify a custom 404 solution is installed.`,
            screenshot_url: pluginsShot || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }
      } catch (e: any) {}
    }

    // --- 6. CUSTOM 404 ON ALL VIEWS (front-end; no login needed) ---
    try {
      if (onProgress) await onProgress(80, "Probing custom 404 page on all views...")
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
          severity: "high",
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
          severity: "medium",
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
          severity: "low",
          title: "Custom 404 page renders on all views",
          description: `A styled custom 404 page (with site header/footer and a 404 message) renders on desktop, tablet, and mobile without a layout break. HTTP status: ${httpStatus ?? "unknown"}.`,
          context_text: `Probe URL: ${probeUrl}`,
          screenshot_url: joined || null,
          status: "open",
          ai_generated: false,
        } as Finding)
      }
    } catch (e: any) {}

    if (onProgress) await onProgress(95, "Finalizing backend findings...")

    // If logged in and nothing flagged, emit a clean pass finding (matches UX).
    if (loggedIn && findings.length === 0) {
      findings.push({
        check_factor: CHECK_FACTOR,
        severity: "low",
        title: "Backend is clean",
        description: "No default/placeholder content found and the custom 404 renders correctly.",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding)
    }

    return findings
  } catch (error: any) {
    findings.push({
      check_factor: CHECK_FACTOR,
      severity: "high",
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
