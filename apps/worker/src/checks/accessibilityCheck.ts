import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"
import {
  detectUserwayInSource,
  resolveRequiredUserwayTier,
  tierForAccount,
  USERWAY_ACCOUNTS,
  type InstalledUserway,
  type UserwayTier,
} from "../lib/userway"
import { looksBlocked } from "../lib/browserContext"

/**
 * Accessibility Check — UserWay widget + HubSpot plan cross-check.
 *
 * G99 ships ADA compliance via a site-wide UserWay widget, in one of two shared
 * accounts chosen by the client's HubSpot "Accessibility Plan Add-On"
 * (`accessibility_plan_add_on`): Complete → PRO widget, Basic → FREE widget.
 *
 * This check reads which UserWay account (if any) is on the rendered site and
 * compares it to the tier the HubSpot plan requires:
 *   • correct tier installed            → PASS ("Pro"/"Basic" compliance)
 *   • installed but wrong tier / account → FAIL "plan mismatch" (fix corrects it)
 *   • not installed                      → FAIL "not installed" (fix adds it)
 *   • present but no HubSpot plan to check against → PASS with a note
 *
 * The widget is site-wide, so this runs ONCE per run (the caller invokes it on
 * the homepage only) and takes the TED client id (else the client name) for the plan lookup.
 * check_factor stays "accessibility_check".
 */

const tierLabel = (t: UserwayTier): string => (t === "pro" ? "Pro" : "Basic")

/**
 * Runtime fallback for when the HTML has no static widget.js <script>: the
 * widget was injected by a tag manager, a Shopify/Wix/Squarespace app, or an
 * inline loader (`s.setAttribute("data-account", …)`). Looks at what the
 * browser actually loaded and rendered. Polls briefly — these loaders are async.
 */
async function detectUserwayAtRuntime(page: PlaywrightPage): Promise<InstalledUserway> {
  const probe = () =>
    page
      .evaluate(() => {
        const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .map((r) => r.name)
          .filter((n) => /(^|\.)userway\.org\//i.test(n.replace(/^https?:\/\//, "")))
        const script = Array.from(document.querySelectorAll("script[src*='userway.org']")) as HTMLScriptElement[]
        const dom = !!document.querySelector(
          ".uwy, #userwayAccessibilityIcon, .userway_buttons_wrapper, [class*='userway'], [id*='userway']",
        )
        const w = window as any
        const account =
          script.map((s) => s.getAttribute("data-account") || "").find(Boolean) ||
          (w._userway_config && (w._userway_config.account || "")) ||
          resources.map((r) => (r.match(/[?&]account=([A-Za-z0-9]+)/) || [])[1] || "").find(Boolean) ||
          (Array.from(document.scripts)
            .map((s) => (s.textContent || "").match(/data-account["']?\s*,\s*["']([A-Za-z0-9]+)/))
            .find(Boolean) || [])[1] ||
          ""
        return { present: resources.length > 0 || script.length > 0 || dom || !!w.UserWay, account }
      })
      .catch(() => ({ present: false, account: "" }))
  let r = await probe()
  for (let i = 0; i < 3 && !r.present; i++) {
    await page.waitForTimeout(2000).catch(() => {})
    r = await probe()
  }
  const account = r.account || null
  return { present: r.present, account, tier: r.present ? tierForAccount(account) : null }
}

export async function checkAccessibility(
  page: PlaywrightPage,
  projectName?: string | null,
  // OPTIONAL: the real TED client id stored on the run (qa_runs.ted_client_id).
  // Preferred over the project name, which is synthetic for full scans.
  tedClientId?: string | number | null,
): Promise<Finding[]> {
  const pageUrl = page.url()
  const factor = "accessibility_check"
  try {
    // Optimization: the HTML fetch and the HubSpot tier lookup are independent
    // (resolveRequiredUserwayTier does not use `html`), so run them concurrently
    // to overlap the HubSpot round-trip with the page-content fetch. Each keeps
    // its own .catch so a failure in either still degrades gracefully exactly as
    // before (Promise.all would otherwise reject the whole thing into the outer
    // catch). Both operations are read-only.
    const [html, { tier: requiredTier, planRaw }] = await Promise.all([
      page.content().then((c) => c || "").catch(() => ""),
      resolveRequiredUserwayTier(
        tedClientId != null && String(tedClientId).trim()
          ? String(tedClientId).trim()
          : projectName,
      ).catch(() => ({
        tier: null as UserwayTier | null,
        planRaw: null as string | null,
      })),
    ])
    let installed = detectUserwayInSource(html)
    if (!installed.present || !installed.account) {
      const live = await detectUserwayAtRuntime(page)
      if (live.present && (!installed.present || live.account)) installed = live
    }

    // A bot-challenge page (Cloudflare etc.) is not the site: "not installed"
    // there would be a false failure. Short body text guards against real pages
    // that merely mention "captcha" or "access denied".
    if (!installed.present && (await looksBlocked(page))) {
      const textLen = await page
        .evaluate(() => (document.body?.innerText || "").length)
        .catch(() => 0)
      if (textLen < 3000) {
        return [
          {
            check_factor: factor,
            title: "Accessibility Check Failed",
            description:
              "Could not complete: the site served a bot-protection page to the QACC browser, so the UserWay widget could not be checked. Process aborted gracefully.",
            context_text: `URL: ${pageUrl}`,
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding,
        ]
      }
    }

    const ctxBase =
      `URL: ${pageUrl}\n` +
      `Installed: ${installed.present ? installed.tier || `unknown account (${installed.account || "?"})` : "none"}\n` +
      `HubSpot accessibility_plan_add_on: ${planRaw || "n/a"}\n` +
      `Required tier: ${requiredTier || "unknown"}`

    // --- not installed ----------------------------------------------------
    if (!installed.present) {
      const desc = requiredTier
        ? `No UserWay accessibility widget is installed on the site. The HubSpot Accessibility Plan Add-On is "${planRaw}", so the ${tierLabel(requiredTier)} UserWay widget (data-account ${USERWAY_ACCOUNTS[requiredTier]}) should be installed site-wide.`
        : `No UserWay accessibility widget is installed, and HubSpot has no Accessibility Plan Add-On for this client to say which tier to install. Confirm the plan in HubSpot.`
      return [
        {
          check_factor: factor,
          title: "Accessibility: UserWay widget not installed",
          description: desc,
          context_text: ctxBase,
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    // --- installed, and we know the required tier -------------------------
    if (requiredTier) {
      if (installed.tier === requiredTier) {
        return [
          {
            check_factor: factor,
            title: `Accessibility: UserWay compliant (${tierLabel(requiredTier)})`,
            description: `The ${tierLabel(requiredTier)} UserWay accessibility widget is installed and matches the HubSpot Accessibility Plan Add-On ("${planRaw}"). No accessibility issues found — ${tierLabel(requiredTier)} UserWay Accessibility compliance.`,
            context_text: ctxBase,
            screenshot_url: null,
            status: "open",
            ai_generated: false,
          } as Finding,
        ]
      }
      // wrong tier, or an unrecognised UserWay account → mismatch
      const have = installed.tier
        ? `the ${tierLabel(installed.tier)} UserWay widget`
        : `an unrecognised UserWay account (${installed.account || "?"})`
      return [
        {
          check_factor: factor,
          title: "Accessibility: UserWay plan mismatch",
          description: `The site has ${have}, but the HubSpot Accessibility Plan Add-On is "${planRaw}", which requires the ${tierLabel(requiredTier)} UserWay widget (data-account ${USERWAY_ACCOUNTS[requiredTier]}). Update the site to the ${tierLabel(requiredTier)} widget.`,
          context_text: ctxBase,
          screenshot_url: null,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }

    // --- installed, but no HubSpot plan to verify against -----------------
    const haveNote = installed.tier
      ? `the ${tierLabel(installed.tier)} UserWay widget`
      : `a UserWay widget on a non-G99 account (${installed.account || "?"})`
    return [
      {
        check_factor: factor,
        title: "Accessibility: UserWay present (plan unverified)",
        description: `The site has ${haveNote}, but HubSpot has no Accessibility Plan Add-On for this client, so it could not be verified against the plan. No accessibility issues found — confirm the intended tier in HubSpot.`,
        context_text: ctxBase,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  } catch (e: any) {
    return [
      {
        check_factor: factor,
        title: "Accessibility Check Failed",
        description: `The accessibility check encountered an error: ${e.message}.`,
        context_text: `URL: ${pageUrl}`,
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}
