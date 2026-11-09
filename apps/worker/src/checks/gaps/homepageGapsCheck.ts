import { Browser } from "playwright"
import { Finding } from "@qacc/shared"
import { realContextOptions, gotoResilient, looksBlocked, DESKTOP_UA, MOBILE_UA } from "../../lib/browserContext"
import { gapFinding, lapseFinding } from "./findings"
import { checkCartFlow, CART_FLOW_KEY } from "./cartFlowCheck"

/**
 * QA-gap checks that only make sense once per site — run on the homepage.
 *
 *   header_breakpoints  header at 1024–1470px: menu wrapping, overlapping the logo, desktop menu and hamburger both showing
 *   menu_parity         hamburger menu vs desktop menu (items, names, order, links); footer tabs vs header tabs
 *   cta_wording         booking button wording in the header vs hamburger menu vs floating single script
 *   widget_style        floating widget colours vs the site's brand (button) colours
 *   page_404            a missing URL: real 404 status, search bar, Home button
 *   safari_check        the homepage in WebKit (Safari's engine): favicon, hero video, layout, script errors
 */

export const HOMEPAGE_KEYS = ["header_breakpoints", "menu_parity", "cta_wording", "widget_style", "page_404", "safari_check", "cart_add_to_cart"]

const WIDTHS = [
  { width: 1470, height: 900 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1200, height: 800 },
  { width: 1130, height: 800 },
  { width: 1024, height: 768 },
]

/** Runs in the page. Self-contained. */
export function readHeader(): { found: boolean; problems: string[] } {
  const clean = (s: any) => String(s || "").replace(/\s+/g, " ").trim()
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0" }
  const hs = Array.from(document.querySelectorAll('header, [data-elementor-type="header"], #masthead, .site-header')).filter(vis)
  const header = hs.find((h) => !hs.some((o) => o !== h && o.contains(h)))
  if (!header) return { found: false, problems: [] }
  const problems: string[] = []
  const nav =
    Array.from(header.querySelectorAll("nav, .main-navigation, .elementor-nav-menu--main")).find((n) => vis(n) && !n.matches(".elementor-nav-menu--dropdown") && n.querySelector("a")) ||
    // No <nav>: the header <ul> with the most visible links.
    Array.from(header.querySelectorAll("ul"))
      .filter((u) => !u.parentElement?.closest("ul") && Array.from(u.children).filter((li) => li.tagName === "LI" && vis(li)).length >= 2)
      .sort((a, b) => b.children.length - a.children.length)[0]?.parentElement
  const topItems = nav ? (Array.from(nav.querySelectorAll(":scope ul > li > a, :scope > ul > li > a")) as HTMLElement[]).filter((a) => vis(a) && !a.closest("ul ul")) : []
  if (topItems.length >= 2) {
    const tops = topItems.map((a) => Math.round(a.getBoundingClientRect().top))
    if (Math.max(...tops) - Math.min(...tops) > 8) problems.push(`menu items wrap onto a second line ("${clean(topItems[tops.indexOf(Math.max(...tops))].textContent)}" drops down)`)
    for (let i = 0; i < topItems.length; i++) for (let j = i + 1; j < topItems.length; j++) {
      const a = topItems[i].getBoundingClientRect(), b = topItems[j].getBoundingClientRect()
      if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) { problems.push(`menu items "${clean(topItems[i].textContent)}" and "${clean(topItems[j].textContent)}" overlap`); i = topItems.length; break }
    }
    const logo = header.querySelector('.custom-logo, img[class*=logo i], img[src*=logo i], img[alt*=logo i]')
    const others = [logo, ...Array.from(header.querySelectorAll("a.elementor-button, .wp-block-button__link, a.btn, a[class*=button]"))].filter((e): e is Element => !!e && vis(e) && !nav!.contains(e))
    for (const o of others) {
      const r = o.getBoundingClientRect()
      const hit = topItems.find((a) => { const x = a.getBoundingClientRect(); return x.left < r.right - 2 && r.left < x.right - 2 && x.top < r.bottom - 2 && r.top < x.bottom - 2 })
      if (hit) { problems.push(`menu item "${clean(hit.textContent)}" overlaps the ${o === logo ? "logo" : `"${clean(o.textContent)}" button`}`); break }
    }
  }
  const toggle = Array.from(header.querySelectorAll('.elementor-menu-toggle, .menu-toggle, .wp-block-navigation__responsive-container-open, [class*=hamburger], button[aria-label*=menu i], .elementor-icon[href*="popup"]')).find(vis)
  if (toggle && topItems.length >= 2) problems.push("the desktop menu and the hamburger icon show at the same time")
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 2) {
    const wide = Array.from(header.querySelectorAll("*")).find((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 2)
    if (wide) problems.push(`the header is wider than the screen (${clean((wide as HTMLElement).innerText).slice(0, 30) || wide.tagName.toLowerCase()} sticks out)`)
  }
  return { found: true, problems }
}

/** Runs in the page. Self-contained. */
export function readMenusAndWidgets(): {
  desktop: { text: string; href: string; depth: number }[]
  mobile: { text: string; href: string; depth: number }[] | null
  footer: { text: string; href: string }[]
  headerCta: string[]
  mobileCta: string[]
  floatingCta: string[]
  brand: string[]
  widgets: { name: string; color: string }[]
} {
  const clean = (s: any) => String(s || "").replace(/\s+/g, " ").trim()
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0" }
  const HEADER_SEL = 'header, [data-elementor-type="header"], #masthead, .site-header'
  const FOOTER_SEL = 'footer, [data-elementor-type="footer"], #colophon, .site-footer'
  const items = (root: Element | null, onlyVisibleTop: boolean) => {
    if (!root) return [] as { text: string; href: string; depth: number }[]
    const out: { text: string; href: string; depth: number }[] = []
    const walk = (ul: Element, depth: number) => {
      for (const li of Array.from(ul.children)) {
        if (li.tagName !== "LI") continue
        const a = li.querySelector(":scope > a, :scope > div > a, :scope > span > a") as HTMLAnchorElement | null
        if (!a) continue
        if (onlyVisibleTop && depth === 0 && !vis(a)) continue
        const text = clean(a.textContent)
        if (text) out.push({ text, href: a.getAttribute("href") ? a.href.replace(/[#?].*$/, "").replace(/\/+$/, "") : "", depth })
        const sub = li.querySelector(":scope > ul, :scope > div > ul")
        if (sub && depth < 1) walk(sub, depth + 1)
      }
    }
    const ul = root.querySelector("ul")
    if (ul) walk(ul, 0)
    return out.slice(0, 100)
  }
  const navs = Array.from(document.querySelectorAll(`${HEADER_SEL.split(",").map((s) => s + " nav").join(",")}, nav.elementor-nav-menu--main, .main-navigation`))
  const headerUlFallback = (): Element | null => {
    const h = document.querySelector(HEADER_SEL)
    if (!h) return null
    const uls = Array.from(h.querySelectorAll("ul")).filter((u) => !u.parentElement?.closest("ul") && Array.from(u.children).filter((li) => li.tagName === "LI" && li.querySelector("a") && vis(li)).length >= 2)
    uls.sort((a, b) => b.children.length - a.children.length)
    return uls[0]?.parentElement || null
  }
  const desktopNav = navs.find((n) => vis(n) && !n.matches(".elementor-nav-menu--dropdown") && n.querySelector("a")) || headerUlFallback()
  const mobileRoot = document.querySelector("nav.elementor-nav-menu--dropdown, #mobile-menu, .mobile-menu, .mobile-navigation, .jet-mobile-menu, .mm-menu, .wp-block-navigation__responsive-container, .elementor-location-popup nav")
  const footerRoot = document.querySelector(`${FOOTER_SEL.split(",").map((s) => s + " nav").join(",")}, ${FOOTER_SEL.split(",").map((s) => s + " .menu").join(",")}`)
  const BOOK = /\b(book|schedule|appointment|reserve|consult)/i
  const header = document.querySelector(HEADER_SEL)
  const headerCta = header ? (Array.from(header.querySelectorAll("a")) as HTMLElement[]).filter((a) => vis(a) && BOOK.test(a.innerText) && clean(a.innerText).length < 40).map((a) => clean(a.innerText)) : []
  const mobileCta = mobileRoot ? (Array.from(mobileRoot.querySelectorAll("a")) as HTMLElement[]).filter((a) => BOOK.test(a.textContent || "") && clean(a.textContent).length < 40).map((a) => clean(a.textContent)) : []
  const fixed = Array.from(document.querySelectorAll("body *")).filter((e) => getComputedStyle(e).position === "fixed" && vis(e) && !e.closest(HEADER_SEL))
  const floatingCta = fixed.flatMap((e) => (Array.from(e.querySelectorAll("a, button")) as HTMLElement[]).concat(e.matches("a,button") ? [e as HTMLElement] : []))
    .filter((a) => vis(a) && BOOK.test(a.innerText || a.getAttribute("aria-label") || "") && clean(a.innerText).length < 40).map((a) => clean(a.innerText || a.getAttribute("aria-label")))
  const solid = (c: string) => { const v = (c.match(/[\d.]+/g) || []).map(Number); return v.length >= 3 && (v.length < 4 || v[3] > 0.8) ? `rgb(${v[0]},${v[1]},${v[2]})` : "" }
  const counts = new Map<string, number>()
  for (const b of Array.from(document.querySelectorAll("a.elementor-button, .wp-block-button__link, a.btn, button[type=submit], a[class*=button]")).filter((b) => vis(b) && getComputedStyle(b).position !== "fixed").slice(0, 80)) {
    const c = solid(getComputedStyle(b).backgroundColor)
    if (c) counts.set(c, (counts.get(c) || 0) + 1)
  }
  for (const h of Array.from(document.querySelectorAll("h1,h2,h3, a")).slice(0, 200)) { const c = solid(getComputedStyle(h).color); if (c) counts.set(c, (counts.get(c) || 0) + 0.2) }
  const brand = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0])
  const outer = fixed.filter((e) => !fixed.some((o) => o !== e && o.contains(e)))
  const widgets: { name: string; color: string }[] = []
  for (const w of outer.slice(0, 10)) {
    const r = w.getBoundingClientRect()
    if (r.width < 24 || r.height < 24 || r.width > innerWidth * 0.6) continue
    const cand = [w, ...Array.from(w.querySelectorAll("*")).slice(0, 30)].map((e) => solid(getComputedStyle(e).backgroundColor)).find(Boolean)
    if (!cand) continue
    const id = `${w.id} ${w.getAttribute("class") || ""}`.toLowerCase()
    const name = /userway|accessib/.test(id) ? "ADA button" : /callnow|call-now/.test(id) ? "Call button" : /chat|cliff/.test(id) ? "Chatbot / cliffhanger" : clean((w as HTMLElement).innerText).slice(0, 24) || "floating widget"
    widgets.push({ name, color: cand })
  }
  return { desktop: items(desktopNav, true), mobile: mobileRoot && mobileRoot !== desktopNav ? items(mobileRoot, false) : null, footer: items(footerRoot, true).filter((i) => i.depth === 0), headerCta, mobileCta, floatingCta, brand, widgets }
}

/** Runs in the 404 page. Self-contained. */
export function read404(): { search: boolean; home: boolean; text: string } {
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" }
  const inChrome = (e: Element) => !!e.closest('header, footer, [data-elementor-type="header"], [data-elementor-type="footer"], nav')
  const search = Array.from(document.querySelectorAll('input[type=search], input[name=s], form[role=search] input, .search-form input')).some((e) => vis(e) && !inChrome(e))
  const root = location.origin.replace(/\/+$/, "")
  const home = (Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]).some((a) => vis(a) && !inChrome(a) && (a.href.replace(/[#?].*$/, "").replace(/\/+$/, "") === root || /\b(home|homepage|back to home|go home)\b/i.test(a.innerText || "")))
  return { search, home, text: (document.body?.innerText || "").slice(0, 300) }
}

// ------------------------------------------------------------- pure helpers
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "")

/** Differences between the desktop and hamburger menus. Pure — unit-tested. */
export function menuParityProblems(
  desktop: { text: string; href: string; depth: number }[],
  mobile: { text: string; href: string; depth: number }[] | null,
  footer: { text: string; href: string }[],
): string[] {
  const out: string[] = []
  const BOOK = /\b(book|schedule|appointment|reserve|consult)/i
  if (mobile && mobile.length && desktop.length) {
    const dTop = desktop.filter((i) => i.depth === 0 && !BOOK.test(i.text))
    const mTop = mobile.filter((i) => i.depth === 0 && !BOOK.test(i.text))
    const dNames = new Set(desktop.map((i) => norm(i.text)))
    const mNames = new Set(mobile.map((i) => norm(i.text)))
    const missing = desktop.filter((i) => !mNames.has(norm(i.text)) && !BOOK.test(i.text)).map((i) => i.text)
    const extra = mobile.filter((i) => !dNames.has(norm(i.text)) && !BOOK.test(i.text)).map((i) => i.text)
    // Same link, different name.
    const byHref = new Map(desktop.filter((i) => i.href).map((i) => [i.href, i.text]))
    const renamed = mobile.filter((i) => i.href && byHref.has(i.href) && norm(byHref.get(i.href)!) !== norm(i.text)).map((i) => `"${byHref.get(i.href)}" on desktop is "${i.text}" in the hamburger menu`)
    const renamedTexts = new Set(renamed.length ? mobile.filter((i) => i.href && byHref.has(i.href)).map((i) => i.text) : [])
    const realMissing = missing.filter((t) => !desktop.some((d) => d.text === t && d.href && mobile.some((m) => m.href === d.href)))
    const realExtra = extra.filter((t) => !renamedTexts.has(t))
    if (realMissing.length) out.push(`Missing from the hamburger menu: ${realMissing.slice(0, 10).join(", ")}`)
    if (realExtra.length) out.push(`Only in the hamburger menu (not on desktop): ${realExtra.slice(0, 10).join(", ")}`)
    out.push(...renamed.slice(0, 6))
    const common = dTop.map((i) => norm(i.text)).filter((n) => mTop.some((m) => norm(m.text) === n))
    const mOrder = mTop.map((i) => norm(i.text)).filter((n) => common.includes(n))
    if (common.length >= 3 && common.join("|") !== mOrder.join("|"))
      out.push(`Hamburger menu order differs — desktop: ${dTop.filter((i) => common.includes(norm(i.text))).map((i) => i.text).join(" › ")}; hamburger: ${mTop.filter((i) => common.includes(norm(i.text))).map((i) => i.text).join(" › ")}`)
    const dHref = new Map(desktop.filter((i) => i.href).map((i) => [norm(i.text), i.href]))
    for (const m of mobile) {
      const h = dHref.get(norm(m.text))
      if (h && m.href && h !== m.href && out.length < 14) out.push(`"${m.text}" links to ${m.href} in the hamburger menu but ${h} on desktop`)
    }
  }
  if (footer.length >= 3 && desktop.length) {
    const dTop = desktop.filter((i) => i.depth === 0)
    const common = footer.map((i) => norm(i.text)).filter((n) => dTop.some((d) => norm(d.text) === n))
    const hOrder = dTop.map((i) => norm(i.text)).filter((n) => common.includes(n))
    if (common.length >= 3 && common.join("|") !== hOrder.join("|"))
      out.push(`Footer tabs are in a different order than the header — header: ${dTop.filter((i) => common.includes(norm(i.text))).map((i) => i.text).join(" › ")}; footer: ${footer.filter((i) => common.includes(norm(i.text))).map((i) => i.text).join(" › ")}`)
    const hByHref = new Map(dTop.filter((i) => i.href).map((i) => [i.href, i.text]))
    for (const fi of footer) {
      const h = hByHref.get(fi.href)
      if (h && norm(h) !== norm(fi.text) && out.length < 16) out.push(`Footer tab "${fi.text}" is "${h}" in the header`)
    }
  }
  return out
}

const rgbOf = (c: string) => (c.match(/\d+/g) || []).map(Number)
const isNeutral = (c: number[]) => Math.max(...c) - Math.min(...c) < 18
const dist = (a: number[], b: number[]) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)

/** Widgets whose colour matches none of the brand colours. Pure — unit-tested. */
export function offBrandWidgets(brand: string[], widgets: { name: string; color: string }[]): string[] {
  const b = brand.map(rgbOf).filter((c) => c.length >= 3 && !isNeutral(c))
  if (b.length === 0) return []
  return widgets
    .filter((w) => { const c = rgbOf(w.color); return c.length >= 3 && !isNeutral(c) && !b.some((x) => dist(x, c) < 70) })
    .map((w) => `${w.name} is ${w.color}, which matches none of the site's brand colours (${brand.filter((x) => !isNeutral(rgbOf(x))).slice(0, 3).join(", ")})`)
}

export async function checkHomepageGaps(
  pageUrl: string,
  runId: string,
  browser: Browser,
  enabled: Set<string>,
  opts: { runType?: string; isWoo?: boolean } = {},
): Promise<Finding[]> {
  const keys = HOMEPAGE_KEYS.filter((k) => enabled.has(k))
  if (keys.length === 0) return []
  const f: Finding[] = []
  const add = (key: string, title: string, items: string[], extra = "") => {
    const uniq = [...new Set(items)]
    if (enabled.has(key) && uniq.length) f.push(gapFinding(key, title, uniq.slice(0, 14), pageUrl, extra))
  }

  // ---- Chromium: header widths, menus, CTA wording, widget colours, 404
  const chromeKeys = keys.filter((k) => k !== "safari_check" && k !== CART_FLOW_KEY)
  if (chromeKeys.length) {
    let context: any = null
    try {
      context = await browser.newContext(realContextOptions({ viewport: { width: 1440, height: 900 } }))
      const page = await context.newPage()
      const nav = await gotoResilient(page, pageUrl, { timeout: 45000 })
      if (!nav.ok || (await looksBlocked(page))) {
        for (const k of chromeKeys) f.push(lapseFinding(k, nav.ok ? "the site blocked the QACC browser (bot protection)" : `the homepage could not be loaded (${String(nav.error || "").split("\n")[0]})`, pageUrl))
      } else {
        // Floating widgets (single script, chatbot) load late.
        await page.waitForTimeout(5000)
        if (enabled.has("menu_parity") || enabled.has("cta_wording") || enabled.has("widget_style")) {
          const m = await page.evaluate(readMenusAndWidgets)
          if (enabled.has("menu_parity")) add("menu_parity", "Hamburger or footer menu differs from the desktop menu", menuParityProblems(m.desktop, m.mobile, m.footer))
          if (enabled.has("cta_wording")) {
            const all = [...new Set([...m.headerCta, ...m.mobileCta, ...m.floatingCta].map((s) => s.trim()).filter(Boolean))]
            const byNorm = new Set(all.map(norm))
            if (byNorm.size > 1) {
              const parts = [
                m.headerCta.length ? `header: "${[...new Set(m.headerCta)].join('", "')}"` : "",
                m.mobileCta.length ? `hamburger menu: "${[...new Set(m.mobileCta)].join('", "')}"` : "",
                m.floatingCta.length ? `floating single script / widgets: "${[...new Set(m.floatingCta)].join('", "')}"` : "",
              ].filter(Boolean)
              add("cta_wording", "Booking button wording differs", [`The booking button says different things — ${parts.join("; ")}`])
            }
          }
          if (enabled.has("widget_style")) add("widget_style", "Widget colours don't match the theme", offBrandWidgets(m.brand, m.widgets))
        }
        if (enabled.has("header_breakpoints")) {
          const problems: string[] = []
          for (const w of WIDTHS) {
            await page.setViewportSize(w)
            await page.waitForTimeout(500)
            const h = await page.evaluate(readHeader).catch(() => ({ found: false, problems: [] as string[] }))
            for (const p of h.problems) problems.push(`At ${w.width}×${w.height}: ${p}`)
          }
          add("header_breakpoints", "Header breaks at laptop / tablet widths", problems, `Checked widths: ${WIDTHS.map((w) => w.width).join(", ")}px.`)
          await page.setViewportSize({ width: 1440, height: 900 })
        }
        if (enabled.has("page_404")) {
          const u = new URL(pageUrl)
          const missing = `${u.origin}/qacc-missing-page-${Date.now().toString(36)}/`
          const r = await gotoResilient(page, missing, { timeout: 30000 })
          if (!r.ok) f.push(lapseFinding("page_404", `the 404 test URL could not be loaded (${String(r.error || "").split("\n")[0]})`, missing))
          else {
            const p = await page.evaluate(read404)
            const items: string[] = []
            if (r.status === 200) items.push(`A missing URL returns status 200 instead of 404 (soft 404): ${missing}`)
            else if (r.status && r.status >= 300 && r.status < 400) items.push(`A missing URL redirects instead of showing a 404 page`)
            if (!p.search) items.push("The 404 page has no search bar")
            if (!p.home) items.push("The 404 page has no Home button / link")
            add("page_404", "404 page incomplete", items, `Tested with ${missing}`)
          }
        }
      }
    } catch (e: any) {
      for (const k of chromeKeys) if (!f.some((x) => x.check_factor === k)) f.push(lapseFinding(k, `the homepage could not be checked (${String(e?.message || e).split("\n")[0].slice(0, 120)})`, pageUrl))
    } finally {
      await context?.close().catch(() => {})
    }
  }

  // ---- Add to Cart at phone size (test phase only; guest cart, no checkout)
  if (enabled.has(CART_FLOW_KEY)) f.push(...(await checkCartFlow(pageUrl, browser, opts)))

  // ---- WebKit (Safari's engine)
  if (enabled.has("safari_check")) f.push(...(await checkSafari(pageUrl)))
  return f
}

async function checkSafari(pageUrl: string): Promise<Finding[]> {
  let wk: any = null
  try {
    const { webkit } = require("playwright")
    wk = await webkit.launch({ headless: true })
  } catch (e: any) {
    return [lapseFinding("safari_check", `the Safari (WebKit) engine is not available on this server (${String(e?.message || e).split("\n")[0].slice(0, 100)})`, pageUrl)]
  }
  const items: string[] = []
  try {
    for (const view of [
      { name: "Safari desktop", viewport: { width: 1440, height: 900 }, userAgent: DESKTOP_UA.replace(/Chrome\/[\d.]+ /, "Version/17.0 "), isMobile: false },
      { name: "Safari iPhone", viewport: { width: 390, height: 844 }, userAgent: MOBILE_UA, isMobile: true },
    ]) {
      const ctx = await wk.newContext({ viewport: view.viewport, userAgent: view.userAgent, isMobile: view.isMobile, hasTouch: view.isMobile, ignoreHTTPSErrors: true, locale: "en-US" })
      const page = await ctx.newPage()
      const errors: string[] = []
      page.on("pageerror", (e: any) => { if (errors.length < 5) errors.push(String(e?.message || e).split("\n")[0].slice(0, 120)) })
      try {
        const nav = await gotoResilient(page, pageUrl, { timeout: 45000 })
        if (!nav.ok) { items.push(`${view.name}: the homepage did not load (${String(nav.error || "").split("\n")[0].slice(0, 80)})`); continue }
        if (await looksBlocked(page)) { items.push(`${view.name}: the site blocked the Safari test browser`); continue }
        await page.waitForTimeout(6000)
        const r = await page.evaluate(async () => {
          const out: string[] = []
          const icons = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]')) as HTMLLinkElement[]
          if (!icons.length) out.push("no favicon link in the page")
          else if (icons.every((l) => /svg/i.test(l.type || l.href))) out.push("the only favicon is an SVG, which Safari does not show in tabs — add a PNG/ICO favicon")
          if (!document.querySelector('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')) out.push("no apple-touch-icon (iPhone/iPad home-screen and tab icon)")
          for (const v of Array.from(document.querySelectorAll("video")).slice(0, 4) as HTMLVideoElement[]) {
            const r = v.getBoundingClientRect()
            if (r.width < 200 || r.top > innerHeight * 1.5) continue
            if (v.error) out.push(`the hero video fails to load (media error ${v.error.code})`)
            else if (v.readyState < 2) out.push("the hero video has not loaded after 6 seconds")
            else if (v.autoplay && v.paused) out.push("the hero video is set to autoplay but is not playing")
            if (v.autoplay && (!v.muted || !v.hasAttribute("playsinline"))) out.push("the autoplay hero video is missing muted / playsinline, so it will not autoplay on iPhone")
          }
          const de = document.documentElement
          if (de.scrollWidth > de.clientWidth + 2) out.push(`the page is ${de.scrollWidth - de.clientWidth}px wider than the screen (horizontal scroll)`)
          return out
        })
        for (const p of r) items.push(`${view.name}: ${p}`)
        for (const e of errors) items.push(`${view.name}: script error — ${e}`)
      } finally {
        await ctx.close().catch(() => {})
      }
    }
  } catch (e: any) {
    return [lapseFinding("safari_check", `the Safari test failed (${String(e?.message || e).split("\n")[0].slice(0, 100)})`, pageUrl)]
  } finally {
    await wk?.close().catch(() => {})
  }
  const uniq = [...new Set(items)]
  // The favicon notes repeat for both views — keep one.
  const dedup = uniq.filter((s, i) => !/favicon|apple-touch/.test(s) || uniq.findIndex((o) => o.split(": ").slice(1).join(": ") === s.split(": ").slice(1).join(": ")) === i)
  return dedup.length ? [gapFinding("safari_check", "Problems in Safari", dedup.slice(0, 14), pageUrl, "Tested in WebKit (Safari's engine) at desktop and iPhone sizes.")] : []
}
