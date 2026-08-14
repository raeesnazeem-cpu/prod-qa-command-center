import { Browser } from "playwright"
import { Finding } from "@qacc/shared"
import type { ThemeType } from "../lib/themeType"

/**
 * Mobile Hamburger Menu Check (homepage, mobile viewport)
 * -------------------------------------------------------
 * A passing criterion of the "Functional & UI Testing" subtask of Internal QA.
 * At a mobile viewport it opens the hamburger menu and verifies the things a
 * human QA checks inside it:
 *   1. the menu actually opens,
 *   2. every nav tab is clickable and points somewhere real,
 *   3. social icons (if present) link to valid external URLs,
 *   4. the phone number (if present) is a well-formed tel: link,
 *   5. a "Book Now" button (if present) is clickable and opens a target,
 *   6. a "Virtual Consultation" / "Self-Assessment" button (if present) opens.
 *
 * Book Now / VC / Self-Assessment are OPTIONAL-IF-PRESENT: reported only when
 * found, exactly as briefed. Headless-honest: we validate tel:/href correctness
 * (site-wide reachability is the dead_links check's job) and, for Book Now / VC,
 * assert the control OPENS a target (nav / modal / iframe) — not an end-to-end
 * booking. Deterministic, bounded, best-effort — never throws.
 *
 * Signature mirrors the homepage browser-owning checks: (pageUrl, runId, browser, onProgress?)
 */

const CHECK_FACTOR = "hamburger_menu"

const MOBILE = { width: 390, height: 844 }
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
//   • ELEMENTOR — fallback for the Nav Menu widget toggle.
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
  '[class*="menu-toggle" i]',
  '[class*="mobile-menu" i][class*="toggle" i]',
]
const ELEMENTOR_TOGGLES = [".elementor-menu-toggle", ".elementor-nav-menu__toggle"]

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

export async function checkHamburgerMenu(
  pageUrl: string,
  runId: string,
  browser: Browser,
  onProgress?: (progress: number, message: string) => Promise<void>,
  themeType?: ThemeType,
): Promise<Finding[]> {
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  const findings: Finding[] = []
  let context: any = null
  let page: any = null

  const push = (title: string, description: string, screenshot_url?: string) => {
    if (findings.length >= MAX_FINDINGS) return
    findings.push({
      check_factor: CHECK_FACTOR,
      title,
      description,
      context_text: `Page: ${pageUrl} (mobile ${MOBILE.width}×${MOBILE.height})`,
      screenshot_url: screenshot_url || null,
      status: "open",
      ai_generated: false,
    } as Finding)
  }

  const shot = async (name: string): Promise<string> => {
    try {
      const buffer = await page.screenshot({ fullPage: false }).catch(() => null)
      if (!buffer) return ""
      return await uploadScreenshot(buffer, `${runId}/hamburger_${name}.png`).catch(() => "")
    } catch {
      return ""
    }
  }

  try {
    context = await browser.newContext({
      viewport: MOBILE,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    })
    page = await context.newPage()
    // A tapped link may open a new tab — close it so we never hang.
    context.on("page", (p: any) => p.close().catch(() => {}))

    if (onProgress) await onProgress(10, "Loading homepage at mobile width...")
    let loadOk = true
    try {
      await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 })
    } catch (e: any) {
      if (!/Timeout|aborted|closed/i.test(e?.message || "")) throw e
      loadOk = false
    }
    await page.waitForTimeout(600)

    // 1. Find a visible hamburger toggle. Explicit WP/Elementor selectors first,
    // then a theme-agnostic heuristic: a small, icon-only, clickable element
    // hugging a top corner of the header (covers custom / React / Next sites
    // whose toggle carries none of the usual classes). The winner is tagged in
    // the DOM so we can grab it as a handle.
    if (onProgress) await onProgress(25, "Locating the hamburger toggle...")
    // Find the mobile toggle using KNOWN WordPress theme markup (block →
    // classic → Elementor fallback). We collect the visible header-area matches
    // and TRY EACH, since some themes wrap the interactive node. Poll a few
    // rounds because block/Elementor headers can hydrate the toggle late.
    const selectors = toggleSelectorsFor(themeType)
    const tagToggles = () =>
      page
        .evaluate((selList: string) => {
          document.querySelectorAll("[data-qacc-tog]").forEach((n) => n.removeAttribute("data-qacc-tog"))
          const hits = Array.from(document.querySelectorAll(selList)).filter((el) => {
            const r = (el as HTMLElement).getBoundingClientRect()
            const s = getComputedStyle(el as HTMLElement)
            // Visible and in the header band near the top of the page.
            return (
              r.width > 0 && r.height > 0 && r.top <= 240 &&
              s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05
            )
          })
          hits.slice(0, 6).forEach((el, i) => el.setAttribute("data-qacc-tog", String(i)))
          return hits.length
        }, selectors)
        .catch(() => 0)

    let candCount = 0
    for (let attempt = 0; attempt < 4 && candCount === 0; attempt++) {
      candCount = await tagToggles()
      if (!candCount) await page.waitForTimeout(700)
    }

    if (!candCount) {
      const s = await shot("no_toggle")
      push(
        "No hamburger menu found at mobile width",
        loadOk
          ? `No mobile menu toggle was found at ${MOBILE.width}px for a ${themeType || "WordPress"} theme (looked for block Navigation, classic .menu-toggle variants, and Elementor). Pre-release requires a hamburger menu below 1024px — verify the mobile navigation exists.`
          : `The homepage did not finish loading, so the mobile menu could not be checked. QACC will retry on the next run.`,
        s,
      )
      return findings
    }

    // 2. Try each toggle until the menu opens: aria-expanded flips true, the
    //    block responsive container gains `is-menu-open`, or a burst of
    //    in-viewport anchors appears (off-canvas / dropdown rendered).
    if (onProgress) await onProgress(40, "Opening the hamburger menu...")
    const tries = Math.min(candCount, 6)
    let opened = false
    let toggle: any = null
    let menuShot = ""
    const blockMenuOpen = () =>
      page
        .evaluate(() => !!document.querySelector(".wp-block-navigation__responsive-container.is-menu-open"))
        .catch(() => false)
    for (let i = 0; i < tries && !opened; i++) {
      const cand = await page.$(`[data-qacc-tog="${i}"]`)
      if (!cand) continue
      const before = await countInViewAnchors(page)
      const beforeUrl = page.url()
      await cand.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
      await cand.tap({ timeout: CLICK_TIMEOUT }).catch(async () => {
        await cand.click({ timeout: CLICK_TIMEOUT }).catch(() => {})
      })
      await page.waitForTimeout(SETTLE_MS + 500)
      const expanded = await cand.getAttribute("aria-expanded").catch(() => null)
      const after = await countInViewAnchors(page)
      if (expanded === "true" || (await blockMenuOpen()) || after - before >= 3) {
        opened = true
        toggle = cand
        menuShot = await shot("open")
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

    if (!opened) {
      const s = await shot("no_open")
      push(
        "Hamburger menu did not open",
        `A mobile menu toggle was found, but tapping it (tried ${tries} control${tries === 1 ? "" : "s"}) did not open a visible menu. Verify the mobile menu opens on tap.`,
        s,
      )
      return findings
    }

    // 3. Enumerate what's inside the open menu (non-destructive first).
    if (onProgress) await onProgress(60, "Inspecting menu items...")
    const items = await collectMenuItems(page)

    // 3a. Tabs — must be clickable and point somewhere real.
    const brokenTabs = items.tabs.filter((t) => !t.validHref)
    if (brokenTabs.length) {
      push(
        `${brokenTabs.length} menu tab${brokenTabs.length === 1 ? "" : "s"} not clickable / no valid target`,
        `These menu items are not usable links (empty, "#", or javascript-only href):\n` +
          brokenTabs.map((t) => `• "${t.text || "(no text)"}" → ${t.href || "(no href)"}`).join("\n"),
        menuShot,
      )
    }

    // 3b. Social icons — valid external URL when present.
    const brokenSocial = items.social.filter((s) => !/^https?:\/\//i.test(s.href))
    if (items.social.length && brokenSocial.length) {
      push(
        `${brokenSocial.length} social link${brokenSocial.length === 1 ? "" : "s"} malformed`,
        `Social links in the menu without a valid absolute URL:\n` +
          brokenSocial.map((s) => `• ${s.text || s.href}`).join("\n"),
        menuShot,
      )
    }

    // 3c. Phone — well-formed tel: with real digits.
    const brokenPhone = items.phones.filter((p) => (p.href.replace(/\D/g, "").length < 7))
    if (items.phones.length && brokenPhone.length) {
      push(
        "Phone link malformed",
        `A tel: link in the menu does not contain a valid phone number:\n` +
          brokenPhone.map((p) => `• ${p.text || p.href}`).join("\n"),
        menuShot,
      )
    }

    // 4. Functional click tests for Book Now + VC (may navigate/modal — done last).
    let bookNowResult: string | null = null
    let vcResult: string | null = null

    if (items.bookNow) {
      if (onProgress) await onProgress(78, "Testing Book Now button...")
      const r = await testOpens(page, pageUrl, items.bookNow.selectorIndex, toggle)
      if (r.opened) bookNowResult = "opens correctly"
      else {
        bookNowResult = "did NOT open a target"
        push(
          "Book Now button did not open a booking target",
          `The "Book Now" control ("${items.bookNow.text}") was found in the menu but clicking it did not open a booking page, modal, or iframe. Verify the booking flow works.`,
          menuShot,
        )
      }
    }

    if (items.vc) {
      if (onProgress) await onProgress(88, "Testing Virtual Consultation / Self-Assessment...")
      const r = await testOpens(page, pageUrl, items.vc.selectorIndex, toggle)
      if (r.opened) vcResult = "opens correctly"
      else {
        vcResult = "did NOT open"
        push(
          "Virtual Consultation / Self-Assessment did not open",
          `The "${items.vc.text}" control was found but clicking it did not open the consultation/self-assessment widget (no modal, iframe, or navigation). Verify it works.`,
          menuShot,
        )
      }
    }

    // 5. Positive summary when nothing broke.
    if (findings.length === 0) {
      const parts: string[] = [
        `Menu opened on tap.`,
        `${items.tabs.length} tab${items.tabs.length === 1 ? "" : "s"} clickable with valid targets.`,
      ]
      if (items.social.length) parts.push(`${items.social.length} social link(s) valid.`)
      if (items.phones.length) parts.push(`Phone link valid.`)
      if (items.bookNow) parts.push(`Book Now ${bookNowResult}.`)
      if (items.vc) parts.push(`Virtual Consultation / Self-Assessment ${vcResult}.`)
      push("Hamburger menu verified", parts.join(" "), menuShot)
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
      if (context) await context.close().catch(() => {})
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
