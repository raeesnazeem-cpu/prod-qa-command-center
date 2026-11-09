import { Browser } from "playwright"
import { Finding } from "@qacc/shared"
import { realContextOptions, gotoResilient, looksBlocked } from "../../lib/browserContext"
import { putMobileOrder } from "./factsStore"
import { gapFinding, lapseFinding } from "./findings"

/**
 * QA-gap layout checks at tablet and mobile width — every page, own context.
 *
 * Loads the page ONCE at desktop width (1440), then resizes the same page to
 * 1024 (tablet landscape), 820 (tablet) and 390 (mobile), reading the rendered
 * layout at each width. Deterministic geometry only — no AI:
 *   spacing_alignment   text touching the screen edge; same buttons in one row not level
 *   text_wrapping       a heading's last line is one word; short button text wraps; text spills out of its box
 *   font_sizes          headings too big / body text too small for the device
 *   equal_sizes         cards or images in one row with different heights
 *   inner_scrollbars    a section or form shows its own scroll bar
 *   narrow_content      long paragraphs using < 70% of the phone width
 *   sticky_header_mobile header sticky / transparent on desktop but not on tablet/mobile (or the reverse); content sliding over it
 *   widget_overlap      floating widgets covering each other, the header logo or the Growth99 footer logo
 *   tablet_layout       side-by-side desktop sections stacked at 1024px
 *   image_display       stretched images, oversized logo, images that disappear on mobile
 *   cart_mobile         (homepage, shop sites) cart missing or doubled in the mobile header
 * plus the per-section image/text order on mobile for the run-end mobile_order check.
 */

const VIEWS = [
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
] as const

export const RESPONSIVE_KEYS = [
  "spacing_alignment", "text_wrapping", "font_sizes", "equal_sizes", "inner_scrollbars", "narrow_content",
  "sticky_header_mobile", "widget_overlap", "tablet_layout", "image_display", "cart_mobile", "mobile_order",
]

interface HeaderState { found: boolean; sticky: boolean; transparent: boolean; overlapped: string }
interface PhaseOut {
  edge: string[]
  buttons: string[]
  orphans: string[]
  buttonWrap: string[]
  overflowText: string[]
  fonts: string[]
  equal: string[]
  scrollers: string[]
  narrow: string[]
  header: HeaderState
  widgets: string[]
  stretched: string[]
  logoBig: string
  goneImages: string[]
  stacked: string[]
  order: { imageFirst: string[]; textFirst: string[] }
  cart: string
}

/** Runs in the page. Self-contained. */
export async function collectLayout(arg: { phase: "desktop" | "t1024" | "tablet" | "mobile"; isHome: boolean }): Promise<PhaseOut> {
  const vw = innerWidth
  const out: PhaseOut = {
    edge: [], buttons: [], orphans: [], buttonWrap: [], overflowText: [], fonts: [], equal: [], scrollers: [], narrow: [],
    header: { found: false, sticky: false, transparent: false, overlapped: "" }, widgets: [], stretched: [], logoBig: "",
    goneImages: [], stacked: [], order: { imageFirst: [], textFirst: [] }, cart: "",
  }
  const clean = (s: any) => String(s || "").replace(/\s+/g, " ").trim()
  const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const vis = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const a = el as any
    if (typeof a.checkVisibility === "function") return a.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    const cs = getComputedStyle(el)
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0"
  }
  const HEADER_SEL = 'header, [data-elementor-type="header"], #masthead, .site-header'
  const FOOTER_SEL = 'footer, [data-elementor-type="footer"], #colophon, .site-footer'
  const CHROME = `${HEADER_SEL}, ${FOOTER_SEL}, nav, [class*=chat i], [id*=chat i], [class*=userway i], [id*=userway i], #callnowbutton`
  const inChrome = (e: Element) => !!e.closest(CHROME)
  const main = document.querySelector("main, #main, #content, .site-main, [role=main]") || document.body
  const headingNear = (e: Element): string => {
    let x: Element | null = e
    for (let i = 0; x && i < 8; i++, x = x.parentElement) {
      const h = x.querySelector("h1,h2,h3,h4")
      if (h && clean(h.textContent)) return short(clean(h.textContent), 50)
    }
    return ""
  }
  const where = (e: Element) => { const h = headingNear(e); return h ? ` (section "${h}")` : "" }
  const isFlexRow = (e: Element) => { const d = getComputedStyle(e).display; return /flex|grid/.test(d) }
  const kids = (e: Element) => Array.from(e.children).filter((c) => vis(c) && !/^(SCRIPT|STYLE|BR)$/.test(c.tagName))
  const sideBySide = (cs: Element[]) => {
    if (cs.length < 2) return false
    const r = cs.map((c) => c.getBoundingClientRect())
    return r.every((x) => Math.abs(x.top - r[0].top) < 12) && new Set(r.map((x) => Math.round(x.left))).size === r.length
  }

  // ---------- desktop: tag two-to-four column sections, tag visible images
  if (arg.phase === "desktop") {
    let i = 0
    for (const e of Array.from(main.querySelectorAll("*")).slice(0, 6000)) {
      if (i >= 60 || inChrome(e) || !isFlexRow(e) || e.hasAttribute("data-qacc-sec")) continue
      const cs = kids(e)
      if (cs.length < 2 || cs.length > 4) continue
      const er = e.getBoundingClientRect()
      if (er.width < vw * 0.55 || !sideBySide(cs)) continue
      if (cs.some((c) => c.getBoundingClientRect().width < er.width * 0.2)) continue
      if (e.closest(".swiper, .slick-slider, .owl-carousel, [class*=carousel], [class*=slider], [class*=gallery]")) continue
      e.setAttribute("data-qacc-sec", String(i++))
      cs.forEach((c, k) => {
        const txt = clean((c as HTMLElement).innerText)
        const big = Array.from(c.querySelectorAll("img, video, iframe")).some((m) => { const r = m.getBoundingClientRect(); const cr = c.getBoundingClientRect(); return r.width * r.height > cr.width * cr.height * 0.35 })
        const bg = getComputedStyle(c).backgroundImage
        const isImg = (big || (bg && bg !== "none" && /url\(/.test(bg))) && txt.length < 60
        const isText = txt.length >= 80 || !!c.querySelector("form")
        c.setAttribute("data-qacc-col", `${k}:${isImg ? "img" : isText ? "text" : "other"}`)
      })
    }
    for (const img of Array.from(main.querySelectorAll("img")).slice(0, 400)) {
      const r = img.getBoundingClientRect()
      if (!inChrome(img) && vis(img) && r.width >= 120 && r.height >= 90) img.setAttribute("data-qacc-dv", "1")
    }
  }

  // ---------- tablet landscape: which desktop side-by-side sections stack
  if (arg.phase === "t1024") {
    for (const e of Array.from(document.querySelectorAll("[data-qacc-sec]"))) {
      const cs = kids(e)
      if (cs.length < 2) continue
      if (!sideBySide(cs)) out.stacked.push(headingNear(e) || `section ${e.getAttribute("data-qacc-sec")}`)
    }
    return out
  }

  const device = arg.phase === "desktop" ? "desktop" : arg.phase
  // ---------- buttons in one row not level
  const BTN = "a.elementor-button, .wp-block-button__link, a.btn, a[class*=button], button:not([class*=toggle]):not([aria-label*=menu i])"
  const btns = Array.from(main.querySelectorAll(BTN)).filter((b) => vis(b) && !inChrome(b) && !b.closest("form")).slice(0, 200)
  const colOf = (b: Element): Element | null => {
    let x: Element | null = b
    for (let i = 0; x && x.parentElement && i < 12; i++, x = x.parentElement) {
      const p = x.parentElement
      if (isFlexRow(p) && kids(p).length >= 2 && sideBySide(kids(p))) return x
    }
    return null
  }
  const byText = new Map<string, Element[]>()
  for (const b of btns) { const k = clean(b.textContent).toLowerCase(); if (k && k.length < 40) byText.set(k, [...(byText.get(k) || []), b]) }
  const reported = new Set<Element>()
  for (const [txt, group] of byText) {
    for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
      const ca = colOf(group[a]), cb = colOf(group[b])
      if (!ca || !cb || ca === cb || ca.parentElement !== cb.parentElement || reported.has(ca.parentElement!)) continue
      const d = Math.abs(group[a].getBoundingClientRect().top - group[b].getBoundingClientRect().top)
      if (d >= 4 && d < 120) { reported.add(ca.parentElement!); if (out.buttons.length < 5) out.buttons.push(`"${short(txt, 30)}" buttons in one row are ${Math.round(d)}px apart (not on one line)${where(ca)}`) }
    }
  }

  // ---------- equal card / image sizes
  const rows = Array.from(main.querySelectorAll("*")).filter((e) => isFlexRow(e) && !inChrome(e) && !e.closest(".swiper, .slick-slider, .owl-carousel")).slice(0, 4000)
  for (const r of rows) {
    if (out.equal.length >= 5) break
    const cs = kids(r)
    if (cs.length < 3 || !sideBySide(cs)) continue
    const rects = cs.map((c) => c.getBoundingClientRect())
    const w0 = rects[0].width
    if (!rects.every((x) => Math.abs(x.width - w0) / w0 < 0.1) || w0 < 120) continue
    const cards = cs.filter((c) => c.querySelector("img, h2, h3, h4"))
    if (cards.length !== cs.length) continue
    // A card's visible box: its own height unless its background is transparent and it holds one boxed child.
    const hs = cs.map((c) => c.getBoundingClientRect().height)
    const mn = Math.min(...hs), mx = Math.max(...hs)
    const boxed = cs.some((c) => { const s = getComputedStyle(c); return (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent") || parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== "none" })
    if (boxed && mx - mn > 24 && (mx - mn) / mx > 0.15) out.equal.push(`Cards in one row have different heights (${hs.map((h) => Math.round(h)).join(" / ")}px)${where(r)}`)
    const ih = cs.map((c) => { const im = c.querySelector("img"); return im ? im.getBoundingClientRect().height : 0 }).filter((h) => h > 30)
    if (ih.length === cs.length) {
      const a = Math.min(...ih), b = Math.max(...ih)
      if (b - a > 12 && (b - a) / b > 0.1) out.equal.push(`Images in one row have different heights (${ih.map((h) => Math.round(h)).join(" / ")}px)${where(r)}`)
    }
  }

  // ---------- header sticky / transparent / overlapped
  const headers = Array.from(document.querySelectorAll(HEADER_SEL)).filter((h) => vis(h))
  const header = headers.find((h) => !headers.some((o) => o !== h && o.contains(h))) || null
  if (header) {
    out.header.found = true
    const opaque = (e: Element) => { const s = getComputedStyle(e); const c = (s.backgroundColor.match(/[\d.]+/g) || []).map(Number); return (s.backgroundImage !== "none" && /url|gradient/.test(s.backgroundImage)) || (c.length >= 3 && (c.length < 4 || c[3] > 0.3)) }
    scrollTo(0, 0)
    await sleep(250)
    const hr = header.getBoundingClientRect()
    const layers = [header, ...Array.from(header.querySelectorAll("*")).filter((e) => { const r = e.getBoundingClientRect(); return r.width > hr.width * 0.8 && r.height > hr.height * 0.6 })]
    out.header.transparent = !layers.some(opaque)
    scrollTo(0, Math.min(900, document.documentElement.scrollHeight - innerHeight))
    await sleep(500)
    const parts = [header, ...Array.from(header.querySelectorAll("*")).slice(0, 400)]
    const stuck = parts.find((e) => { const r = e.getBoundingClientRect(); const p = getComputedStyle(e).position; return (p === "fixed" || p === "sticky") && r.top > -3 && r.top < 12 && r.height > 30 && r.width > vw * 0.6 && vis(e) })
    out.header.sticky = !!stuck && scrollY > 200
    if (stuck) {
      const r = stuck.getBoundingClientRect()
      for (const x of [r.left + r.width * 0.25, r.left + r.width * 0.5, r.left + r.width * 0.75]) {
        const el = document.elementFromPoint(x, r.top + r.height / 2)
        if (el && !stuck.contains(el) && !el.closest(HEADER_SEL) && !el.closest("[class*=chat i], [id*=userway i], #callnowbutton") && getComputedStyle(el).position !== "fixed") {
          out.header.overlapped = short(clean((el as HTMLElement).innerText) || el.tagName.toLowerCase(), 40)
          break
        }
      }
    }
    scrollTo(0, 0)
    await sleep(200)
  }

  if (arg.phase === "desktop") return out

  // ---------- text touching the edge, wrapping, overflow, fonts, narrow
  const textEls = Array.from(main.querySelectorAll("h1,h2,h3,h4,p,li,a.elementor-button,.wp-block-button__link,a.btn,button")).filter((e) => !inChrome(e) && vis(e) && !e.closest(".swiper, .slick-slider, .owl-carousel, [class*=marquee], [class*=ticker]")).slice(0, 900)
  const range = document.createRange()
  for (const e of textEls) {
    const txt = clean((e as HTMLElement).innerText)
    if (!txt) continue
    // Rects of the TEXT only — an element's own box (button padding, inner
    // spans) would otherwise count as an extra "line".
    const rects: DOMRect[] = []
    const tw0 = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
    let t0: Node | null
    while ((t0 = tw0.nextNode()) && rects.length < 200) {
      if (!(t0.nodeValue || "").trim()) continue
      range.selectNodeContents(t0)
      for (const r of Array.from(range.getClientRects())) if (r.width > 1 && r.height > 1) rects.push(r)
    }
    if (!rects.length) continue
    const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right))
    // Distinct lines: tops more than half a line apart.
    const lineTops: number[] = []
    for (const r of [...rects].sort((a, b) => a.top - b.top)) if (!lineTops.length || r.top - lineTops[lineTops.length - 1] > r.height / 2) lineTops.push(r.top)
    if ((left < 6 || right > vw - 6) && left > -2 && right < vw + 2 && out.edge.length < 5) out.edge.push(`"${short(txt, 40)}" touches the screen edge (${Math.round(left)}px / ${Math.round(vw - right)}px from the sides)`)
    const tag = e.tagName
    const isBtn = !/^(H\d|P|LI)$/.test(tag)
    const lines = lineTops.length
    if (isBtn && lines > 1 && txt.split(" ").length <= 4 && txt.length < 32 && out.buttonWrap.length < 5) out.buttonWrap.push(`Button "${txt}" breaks onto ${lines} lines`)
    if (/^H[1-4]$/.test(tag) && txt.split(" ").length >= 3 && out.orphans.length < 6) {
      // word-level lines: one rect per word, grouped by mid-point (mixed font sizes share a line)
      const fsz = parseFloat(getComputedStyle(e).fontSize) || 16
      const words: { w: string; top: number }[] = []
      const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
      let tn: Node | null
      while ((tn = tw.nextNode()) && words.length < 40) {
        const s = tn.nodeValue || ""
        const re = /\S+/g
        let m: RegExpExecArray | null
        while ((m = re.exec(s)) && words.length < 40) {
          range.setStart(tn, m.index)
          range.setEnd(tn, m.index + m[0].length)
          const r = range.getBoundingClientRect()
          if (r.width > 0) words.push({ w: m[0], top: Math.round(r.top + r.height / 2) })
        }
      }
      const tops = [...new Set(words.map((w) => w.top))].sort((a, b) => a - b)
      const merged: number[] = []
      for (const tp of tops) if (!merged.length || tp - merged[merged.length - 1] > fsz * 0.6) merged.push(tp)
      if (merged.length >= 2) {
        const last = merged[merged.length - 1]
        const lastWords = words.filter((w) => Math.abs(w.top - last) <= fsz * 0.6)
        if (lastWords.length === 1 && lastWords[0].w.length > 1) out.orphans.push(`Heading "${short(txt, 45)}" leaves "${lastWords[0].w}" alone on the last line`)
      }
    }
    const el = e as HTMLElement
    if (/^(H\d|P)$/.test(tag) && el.scrollWidth > el.clientWidth + 3 && getComputedStyle(el).overflowX === "visible" && out.overflowText.length < 5) out.overflowText.push(`"${short(txt, 40)}" runs outside its box`)
    const fs = parseFloat(getComputedStyle(e).fontSize)
    const lim: Record<string, [number, number]> = arg.phase === "mobile" ? { H1: [0, 40], H2: [0, 34], H3: [0, 30], P: [13, 99], LI: [13, 99] } : { H1: [0, 60], H2: [0, 48], P: [13, 99], LI: [13, 99] }
    const l = lim[tag]
    if (l && (fs < l[0] || fs > l[1]) && out.fonts.length < 5 && txt.length > 3) out.fonts.push(`${tag} "${short(txt, 40)}" is ${Math.round(fs)}px — ${fs > l[1] ? "too big" : "too small"} for ${device}`)
    if (arg.phase === "mobile" && tag === "P" && txt.split(" ").length >= 25 && rects.length) {
      const w = right - left
      if (w < vw * 0.7 && out.narrow.length < 4) out.narrow.push(`Paragraph "${short(txt, 40)}" uses only ${Math.round((w / vw) * 100)}% of the screen width`)
    }
  }

  // ---------- inner scroll bars
  for (const e of Array.from(document.querySelectorAll("body *")).slice(0, 8000)) {
    if (out.scrollers.length >= 4) break
    if (/^(HTML|BODY|TEXTAREA|SELECT|PRE|CODE|IFRAME|svg)$/i.test(e.tagName)) continue
    if (e.closest("nav, .menu, [class*=menu], .swiper, .slick-slider, .owl-carousel, [class*=carousel], [class*=slider], [class*=chat i], [id*=chat i], [id*=userway i], [class*=dropdown], [role=dialog], [class*=popup], [class*=modal]")) continue
    const s = getComputedStyle(e)
    if (!/(auto|scroll)/.test(s.overflowY)) continue
    const el = e as HTMLElement
    if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 100 && el.clientWidth > 150 && vis(e)) out.scrollers.push(`${e.querySelector("form") || e.closest("form") ? "Form" : "Section"}${where(e)} shows an inner scroll bar (${el.scrollHeight}px of content in a ${el.clientHeight}px box)`)
  }

  // ---------- images: stretched, gone on this device, oversized logo
  for (const img of Array.from(document.querySelectorAll("img")).slice(0, 400) as HTMLImageElement[]) {
    const r = img.getBoundingClientRect()
    const seen = vis(img)
    if (img.getAttribute("data-qacc-dv") === "1" && !seen && out.goneImages.length < 5) out.goneImages.push(`${(img.currentSrc || img.src).split("/").pop()} is shown on desktop but hidden on ${device}${where(img)}`)
    if (!seen || !img.naturalWidth || r.width < 60 || r.height < 60 || inChrome(img)) continue
    const fit = getComputedStyle(img).objectFit
    if (fit === "fill" || fit === "") {
      const nr = img.naturalWidth / img.naturalHeight, rr = r.width / r.height
      if (Math.abs(rr - nr) / nr > 0.1 && out.stretched.length < 5) out.stretched.push(`${(img.currentSrc || img.src).split("/").pop()} is ${rr > nr ? "stretched" : "squeezed"} on ${device} (${Math.round(r.width)}×${Math.round(r.height)}, file ${img.naturalWidth}×${img.naturalHeight})`)
    }
  }
  if (header) {
    const logo = header.querySelector('.custom-logo, img[class*=logo i], img[src*=logo i], img[alt*=logo i]') as HTMLImageElement | null
    if (logo && vis(logo)) {
      const r = logo.getBoundingClientRect()
      if (r.height > (arg.phase === "mobile" ? 90 : 120) || r.width > vw * 0.75) out.logoBig = `The header logo is ${Math.round(r.width)}×${Math.round(r.height)}px on ${device} — too large`
    }
  }

  // ---------- floating widgets overlapping
  const fixedEls = () => Array.from(document.querySelectorAll("body *")).filter((e) => {
    const s = getComputedStyle(e)
    if (s.position !== "fixed" || !vis(e)) return false
    const r = e.getBoundingClientRect()
    if (r.width < 24 || r.height < 24 || r.width * r.height > vw * innerHeight * 0.35) return false
    if (e.closest(HEADER_SEL) || r.top < 5 && r.width > vw * 0.8) return false
    return true
  }).filter((e, _i, all) => !all.some((o) => o !== e && o.contains(e)))
  const nameOf = (e: Element) => {
    const id = `${e.id} ${e.getAttribute("class") || ""} ${e.getAttribute("aria-label") || ""} ${clean((e as HTMLElement).innerText).slice(0, 20)}`.toLowerCase()
    if (/userway|accessib|ada/.test(id)) return "ADA button"
    if (/callnow|call-now|\bcall\b/.test(id)) return "Call button"
    if (/chat|cliffhanger/.test(id)) return "Chatbot"
    if (/text.?us|sms/.test(id)) return "Text-us button"
    if (/book|appointment/.test(id)) return "Book button"
    if (/scroll.?top|back.?to.?top|go.?top/.test(id)) return "Back-to-top button"
    return short(clean((e as HTMLElement).innerText) || e.tagName.toLowerCase(), 20) || "widget"
  }
  const overlap = (a: DOMRect, b: DOMRect) => { const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)); const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); return (x * y) / Math.min(a.width * a.height, b.width * b.height) }
  const pairCheck = (when: string, extra: { name: string; rect: DOMRect } | null) => {
    const els = fixedEls()
    for (let i = 0; i < els.length; i++) {
      const ri = els[i].getBoundingClientRect()
      for (let j = i + 1; j < els.length; j++) {
        if (overlap(ri, els[j].getBoundingClientRect()) > 0.15 && out.widgets.length < 6) out.widgets.push(`${nameOf(els[i])} overlaps ${nameOf(els[j])} on ${device} (${when})`)
      }
      if (extra && overlap(ri, extra.rect) > 0.1 && out.widgets.length < 6) out.widgets.push(`${nameOf(els[i])} covers the ${extra.name} on ${device}`)
    }
  }
  scrollTo(0, 0)
  await sleep(200)
  const hLogo = header?.querySelector('.custom-logo, img[class*=logo i], img[src*=logo i]') as Element | null
  pairCheck("top of page", hLogo && vis(hLogo) ? { name: "header logo", rect: hLogo.getBoundingClientRect() } : null)
  const g99 = Array.from(document.querySelectorAll(`${FOOTER_SEL.split(",").map((s) => s + " a[href*=growth99], " + s + " img[src*=growth99], " + s + " img[alt*=growth99 i]").join(",")}`))[0] || null
  scrollTo(0, document.documentElement.scrollHeight)
  await sleep(450)
  pairCheck("bottom of page", g99 && vis(g99) ? { name: "Growth99 footer logo", rect: g99.getBoundingClientRect() } : null)
  scrollTo(0, 0)

  // ---------- image / text order on mobile
  if (arg.phase === "mobile") {
    for (const sec of Array.from(document.querySelectorAll("[data-qacc-sec]"))) {
      const cols = Array.from(sec.children).filter((c) => c.hasAttribute("data-qacc-col"))
      const img = cols.find((c) => /:img$/.test(c.getAttribute("data-qacc-col")!))
      const txt = cols.find((c) => /:text$/.test(c.getAttribute("data-qacc-col")!))
      if (cols.length !== 2 || !img || !txt || !vis(img) || !vis(txt)) continue
      const label = headingNear(txt) || `section ${sec.getAttribute("data-qacc-sec")}`
      if (img.getBoundingClientRect().top <= txt.getBoundingClientRect().top) out.order.imageFirst.push(label)
      else out.order.textFirst.push(label)
    }
    // ---------- cart on mobile (shop sites)
    if (arg.isHome && (document.body.classList.contains("woocommerce-js") || document.querySelector('a[href*="/cart"]'))) {
      const cartSel = 'a[href*="/cart"], .cart-contents, .elementor-menu-cart__toggle, .wc-block-mini-cart, [class*=mini-cart]'
      const inHeader = header ? Array.from(header.querySelectorAll(cartSel)).filter(vis) : []
      const outer = inHeader.filter((e) => !inHeader.some((o) => o !== e && o.contains(e)))
      const inMenu = document.querySelector(`nav.elementor-nav-menu--dropdown ${cartSel.split(",")[0]}, .mobile-menu a[href*="/cart"], #mobile-menu a[href*="/cart"]`)
      if (outer.length === 0 && !inMenu) out.cart = "No cart icon in the mobile header or hamburger menu"
      else if (outer.length > 1) out.cart = `The cart icon shows ${outer.length} times in the mobile header`
    }
  }
  return out
}

export async function checkResponsiveGaps(
  pageUrl: string,
  runId: string,
  browser: Browser,
  enabled: Set<string>,
  isHome: boolean,
): Promise<Finding[]> {
  const keys = RESPONSIVE_KEYS.filter((k) => enabled.has(k) && (k !== "cart_mobile" || isHome))
  if (keys.length === 0) return []
  let context: any = null
  try {
    context = await browser.newContext(realContextOptions({ viewport: { width: 1440, height: 900 } }))
    const page = await context.newPage()
    const nav = await gotoResilient(page, pageUrl, { timeout: 45000 })
    if (!nav.ok) return keys.filter((k) => k !== "mobile_order").map((k) => lapseFinding(k, `the page could not be loaded (${String(nav.error || "").split("\n")[0]})`, pageUrl))
    if (await looksBlocked(page)) return keys.filter((k) => k !== "mobile_order").map((k) => lapseFinding(k, "the site blocked the QACC browser (bot protection)", pageUrl))
    // Trigger lazy-loaded images once, then back to the top.
    await page.evaluate(async () => {
      const h = document.documentElement.scrollHeight
      for (let y = 0; y < Math.min(h, 20000); y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)) }
      scrollTo(0, 0)
    }).catch(() => {})
    await page.waitForTimeout(600)

    const desktop: PhaseOut = await page.evaluate(collectLayout, { phase: "desktop", isHome })
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.waitForTimeout(700)
    const t1024: PhaseOut = await page.evaluate(collectLayout, { phase: "t1024", isHome })
    const phases: Record<string, PhaseOut> = {}
    for (const v of VIEWS) {
      await page.setViewportSize({ width: v.width, height: v.height })
      await page.waitForTimeout(800)
      phases[v.name] = await page.evaluate(collectLayout, { phase: v.name, isHome })
    }
    const tab = phases.tablet, mob = phases.mobile
    putMobileOrder(runId, pageUrl, mob.order)

    const f: Finding[] = []
    const add = (key: string, title: string, items: string[]) => {
      const uniq = [...new Set(items)]
      if (enabled.has(key) && uniq.length) f.push(gapFinding(key, title, uniq.slice(0, 12), pageUrl, "Checked at 1440px (desktop), 1024px, 820px (tablet) and 390px (mobile)."))
    }
    add("spacing_alignment", "Uneven spacing or alignment", [
      ...tab.edge.map((s) => `Tablet: ${s}`), ...mob.edge.map((s) => `Mobile: ${s}`),
      ...desktop.buttons.map((s) => `Desktop: ${s}`), ...tab.buttons.map((s) => `Tablet: ${s}`),
    ])
    add("text_wrapping", "Awkward text wrapping", [
      ...tab.orphans.map((s) => `Tablet: ${s}`), ...mob.orphans.map((s) => `Mobile: ${s}`),
      ...tab.buttonWrap.map((s) => `Tablet: ${s}`), ...mob.buttonWrap.map((s) => `Mobile: ${s}`),
      ...tab.overflowText.map((s) => `Tablet: ${s}`), ...mob.overflowText.map((s) => `Mobile: ${s}`),
    ])
    add("font_sizes", "Font size not right for the device", [...tab.fonts, ...mob.fonts])
    add("equal_sizes", "Cards or images in one row are not the same size", [
      ...desktop.equal.map((s) => `Desktop: ${s}`), ...tab.equal.map((s) => `Tablet: ${s}`),
    ])
    add("inner_scrollbars", "Scroll bar inside a section or form", [
      ...tab.scrollers.map((s) => `Tablet: ${s}`), ...mob.scrollers.map((s) => `Mobile: ${s}`),
    ])
    add("narrow_content", "Content too narrow on mobile", mob.narrow)
    const hd: string[] = []
    if (desktop.header.found) {
      for (const [name, p] of [["tablet", tab], ["mobile", mob]] as const) {
        if (desktop.header.sticky && !p.header.sticky) hd.push(`Header is sticky on desktop but not on ${name}`)
        if (!desktop.header.sticky && p.header.sticky) hd.push(`Header is sticky on ${name} but not on desktop`)
        if (desktop.header.transparent !== p.header.transparent) hd.push(`Header is ${desktop.header.transparent ? "transparent" : "solid"} on desktop but ${p.header.transparent ? "transparent" : "solid"} on ${name}`)
      }
      for (const [name, p] of [["desktop", desktop], ["tablet", tab], ["mobile", mob]] as const)
        if (p.header.overlapped) hd.push(`On ${name}, page content ("${p.header.overlapped}") slides over the sticky header while scrolling`)
    }
    add("sticky_header_mobile", "Sticky / transparent header differs by device", hd)
    add("widget_overlap", "Floating widgets overlapping", [...tab.widgets, ...mob.widgets])
    add("tablet_layout", "Tablet layout does not match desktop", t1024.stacked.slice(0, 8).map((s) => `Side by side on desktop but stacked at 1024px: "${s}"`))
    add("image_display", "Stretched, hidden or oversized images (tablet / mobile)", [
      ...tab.stretched, ...mob.stretched, ...tab.goneImages, ...mob.goneImages,
      ...(tab.logoBig ? [tab.logoBig] : []), ...(mob.logoBig ? [mob.logoBig] : []),
    ])
    if (isHome && mob.cart) add("cart_mobile", "Cart missing or doubled on mobile", [mob.cart])
    return f
  } catch (e: any) {
    return keys.filter((k) => k !== "mobile_order").map((k) => lapseFinding(k, `the layout could not be measured (${String(e?.message || e).split("\n")[0].slice(0, 120)})`, pageUrl))
  } finally {
    await context?.close().catch(() => {})
  }
}
