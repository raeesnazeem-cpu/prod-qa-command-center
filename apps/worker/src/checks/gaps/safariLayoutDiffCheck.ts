import { Browser } from "playwright"
import { Finding } from "@qacc/shared"
import { gotoResilient, looksBlocked, MOBILE_UA } from "../../lib/browserContext"
import { gapFinding, lapseFinding } from "./findings"

/**
 * safari_layout_diff — Chrome vs Safari layout comparison, free and self-hosted.
 *
 * Replaces what SmartUI did for us, without a paid service. On a few key pages
 * (homepage, contact, about, services — SAFARI_DIFF_PAGES per scan, default 5)
 * the page is loaded in Chromium AND in WebKit (Safari's engine, bundled with
 * Playwright) with the same Safari user agent, at desktop (1440), iPad (820)
 * and iPhone (390). Both are stabilised the same way (animations off, lazy
 * images loaded, fonts ready), then the position, size and visibility of the
 * same elements (by DOM path) are compared. Reported, per device:
 *   • a sideways scroll only in Safari
 *   • something visible in Chrome but hidden / missing in Safari (or reverse)
 *   • an image that fails to load only in Safari
 *   • an element laid out differently (moved sideways or a different width)
 *   • a section much taller / shorter in Safari
 *   • the whole page much taller / shorter in Safari
 * plus a side-by-side Chrome | Safari picture of the first difference.
 *
 * Geometry, not pixels: font smoothing differs between engines on every
 * page, so a pixel diff is all noise; a moved or vanished element is not.
 *
 * Not a real Apple device: this is WebKit on Linux. Apple-only issues (system
 * fonts, iOS video policies on hardware) can still slip through.
 */

export const SAFARI_DIFF_KEY = "safari_layout_diff"
const RUN_MAX_PAGES = Math.max(1, Number(process.env.SAFARI_DIFF_PAGES) || 5)
const runPages = new Map<string, { n: number; t: number }>()

export function releaseSafariDiffBudget(runId: string): void {
  runPages.delete(runId)
}

/** Pages worth comparing: home, contact, about, services landing. Pure — unit-tested. */
export function isKeyPage(pageUrl: string, siteUrl: string): boolean {
  const path = (u: string) => {
    try {
      return new URL(u).pathname.replace(/\/+$/, "").toLowerCase()
    } catch {
      return ""
    }
  }
  const p = path(pageUrl)
  if (p === "" || p === path(siteUrl)) return true
  return /^\/(contact(-us)?|about(-us)?|services?|treatments?|our-services|book(-now)?|appointments?)$/.test(p)
}

function takePage(runId: string, isHome: boolean): boolean {
  const now = Date.now()
  for (const [k, v] of runPages) if (now - v.t > 6 * 3600_000) runPages.delete(k)
  const b = runPages.get(runId) || { n: 0, t: now }
  // The homepage always gets a slot, even if inner pages were crawled first.
  if (b.n >= RUN_MAX_PAGES && !isHome) return false
  b.n++
  b.t = now
  runPages.set(runId, b)
  return true
}

export interface Box {
  key: string
  kind: "section" | "heading" | "text" | "image" | "media" | "button" | "form" | "nav"
  label: string
  x: number
  y: number
  w: number
  h: number
  vis: boolean
  broken?: boolean
}
export interface Layout {
  vw: number
  scrollW: number
  docH: number
  boxes: Box[]
}

/** Runs in the page (both engines). Self-contained. */
function collectBoxes(): Layout {
  const vw = document.documentElement.clientWidth
  const clean = (s: any) => String(s || "").replace(/\s+/g, " ").trim()
  const SKIP = ".swiper, .slick-slider, .owl-carousel, [class*=carousel], [class*=slider], [class*=marquee], [class*=ticker], [aria-hidden='true'], [id*=chat i], [class*=chat i], [id*=userway i], [class*=userway i], #callnowbutton, [class*=cookie i], iframe[src*='recaptcha']"
  const fixedSet = new WeakMap<Element, boolean>()
  const inFixed = (e: Element): boolean => {
    let x: Element | null = e
    for (let i = 0; x && i < 20; i++, x = x.parentElement) {
      if (fixedSet.has(x)) return fixedSet.get(x)!
      const p = getComputedStyle(x).position
      if (p === "fixed" || p === "sticky") { fixedSet.set(x, true); return true }
    }
    return false
  }
  const pathOf = (e: Element): string => {
    const parts: number[] = []
    let x: Element | null = e
    while (x && x !== document.body && parts.length < 40) {
      const parent: Element | null = x.parentElement
      if (!parent) break
      parts.push(Array.prototype.indexOf.call(parent.children, x))
      x = parent
    }
    return parts.reverse().join(".")
  }
  const kindOf = (e: Element): Box["kind"] | null => {
    const t = e.tagName
    if (/^H[1-3]$/.test(t)) return "heading"
    if (t === "P") return "text"
    if (t === "IMG") return "image"
    if (t === "VIDEO" || t === "IFRAME") return "media"
    if (t === "FORM") return "form"
    if (t === "BUTTON" || e.matches("a.elementor-button, .wp-block-button__link, a.btn, a[class*=button]")) return "button"
    if (e.matches("header nav a, [data-elementor-type='header'] nav a")) return "nav"
    if (e.matches("section, .elementor-section, .e-con.e-parent, .wp-block-group, .wp-block-cover, footer, header")) return "section"
    return null
  }
  const boxes: Box[] = []
  const all = document.body.querySelectorAll("h1,h2,h3,p,img,video,iframe,form,button,a,section,.elementor-section,.e-con,.wp-block-group,.wp-block-cover,header,footer")
  for (const e of Array.from(all)) {
    if (boxes.length >= 800) break
    const kind = kindOf(e)
    if (!kind || e.closest(SKIP) || inFixed(e)) continue
    if (kind === "text" && clean((e as HTMLElement).innerText).length < 40) continue
    const r = e.getBoundingClientRect()
    if (kind === "image" && Math.max(r.width, r.height) < 60 && (e as HTMLImageElement).naturalWidth !== 0) continue
    const cs = getComputedStyle(e)
    const vis = r.width >= 1 && r.height >= 1 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05
    const img = e as HTMLImageElement
    boxes.push({
      key: pathOf(e),
      kind,
      label: clean(kind === "image" ? (img.alt || (img.currentSrc || img.src || "").split("/").pop()) : (e as HTMLElement).innerText || e.getAttribute("aria-label") || e.tagName.toLowerCase()).slice(0, 50),
      x: Math.round(r.left + scrollX),
      y: Math.round(r.top + scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
      vis,
      broken: kind === "image" && img.complete && !!(img.currentSrc || img.src) && !/^data:/.test(img.currentSrc || img.src) && img.naturalWidth === 0,
    })
  }
  return { vw, scrollW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, boxes }
}

export interface DiffIssue { text: string; key: string; area: number; box?: Box }

/** Compare the same page in Chrome and Safari at one size. Pure — unit-tested. */
export function compareLayouts(chrome: Layout, safari: Layout, device: string): DiffIssue[] {
  const out: DiffIssue[] = []
  if (safari.scrollW > safari.vw + 2 && chrome.scrollW <= chrome.vw + 2)
    out.push({ text: `${device}: the page scrolls sideways only in Safari (${safari.scrollW - safari.vw}px too wide)`, key: "", area: Infinity })
  const dh = safari.docH - chrome.docH
  if (Math.abs(dh) > Math.max(200, chrome.docH * 0.08))
    out.push({ text: `${device}: the page is ${Math.abs(dh)}px ${dh > 0 ? "taller" : "shorter"} in Safari (${chrome.docH}px in Chrome)`, key: "", area: 1e9 })
  const s = new Map(safari.boxes.map((b) => [b.key, b]))
  const name = (b: Box) => `${b.kind === "section" ? "Section" : b.kind[0].toUpperCase() + b.kind.slice(1)}${b.label ? ` "${b.label}"` : ""}`
  for (const c of chrome.boxes) {
    const sb = s.get(c.key)
    if (!sb) continue
    if (sb.broken && !c.broken) { out.push({ text: `${device}: image ${c.label ? `"${c.label}" ` : ""}fails to load only in Safari`, key: c.key, area: c.w * c.h, box: sb }); continue }
    if (c.vis && !sb.vis && c.w * c.h > 400) { out.push({ text: `${device}: ${name(c)} shows in Chrome but is hidden / missing in Safari`, key: c.key, area: c.w * c.h, box: c }); continue }
    if (!c.vis && sb.vis && sb.w * sb.h > 400) { out.push({ text: `${device}: ${name(sb)} is hidden in Chrome but shows in Safari`, key: c.key, area: sb.w * sb.h, box: sb }); continue }
    if (!c.vis || !sb.vis) continue
    const dx = Math.abs(sb.x - c.x)
    const dw = Math.abs(sb.w - c.w)
    if (dw > Math.max(24, c.w * 0.15) || dx > Math.max(24, chrome.vw * 0.04)) {
      out.push({ text: `${device}: ${name(c)} is laid out differently in Safari (Chrome ${c.w}px wide at x=${c.x}; Safari ${sb.w}px wide at x=${sb.x})`, key: c.key, area: c.w * c.h, box: sb })
      continue
    }
    if (c.kind === "section" && Math.abs(sb.h - c.h) > Math.max(80, c.h * 0.2))
      out.push({ text: `${device}: ${name(c)} is ${Math.abs(sb.h - c.h)}px ${sb.h > c.h ? "taller" : "shorter"} in Safari (${c.h}px in Chrome)`, key: c.key, area: c.w * c.h, box: sb })
  }
  // Report the outermost differences only: a moved section moves its children too.
  out.sort((a, b) => b.area - a.area)
  const kept: DiffIssue[] = []
  for (const i of out) {
    if (i.key && kept.some((k) => k.key && (i.key === k.key || i.key.startsWith(k.key + ".")))) continue
    kept.push(i)
    if (kept.length >= 8) break
  }
  return kept
}

/** Same CSS + scroll in both engines so differences come from the engine, not timing. */
async function stabilise(page: any): Promise<void> {
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.elementor-invisible{visibility:visible!important}" }).catch(() => {})
  await page.evaluate(async () => {
    document.querySelectorAll("video").forEach((v) => { try { (v as HTMLVideoElement).pause() } catch {} })
    const h = document.documentElement.scrollHeight
    for (let y = 0; y < Math.min(h, 20000); y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)) }
    scrollTo(0, 0)
    try { await (document as any).fonts?.ready } catch {}
  }).catch(() => {})
  await page.waitForTimeout(900)
}

const SAFARI_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

async function sideBySide(a: Buffer, b: Buffer): Promise<Buffer | null> {
  try {
    const sharp = require("sharp")
    const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()])
    const h = Math.max(ma.height || 0, mb.height || 0)
    const w = (ma.width || 0) + (mb.width || 0) + 12
    return await sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 80 } } })
      .composite([{ input: a, left: 0, top: 0 }, { input: b, left: (ma.width || 0) + 12, top: 0 }])
      .jpeg({ quality: 70 })
      .toBuffer()
  } catch {
    return null
  }
}

export async function checkSafariLayoutDiff(
  pageUrl: string,
  siteUrl: string,
  runId: string,
  pageId: string,
  chromium: Browser,
): Promise<Finding[]> {
  const isHome = isKeyPage(pageUrl, siteUrl) && (() => { try { return new URL(pageUrl).pathname.replace(/\/+$/, "") === new URL(siteUrl).pathname.replace(/\/+$/, "") } catch { return false } })()
  if (!isKeyPage(pageUrl, siteUrl) || !takePage(runId, isHome)) return []
  let wk: any = null
  try {
    const { webkit } = require("playwright")
    wk = await webkit.launch({ headless: true })
  } catch (e: any) {
    return [lapseFinding(SAFARI_DIFF_KEY, `the Safari (WebKit) engine is not available on this server (${String(e?.message || e).split("\n")[0].slice(0, 100)})`, pageUrl)]
  }
  const { uploadScreenshot } = require("../../lib/supabaseStorage")
  const issues: DiffIssue[] = []
  let evidence: string | null = null
  const opened: any[] = []
  const pair = async (opts: Record<string, any>) => {
    const base = { ignoreHTTPSErrors: true, locale: "en-US", reducedMotion: "reduce" as const, ...opts }
    const [cc, sc] = await Promise.all([chromium.newContext(base), wk.newContext(base)])
    opened.push(cc, sc)
    const [cp, sp] = await Promise.all([cc.newPage(), sc.newPage()])
    const [cn, sn] = await Promise.all([gotoResilient(cp, pageUrl, { timeout: 45000 }), gotoResilient(sp, pageUrl, { timeout: 45000 })])
    if (!cn.ok || !sn.ok) throw new Error(`page did not load (${String((!cn.ok ? cn.error : sn.error) || "").split("\n")[0]})`)
    if ((await looksBlocked(cp)) || (await looksBlocked(sp))) throw new Error("the site blocked the QACC browser (bot protection)")
    await Promise.all([stabilise(cp), stabilise(sp)])
    return { cp, sp }
  }
  const compareNow = async (cp: any, sp: any, device: string) => {
    const [cl, sl] = await Promise.all([cp.evaluate(collectBoxes), sp.evaluate(collectBoxes)])
    const found = compareLayouts(cl, sl, device)
    issues.push(...found)
    const first = found.find((i) => i.box)
    if (first?.box && !evidence) {
      const b = first.box
      const pad = 40
      const cx = Math.max(0, b.x - pad)
      const clip = { x: cx, y: Math.max(0, b.y - pad), width: Math.max(1, Math.min(b.w + pad * 2, cl.vw - cx)), height: Math.max(1, Math.min(b.h + pad * 2, 1200)) }
      const [ca, sa] = await Promise.all([
        cp.screenshot({ type: "jpeg", quality: 70, clip, fullPage: true }).catch(() => null),
        sp.screenshot({ type: "jpeg", quality: 70, clip, fullPage: true }).catch(() => null),
      ])
      const img = ca && sa ? await sideBySide(ca, sa) : null
      if (img) evidence = (await uploadScreenshot(img, `${runId}/safari_diff_${pageId}.jpg`).catch(() => "")) || null
    }
  }
  try {
    const d = await pair({ viewport: { width: 1440, height: 900 }, userAgent: SAFARI_DESKTOP_UA })
    await compareNow(d.cp, d.sp, "Desktop")
    await Promise.all(opened.splice(0).map((c) => c.close().catch(() => {})))

    const m = await pair({ viewport: { width: 820, height: 1180 }, userAgent: MOBILE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await compareNow(m.cp, m.sp, "iPad")
    await Promise.all([m.cp.setViewportSize({ width: 390, height: 844 }), m.sp.setViewportSize({ width: 390, height: 844 })])
    await Promise.all([stabilise(m.cp), stabilise(m.sp)])
    await compareNow(m.cp, m.sp, "iPhone")
  } catch (e: any) {
    if (!issues.length) return [lapseFinding(SAFARI_DIFF_KEY, `the Chrome vs Safari comparison could not run (${String(e?.message || e).split("\n")[0].slice(0, 120)})`, pageUrl)]
  } finally {
    await Promise.all(opened.map((c) => c.close().catch(() => {})))
    await wk?.close().catch(() => {})
  }
  if (!issues.length) return []
  return [
    gapFinding(
      SAFARI_DIFF_KEY,
      "Page looks different in Safari",
      [...new Set(issues.map((i) => i.text))].slice(0, 12),
      pageUrl,
      "Compared Chrome and Safari's engine (WebKit) at desktop 1440px, iPad 820px and iPhone 390px. Picture: Chrome on the left, Safari on the right.",
      evidence,
    ),
  ]
}
