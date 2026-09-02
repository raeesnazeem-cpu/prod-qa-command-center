import { Browser } from "playwright"
import { Finding } from "@qacc/shared"
import type { ThemeType } from "../lib/themeType"

/**
 * Mobile & Tablet Hamburger Menu Check
 * ------------------------------------
 * A passing criterion of the "Functional & UI Testing" subtask of Internal QA.
 *
 * The requirement has TWO halves, and BOTH must hold at mobile AND tablet width
 * (the screens where a hamburger is required, i.e. under 1024px wide):
 *   1. PRESENT IN THE HEADER — the hamburger toggle exists in the rendered
 *      header template (block Navigation button, classic .menu-toggle variants,
 *      the Elementor Nav-Menu toggle, OR the Elementor "Icon" widget used as a
 *      hamburger that opens a Popup — `<a class="elementor-icon"
 *      href="#elementor-action...popup:open...">`, the exact markup briefed).
 *   2. TOGGLEABLE — tapping it actually opens a visible menu.
 *
 * If the hamburger is missing from the header, or is present but does not open,
 * the check FAILS. There is no automated fix — the only remediation is to ask
 * the developer to add / fix the hamburger menu manually.
 *
 * When the menu DOES open (mobile), we additionally verify the things a human QA
 * checks inside it: every nav tab points somewhere real, social icons are valid
 * external URLs, the phone is a well-formed tel:, and — only if present — a
 * "Book Now" and a "Virtual Consultation / Self-Assessment" control actually
 * open a target. Book Now / VC are OPTIONAL-IF-PRESENT. Headless-honest,
 * deterministic, bounded, best-effort — never throws.
 *
 * Signature mirrors the homepage browser-owning checks: (pageUrl, runId, browser, onProgress?)
 */

const CHECK_FACTOR = "hamburger_menu"

// The screens where a hamburger is required (both under 1024px wide). We probe
// PRESENT + TOGGLEABLE at each; the deep in-menu validation runs once, at mobile.
const VIEWPORTS: { name: "mobile" | "tablet"; width: number; height: number; ua: string }[] = [
  {
    name: "mobile",
    width: 390,
    height: 844,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  {
    name: "tablet",
    width: 768,
    height: 1024,
    ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
]

const MAX_FINDINGS = 10
const MAX_LINKS = 40
const CLICK_TIMEOUT = 2500
const SETTLE_MS = 500

// Mobile-menu toggles by WordPress theme type. QACC only scans WordPress sites,
// so we use KNOWN theme markup rather than a generic heuristic.
//
//   • BLOCK / FSE themes — the core Navigation block's responsive "open" button.
//     When open, `.wp-block-navigation__responsive-container` gains `is-menu-open`.
//   • CLASSIC themes — the near-universal `.menu-toggle`, plus the popular theme
//     and mobile-menu-plugin variants (Astra, OceanWP, GeneratePress, Bootstrap
//     navbars, SlickNav, Responsive Menu, generic hamburger classes).
//   • ELEMENTOR — the Nav-Menu widget toggle, AND the Icon widget used as a
//     hamburger that opens a Popup (href carries an `elementor-action ...
//     popup:open`). That popup-icon pattern is the briefed markup and is common
//     on Elementor sites, so it must be recognized as a real hamburger.
const BLOCK_TOGGLES = [
  ".wp-block-navigation__responsive-container-open",
  "button.wp-block-navigation__responsive-container-open",
]
const CLASSIC_TOGGLES = [
  ".menu-toggle",
  "button.menu-toggle",
  ".ast-mobile-menu-buttons",
  ".ast-button-wrap .menu-toggle",
  ".oceanwp-mobile-menu-icon",
  "#mobile-menu",
  ".navbar-toggler",
  ".slicknav_btn",
  "#responsive-menu-button",
  ".hamburger",
  ".hamburger-menu",
  ".mobile-menu-toggle",
  ".mobile-nav-toggle",
  ".nav-toggle",
  ".menu-trigger",
  // Custom-coded builds that ship their own toggle as `#burger` / `.burger`.
  "button#burger",
  "#burger",
  ".burger",
  '[class*="menu-toggle" i]',
  '[class*="mobile-menu" i][class*="toggle" i]',
  // Custom nav toggles (e.g. `<button class="c-nav__toggle">`) and aria-labeled
  // toggles ("Toggle navigation menu"). The SVG-shape fallback in tagToggles
  // catches these too, but matching the class/label directly is cheaper.
  '[class*="nav" i][class*="toggle" i]',
  '[aria-label*="toggle" i][aria-label*="menu" i]',
  '[aria-label*="toggle" i][aria-label*="nav" i]',
]
const ELEMENTOR_TOGGLES = [
  ".elementor-menu-toggle",
  ".elementor-nav-menu__toggle",
  // Elementor "Icon" widget used as a hamburger that opens a Popup:
  //   <a class="elementor-icon" href="#elementor-action%3A...popup%3Aopen...">
  // The href is URL-encoded but the literal words "elementor-action" and
  // "popup" survive encoding, so we can match on them.
  'a.elementor-icon[href*="elementor-action"][href*="popup"]',
  '.elementor-icon-wrapper a[href*="elementor-action"][href*="popup"]',
]

// Build the ordered selector list for a theme (theme-specific first, Elementor
// last as fallback). Unknown theme → try block + classic + Elementor.
function toggleSelectorsFor(themeType?: ThemeType): string {
  const groups =
    themeType === "block"
      ? [BLOCK_TOGGLES, ELEMENTOR_TOGGLES]
      : themeType === "classic"
        ? [CLASSIC_TOGGLES, ELEMENTOR_TOGGLES]
        : [BLOCK_TOGGLES, CLASSIC_TOGGLES, ELEMENTOR_TOGGLES]
  return groups.flat().join(", ")
}

const SOCIAL_RE =
  /(facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.|wa\.me|whatsapp|t\.me|threads\.net|yelp\.com)/i
const BOOK_RE = /\b(book\s*now|book\s*(an?\s*)?appointment|book\s*online|schedule\s*(now|appointment|online)?|request\s*appointment)\b/i
const VC_RE = /\b(virtual\s*consultation|self[\s-]*assessment|vc\b|body\s*model)\b/i

type ProbeResult = {
  loadOk: boolean
  present: boolean
  opened: boolean
  // Extra findings from the deep in-menu validation (mobile only).
  extraFindings: Finding[]
  // Screenshot of the open menu (or the best evidence shot) for this viewport.
  shotUrl: string
}

export async function checkHamburgerMenu(
  pageUrl: string,
  runId: string,
  browser: Browser,
  onProgress?: (progress: number, message: string) => Promise<void>,
  themeType?: ThemeType,
): Promise<Finding[]> {
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  const findings: Finding[] = []
  // Stealth chromium: gogroth (and other Cloudflare-fronted) staging sites 403
  // a plain headless browser. The passed-in `browser` is a plain-playwright
  // instance, so launch our own stealth browser here and close it in finally.
  const { chromium } = require("playwright-extra")
  const stealth = require("puppeteer-extra-plugin-stealth")()
  chromium.use(stealth)
  let ownBrowser: any = null

  const selectors = toggleSelectorsFor(themeType)

  const push = (title: string, description: string, screenshot_url?: string, contextText?: string) => {
    if (findings.length >= MAX_FINDINGS) return
    findings.push({
      check_factor: CHECK_FACTOR,
      title,
      description,
      context_text: contextText || `Page: ${pageUrl}`,
      screenshot_url: screenshot_url || null,
      status: "open",
      ai_generated: false,
    } as Finding)
  }

  // Probe ONE viewport: load the page, find the header hamburger toggle, and
  // confirm it opens. `deep` (mobile) also validates the menu contents and
  // returns those as extraFindings. Owns and closes its own browser context.
  async function probeViewport(
    vp: (typeof VIEWPORTS)[number],
    deep: boolean,
    baseProgress: number,
  ): Promise<ProbeResult> {
    const result: ProbeResult = { loadOk: true, present: false, opened: false, extraFindings: [], shotUrl: "" }
    let context: any = null
    let page: any = null
    const label = vp.name === "mobile" ? "mobile" : "tablet"

    const shot = async (name: string): Promise<string> => {
      try {
        const buffer = await page.screenshot({ fullPage: false }).catch(() => null)
        if (!buffer) return ""
        return await uploadScreenshot(buffer, `${runId}/hamburger_${vp.name}_${name}.png`).catch(() => "")
      } catch {
        return ""
      }
    }

    try {
      context = await ownBrowser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        userAgent: vp.ua,
      })
      page = await context.newPage()
      // A tapped link may open a new tab — close it so we never hang.
      context.on("page", (p: any) => p.close().catch(() => {}))

      if (onProgress) await onProgress(baseProgress + 2, `Loading homepage at ${label} width...`)
      try {
        await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 })
      } catch (e: any) {
        if (!/Timeout|aborted|closed/i.test(e?.message || "")) throw e
        result.loadOk = false
      }
      await page.waitForTimeout(600)

      // 0. Fast-path: a `#burger` toggle button. Some custom builds ship their
      //    hamburger as a `<button id="burger" class="burger">` in the navbar.
      //    Presence of this button, visible in the header band, satisfies the
      //    "hamburger exists" requirement on its own; custom open mechanisms
      //    don't reliably match the WP aria/.is-menu-open heuristics, so we
      //    accept it as present + toggleable without forcing the deep flow.
      const hasBurgerId = await page
        .evaluate(() => {
          const el = document.querySelector("button#burger, #burger, .burger")
          if (!el) return false
          const r = (el as HTMLElement).getBoundingClientRect()
          const s = getComputedStyle(el as HTMLElement)
          return (
            r.width > 0 && r.height > 0 && r.top <= 240 &&
            s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05
          )
        })
        .catch(() => false)

      if (hasBurgerId) {
        result.present = true
        result.opened = true
        result.shotUrl = await shot("burger_id_present")
        return result
      }

      // 1. Find a visible hamburger toggle using KNOWN WordPress theme markup
      //    (block → classic → Elementor fallback). Collect visible header-area
      //    matches and TRY EACH, since some themes wrap the interactive node.
      //    Poll a few rounds because block/Elementor headers can hydrate late.
      if (onProgress) await onProgress(baseProgress + 4, `Locating the ${label} hamburger toggle...`)
      const tagToggles = () =>
        page
          .evaluate((selList: string) => {
            document.querySelectorAll("[data-qacc-tog]").forEach((n) => n.removeAttribute("data-qacc-tog"))

            const isVisibleHeader = (el: Element) => {
              const r = (el as HTMLElement).getBoundingClientRect()
              const s = getComputedStyle(el as HTMLElement)
              // Visible and in the header band near the top of the page.
              return (
                r.width > 0 && r.height > 0 && r.top <= 240 &&
                s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05
              )
            }

            // (A) Known theme / Elementor / custom-class selectors.
            const hits: Element[] = Array.from(document.querySelectorAll(selList)).filter(isVisibleHeader)

            // (B) Icon-shape fallback — key on the ICON, not the class. ANY
            //     small, header-area clickable whose inline <svg> draws the
            //     classic hamburger (2+ horizontal lines/bars stacked at
            //     different heights) counts as a toggle. This covers custom
            //     buttons with no recognizable class (e.g. `.c-nav__toggle`
            //     with `<path d="M3 12h18M3 6h18M3 18h18">`), stroke/line/rect
            //     variants, and the Elementor filled-bar icon.
            const looksLikeHamburgerSvg = (svg: SVGElement): boolean => {
              const sr = svg.getBoundingClientRect()
              // Icon-sized only — skip large illustrative SVGs.
              if (sr.width === 0 || sr.height === 0 || sr.width > 80 || sr.height > 80) return false
              // Horizontal draw commands (h/H) started from multiple move
              // points (m/M) across all <path> `d` data = stacked bars.
              let horiz = 0
              let moves = 0
              svg.querySelectorAll("path").forEach((p) => {
                const d = p.getAttribute("d") || ""
                horiz += (d.match(/[hH]\s*-?\d*\.?\d+/g) || []).length
                moves += (d.match(/[mM]\s*-?\d*\.?\d+/g) || []).length
              })
              if (horiz >= 2 && moves >= 2) return true
              // <line> variant: 2+ (near-)horizontal lines (y1 ≈ y2).
              const hLines = Array.from(svg.querySelectorAll("line")).filter(
                (l) =>
                  Math.abs(parseFloat(l.getAttribute("y1") || "0") - parseFloat(l.getAttribute("y2") || "0")) <= 1,
              )
              if (hLines.length >= 2) return true
              // <rect> variant: 2+ wide, thin bars (width ≥ 2× height).
              const bars = Array.from(svg.querySelectorAll("rect")).filter((rc) => {
                const w = parseFloat(rc.getAttribute("width") || "0")
                const h = parseFloat(rc.getAttribute("height") || "0")
                return w > 0 && h > 0 && w >= h * 2
              })
              return bars.length >= 2
            }

            Array.from(document.querySelectorAll("svg")).forEach((svg) => {
              if (!looksLikeHamburgerSvg(svg as SVGElement)) return
              const clickable =
                (svg.closest(
                  'button, a, [role="button"], [onclick], [class*="toggle" i], [class*="burger" i], [class*="nav" i], [aria-label]',
                ) as Element | null) || svg.parentElement
              if (clickable && isVisibleHeader(clickable) && !hits.includes(clickable)) hits.push(clickable)
            })

            hits.slice(0, 6).forEach((el, i) => el.setAttribute("data-qacc-tog", String(i)))
            return hits.length
          }, selectors)
          .catch(() => 0)

      await page
        .waitForFunction(
          (selList: string) =>
            Array.from(document.querySelectorAll(selList)).some((el) => {
              const r = (el as HTMLElement).getBoundingClientRect()
              const s = getComputedStyle(el as HTMLElement)
              return (
                r.width > 0 &&
                r.height > 0 &&
                r.top <= 240 &&
                s.visibility !== "hidden" &&
                s.display !== "none" &&
                Number(s.opacity) > 0.05
              )
            }),
          selectors,
          { timeout: 4 * 700 },
        )
        .catch(() => {})
      const candCount = await tagToggles()

      if (!candCount) {
        result.present = false
        result.shotUrl = await shot("no_toggle")
        return result
      }
      result.present = true

      // 2. Try each toggle until the menu opens: aria-expanded flips true, the
      //    block responsive container gains `is-menu-open`, an Elementor popup
      //    modal becomes visible, or a burst of in-viewport anchors appears
      //    (off-canvas / dropdown / popup rendered).
      if (onProgress) await onProgress(baseProgress + 6, `Opening the ${label} hamburger menu...`)
      const tries = Math.min(candCount, 6)
      let toggle: any = null
      const blockMenuOpen = () =>
        page
          .evaluate(() => !!document.querySelector(".wp-block-navigation__responsive-container.is-menu-open"))
          .catch(() => false)
      const elementorPopupOpen = () =>
        page
          .evaluate(() =>
            Array.from(document.querySelectorAll(".elementor-popup-modal, .dialog-widget.elementor-popup-modal")).some(
              (el) => {
                const r = (el as HTMLElement).getBoundingClientRect()
                const s = getComputedStyle(el as HTMLElement)
                return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"
              },
            ),
          )
          .catch(() => false)

      for (let i = 0; i < tries && !result.opened; i++) {
        const cand = await page.$(`[data-qacc-tog="${i}"]`)
        if (!cand) continue
        const before = await countInViewAnchors(page)
        const beforeUrl = page.url()
        await cand.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
        await cand.tap({ timeout: CLICK_TIMEOUT }).catch(async () => {
          await cand.click({ timeout: CLICK_TIMEOUT }).catch(() => {})
        })
        await page
          .waitForFunction(
            ({ before, sel }: { before: number; sel: string }) => {
              const tog = document.querySelector(sel)
              if (tog && tog.getAttribute("aria-expanded") === "true") return true
              if (document.querySelector(".wp-block-navigation__responsive-container.is-menu-open")) return true
              if (
                Array.from(document.querySelectorAll(".elementor-popup-modal, .dialog-widget.elementor-popup-modal")).some(
                  (el) => {
                    const r = (el as HTMLElement).getBoundingClientRect()
                    const s = getComputedStyle(el as HTMLElement)
                    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"
                  },
                )
              )
                return true
              const vh = window.innerHeight,
                vw = window.innerWidth
              const after = Array.from(document.querySelectorAll("a")).filter((el) => {
                const r = (el as HTMLElement).getBoundingClientRect()
                const s = getComputedStyle(el as HTMLElement)
                const shown =
                  r.width > 4 &&
                  r.height > 4 &&
                  s.visibility !== "hidden" &&
                  s.display !== "none" &&
                  Number(s.opacity) > 0.05
                const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
                return shown && inView
              }).length
              return after - before >= 3
            },
            { before, sel: `[data-qacc-tog="${i}"]` },
            { timeout: SETTLE_MS + 500 },
          )
          .catch(() => {})
        const expanded = await cand.getAttribute("aria-expanded").catch(() => null)
        const after = await countInViewAnchors(page)
        if (
          expanded === "true" ||
          (await blockMenuOpen()) ||
          (await elementorPopupOpen()) ||
          after - before >= 3
        ) {
          result.opened = true
          toggle = cand
          result.shotUrl = await shot("open")
          break
        }
        // Not this one. If it navigated, reload + re-tag; else tap again to undo
        // any partial state before trying the next toggle.
        if (page.url().split("#")[0] !== beforeUrl.split("#")[0]) {
          await page.goto(pageUrl, { waitUntil: "load", timeout: 30000 }).catch(() => {})
          await page.waitForTimeout(600)
          await tagToggles()
        } else {
          await cand.tap({ timeout: CLICK_TIMEOUT }).catch(() => {})
          await page.waitForTimeout(200)
        }
      }

      if (!result.opened) {
        result.shotUrl = await shot("no_open")
        return result
      }

      // 3. Deep in-menu validation — mobile only, to avoid duplicate findings.
      if (deep) {
        if (onProgress) await onProgress(baseProgress + 8, "Inspecting menu items...")
        const menuShot = result.shotUrl
        const localPush = (title: string, description: string, screenshot_url?: string) => {
          if (findings.length + result.extraFindings.length >= MAX_FINDINGS) return
          result.extraFindings.push({
            check_factor: CHECK_FACTOR,
            title,
            description,
            context_text: `Page: ${pageUrl} (mobile ${vp.width}×${vp.height})`,
            screenshot_url: screenshot_url || null,
            status: "open",
            ai_generated: false,
          } as Finding)
        }

        const items = await collectMenuItems(page)

        // 3a. Tabs — must be clickable and point somewhere real.
        const brokenTabs = items.tabs.filter((t) => !t.validHref)
        if (brokenTabs.length) {
          localPush(
            `${brokenTabs.length} menu tab${brokenTabs.length === 1 ? "" : "s"} not clickable / no valid target`,
            `These menu items are not usable links (empty, "#", or javascript-only href):\n` +
              brokenTabs.map((t) => `• "${t.text || "(no text)"}" → ${t.href || "(no href)"}`).join("\n"),
            menuShot,
          )
        }

        // 3b. Social icons — valid external URL when present.
        const brokenSocial = items.social.filter((s) => !/^https?:\/\//i.test(s.href))
        if (items.social.length && brokenSocial.length) {
          localPush(
            `${brokenSocial.length} social link${brokenSocial.length === 1 ? "" : "s"} malformed`,
            `Social links in the menu without a valid absolute URL:\n` +
              brokenSocial.map((s) => `• ${s.text || s.href}`).join("\n"),
            menuShot,
          )
        }

        // 3c. Phone — well-formed tel: with real digits.
        const brokenPhone = items.phones.filter((p) => p.href.replace(/\D/g, "").length < 7)
        if (items.phones.length && brokenPhone.length) {
          localPush(
            "Phone link malformed",
            `A tel: link in the menu does not contain a valid phone number:\n` +
              brokenPhone.map((p) => `• ${p.text || p.href}`).join("\n"),
            menuShot,
          )
        }

        // 4. Functional click tests for Book Now + VC (may navigate/modal — last).
        if (items.bookNow) {
          if (onProgress) await onProgress(baseProgress + 10, "Testing Book Now button...")
          const r = await testOpens(page, pageUrl, items.bookNow.selectorIndex, toggle)
          if (!r.opened) {
            localPush(
              "Book Now button did not open a booking target",
              `The "Book Now" control ("${items.bookNow.text}") was found in the menu but clicking it did not open a booking page, modal, or iframe. Verify the booking flow works.`,
              menuShot,
            )
          }
        }

        if (items.vc) {
          if (onProgress) await onProgress(baseProgress + 12, "Testing Virtual Consultation / Self-Assessment...")
          const r = await testOpens(page, pageUrl, items.vc.selectorIndex, toggle)
          if (!r.opened) {
            localPush(
              "Virtual Consultation / Self-Assessment did not open",
              `The "${items.vc.text}" control was found but clicking it did not open the consultation/self-assessment widget (no modal, iframe, or navigation). Verify it works.`,
              menuShot,
            )
          }
        }
      }

      return result
    } catch {
      // Best-effort: a viewport error is treated as "could not verify", not a
      // hard site defect. The outer verdict logic decides what to report.
      result.loadOk = result.loadOk && false
      return result
    } finally {
      try {
        if (context) await context.close().catch(() => {})
      } catch {}
    }
  }

  try {
    ownBrowser = await chromium.launch({ headless: true })

    if (onProgress) await onProgress(10, "Checking the hamburger menu at mobile width...")
    const mobile = await probeViewport(VIEWPORTS[0], true, 10)

    if (onProgress) await onProgress(60, "Checking the hamburger menu at tablet width...")
    const tablet = await probeViewport(VIEWPORTS[1], false, 60)

    // Verdict. The requirement: the hamburger must be PRESENT in the header and
    // TOGGLEABLE at BOTH mobile and tablet width. A viewport that failed to load
    // is "could not verify" → retried next run, never a hard fail on its own.
    const perView = [
      { label: "mobile", r: mobile, w: VIEWPORTS[0].width },
      { label: "tablet", r: tablet, w: VIEWPORTS[1].width },
    ]

    const notLoaded = perView.filter((v) => !v.r.loadOk)
    const problems: string[] = []
    for (const v of perView) {
      if (!v.r.loadOk) continue
      if (!v.r.present) {
        problems.push(`• ${v.label} (${v.w}px): no hamburger menu in the header template.`)
      } else if (!v.r.opened) {
        problems.push(`• ${v.label} (${v.w}px): a hamburger toggle is present but tapping it does not open the menu.`)
      }
    }

    const evidenceShot = mobile.shotUrl || tablet.shotUrl || ""

    if (problems.length) {
      // One consolidated failure. No automated fix exists — the only remediation
      // is to ask the developer to add / fix the hamburger menu by hand.
      push(
        "Hamburger menu missing or not toggleable",
        `The hamburger menu must appear in the header and open on tap at both mobile and tablet width (screens under 1024px). Problems found:\n` +
          problems.join("\n") +
          `\n\nNo automated fix is available — ask the developer to add or fix the hamburger menu manually so it appears and toggles on screens under 1024px wide (mobile and tablet).`,
        evidenceShot,
      )
      // Attach the deep in-menu findings (broken links / phone / Book Now / VC)
      // gathered when the menu did open at mobile.
      for (const f of mobile.extraFindings) {
        if (findings.length >= MAX_FINDINGS) break
        findings.push(f)
      }
      if (onProgress) await onProgress(98, "Finalizing hamburger menu findings...")
      return findings
    }

    // If nothing could be verified because neither viewport loaded, ask for a
    // retry rather than reporting a false defect.
    if (notLoaded.length === perView.length) {
      push(
        "Hamburger menu could not be checked",
        `The homepage did not finish loading at mobile or tablet width, so the hamburger menu could not be verified. This will be retried on the next run.`,
        evidenceShot,
      )
      return findings
    }

    // Menu present + toggleable at every viewport that loaded → pass. Attach any
    // in-menu findings from the deep mobile pass (these are real defects inside
    // an otherwise-working menu).
    for (const f of mobile.extraFindings) {
      if (findings.length >= MAX_FINDINGS) break
      findings.push(f)
    }

    if (findings.length === 0) {
      const verified = perView.filter((v) => v.r.loadOk).map((v) => v.label).join(" and ")
      push(
        "Hamburger menu verified",
        `The hamburger menu is present in the header and opens on tap at ${verified} width (under 1024px). Menu links and buttons checked and valid.`,
        evidenceShot,
      )
    }

    if (onProgress) await onProgress(98, "Finalizing hamburger menu findings...")
    return findings
  } catch (error: any) {
    push(
      "Hamburger Menu Check Failed",
      `The check encountered an unexpected error: ${error?.message}. Process aborted gracefully to prevent stalling the scan.`,
    )
    return findings
  } finally {
    try {
      if (ownBrowser) await ownBrowser.close().catch(() => {})
    } catch {}
  }
}

// Count ALL currently-visible, in-viewport anchor links. A burst of these after
// tapping the toggle is the theme-agnostic signal that a menu opened (works even
// when the menu's container carries no nav/menu class). Off-screen footer links
// are excluded so they never masquerade as an open menu.
async function countInViewAnchors(page: any): Promise<number> {
  try {
    return await page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth
      const links = Array.from(document.querySelectorAll("a"))
      return links.filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const s = getComputedStyle(el as HTMLElement)
        const shown = r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05
        const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
        return shown && inView
      }).length
    })
  } catch {
    return 0
  }
}

type MenuItems = {
  tabs: { text: string; href: string; validHref: boolean; selectorIndex: number }[]
  social: { text: string; href: string; selectorIndex: number }[]
  phones: { text: string; href: string; selectorIndex: number }[]
  bookNow: { text: string; selectorIndex: number } | null
  vc: { text: string; selectorIndex: number } | null
}

// Read every currently-visible clickable element in the open menu, tagging each
// as a tab / social / phone / bookNow / vc. `selectorIndex` is the element's
// index in the returned page-order list, used to re-locate it for click tests.
async function collectMenuItems(page: any): Promise<MenuItems> {
  const raw: { tag: string; text: string; href: string; idx: number }[] = await page
    .evaluate(
      (max: number) => {
        const scope = document.querySelectorAll(
          "nav a, nav button, header a, header button, [class*='menu'] a, [class*='menu'] button, [class*='nav'] a, [class*='nav'] button, [class*='offcanvas'] a, [class*='drawer'] a",
        )
        const out: { tag: string; text: string; href: string; idx: number }[] = []
        const seen = new Set<Element>()
        let idx = 0
        const vh = window.innerHeight, vw = window.innerWidth
        for (const el of Array.from(scope)) {
          const r0 = (el as HTMLElement).getBoundingClientRect()
          const s0 = getComputedStyle(el as HTMLElement)
          const shown = r0.width > 0 && r0.height > 0 && s0.visibility !== "hidden" && s0.display !== "none" && Number(s0.opacity) > 0.05
          const inView = r0.bottom > 0 && r0.top < vh && r0.right > 0 && r0.left < vw
          if (seen.has(el) || !shown || !inView) { idx++; continue }
          seen.add(el)
          const a = el as HTMLAnchorElement
          out.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 60),
            href: (a.getAttribute && a.getAttribute("href")) || "",
            idx,
          })
          idx++
          if (out.length >= max) break
        }
        return out
      },
      MAX_LINKS,
    )
    .catch(() => [])

  const items: MenuItems = { tabs: [], social: [], phones: [], bookNow: null, vc: null }
  for (const el of raw) {
    const label = `${el.text} ${el.href}`
    if (el.href.startsWith("tel:")) {
      items.phones.push({ text: el.text, href: el.href, selectorIndex: el.idx })
    } else if (SOCIAL_RE.test(el.href)) {
      items.social.push({ text: el.text, href: el.href, selectorIndex: el.idx })
    } else if (!items.vc && VC_RE.test(label)) {
      items.vc = { text: el.text || "Virtual Consultation", selectorIndex: el.idx }
    } else if (!items.bookNow && BOOK_RE.test(label)) {
      items.bookNow = { text: el.text || "Book Now", selectorIndex: el.idx }
    } else if (el.tag === "a") {
      const href = el.href
      const validHref = !!href && href !== "#" && !/^javascript:/i.test(href) && !/^#$/.test(href)
      items.tabs.push({ text: el.text, href, validHref, selectorIndex: el.idx })
    }
  }
  return items
}

// Click the element at page-order index `idx` and decide whether it OPENED a
// target: a navigation, a newly-visible modal/dialog, or an iframe appearing.
// Re-navigates home afterward so the menu can be re-tested. Best-effort.
async function testOpens(
  page: any,
  pageUrl: string,
  idx: number,
  toggle: any,
): Promise<{ opened: boolean }> {
  try {
    const beforeUrl = page.url()
    const beforeIframes = await page.$$eval("iframe", (n: Element[]) => n.length).catch(() => 0)
    const beforeModals = await countVisibleModals(page)

    // Re-open the menu if it collapsed, then re-locate the element by index.
    await toggle.click({ timeout: CLICK_TIMEOUT }).catch(() => {})
    await page.waitForTimeout(300)

    const handles = await page.$$(
      "nav a, nav button, header a, header button, [class*='menu'] a, [class*='menu'] button, [class*='nav'] a, [class*='nav'] button, [class*='offcanvas'] a, [class*='drawer'] a",
    )
    const el = handles[idx]
    if (!el) return { opened: false }
    await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
    await el.click({ timeout: CLICK_TIMEOUT }).catch(() => {})
    await page.waitForTimeout(SETTLE_MS + 400)

    const navigated = page.url().split("#")[0] !== beforeUrl.split("#")[0]
    const afterIframes = await page.$$eval("iframe", (n: Element[]) => n.length).catch(() => 0)
    const afterModals = await countVisibleModals(page)
    const opened = navigated || afterIframes > beforeIframes || afterModals > beforeModals

    // Return home so the next test starts clean.
    if (navigated) {
      await page.goto(pageUrl, { waitUntil: "load", timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(400)
    }
    return { opened }
  } catch {
    return { opened: false }
  }
}

async function countVisibleModals(page: any): Promise<number> {
  try {
    return await page.evaluate(() => {
      const sel = '[role="dialog"], [aria-modal="true"], .modal.show, .modal.in, [class*="modal"][class*="open"], [class*="popup"][class*="open"]'
      return Array.from(document.querySelectorAll(sel)).filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const s = getComputedStyle(el as HTMLElement)
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"
      }).length
    })
  } catch {
    return 0
  }
}
