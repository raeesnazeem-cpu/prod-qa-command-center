import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"
import { PageFacts, putFacts, imageKey } from "./factsStore"
import { gapFinding, lapseFinding } from "./findings"

/**
 * QA-gap page checks — ONE read of the crawled page (desktop width), every page.
 *
 * Runs on the crawl's shared page (serial shared-page lane), read-only: a single
 * page.evaluate plus one per form iframe. It answers the per-page gap checks
 * (wrong tab, clickable contact details, empty links, ™/®, duplicates, text
 * styling, form consent/fields, page errors, active menu item, blog links/TOC,
 * outdated offers, social links, stretched/broken images, footer copyright)
 * and stores the page's facts for the run-end cross-page checks.
 *
 * Every check writes rows only for real problems; a check with no row at the
 * end of a completed run passed (shared verdict rule). A page that cannot be
 * read gets a "Check Failed" row per enabled check, never a silent pass.
 */

// Brand names that carry a ™ or ® symbol. Matched as whole words,
// case-insensitive. Kept to names that are unambiguous in med-spa copy.
export const TRADEMARK_BRANDS = [
  "Botox", "Dysport", "Xeomin", "Jeuveau", "Daxxify", "Juvederm", "Juvéderm", "Restylane", "Radiesse",
  "Sculptra", "Kybella", "CoolSculpting", "Emsculpt", "Emsella", "Emface", "Morpheus8", "HydraFacial",
  "Ultherapy", "Thermage", "SkinPen", "Fraxel", "Vivace", "Profhilo", "Latisse", "SkinMedica", "Obagi",
  "DiamondGlow", "PicoSure", "Sofwave", "Exion", "Emtone", "truSculpt", "CoolPeel", "Lumecca", "Votiva",
  "Fractora", "AquaGold", "Clear + Brilliant", "Clear and Brilliant", "Secret RF", "Opus Plasma",
  "Belotero", "RHA Collection", "ZO Skin Health", "Halo", "Moxi",
]

export interface PageGapRaw {
  blocked: boolean
  readyState: string
  facts: Omit<PageFacts, "url" | "mobileOrder">
  wrongTab: string[]
  unlinkedPhones: string[]
  unlinkedEmails: string[]
  unlinkedAddresses: string[]
  logoNotHome: string
  emptyLinks: string[]
  tm: { brand: string; problem: "missing" | "not_superscript"; snippet: string }[]
  dupParagraphs: string[]
  dupMaps: number
  dupTitles: string[]
  dupHeaders: number
  fontOutliers: string[]
  italicParas: string[]
  lowContrast: string[]
  listStyles: string[]
  doubleBullets: string[]
  forms: FormFacts[]
  errorTexts: string[]
  activeMenu: { found: boolean; highlighted: boolean; label: string } | null
  blog: BlogFacts | null
  footer: { text: string; copyrightCount: number } | null
  socialBad: string[]
  stretched: string[]
  broken: string[]
  emptyImageSpots: number
  outdatedCandidates: string[]
}

export interface FormFacts {
  where: string
  hasConsent: boolean
  consentChecked: boolean[]
  consentOffsite: string[]
  allUpper: boolean
  invisibleInput: boolean
  visibleErrors: string[]
  innerScroll: boolean
}

export interface BlogFacts {
  internalLinks: number
  newTabInternal: number
  unstyledInternal: number
  toc: { count: number; broken: string[]; offPage: string[]; hidden: boolean } | null
  duplicateTitle: boolean
  uncategorized: boolean
  postNav: "missing" | "no_titles" | "ok"
}

// ---------------------------------------------------------------- collector
/** Runs inside the page. Self-contained: no module-scope references. */
export function collect(args: { brands: string[]; isHome: boolean }): PageGapRaw {
  const MAX = 12
  const body = document.body
  const out: any = {
    blocked: false,
    readyState: document.readyState,
    wrongTab: [], unlinkedPhones: [], unlinkedEmails: [], unlinkedAddresses: [], logoNotHome: "",
    emptyLinks: [], tm: [], dupParagraphs: [], dupMaps: 0, dupTitles: [], dupHeaders: 0,
    fontOutliers: [], italicParas: [], lowContrast: [], listStyles: [], doubleBullets: [],
    forms: [], errorTexts: [], activeMenu: null, blog: null, footer: null, socialBad: [],
    stretched: [], broken: [], emptyImageSpots: 0, outdatedCandidates: [],
  }
  const facts: any = {
    finalUrl: location.href, title: document.title || "", siteName: "", h1: [], headings: [],
    isBlogPost: false, hasToc: false, h2Count: 0, nav: [], mobileNav: null, footerNav: [], links: [],
    phones: [], emails: [], addresses: [], images: [], bannerImage: "", featuredImage: "", logo: "", text: "",
  }
  out.facts = facts
  if (!body) return out
  const t = (document.title || "").toLowerCase()
  if (/just a moment|attention required|access denied|verify you are human|checking your browser/.test(t) && (body.innerText || "").length < 3000) {
    out.blocked = true
    return out
  }

  const clean = (s: any) => String(s || "").replace(/\s+/g, " ").trim()
  const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s)
  const host = location.hostname.replace(/^www\./, "")
  const abs = (h: string) => { try { return new URL(h, location.href) } catch { return null } }
  const isInternal = (u: URL | null) => !!u && /^https?:$/.test(u.protocol) && u.hostname.replace(/^www\./, "") === host
  const vis = (el: Element): boolean => {
    const r = (el as HTMLElement).getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const anyEl = el as any
    if (typeof anyEl.checkVisibility === "function") return anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    const cs = getComputedStyle(el)
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0"
  }
  const HEADER_SEL = 'header, [data-elementor-type="header"], #masthead, .site-header, [role="banner"]'
  const FOOTER_SEL = 'footer, [data-elementor-type="footer"], #colophon, .site-footer, [role="contentinfo"]'
  const WIDGET_SEL = '[id*="chat" i], [class*="chatbot" i], [class*="cliffhanger" i], [id*="userway" i], [class*="userway" i], #callnowbutton, [class*="g99" i]'
  const fixedCache = new WeakMap<Element, boolean>()
  const inFixed = (el: Element): boolean => {
    let n: Element | null = el
    for (let i = 0; n && i < 12; i++, n = n.parentElement) {
      if (fixedCache.has(n)) return fixedCache.get(n)!
      if (getComputedStyle(n).position === "fixed") { fixedCache.set(n, true); return true }
    }
    return false
  }
  const area = (el: Element): "header" | "footer" | "main" | "floating" => {
    if (el.closest(HEADER_SEL)) return "header"
    if (el.closest(FOOTER_SEL)) return "footer"
    if (el.closest(WIDGET_SEL) || inFixed(el)) return "floating"
    return "main"
  }
  const label = (a: Element) => clean((a as HTMLElement).innerText || a.getAttribute("aria-label") || a.getAttribute("title") || (a.querySelector("img") as HTMLImageElement | null)?.alt || "")
  const mainRoot: Element = document.querySelector("main, #main, #content, .site-main, [role=main]") || body
  const inChrome = (el: Element) => !!el.closest(HEADER_SEL + "," + FOOTER_SEL + ",nav," + WIDGET_SEL)
  const isClone = (el: Element) => !!el.closest('.swiper-slide-duplicate, .slick-cloned, [aria-hidden="true"], .elementor-hidden-desktop, template, noscript')

  // ---------- facts: site name, h1, headings
  facts.siteName = clean((document.querySelector('meta[property="og:site_name"]') as HTMLMetaElement | null)?.content || "")
  facts.h1 = Array.from(document.querySelectorAll("h1")).filter(vis).map((h) => clean((h as HTMLElement).innerText)).filter(Boolean).slice(0, 5)
  const contentHeadings = Array.from(mainRoot.querySelectorAll("h2, h3")).filter((h) => vis(h) && !inChrome(h) && !isClone(h))
  facts.h2Count = contentHeadings.filter((h) => h.tagName === "H2").length
  facts.headings = contentHeadings.slice(0, 40).map((h) => {
    const txt = clean((h as HTMLElement).innerText)
    const letters = txt.replace(/[^A-Za-z]/g, "")
    const caps = getComputedStyle(h).textTransform === "uppercase" || (letters.length >= 4 && letters === letters.toUpperCase())
    return { text: short(txt, 80), caps }
  }).filter((h) => h.text)

  // ---------- menus
  const menuItems = (root: Element | null, onlyVisible: boolean) => {
    if (!root) return [] as any[]
    const items: any[] = []
    const top = root.querySelector("ul") || root
    const walk = (ul: Element, depth: number, parent?: string) => {
      for (const li of Array.from(ul.children)) {
        if (li.tagName !== "LI") continue
        const a = li.querySelector(":scope > a, :scope > div > a, :scope > span > a") as HTMLAnchorElement | null
        if (!a) continue
        if (onlyVisible && depth === 0 && !vis(a)) continue
        const text = clean(a.textContent)
        if (!text) continue
        items.push({ text: short(text, 60), href: a.getAttribute("href") ? a.href : "", depth, parent })
        const sub = li.querySelector(":scope > ul, :scope > div > ul")
        if (sub && depth < 2) walk(sub, depth + 1, short(text, 60))
      }
    }
    walk(top, 0)
    return items.slice(0, 120)
  }
  const headerNavs = Array.from(document.querySelectorAll(`${HEADER_SEL.split(",").map((s) => s + " nav").join(",")}, nav.elementor-nav-menu--main, .main-navigation, #site-navigation`))
  // No <nav>? Many custom themes put the menu in a bare <ul> inside the header:
  // take the header list with the most visible top-level links.
  const headerUlFallback = (): Element | null => {
    const h = document.querySelector(HEADER_SEL)
    if (!h) return null
    const uls = Array.from(h.querySelectorAll("ul")).filter((u) => !u.parentElement?.closest("ul") && Array.from(u.children).filter((li) => li.tagName === "LI" && li.querySelector("a") && vis(li)).length >= 2)
    uls.sort((a, b) => b.children.length - a.children.length)
    return uls[0]?.parentElement || null
  }
  const desktopNav = headerNavs.find((n) => vis(n) && !n.matches(".elementor-nav-menu--dropdown") && n.querySelector("a")) || headerUlFallback()
  facts.nav = menuItems(desktopNav, true)
  const mobileRoot = document.querySelector(
    "nav.elementor-nav-menu--dropdown, #mobile-menu, .mobile-menu, .mobile-navigation, .jet-mobile-menu, .mm-menu, .wp-block-navigation__responsive-container, .elementor-location-popup nav, .menu-mobile",
  )
  if (mobileRoot && mobileRoot !== desktopNav) {
    const m = menuItems(mobileRoot, false)
    if (m.length) facts.mobileNav = m
  }
  const footerNavRoot = document.querySelector(`${FOOTER_SEL.split(",").map((s) => s + " nav").join(",")}, ${FOOTER_SEL.split(",").map((s) => s + " .menu").join(",")}`)
  facts.footerNav = menuItems(footerNavRoot, true).filter((i) => i.depth === 0).map((i) => ({ text: i.text, href: i.href }))

  // ---------- logo
  const logoImg = (document.querySelector(`${HEADER_SEL.split(",").map((s) => s + " .custom-logo, " + s + ' img[class*="logo" i], ' + s + ' img[src*="logo" i], ' + s + ' img[alt*="logo" i]').join(",")}`) ||
    document.querySelector(`${HEADER_SEL.split(",")[0]} img`)) as HTMLImageElement | null
  if (logoImg) {
    facts.logo = logoImg.currentSrc || logoImg.src || ""
    const a = logoImg.closest("a") as HTMLAnchorElement | null
    const u = a ? abs(a.getAttribute("href") || "") : null
    if (!a || !u || !isInternal(u) || u.pathname.replace(/\/+$/, "") !== "") out.logoNotHome = a ? (a.getAttribute("href") || "(empty)") : "(no link)"
    // Logo link much wider than the logo = blank clickable space.
    if (a && vis(a) && vis(logoImg)) {
      const ar = a.getBoundingClientRect(), ir = logoImg.getBoundingClientRect()
      if (ar.width > ir.width * 1.6 + 40) out.emptyLinks.push(`Blank space beside the header logo is clickable (link ${Math.round(ar.width)}px wide, logo ${Math.round(ir.width)}px)`)
    }
  }

  // ---------- links
  const BOOKING_HOSTS = /(janeapp|vagaro|boulevard|joinblvd|mindbody|zenoti|squareup|square\.site|acuityscheduling|calendly|schedulicity|genbook|booker|meevo|nexhealth|localmed|zocdoc|aestheticspro|patientnow|mangomint|glossgenius|fresha|setmore|growth99\.com\/.*book|app\.growth99)/i
  const BOOK_TEXT = /\b(book|schedule|appointment|reserve|consult)/i
  const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]
  const seenWrong = new Set<string>()
  for (const a of anchors.slice(0, 1500)) {
    const raw = a.getAttribute("href") || ""
    const ar = area(a)
    if (ar === "floating" && a.closest(WIDGET_SEL)) {
      // still record floating booking buttons below
    }
    const text = label(a)
    const u = abs(raw)
    const visible = vis(a)
    if (visible && facts.links.length < 400 && u && !isClone(a)) {
      const img = a.querySelector("img") as HTMLImageElement | null
      const bg = !img ? (Array.from(a.querySelectorAll("*")).slice(0, 15).map((e) => getComputedStyle(e).backgroundImage).find((b) => b && b !== "none") || "") : ""
      const bgUrl = bg ? (bg.match(/url\(["']?([^"')]+)/)?.[1] || "") : ""
      facts.links.push({ text: short(text, 80), href: u.href, area: ar, hasImg: img ? (img.currentSrc || img.src) : bgUrl })
    }
    if (!visible || !u) continue
    const target = (a.getAttribute("target") || "").toLowerCase()
    const key = `${raw}|${target}`
    if (seenWrong.has(key)) continue
    if (/^(tel|mailto|sms):/i.test(raw) && target === "_blank") {
      seenWrong.add(key); out.wrongTab.push(`"${short(text || raw, 50)}" (${raw}) opens a new tab — should open in the same tab`)
    } else if (isInternal(u) && target === "_blank" && !/\.(pdf|jpe?g|png|webp|docx?)$/i.test(u.pathname) && !/wp-content\/uploads/.test(u.pathname)) {
      seenWrong.add(key); out.wrongTab.push(`"${short(text || u.pathname, 50)}" → ${u.pathname} is an internal page but opens in a new tab`)
    } else if (!isInternal(u) && /^https?:$/.test(u.protocol) && (BOOKING_HOSTS.test(u.href) || (BOOK_TEXT.test(text) && !/(google|facebook|instagram|yelp)\./.test(u.hostname))) && target !== "_blank") {
      seenWrong.add(key); out.wrongTab.push(`Booking link "${short(text || u.hostname, 50)}" → ${u.hostname} opens in the same tab — third-party booking should open in a new tab`)
    }
    // Empty / punctuation-only links.
    if (!a.querySelector("img, svg, i, [class*=icon], video, picture") && !a.getAttribute("aria-label") && !/^(tel|mailto):/.test(raw)) {
      const own = clean(a.textContent)
      const bgImg = getComputedStyle(a).backgroundImage
      if ((!own || /^[\s,.;:–—\-|·•]+$/.test(own)) && (!bgImg || bgImg === "none") && a.getBoundingClientRect().width > 4) {
        out.emptyLinks.push(own ? `A "${own}" character is a link (→ ${u.pathname || u.href})` : `Empty clickable area with no text or image (→ ${short(u.href, 70)}) in the ${ar}`)
      }
    }
  }
  // Social links
  const SOCIAL = /(facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|linkedin\.com|pinterest\.com|yelp\.com)/i
  const socialSeen = new Set<string>()
  for (const a of anchors) {
    const raw = a.getAttribute("href") || ""
    const cls = `${a.className} ${a.getAttribute("aria-label") || ""} ${a.querySelector("i,svg,span")?.getAttribute("class") || ""}`
    if (raw === "#" && /facebook|instagram|twitter|youtube|tiktok|linkedin|pinterest|yelp/i.test(cls) && vis(a)) {
      if (!socialSeen.has("#" + cls)) { socialSeen.add("#" + cls); out.socialBad.push(`Social icon (${(cls.match(/facebook|instagram|twitter|youtube|tiktok|linkedin|pinterest|yelp/i) || [""])[0]}) links to "#" — no profile set`) }
      continue
    }
    const u = abs(raw)
    if (!u || !SOCIAL.test(u.hostname) || socialSeen.has(u.href)) continue
    if (/sharer|share\?|intent\/tweet|shareArticle|pin\/create/i.test(u.href)) continue
    socialSeen.add(u.href)
    const path = u.pathname.replace(/\/+$/, "")
    if (!path || /^\/(home|login|pages|people|profile\.php)$/i.test(path) && !u.search)
      out.socialBad.push(`${u.hostname} link has no profile (${u.href}) — points at the site's home page`)
    else if (/(growth99|gogroth|envato|themeforest|elementor|wordpress|wpengine|astra|oceanwp|yourpage|username|example)/i.test(path))
      out.socialBad.push(`${u.hostname} link points to a template / agency profile, not the client's: ${u.href}`)
  }

  // ---------- phones / emails / addresses
  const PHONE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/g
  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  const ADDRESS = /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z0-9][\w.'-]*(?:\s+[A-Z0-9][\w.'-]*){0,4}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pkwy|Parkway|Ct|Court|Hwy|Highway|Pl|Place|Cir|Circle|Trl|Trail|Pike|Sq|Square)\b\.?(?:[^\n]{0,40}?\b[A-Z][a-zA-Z .]+,\s*[A-Z]{2}\s*\d{5})?/g
  for (const a of anchors) {
    const raw = a.getAttribute("href") || ""
    if (/^tel:/i.test(raw)) {
      const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
      const disp = clean(a.innerText)
      if (digits.length >= 10 && facts.phones.length < 60) facts.phones.push({ digits, display: short(disp, 40), href: raw, area: area(a) })
    } else if (/^mailto:/i.test(raw)) {
      const em = raw.replace(/^mailto:/i, "").split("?")[0].toLowerCase()
      if (em && facts.emails.length < 40) facts.emails.push({ email: em, area: area(a) })
    }
  }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const unPh = new Set<string>(), unEm = new Set<string>(), unAd = new Set<string>()
  const texts: { node: Text; text: string }[] = []
  let n: Node | null
  let collected = 0
  while ((n = walker.nextNode()) && collected < 6000) {
    const p = (n as Text).parentElement
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION|TITLE|SVG)$/i.test(p.tagName) || p.closest("script,style,noscript,template")) continue
    const s = n.nodeValue || ""
    if (!s.trim()) continue
    collected++
    texts.push({ node: n as Text, text: s })
  }
  const visCache = new WeakMap<Element, boolean>()
  const visP = (e: Element) => { if (!visCache.has(e)) visCache.set(e, vis(e) && !isClone(e)); return visCache.get(e)! }
  for (const { node, text } of texts) {
    const p = node.parentElement!
    if (!visP(p) || p.closest("input,select,form [type=hidden]")) continue
    const linked = p.closest("a[href]") as HTMLAnchorElement | null
    for (const m of text.matchAll(PHONE)) {
      const digits = `${m[1]}${m[2]}${m[3]}`
      if (!linked || !/^tel:/i.test(linked.getAttribute("href") || "")) {
        if (!unPh.has(digits) && !p.closest(WIDGET_SEL)) { unPh.add(digits); out.unlinkedPhones.push(`${m[0].trim()} (${area(p)})`) }
      }
      if (!linked) facts.phones.push({ digits, display: m[0].trim(), href: "", area: area(p) })
    }
    for (const m of text.matchAll(EMAIL)) {
      const em = m[0].toLowerCase()
      if (/\.(png|jpe?g|webp|svg|gif)$/.test(em) || /sentry|example\.|wixpress/.test(em)) continue
      if (!linked || !/^mailto:/i.test(linked.getAttribute("href") || "")) {
        if (!unEm.has(em)) { unEm.add(em); out.unlinkedEmails.push(`${em} (${area(p)})`) }
      }
      if (!facts.emails.some((e: any) => e.email === em)) facts.emails.push({ email: em, area: area(p) })
    }
    const blockText = clean((p.closest("p, li, div, address, span, td") as HTMLElement | null)?.innerText || text)
    for (const m of blockText.matchAll(ADDRESS)) {
      const ad = clean(m[0])
      if (facts.addresses.length < 12 && !facts.addresses.includes(ad)) facts.addresses.push(ad)
      const ar = area(p)
      if ((ar === "footer" || /contact/i.test(location.pathname)) && !linked && !unAd.has(ad)) {
        unAd.add(ad); out.unlinkedAddresses.push(ad)
      }
    }
  }
  // Map links: remember the address each one wraps / sits beside.
  for (const l of facts.links) {
    if (!/(google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page|share\.google)/i.test(l.href)) continue
    const a = anchors.find((x) => x.href === l.href)
    const near = clean((a?.closest("p, li, div, address") as HTMLElement | null)?.innerText || "")
    const m = near.match(ADDRESS)
    if (m) l.addressNear = clean(m[0])
  }

  // ---------- trademark symbols
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const brandRe = new RegExp(`(^|[^\\w])(${args.brands.map(esc).join("|")})(?![\\w])`, "gi")
  const tmSeen = new Set<string>()
  for (let i = 0; i < texts.length; i++) {
    const { node, text } = texts[i]
    const p = node.parentElement!
    if (!visP(p) || p.closest("a[href^='http']:not([href*='" + host + "'])")) continue
    for (const m of text.matchAll(brandRe)) {
      const brand = m[2]
      const end = (m.index || 0) + m[0].length
      let next = text.slice(end, end + 2)
      let nextEl: Element | null = p
      if (!next.trim() && end >= text.length && texts[i + 1]) { next = (texts[i + 1].text || "").slice(0, 2); nextEl = texts[i + 1].node.parentElement }
      const sym = /^[\s]?[™®ᵀᴹ]|^\s?\((r|tm)\)/i.test(next)
      const key = brand.toLowerCase()
      if (!sym) {
        if (!tmSeen.has(key + "m")) { tmSeen.add(key + "m"); out.tm.push({ brand, problem: "missing", snippet: short(clean(text.slice(Math.max(0, (m.index || 0) - 30), end + 30)), 80) }) }
      } else if (nextEl) {
        const symEl = nextEl === p && end < text.length ? p : nextEl
        const va = getComputedStyle(symEl).verticalAlign
        const sup = !!symEl.closest("sup") || va === "super" || va === "top" || va === "text-top" || parseFloat(getComputedStyle(symEl).fontSize) < parseFloat(getComputedStyle(p.parentElement || p).fontSize) * 0.85
        if (!sup && symEl === p && !tmSeen.has(key + "s")) { tmSeen.add(key + "s"); out.tm.push({ brand, problem: "not_superscript", snippet: short(clean(text.slice(Math.max(0, (m.index || 0) - 20), end + 20)), 70) }) }
      }
      if (out.tm.length > 40) break
    }
  }

  // ---------- duplicates
  const paras = Array.from(mainRoot.querySelectorAll("p, li")).filter((e) => !inChrome(e) && !isClone(e) && !e.closest("nav, .swiper, .slick-slider, .owl-carousel, [class*=carousel], [class*=slider], [class*=testimonial], [class*=review]") && visP(e))
  const seenP = new Map<string, number>()
  for (const e of paras) {
    const tx = clean((e as HTMLElement).innerText).toLowerCase()
    if (tx.length < 60) continue
    seenP.set(tx, (seenP.get(tx) || 0) + 1)
  }
  for (const [tx, c] of seenP) if (c > 1 && out.dupParagraphs.length < 6) out.dupParagraphs.push(`"${short(tx, 80)}" appears ${c} times`)
  const maps = Array.from(document.querySelectorAll('iframe[src*="google.com/maps"], iframe[src*="maps.google"]')).filter(vis).map((f) => (f as HTMLIFrameElement).src.split("&")[0])
  const mapCount = new Map<string, number>()
  maps.forEach((m) => mapCount.set(m, (mapCount.get(m) || 0) + 1))
  out.dupMaps = Math.max(0, ...[...mapCount.values()].map((c) => c - 1))
  const h1s = facts.h1.map((h: string) => h.toLowerCase())
  if (h1s.length > 1 && new Set(h1s).size < h1s.length) out.dupTitles.push(`The page title "${short(facts.h1[0], 60)}" is shown twice (two identical H1 headings)`)
  else if (facts.h1.length > 1) out.dupTitles.push(`${facts.h1.length} H1 headings on the page: ${facts.h1.map((h: string) => `"${short(h, 40)}"`).join(", ")}`)
  const headers = Array.from(document.querySelectorAll('header, [data-elementor-type="header"]')).filter((h) => vis(h) && h.querySelector("nav, a") && !h.closest("article, main header, .elementor-location-popup") && h.getBoundingClientRect().top + scrollY < 400)
  const outerHeaders = headers.filter((h) => !headers.some((o) => o !== h && o.contains(h)))
  if (outerHeaders.length > 1) out.dupHeaders = outerHeaders.length

  // ---------- text styling
  const famOf = (e: Element) => getComputedStyle(e).fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase()
  const textParas = paras.filter((e) => e.tagName === "P" && clean((e as HTMLElement).innerText).length >= 40 && !e.closest("blockquote, pre, code, form, [class*=quote]"))
  const famCount = new Map<string, number>()
  textParas.forEach((e) => famCount.set(famOf(e), (famCount.get(famOf(e)) || 0) + 1))
  const domFam = [...famCount.entries()].sort((a, b) => b[1] - a[1])[0]
  if (domFam && textParas.length >= 4) {
    for (const e of textParas) if (famOf(e) !== domFam[0] && out.fontOutliers.length < 5) out.fontOutliers.push(`"${short(clean((e as HTMLElement).innerText), 60)}" uses ${famOf(e)} (rest of the page: ${domFam[0]})`)
    for (const e of textParas) {
      const cs = getComputedStyle(e)
      const allEm = e.children.length > 0 && Array.from(e.childNodes).every((c) => (c.nodeType === 3 && !c.nodeValue!.trim()) || (c.nodeType === 1 && /^(EM|I)$/.test((c as Element).tagName)))
      if ((cs.fontStyle === "italic" || allEm) && out.italicParas.length < 5 && !e.closest("[class*=testimonial], [class*=review], figcaption")) out.italicParas.push(`"${short(clean((e as HTMLElement).innerText), 60)}" is in italics`)
    }
  }
  const rgb = (c: string) => (c.match(/[\d.]+/g) || []).map(Number)
  const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const bgOf = (e: Element): number[] | null => {
    let x: Element | null = e
    for (let i = 0; x && i < 25; i++, x = x.parentElement) {
      const cs = getComputedStyle(x)
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null
      const c = rgb(cs.backgroundColor)
      if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) return c
      if (c.length >= 4 && c[3] > 0.05) return null
    }
    return [255, 255, 255]
  }
  for (const e of [...textParas, ...contentHeadings].slice(0, 300)) {
    const fg = rgb(getComputedStyle(e).color)
    const bg = bgOf(e)
    if (!bg || fg.length < 3) continue
    const l1 = lum(fg), l2 = lum(bg)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    if (ratio < 3 && out.lowContrast.length < 6) out.lowContrast.push(`"${short(clean((e as HTMLElement).innerText), 50)}" is hard to read (contrast ${ratio.toFixed(1)}:1)`)
  }
  const lists = Array.from(mainRoot.querySelectorAll("ul")).filter((u) => !inChrome(u) && !u.closest("nav, .menu, [class*=menu], [class*=social], [class*=widget], .swiper, .slick-slider, form, [class*=icon-list]") && u.children.length >= 2 && visP(u))
  const styles = new Map<string, number>()
  for (const u of lists) {
    const li = u.querySelector("li")
    if (!li) continue
    let st = getComputedStyle(li).listStyleType
    if (st === "none") {
      const before = getComputedStyle(li, "::before").content
      st = before && before !== "none" && before !== "normal" ? `custom ${before.slice(0, 6)}` : "none"
    }
    if (st !== "none") styles.set(st, (styles.get(st) || 0) + 1)
    for (const item of Array.from(u.children).slice(0, 30)) {
      const tx = clean((item as HTMLElement).innerText)
      if (/^[•●▪◦‣\-–]\s/.test(tx) && st !== "none" && out.doubleBullets.length < 4) out.doubleBullets.push(`"${short(tx, 50)}" shows two bullets`)
    }
  }
  if (styles.size > 1) out.listStyles.push(`Bullet lists on this page use ${styles.size} different styles: ${[...styles.keys()].join(", ")}`)

  // ---------- forms (same-document; iframes are read separately)
  const formRoots = Array.from(document.querySelectorAll("form")).filter((f) => vis(f) && f.querySelector('input[type=email], input[type=tel], input[name*=email i], input[name*=phone i]') && !f.matches("[role=search], .search-form, [class*=search]"))
  for (const f of formRoots.slice(0, 6)) out.forms.push(formFacts(f, `form on this page${f.id ? ` (#${f.id})` : ""}`))
  function formFacts(f: Element, where: string) {
    const boxes = Array.from(f.querySelectorAll("input[type=checkbox]")) as HTMLInputElement[]
    const consent = boxes.filter((b) => {
      const l = clean(((b.closest("label") as HTMLElement | null)?.innerText || "") + " " + ((b.id && (document.querySelector(`label[for="${CSS.escape(b.id)}"]`) as HTMLElement | null)?.innerText) || "") + " " + ((b.parentElement as HTMLElement | null)?.innerText || ""))
      return /consent|agree|terms|privacy|sms|text message|communications|opt.?in|contact me/i.test(l)
    })
    const consentLinks = consent.flatMap((b) => Array.from((b.closest("label, div, p") || b).querySelectorAll("a[href]")) as HTMLAnchorElement[])
    const offsite = consentLinks.filter((a) => { const u = abs(a.getAttribute("href") || ""); return !!u && /^https?:$/.test(u.protocol) && !isInternal(u) && !/growth99/i.test(u.hostname) }).map((a) => a.href)
    const inputs = (Array.from(f.querySelectorAll("input[type=text], input[type=email], input[type=tel], input:not([type]), textarea")) as HTMLElement[]).filter(vis)
    const allUpper = inputs.length >= 2 && inputs.every((i) => getComputedStyle(i).textTransform === "uppercase")
    const invisibleInput = inputs.some((i) => { const cs = getComputedStyle(i); const c1 = rgb(cs.color), c2 = rgb(cs.backgroundColor); return c2.length >= 3 && (c2.length < 4 || c2[3] > 0.9) && Math.abs(c1[0] - c2[0]) + Math.abs(c1[1] - c2[1]) + Math.abs(c1[2] - c2[2]) < 30 })
    const visibleErrors = (Array.from(f.querySelectorAll("*")) as HTMLElement[]).filter((e) => e.children.length === 0 && vis(e) && /captcha|recaptcha|please verify|verification failed|this field is required|invalid (email|phone)/i.test(e.innerText || "")).map((e) => short(clean(e.innerText), 60)).slice(0, 3)
    let innerScroll = false
    for (let x: Element | null = f, i = 0; x && i < 4; i++, x = x.parentElement) {
      const cs = getComputedStyle(x)
      if (/(auto|scroll)/.test(cs.overflowY) && x.scrollHeight > x.clientHeight + 4 && x.clientHeight > 80) { innerScroll = true; break }
    }
    return { where, hasConsent: consent.length > 0, consentChecked: consent.map((b) => b.checked), consentOffsite: offsite.slice(0, 3), allUpper, invisibleInput, visibleErrors, innerScroll }
  }

  // ---------- page errors / visible code
  const bodyText = (body.innerText || "").slice(0, 200000)
  const ERR = [
    /Error establishing a database connection/i,
    /WordPress database error[^\n]{0,120}/i,
    /\b(Fatal error|Parse error|Warning|Notice|Deprecated):\s[^\n]{0,140}?\bon line \d+/,
    /Uncaught (Error|Exception|TypeError)[^\n]{0,100}/,
    /\[(contact-form-7|elementor-template|gravityform|wpforms|vc_row|vc_column|et_pb_\w+|fusion_\w+|rev_slider|ninja_form|caldera_form|wp_\w+)[^\]]{0,80}\]/i,
    /\{\{\s*[\w.]+\s*\}\}/,
    /<\/?(div|span|p|script|iframe|br|strong)\b[^>\n]{0,60}>/i,
    /&(nbsp|amp|lt|gt|quot|#\d+);/,
  ]
  for (const re of ERR) {
    const m = bodyText.match(re)
    if (m && out.errorTexts.length < 6) out.errorTexts.push(short(clean(m[0]), 120))
  }

  // ---------- active menu item
  if (!args.isHome && desktopNav) {
    const here = location.href.replace(/[#?].*$/, "").replace(/\/+$/, "")
    const links = (Array.from(desktopNav.querySelectorAll("a[href]")) as HTMLAnchorElement[]).filter((a) => vis(a))
    const cur = links.find((a) => a.href.replace(/[#?].*$/, "").replace(/\/+$/, "") === here)
    if (cur) {
      const li = cur.closest("li")
      const sib = links.find((a) => a !== cur && a.closest("ul") === cur.closest("ul") && !a.closest(".current-menu-item, .current_page_item, .current-menu-ancestor"))
      const sig = (a: Element) => { const cs = getComputedStyle(a); return [cs.color, cs.backgroundColor, cs.fontWeight, cs.textDecorationLine, cs.borderBottomWidth + cs.borderBottomColor].join("|") }
      const marked = !!li?.matches(".current-menu-item, .current_page_item, .current-menu-ancestor, .active") || cur.matches("[aria-current], .elementor-item-active, .active")
      const differs = sib ? sig(cur) !== sig(sib) : marked
      out.activeMenu = { found: true, highlighted: differs, label: clean(cur.textContent) }
    }
  }

  // ---------- blog post
  const cl = body.classList
  const isPost = cl.contains("single-post") || (!cl.contains("page") && !cl.contains("home") && document.querySelectorAll("article.type-post").length === 1)
  facts.isBlogPost = isPost
  if (isPost) {
    const content = document.querySelector(".entry-content, .elementor-widget-theme-post-content, .post-content, article .content, .single-content") || mainRoot
    const contentLinks = (Array.from(content.querySelectorAll("a[href]")) as HTMLAnchorElement[]).filter((a) => !a.closest("#ez-toc-container, .ez-toc, .lwptoc, .rank-math-toc, .wp-block-rank-math-toc-block, .table-of-contents, nav, .sharedaddy, [class*=share]"))
    const internal = contentLinks.filter((a) => { const u = abs(a.getAttribute("href") || ""); return isInternal(u) && !(u!.pathname === location.pathname && u!.hash) })
    const pColor = getComputedStyle(content.querySelector("p") || content).color
    const unstyled = internal.filter((a) => { const cs = getComputedStyle(a); return cs.color === pColor && !/underline/.test(cs.textDecorationLine) && Number(cs.fontWeight) < 600 && !a.closest("strong, b") })
    const tocEls = Array.from(document.querySelectorAll("#ez-toc-container, .ez-toc-v2_0_17, .lwptoc, .rank-math-toc, .wp-block-rank-math-toc-block, .table-of-contents, nav.toc, .ez-toc-container, .elementor-widget-table-of-contents"))
    const outerToc = tocEls.filter((e) => !tocEls.some((o) => o !== e && o.contains(e)))
    let toc: any = null
    if (outerToc.length) {
      const tl = outerToc.flatMap((e) => Array.from(e.querySelectorAll("a[href]")) as HTMLAnchorElement[])
      const broken: string[] = [], offPage: string[] = []
      for (const a of tl) {
        const raw = a.getAttribute("href") || ""
        const u = abs(raw)
        if (!u) continue
        if (u.pathname.replace(/\/+$/, "") !== location.pathname.replace(/\/+$/, "") || u.hostname !== location.hostname) offPage.push(`"${short(clean(a.textContent), 40)}" → ${short(u.href, 60)}`)
        else if (u.hash && !document.getElementById(decodeURIComponent(u.hash.slice(1))) && !document.querySelector(`[name="${CSS.escape(decodeURIComponent(u.hash.slice(1)))}"]`)) broken.push(`"${short(clean(a.textContent), 40)}" (${u.hash})`)
      }
      const hidden = outerToc.every((e) => { const tx = clean((e as HTMLElement).innerText); const fg = rgb(getComputedStyle(e).color); const bg = bgOf(e); return !tx || (!!bg && Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]) < 40) })
      toc = { count: outerToc.length, broken: broken.slice(0, 6), offPage: offPage.slice(0, 6), hidden: hidden && tl.length > 0 }
      facts.hasToc = true
    } else if (Array.from(content.querySelectorAll("h2,h3,p,strong")).some((e) => /^table of contents$/i.test(clean((e as HTMLElement).innerText)))) {
      facts.hasToc = true
      toc = { count: 1, broken: [], offPage: [], hidden: false }
    }
    const h1 = (facts.h1[0] || "").toLowerCase()
    const dupTitle = !!h1 && Array.from(content.querySelectorAll("h1,h2,h3,p")).filter(visP).some((e) => clean((e as HTMLElement).innerText).toLowerCase() === h1)
    const uncategorized = Array.from(document.querySelectorAll("a[rel~=category], .cat-links a, .widget_categories a, .elementor-post-info a, .post-categories a")).some((a) => /^uncategori[sz]ed$/i.test(clean(a.textContent)) && vis(a))
    const navEl = document.querySelector(".post-navigation, .nav-links, .elementor-post-navigation, .wp-block-post-navigation-link, .navigation.post-navigation, nav[aria-label*=Post i]") || (document.querySelector("a[rel=prev], a[rel=next]")?.closest("nav, div") ?? null)
    let postNav: "missing" | "no_titles" | "ok" = "missing"
    if (navEl && vis(navEl)) {
      const tx = clean((navEl as HTMLElement).innerText).replace(/\b(previous|next|post|prev|«|»|←|→|<|>)\b/gi, "").trim()
      postNav = tx.length < 6 ? "no_titles" : "ok"
    }
    out.blog = { internalLinks: internal.length, newTabInternal: internal.filter((a) => a.target === "_blank").length, unstyledInternal: unstyled.length, toc, duplicateTitle: dupTitle, uncategorized, postNav }
  }

  // ---------- footer bar (homepage)
  if (args.isHome) {
    const footers = Array.from(document.querySelectorAll(FOOTER_SEL)).filter((f) => !Array.from(document.querySelectorAll(FOOTER_SEL)).some((o) => o !== f && o.contains(f)))
    const ft = footers.map((f) => clean((f as HTMLElement).innerText)).join(" \n ")
    if (ft) out.footer = { text: ft.slice(-1500), copyrightCount: (ft.match(/©|&copy;|\bcopyright\b/gi) || []).length }
  }

  // ---------- images
  const imgs = (Array.from(mainRoot.querySelectorAll("img")) as HTMLImageElement[]).filter((i) => !inChrome(i))
  for (const img of imgs.slice(0, 300)) {
    if (!vis(img) || isClone(img)) continue
    const r = img.getBoundingClientRect()
    const src = img.currentSrc || img.src || ""
    if (img.complete && img.naturalWidth === 0 && src && !src.startsWith("data:") && r.width > 20 && out.broken.length < 8) { out.broken.push(src); continue }
    if (!img.naturalWidth || r.width < 60 || r.height < 60) continue
    const fit = getComputedStyle(img).objectFit
    if (fit === "fill" || fit === "") {
      const nr = img.naturalWidth / img.naturalHeight, rr = r.width / r.height
      if (Math.abs(rr - nr) / nr > 0.1 && out.stretched.length < 8) out.stretched.push(`${src.split("/").pop()} shown at ${Math.round(r.width)}×${Math.round(r.height)} (file is ${img.naturalWidth}×${img.naturalHeight}) — ${rr > nr ? "stretched wide" : "squeezed"}`)
    }
    if (r.width >= 200 && r.height >= 150 && facts.images.length < 60) facts.images.push(src)
  }
  out.emptyImageSpots = Array.from(document.querySelectorAll(".elementor-widget-image .elementor-widget-container, .wp-block-image")).filter((w) => vis(w) && !w.querySelector("img, svg, picture, video") ).length
  for (const img of Array.from(document.querySelectorAll("img:not([src]), img[src='']")).filter(vis)) out.emptyImageSpots++
  const featured = (document.querySelector(".wp-post-image, .post-thumbnail img, .elementor-widget-theme-post-featured-image img") as HTMLImageElement | null)
  facts.featuredImage = featured ? (featured.currentSrc || featured.src) : ((document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)?.content || "")
  const banner = Array.from(document.querySelectorAll("section, .elementor-section, .e-con, .wp-block-cover, .page-header, .breadcrumb, [class*=banner]")).slice(0, 8).find((s) => { const r = s.getBoundingClientRect(); const bg = getComputedStyle(s).backgroundImage; return r.width > innerWidth * 0.8 && bg && bg !== "none" && /url\(/.test(bg) })
  facts.bannerImage = banner ? (getComputedStyle(banner).backgroundImage.match(/url\(["']?([^"')]+)/)?.[1] || "") : ""

  // ---------- outdated offers (dates, judged in node)
  const OFFER = /(special|offer|promo|deal|sale|valid|expires?|ends?|through|until|thru|limited time)/i
  for (const e of Array.from(mainRoot.querySelectorAll("h1,h2,h3,h4,p,li,span,strong")).slice(0, 2500)) {
    if (inChrome(e) || e.children.length > 3) continue
    const tx = clean((e as HTMLElement).innerText)
    if (tx.length < 6 || tx.length > 220 || !OFFER.test(tx) || !/\b(20\d\d|\d{1,2}\/\d{1,2}\/\d{2,4})\b/.test(tx)) continue
    if (!visP(e)) continue
    if (out.outdatedCandidates.length < 30 && !out.outdatedCandidates.includes(tx)) out.outdatedCandidates.push(tx)
  }

  facts.text = clean((mainRoot as HTMLElement).innerText || "").slice(0, 6000)
  return out
}

/** Runs inside a form iframe. Self-contained. */
export function collectFrameForm(): FormFacts | null {
  const vis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" }
  const f = Array.from(document.querySelectorAll("form")).find((x) => vis(x) && x.querySelector("input[type=email], input[type=tel], input[name*=email i], input[name*=phone i]"))
  if (!f) return null
  const clean = (s: any) => String(s || "").replace(/\s+/g, " ").trim()
  const rgb = (c: string) => (c.match(/[\d.]+/g) || []).map(Number)
  const boxes = Array.from(f.querySelectorAll("input[type=checkbox]")) as HTMLInputElement[]
  const consent = boxes.filter((b) => /consent|agree|terms|privacy|sms|text message|communications|opt.?in|contact me/i.test(clean(((b.closest("label, div, p") as HTMLElement | null)?.innerText) || "")))
  const offsite = consent.flatMap((b) => Array.from((b.closest("label, div, p") || b).querySelectorAll("a[href]")) as HTMLAnchorElement[])
    .map((a) => a.href).filter((h) => /^https?:/.test(h) && !/growth99/i.test(h) && (() => { try { return new URL(h).hostname !== new URL(document.referrer || location.href).hostname } catch { return false } })())
  const inputs = (Array.from(f.querySelectorAll("input[type=text], input[type=email], input[type=tel], input:not([type]), textarea")) as HTMLElement[]).filter(vis)
  const de = document.scrollingElement || document.documentElement
  return {
    where: `form in frame ${location.hostname}`,
    hasConsent: consent.length > 0,
    consentChecked: consent.map((b) => b.checked),
    consentOffsite: offsite.slice(0, 3),
    allUpper: inputs.length >= 2 && inputs.every((i) => getComputedStyle(i).textTransform === "uppercase"),
    invisibleInput: inputs.some((i) => { const cs = getComputedStyle(i); const a = rgb(cs.color), b = rgb(cs.backgroundColor); return b.length >= 3 && (b.length < 4 || b[3] > 0.9) && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 30 }),
    visibleErrors: (Array.from(f.querySelectorAll("*")) as HTMLElement[]).filter((e) => e.children.length === 0 && vis(e) && /captcha|recaptcha|please verify|verification failed|this field is required/i.test(e.innerText || "")).map((e) => clean(e.innerText).slice(0, 60)).slice(0, 3),
    innerScroll: de.scrollHeight > window.innerHeight + 8 && getComputedStyle(document.body).overflowY !== "hidden",
  }
}

// ---------------------------------------------------------------- node-side
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/**
 * Expired offer text: an end date in the past ("valid through March 31, 2025",
 * "expires 3/31/25"), or an offer heading naming a past year / month.
 * Pure — unit-tested.
 */
export function expiredOfferReason(text: string, now = new Date()): string | null {
  const t = text.toLowerCase()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endWord = /(valid|expires?|ends?|through|until|thru|by|before|offer good)/
  const md = t.match(new RegExp(`${endWord.source}[^.\\n]{0,25}?\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d\\d)`))
  if (md) {
    const d = new Date(Number(md[4]), MONTHS.indexOf(md[2]), Number(md[3]))
    if (d < today) return `ended ${d.toDateString().slice(4)}`
  }
  const num = t.match(new RegExp(`${endWord.source}[^.\\n]{0,25}?\\b(\\d{1,2})/(\\d{1,2})/(\\d{2,4})\\b`))
  if (num) {
    let y = Number(num[4]); if (y < 100) y += 2000
    const d = new Date(y, Number(num[2]) - 1, Number(num[3]))
    if (!isNaN(d.getTime()) && d < today) return `ended ${d.toDateString().slice(4)}`
  }
  if (/(special|offer|promo|deal|sale)/.test(t)) {
    const my = t.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(20\\d\\d)\\b`))
    if (my) {
      const end = new Date(Number(my[2]), MONTHS.indexOf(my[1]) + 1, 0)
      if (end < today) return `is for ${my[1][0].toUpperCase()}${my[1].slice(1)} ${my[2]}`
    }
    const y = t.match(/\b(20\d\d)\b/)
    if (y && Number(y[1]) < now.getFullYear() && !/(since|est\.?|established|founded|©|copyright)\s*(in\s*)?20\d\d/.test(t)) return `is for ${y[1]}`
  }
  return null
}

/** Footer bar problems from the footer's text. Pure — unit-tested. */
export function footerBarProblems(footerText: string, copyrightCount: number, businessName: string): string[] {
  const t = footerText || ""
  const out: string[] = []
  if (!/©|&copy;|\bcopyright\b/i.test(t)) {
    if (/(^|\s)@\s?(19|20)\d\d\b/.test(t)) out.push('"@" is used instead of "©" in the copyright line')
    else out.push("No copyright line (©) in the footer")
  }
  if (!/all rights reserved/i.test(t)) out.push('"All rights reserved" is missing')
  if (copyrightCount > 1) out.push(`The copyright line appears ${copyrightCount} times`)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
  const name = norm(businessName)
  if (name.length >= 4 && !norm(t).includes(name)) out.push(`The business name "${businessName}" is not in the footer bar`)
  return out
}

export interface PageGapContext {
  runId: string
  pageId: string
  pageUrl: string
  isHome: boolean
  enabled: Set<string>
}

/**
 * Run the per-page gap checks on the crawled (shared) page. Returns findings
 * for the enabled checks and stores this page's facts for the run-end checks.
 */
export async function checkPageGaps(page: PlaywrightPage, ctx: PageGapContext): Promise<Finding[]> {
  const pageKeys = [
    "link_targets", "clickable_contact", "empty_clickable", "trademark_symbols", "duplicate_content",
    "text_styling", "form_quality", "page_errors", "active_menu", "blog_content", "outdated_content",
    "social_links", "image_display", ...(ctx.isHome ? ["footer_copyright"] : []),
  ].filter((k) => ctx.enabled.has(k))

  let raw: PageGapRaw
  try {
    raw = await page.evaluate(collect, { brands: TRADEMARK_BRANDS, isHome: ctx.isHome })
  } catch {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {})
    try {
      raw = await page.evaluate(collect, { brands: TRADEMARK_BRANDS, isHome: ctx.isHome })
    } catch (e: any) {
      return pageKeys.map((k) => lapseFinding(k, `the page could not be read (${String(e?.message || e).slice(0, 120)})`, ctx.pageUrl))
    }
  }
  if (raw.blocked) return pageKeys.map((k) => lapseFinding(k, "the site blocked the QACC browser (bot protection)", ctx.pageUrl))

  // Form iframes (Growth99 form widget, embedded form builders).
  if (ctx.enabled.has("form_quality") || ctx.enabled.has("inner_scrollbars")) {
    for (const fr of page.frames().slice(1, 10)) {
      try {
        const el = await fr.frameElement().catch(() => null)
        if (!el || !(await el.isVisible().catch(() => false))) continue
        const ff = await fr.evaluate(collectFrameForm).catch(() => null)
        if (ff) {
          // An iframe taller inside than its box shows a scroll bar unless scrolling is off.
          const scrolling = await el.getAttribute("scrolling").catch(() => null)
          if (scrolling === "no") ff.innerScroll = false
          raw.forms.push(ff)
        }
      } catch {}
      if (raw.forms.length >= 8) break
    }
  }

  // Store facts for the run-end checks (always — run-level checks need every page).
  const facts: PageFacts = {
    ...(raw.facts as any),
    url: ctx.pageUrl,
    images: raw.facts.images.map(imageKey).filter(Boolean),
    bannerImage: imageKey(raw.facts.bannerImage),
    featuredImage: imageKey(raw.facts.featuredImage),
    logo: imageKey(raw.facts.logo),
    links: raw.facts.links.map((l) => ({ ...l, hasImg: l.hasImg ? imageKey(l.hasImg) : undefined })),
    mobileOrder: null,
  }
  putFacts(ctx.runId, facts)

  const f: Finding[] = []
  const add = (key: string, title: string, items: string[], extra = "") => {
    if (!ctx.enabled.has(key) || items.length === 0) return
    f.push(gapFinding(key, title, items, ctx.pageUrl, extra))
  }

  add("link_targets", "Links open in the wrong tab", raw.wrongTab.slice(0, 12))

  const contact: string[] = [
    ...raw.unlinkedPhones.slice(0, 5).map((p) => `Phone ${p} is not clickable (no tel: link)`),
    ...raw.unlinkedEmails.slice(0, 5).map((e) => `Email ${e} is not clickable (no mailto: link)`),
    ...raw.unlinkedAddresses.slice(0, 3).map((a) => `Address "${a}" is not linked to Google Maps`),
  ]
  if (raw.logoNotHome) contact.push(`The header logo does not link to the home page (link: ${raw.logoNotHome})`)
  add("clickable_contact", "Contact details or logo not clickable", contact)

  add("empty_clickable", "Empty or blank areas are clickable", [...new Set(raw.emptyLinks)].slice(0, 10))

  add(
    "trademark_symbols",
    "Trademark symbols missing or not superscripted",
    raw.tm.slice(0, 15).map((t) =>
      t.problem === "missing" ? `${t.brand} has no ™/® symbol — "${t.snippet}"` : `${t.brand}'s symbol is not superscripted — "${t.snippet}"`,
    ),
  )

  const dups = [
    ...raw.dupParagraphs,
    ...raw.dupTitles,
    ...(raw.dupMaps > 0 ? [`The same Google map is embedded ${raw.dupMaps + 1} times`] : []),
    ...(raw.dupHeaders > 1 ? [`${raw.dupHeaders} headers are shown at the top of the page (duplicate header)`] : []),
  ]
  add("duplicate_content", "Duplicate content on the page", dups)

  add("text_styling", "Font, colour or list style inconsistent", [
    ...raw.fontOutliers, ...raw.italicParas, ...raw.lowContrast, ...raw.listStyles, ...raw.doubleBullets,
  ])

  const formItems: string[] = []
  for (const fm of raw.forms) {
    if (!fm.hasConsent) formItems.push(`${fm.where}: no consent checkbox`)
    if (fm.consentChecked.length > 1 && new Set(fm.consentChecked).size > 1) formItems.push(`${fm.where}: one consent box is ticked by default and another is not`)
    for (const l of fm.consentOffsite) formItems.push(`${fm.where}: consent link goes to another site — ${l}`)
    if (fm.allUpper) formItems.push(`${fm.where}: every field forces CAPITAL letters`)
    if (fm.invisibleInput) formItems.push(`${fm.where}: typed text is the same colour as the field (not visible)`)
    for (const e of fm.visibleErrors) formItems.push(`${fm.where}: message showing before anything is submitted — "${e}"`)
    if (fm.innerScroll) formItems.push(`${fm.where}: shows an inner scroll bar — increase the form height`)
  }
  add("form_quality", "Form consent or field problems", formItems)

  add("page_errors", "Errors or raw code showing on the page", raw.errorTexts)

  if (raw.activeMenu && !raw.activeMenu.highlighted)
    add("active_menu", "Current page not highlighted in the menu", [`"${raw.activeMenu.label}" looks the same as the other menu items on its own page`])

  if (raw.blog) {
    const b = raw.blog
    const items: string[] = []
    if (b.internalLinks < 3) items.push(`Only ${b.internalLinks} internal link${b.internalLinks === 1 ? "" : "s"} in the post (add at least 3)`)
    if (b.newTabInternal > 0) items.push(`${b.newTabInternal} internal link(s) open in a new tab`)
    if (b.unstyledInternal > 0) items.push(`${b.unstyledInternal} internal link(s) look like plain text (not bold, coloured or underlined)`)
    if (b.toc) {
      if (b.toc.count > 1) items.push(`The table of contents is added ${b.toc.count} times`)
      for (const x of b.toc.broken) items.push(`TOC link ${x} does not jump to any section`)
      for (const x of b.toc.offPage) items.push(`TOC link ${x} leaves the post`)
      if (b.toc.hidden) items.push("The table of contents text is not visible")
    }
    if (b.duplicateTitle) items.push("The post title is repeated inside the content")
    if (b.uncategorized) items.push('"Uncategorized" is shown as a category')
    if (b.postNav === "missing") items.push("No Previous / Next post links")
    if (b.postNav === "no_titles") items.push("Previous / Next links do not show the post titles")
    add("blog_content", "Blog post links, TOC or formatting problems", items)
  }

  const outdated = raw.outdatedCandidates
    .map((t) => ({ t, why: expiredOfferReason(t) }))
    .filter((x) => x.why)
    .slice(0, 6)
    .map((x) => `"${x.t.slice(0, 100)}" — ${x.why}`)
  add("outdated_content", "Expired offers or dates still shown", outdated)

  add("social_links", "Social media links wrong", raw.socialBad.slice(0, 8))

  add("image_display", "Stretched, broken or missing images", [
    ...raw.stretched,
    ...raw.broken.map((s) => `Broken image (does not load): ${s.split("/").pop()}`),
    ...(raw.emptyImageSpots > 0 ? [`${raw.emptyImageSpots} empty image spot(s) with no picture`] : []),
  ], "Desktop view (1440px).")

  if (ctx.isHome && raw.footer && ctx.enabled.has("footer_copyright")) {
    const name = raw.facts.siteName || (raw.facts.title.split(/[|–—-]/).pop() || "").trim()
    add("footer_copyright", "Footer copyright bar incomplete", footerBarProblems(raw.footer.text, raw.footer.copyrightCount, name))
  }
  return f
}
