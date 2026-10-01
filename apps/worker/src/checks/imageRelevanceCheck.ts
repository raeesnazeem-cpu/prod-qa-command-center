import { Browser } from "playwright"
import { Finding, aiFailureReason } from "@qacc/shared"
import { completeTextIsolated, describeImageResult } from "../lib/aiFallback"
import { slugFromUrl, stripBrand } from "./urlTabMatchingCheck"
import pLimit from "p-limit"
import pino from "pino"

const logger = pino({ level: process.env.LOG_LEVEL || "info" })

/**
 * Image Relevance — FULL SCAN ONLY (service pages)
 * ------------------------------------------------
 * On every service page, the content images must fit the service the page is
 * about: a "Botox" page shows injections / faces / results, not a dental chair
 * or a body-contouring machine.
 *
 * Which pages:
 *   • Homepage → never (the caller does not schedule it, and we re-check here
 *     against the final URL after redirects).
 *   • Utility pages (contact, about, blog, privacy, gallery …) and WP blog /
 *     archive / 404 templates → not service pages, no result row.
 *   • Service pages are recognised by, in order:
 *       1. URL — a /services/, /treatments/, /procedures/ … path segment, or a
 *          slug like "acne-treatment" (the bare "/services/" hub is excluded);
 *       2. WP body class — single-services / single-treatment …;
 *       3. Site menu — the page is linked under a "Services"/"Treatments" menu;
 *       4. Text AI — reads heading + title + copy and decides. If the AI cannot
 *          answer, the page records a tool lapse (never a silent skip).
 *
 * Which images: every <img> (lazy ones loaded by scrolling first) and every CSS
 * background image inside the page content. Header, footer, nav, popups,
 * sidebars, logos/icons/badges, testimonial/review/related-services blocks and
 * image cards that link to ANOTHER page are left out — they are not meant to
 * depict this service.
 *
 * Verdict (AI vision, per image): relevant / neutral / irrelevant. Neutral is
 * generic brand imagery (staff, clinic, logo, a smiling model) that is fine on
 * any page. A page FAILS when:
 *   • an image clearly shows something else (double-checked by a second vision
 *     question before it is reported), or
 *   • none of its images actually shows the service, or
 *   • it has no content images at all.
 * It PASSES only when every checked image was read and at least one is
 * relevant. Anything QACC could not verify (vision down, image unreadable,
 * page did not load) is a tool lapse, so the report says "could not complete"
 * rather than passing.
 *
 * Signature mirrors the all-pages browser-owning checks; the caller schedules it
 * only for run_type === "full_scan".
 */

const CHECK_FACTOR = "image_relevance"

const MAX_IMAGES = Math.max(1, Number(process.env.IMAGE_RELEVANCE_MAX_IMAGES || 10))
// When none of the first MAX_IMAGES images is relevant, keep looking (up to this
// many) before declaring "no relevant image" — the right one may just be smaller.
const MAX_IMAGES_EXTENDED = Math.max(MAX_IMAGES, Number(process.env.IMAGE_RELEVANCE_MAX_IMAGES_EXTENDED || 20))
const IRRELEVANT_MIN_CONFIDENCE = Number(process.env.IMAGE_RELEVANCE_MIN_CONFIDENCE || 0.7)
const RELEVANT_MIN_CONFIDENCE = 0.5
const SERVICE_AI_MIN_CONFIDENCE = 0.6
const MIN_RENDER_W = 120
const MIN_RENDER_H = 100
const MIN_RENDER_AREA = 20000
const MIN_NATURAL = 150

// Real desktop UA — Cloudflare-fronted staging sites 403 "HeadlessChrome".
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// ---------------------------------------------------------------------------
// Page classification (pure, unit-tested)
// ---------------------------------------------------------------------------

const SERVICE_SEGMENT = /(^|-)(services?|treatments?|procedures?|therap(y|ies)|conditions?|concerns?)($|-)/i
// A bare listing hub ("/services/", "/our-treatments/") lists many services, so
// its images legitimately show many different things.
const HUB_SLUG = /^((our|all|view-all|medical|med-spa|spa)-)?(services?|treatments?|procedures?|therap(y|ies)|conditions?|concerns?)$/i
// Any segment that puts the page in a non-service section.
const EXCLUDED_SECTION = /^(blog|blogs|news|articles?|category|tag|author|feed|shop|store|products?|cart|checkout|my-account|events?|wp-content|wp-admin|wp-json)$/i
const EXCLUDED_SLUG = new RegExp(
  "^(" +
    [
      "contact(-us)?", "about(-us)?", "our-story", "who-we-are", "meet-.*", "team", "our-team", "staff",
      "providers?", "doctors?", "our-doctors?", "physicians?", "privacy.*", "terms.*", "accessibility.*",
      "cookie.*", "disclaimer", "legal", "sitemap", "faqs?", "frequently-asked-questions", "reviews?",
      "testimonials?", "gallery", "photo-gallery", "before-(and-)?after.*", "results", "careers?", "jobs",
      "specials?", "offers?", "promotions?", "deals", "financing", "payment.*", "pricing", "memberships?",
      "book.*", "appointments?", "schedule.*", "request-.*", "consultation", "virtual-consultation",
      "thank-?you.*", "locations?", "directions", "press", "media", "patient-.*", "new-patients?",
      "forms", "login", "register", "search", "404", "coming-soon", "maintenance", "referral.*",
      "gift-cards?", "blog", "news", "home",
    ].join("|") +
    ")$",
  "i",
)
// Booking-type links: an image wrapped in one of these still belongs to this page.
const BOOKING_LINK = /(contact|book|appointment|schedule|consult|request|reserve)/i

const normHost = (h: string) => (h || "").toLowerCase().replace(/^www\./, "")

/** Comparable form of a URL: host + path, no scheme/www/trailing slash/query/hash. */
export function normalizePageUrl(u: string): string {
  try {
    const x = new URL(u)
    const path = x.pathname.replace(/\/index\.(php|html?)$/i, "/").replace(/\/+$/, "")
    return `${normHost(x.hostname)}${path}`.toLowerCase()
  } catch {
    return (u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase()
  }
}

export type UrlClass =
  | { kind: "home" }
  | { kind: "excluded"; reason: string }
  | { kind: "service"; reason: string }
  | { kind: "unknown" }

/** Classify a page from its URL alone. */
export function classifyByUrl(pageUrl: string, siteUrl: string): UrlClass {
  if (normalizePageUrl(pageUrl) === normalizePageUrl(siteUrl)) return { kind: "home" }
  let segs: string[] = []
  try {
    segs = new URL(pageUrl).pathname
      .split("/")
      .map((s) => decodeURIComponent(s).replace(/\.(html?|php)$/i, "").toLowerCase())
      .filter(Boolean)
  } catch {
    return { kind: "unknown" }
  }
  // The site may live in a sub-folder (site_url = example.com/clinic/).
  try {
    const base = new URL(siteUrl).pathname.split("/").filter(Boolean).map((s) => s.toLowerCase())
    if (base.length && base.every((b, i) => segs[i] === b)) segs = segs.slice(base.length)
  } catch {}
  if (segs.length === 0) return { kind: "home" }

  const section = segs.find((s) => EXCLUDED_SECTION.test(s))
  if (section) return { kind: "excluded", reason: `in the "${section}" section` }
  // Pagination (/page/2) and dated archives (/2024/05) are listing pages.
  if (segs.some((s) => s === "page") || /^\d+$/.test(segs[segs.length - 1]))
    return { kind: "excluded", reason: "a listing/archive page" }

  const slug = slugFromUrl(pageUrl).toLowerCase()
  if (HUB_SLUG.test(slug)) return { kind: "excluded", reason: "the services listing page" }
  if (EXCLUDED_SLUG.test(slug)) return { kind: "excluded", reason: `a "${slug}" page` }
  if (segs.some((s) => SERVICE_SEGMENT.test(s)))
    return { kind: "service", reason: "URL is under a services path" }
  return { kind: "unknown" }
}

const EXCLUDED_BODY_CLASS = /^(single-post|blog|archive|category|tag|author|search|search-results|error404|attachment|post-type-archive.*|woocommerce-page|single-product)$/i
const SERVICE_BODY_CLASS = /^single-(services?|treatments?|procedures?|therap(y|ies)|conditions?)$/i

/** WP body classes say what template rendered the page. */
export function classifyByBodyClass(classes: string[]): UrlClass {
  if (classes.some((c) => SERVICE_BODY_CLASS.test(c))) return { kind: "service", reason: "service post type" }
  const ex = classes.find((c) => EXCLUDED_BODY_CLASS.test(c))
  if (ex) return { kind: "excluded", reason: `a WordPress "${ex}" template` }
  return { kind: "unknown" }
}

// Headings that name a section, not the service.
const GENERIC_HEADING = /^(welcome.*|home|services?|our services|treatments?|our treatments|procedures?|about.*|contact.*|book now|learn more|menu)$/i

const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim()
const humanizeSlug = (slug: string) =>
  clean(slug.replace(/[-_]+/g, " ")).replace(/\b\w/g, (c) => c.toUpperCase())

/** The service the page is about: content H1 → menu label → AI name → tab title → slug. */
export function pickServiceName(o: {
  h1s: string[]
  menuLabel?: string
  aiName?: string
  title: string
  brandHints: string[]
  host: string
  slug: string
}): string {
  const usable = (s?: string) => {
    const c = clean(s || "")
    return c && c.length >= 2 && c.length <= 120 && !GENERIC_HEADING.test(c) ? c : ""
  }
  for (const h of o.h1s) if (usable(h)) return usable(h)
  if (usable(o.menuLabel)) return usable(o.menuLabel)
  if (usable(o.aiName)) return usable(o.aiName)
  const t = usable(stripBrand(o.title || "", o.brandHints, o.host))
  if (t) return t
  return humanizeSlug(o.slug) || "this service"
}

// ---------------------------------------------------------------------------
// AI replies (pure, unit-tested)
// ---------------------------------------------------------------------------

export type ImageCategory = "relevant" | "neutral" | "irrelevant"
export interface ImageVerdict {
  category: ImageCategory
  confidence: number
  shows: string
  reason: string
}

function firstJson(text: string): any | null {
  const m = String(text || "").match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    // Models sometimes add a trailing comment after the object; trim to the
    // first balanced closing brace and retry once.
    const s = m[0]
    let depth = 0
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "{") depth++
      else if (s[i] === "}" && --depth === 0) {
        try {
          return JSON.parse(s.slice(0, i + 1))
        } catch {
          return null
        }
      }
    }
    return null
  }
}

const conf = (v: any) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

/** Parse the per-image vision reply. null = unreadable (treated as unverified). */
export function parseImageVerdict(text: string): ImageVerdict | null {
  const o = firstJson(text)
  if (!o || typeof o !== "object") return null
  const cat = String(o.category ?? o.verdict ?? "").toLowerCase().trim()
  if (cat !== "relevant" && cat !== "neutral" && cat !== "irrelevant") return null
  return {
    category: cat,
    confidence: conf(o.confidence),
    shows: clean(String(o.shows ?? o.description ?? "")).slice(0, 200),
    reason: clean(String(o.reason ?? o.note ?? "")).slice(0, 200),
  }
}

/**
 * Parse a blind image description. JSON {"shows"} when the model complies; a
 * plain sentence otherwise (small vision models often answer the describe step
 * in prose, and that prose is the description we asked for). null = unusable.
 */
export function parseDescription(text: string): string | null {
  const o = firstJson(text)
  let shows = o && typeof o === "object" ? clean(String(o.shows ?? o.description ?? "")) : ""
  if (!shows && !/[{}]/.test(text || "")) {
    shows = clean(String(text || ""))
      .replace(/^(sure[,!.]?\s*)?(here is|here's)[^:]*:\s*/i, "")
      .replace(/\*\*/g, "")
  }
  // "The image depicts a woman …" → "a woman …" so the report reads "Shows a woman …".
  shows = shows.replace(/^(the|this)\s+(image|photo|photograph|picture)\s+(shows|depicts|features|displays|is of|contains)\s+/i, "")
  return shows.length >= 10 ? shows.slice(0, 300) : null
}

/** Parse the service-page classifier reply. null = unreadable. */
export function parseServicePageVerdict(
  text: string,
): { servicePage: boolean; service: string; confidence: number } | null {
  const o = firstJson(text)
  if (!o || typeof o.service_page !== "boolean") return null
  return { servicePage: o.service_page, service: clean(String(o.service || "")).slice(0, 120), confidence: conf(o.confidence) }
}

// ---------------------------------------------------------------------------
// Page verdict (pure, unit-tested)
// ---------------------------------------------------------------------------

export interface CheckedImage {
  src: string
  thumb: string
  verdict: ImageVerdict | null // null = could not be verified
  confirmed?: boolean // second opinion agreed it does not fit
  error?: string
}

export interface PageOutcome {
  pageUrl: string
  service: string
  loadOk: boolean
  candidates: number // content images found on the page
  checked: CheckedImage[] // images sent to vision, in order
  lastError: string
}

const lapseRow = (pageUrl: string, service: string, why: string, detail: string): Finding =>
  ({
    check_factor: CHECK_FACTOR,
    title: "Image Relevance Check Failed",
    description: `Could not complete: ${why}. ${detail} Process aborted gracefully.`,
    context_text: `Page: ${pageUrl}\nService: ${service}`,
    screenshot_url: null,
    status: "open",
    ai_generated: false,
  }) as Finding

/** Turn what was observed on one service page into exactly one finding. */
export function decidePage(o: PageOutcome): Finding {
  const svc = o.service
  const flagged = o.checked.filter((c) => c.verdict?.category === "irrelevant" && c.confirmed === true)
  const relevant = o.checked.filter(
    (c) => c.verdict?.category === "relevant" && c.verdict.confidence >= RELEVANT_MIN_CONFIDENCE,
  )
  const unverified = o.checked.filter((c) => !c.verdict || (c.verdict.category === "irrelevant" && c.confirmed === undefined))
  const unchecked = Math.max(0, o.candidates - o.checked.length)
  const reason = aiFailureReason(o.lastError)
  const coverage =
    unchecked > 0 ? ` Checked the ${o.checked.length} largest of ${o.candidates} content images.` : ""
  const unverifiedNote =
    unverified.length > 0 ? ` ${unverified.length} image(s) could not be verified (${reason}).` : ""

  // 1. A clearly wrong image is a defect even if others could not be read.
  if (flagged.length > 0) {
    const rows = flagged.map((c) => ({
      type: "irrelevant",
      src: c.src,
      thumb: c.thumb,
      note: `Shows ${c.verdict!.shows || "unrelated content"} — should show something related to ${svc}`,
    }))
    return {
      check_factor: CHECK_FACTOR,
      title: `${flagged.length} image${flagged.length > 1 ? "s" : ""} not relevant to "${svc}"`,
      description:
        `The "${svc}" service page shows image(s) that do not match the service. Replace them with images of ${svc}.<br>` +
        rows.map((r) => `• <a href="${r.src}">${r.src}</a> — ${r.note}`).join("<br>") +
        coverage +
        unverifiedNote,
      context_text: JSON.stringify(rows),
      screenshot_url: rows.map((r) => r.thumb).filter(Boolean).join(",") || null,
      status: "open",
      ai_generated: true,
    } as Finding
  }

  // 2. Page never rendered: nothing can be claimed either way.
  if (!o.loadOk && o.checked.length === 0)
    return lapseRow(o.pageUrl, svc, "the page did not finish loading", "Image relevance could not be verified.")

  // 3. A service page must carry at least one image.
  if (o.candidates === 0)
    return {
      check_factor: CHECK_FACTOR,
      title: `Service page "${svc}" is missing images`,
      description: `The "${svc}" service page has no images in its content (header, footer, logos and icons are not counted). Add at least one image that shows ${svc}.`,
      context_text: `Page: ${o.pageUrl}\nService: ${svc}`,
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding

  // 4. Some images were never read and nothing relevant was confirmed — we
  //    cannot say whether the page passes.
  if (unverified.length > 0 && relevant.length === 0)
    return lapseRow(
      o.pageUrl,
      svc,
      reason,
      `Read ${o.checked.length - unverified.length} of ${o.checked.length} image(s); none of those shows ${svc}.`,
    )

  // 5. Every image read, none shows the service.
  if (relevant.length === 0) {
    const rows = o.checked.map((c) => ({
      type: "unrelated",
      src: c.src,
      thumb: c.thumb,
      note: `Shows ${c.verdict?.shows || "generic content"} — should show something related to ${svc}`,
    }))
    return {
      check_factor: CHECK_FACTOR,
      title: `Images on the "${svc}" page do not show the service`,
      description:
        `Not one of the ${o.checked.length} image(s) on the "${svc}" service page depicts ${svc}. They are generic and could sit on any page. Add at least one image of ${svc}.<br>` +
        rows.map((r) => `• <a href="${r.src}">${r.src}</a> — ${r.note}`).join("<br>") +
        coverage,
      context_text: JSON.stringify(rows),
      screenshot_url: rows.map((r) => r.thumb).filter(Boolean).join(",") || null,
      status: "open",
      ai_generated: true,
    } as Finding
  }

  // 6. Relevant images exist, but some others could not be read: one of those
  //    may be the wrong one, so this is not a pass.
  if (unverified.length > 0)
    return lapseRow(
      o.pageUrl,
      svc,
      reason,
      `${relevant.length} image(s) match ${svc}, but ${unverified.length} of ${o.checked.length} could not be verified.`,
    )

  // 7. Pass.
  const neutral = o.checked.length - relevant.length
  return {
    check_factor: CHECK_FACTOR,
    title: "No image relevance issues found",
    description: `"${svc}": ${relevant.length} of ${o.checked.length} image(s) show the service${neutral ? `, ${neutral} generic brand image(s) are fine` : ""}.${coverage}`,
    context_text: `Page: ${o.pageUrl}\nService: ${svc}\nImages checked: ${o.checked.length}`,
    screenshot_url: null,
    status: "open",
    ai_generated: false,
  } as Finding
}

// ---------------------------------------------------------------------------
// Browser side
// ---------------------------------------------------------------------------

interface RawCandidate {
  idx: number
  kind: "img" | "bg"
  src: string
  w: number
  h: number
  nw: number
  nh: number
  alt: string
  near: string
  linkHref: string
}

interface PageFacts {
  finalUrl: string
  bodyClasses: string[]
  h1s: string[]
  title: string
  siteName: string
  intro: string
  menuServiceLinks: { href: string; label: string }[]
  candidates: RawCandidate[]
  blocked: boolean
}

/** Runs in the page. Plain JS only (no TS helpers are visible in there). */
function collectPageFacts(): PageFacts {
  const SITE_CHROME =
    "#wpadminbar, .site-header, .site-footer, #masthead, #colophon, [data-elementor-type='header'], [data-elementor-type='footer'], [data-elementor-type='popup'], .elementor-location-header, .elementor-location-footer, .elementor-location-popup, .elementor-popup-modal, [role='banner'], [role='contentinfo'], [role='dialog'], aside, .sidebar, #secondary, .widget-area"
  const CHROME_TAGS = "header, footer, nav, [role='navigation']"
  const CONTENT = "main, article, [role='main']"
  const SKIP_CONTAINER =
    /(^|[-_])(testimonials?|reviews?|ratings?|logos?|brands?|partners?|clients?|awards?|badges?|certifications?|cookie|cookies|consent|related|other-services|more-services|instagram|insta-feed|social)([-_]|$)/i
  const DECORATIVE =
    /(logo|icon|badge|award|seal|certif|favicon|avatar|gravatar|emoji|spinner|loader|loading|placeholder|sprite|arrow|star-?rating|stars|payment|trustpilot|yelp|realself|signature|divider|separator|pattern|texture|shape)/i

  const inChrome = (el: Element): boolean => {
    if (el.closest(SITE_CHROME)) return true
    const tag = el.closest(CHROME_TAGS)
    // An <header class="entry-header"> inside the article is content, not chrome.
    return !!tag && !tag.closest(CONTENT)
  }
  const inSkippedContainer = (el: Element): boolean => {
    let n: Element | null = el
    for (let d = 0; n && n !== document.body && d < 25; d++, n = n.parentElement) {
      const cls = typeof (n as any).className === "string" ? (n as any).className : ""
      const tokens = `${cls} ${n.id || ""}`.split(/\s+/)
      if (tokens.some((t: string) => SKIP_CONTAINER.test(t))) return true
      if (/swiper-slide-duplicate|slick-cloned/.test(cls)) return true
    }
    return false
  }
  // Carousel slides that are not the active one are faded out (opacity 0) or
  // display:none — they are still part of the page's imagery.
  const SLIDE = ".swiper-slide, .slick-slide, .carousel-item, .elementor-slide, .owl-item, .splide__slide, .flickity-cell"
  const inSlide = (el: Element) => !!el.closest(SLIDE)
  const visible = (el: Element): boolean => {
    const anyEl = el as any
    if (inSlide(el)) {
      // Only reject when the slider itself (not just this slide) is hidden.
      const slider = el.closest(SLIDE)!.parentElement
      return !slider || slider.getClientRects().length > 0
    }
    if (typeof anyEl.checkVisibility === "function")
      return anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    const cs = getComputedStyle(el)
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05
  }
  const txt = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim()
  const nearText = (el: Element): string => {
    const parts: string[] = []
    const fig = el.closest("figure")
    const cap = fig?.querySelector("figcaption")
    if (cap) parts.push(txt(cap.textContent))
    const section = el.closest("section, .elementor-section, .e-con, .wp-block-group, .wp-block-columns") || el.parentElement
    const hd = section?.querySelector("h1, h2, h3, h4")
    if (hd) parts.push(txt(hd.textContent))
    return parts.filter(Boolean).join(" | ").slice(0, 160)
  }
  const largestFromSrcset = (ss: string): string => {
    let best = ""
    let bestW = 0
    for (const part of (ss || "").split(",")) {
      const [u, d] = part.trim().split(/\s+/)
      const w = parseFloat(d || "0") || 1
      if (u && w >= bestW) {
        best = u
        bestW = w
      }
    }
    return best
  }
  const abs = (u: string) => {
    try {
      return new URL(u, location.href).href
    } catch {
      return ""
    }
  }

  // --- Cloudflare / bot wall ---
  const blocked =
    /just a moment|attention required|access denied|verify you are human/i.test(document.title) ||
    !!document.querySelector("#challenge-form, #cf-challenge-running, .cf-browser-verification")

  // --- Headings / title / intro ---
  const h1s = Array.from(document.querySelectorAll("h1"))
    .filter((h) => !inChrome(h) && visible(h))
    .map((h) => txt(h.textContent))
    .filter(Boolean)
  const siteName = (document.querySelector('meta[property="og:site_name"]') as HTMLMetaElement)?.content || ""
  const root =
    (document.querySelector(CONTENT) as HTMLElement) ||
    (document.querySelector(".elementor-location-single, .entry-content, #content, .site-content") as HTMLElement) ||
    document.body
  const introParts: string[] = []
  for (const p of Array.from(root.querySelectorAll("h2, h3, p, li"))) {
    if (inChrome(p) || !visible(p)) continue
    const t = txt(p.textContent)
    if (t.length >= 20) introParts.push(t)
    if (introParts.join(" ").length > 1500) break
  }

  // --- "Services" menu links ---
  const MENU_LABEL = /^(our\s+)?(services|treatments|procedures|therapies|offerings|solutions|what we (do|offer)|menu of services|med ?spa services|aesthetic services)$/i
  const menuServiceLinks: { href: string; label: string }[] = []
  const menuRoots = Array.from(document.querySelectorAll("nav, header, [role='navigation'], .elementor-nav-menu, .menu, [data-elementor-type='header']"))
  const seenHref = new Set<string>()
  for (const mr of menuRoots) {
    for (const trigger of Array.from(mr.querySelectorAll("a, span, button, .e-n-menu-title"))) {
      const label = txt(trigger.textContent)
      if (!label || label.length > 40 || !MENU_LABEL.test(label)) continue
      const item = trigger.closest("li, .e-n-menu-item, .menu-item")
      if (!item) continue
      for (const a of Array.from(item.querySelectorAll("a[href]"))) {
        if (a === trigger) continue
        const href = abs(a.getAttribute("href") || "")
        const l = txt(a.textContent)
        if (!href || !l || seenHref.has(href)) continue
        seenHref.add(href)
        menuServiceLinks.push({ href, label: l.slice(0, 120) })
      }
    }
  }

  // --- Lazy-load attribute fallbacks ---
  const lazySrc = (img: HTMLImageElement): string =>
    img.getAttribute("data-src") ||
    img.getAttribute("data-lazy-src") ||
    img.getAttribute("data-original") ||
    largestFromSrcset(img.getAttribute("data-srcset") || img.getAttribute("data-lazy-srcset") || "")

  const candidates: RawCandidate[] = []
  let idx = 0
  const linkOf = (el: Element) => abs((el.closest("a[href]") as HTMLAnchorElement)?.getAttribute("href") || "")

  // <img> (including <picture>)
  for (const img of Array.from(document.querySelectorAll("img")) as HTMLImageElement[]) {
    if (inChrome(img) || inSkippedContainer(img) || !visible(img)) continue
    const r = img.getBoundingClientRect()
    let src = img.currentSrc || img.src || ""
    if (!src || /^data:/i.test(src)) src = lazySrc(img) || src
    src = abs(src)
    const meta = `${src.split("?")[0].split("/").pop() || ""} ${img.alt || ""} ${typeof img.className === "string" ? img.className : ""}`
    if (DECORATIVE.test(meta)) continue
    if (/\.svg(\?|$)/i.test(src)) continue
    // A hidden slide has no box; judge it by the image file's own size instead.
    const w = r.width || (inSlide(img) ? img.naturalWidth : 0)
    const h = r.height || (inSlide(img) ? img.naturalHeight : 0)
    if (w < 120 || h < 100 || w * h < 20000) continue
    const ratio = w / h
    if (ratio > 5 || ratio < 0.2) continue
    if (img.naturalWidth && img.naturalHeight && (img.naturalWidth < 150 || img.naturalHeight < 150)) continue
    img.setAttribute("data-qacc-ir", String(idx))
    candidates.push({
      idx,
      kind: "img",
      src: /^data:/i.test(src) ? "" : src,
      w: Math.round(w),
      h: Math.round(h),
      nw: img.naturalWidth || 0,
      nh: img.naturalHeight || 0,
      alt: txt(img.alt).slice(0, 120),
      near: nearText(img),
      linkHref: linkOf(img),
    })
    idx++
  }

  // CSS background images (Elementor sections/columns, hero blocks, cards).
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect()
    if (r.width < 200 || r.height < 150 || r.width * r.height < 30000) continue
    const bg = getComputedStyle(el).backgroundImage
    if (!bg || bg === "none") continue
    const m = bg.match(/url\(["']?([^"')]+)["']?\)/)
    if (!m) continue
    const src = abs(m[1])
    if (!src || /^data:/i.test(src) || /\.svg(\?|$)/i.test(src)) continue
    if (inChrome(el) || inSkippedContainer(el) || !visible(el)) continue
    if (DECORATIVE.test(src.split("?")[0].split("/").pop() || "")) continue
    const ratio = r.width / r.height
    if (ratio > 6 || ratio < 0.2) continue
    el.setAttribute("data-qacc-ir", String(idx))
    candidates.push({
      idx,
      kind: "bg",
      src,
      w: Math.round(r.width),
      h: Math.round(r.height),
      nw: 0,
      nh: 0,
      alt: "",
      near: nearText(el),
      linkHref: linkOf(el),
    })
    idx++
  }

  return {
    finalUrl: location.href,
    bodyClasses: Array.from(document.body.classList),
    h1s,
    title: document.title || "",
    siteName,
    intro: introParts.join(" ").slice(0, 1500),
    menuServiceLinks,
    candidates,
    blocked,
  }
}

/** Dedupe key: WordPress size variants (-300x200, -scaled) are the same image. */
export function imageKey(src: string): string {
  return (src || "")
    .split(/[?#]/)[0]
    .replace(/^https?:\/\//, "")
    .replace(/-\d+x\d+(?=\.\w+$)/, "")
    .replace(/-scaled(?=\.\w+$)/, "")
    .toLowerCase()
}

/** True when an image links to a different page of the site (a "see our other service" card). */
export function isCrossLink(linkHref: string, pageUrl: string): boolean {
  if (!linkHref || /^(tel|mailto|javascript):/i.test(linkHref)) return false
  try {
    const l = new URL(linkHref)
    const p = new URL(pageUrl)
    if (normHost(l.hostname) !== normHost(p.hostname)) return false
    if (normalizePageUrl(linkHref) === normalizePageUrl(pageUrl)) return false
    if (BOOKING_LINK.test(l.pathname)) return false
    // Image lightbox links to the image file itself.
    if (/\.(jpe?g|png|webp|gif|avif)$/i.test(l.pathname)) return false
    return true
  } catch {
    return false
  }
}

/**
 * A category/listing page ("Skin Treatments" → cards for Moxi, SkinPen, Peels …):
 * every image is a card linking to a DIFFERENT page, at least 3 distinct ones,
 * and the page has no image of its own. Such a page lists services rather than
 * being one. A real service page with a "related treatments" row still has its
 * own images, so it is never caught by this.
 */
export function isListingPage(candidates: { linkHref: string }[], pageUrl: string): boolean {
  const targets = new Set<string>()
  let own = 0
  for (const c of candidates) {
    if (isCrossLink(c.linkHref, pageUrl)) targets.add(normalizePageUrl(c.linkHref))
    else own++
  }
  return own === 0 && targets.size >= 3
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function servicePagePrompt(f: { url: string; title: string; h1s: string[]; intro: string }) {
  const system =
    "You classify pages of a business website (usually a med spa, clinic or local service business). Answer with STRICT JSON only."
  const user =
    `Is this page dedicated to ONE specific service, treatment, procedure or condition the business offers (e.g. a "Botox" page, a "Laser Hair Removal" page, a "Dental Implants" page)? ` +
    `Answer false for the homepage, about/team/contact pages, blog posts, galleries, pricing/specials, and pages that list many services.\n\n` +
    `URL: ${f.url}\nTab title: ${f.title}\nMain heading(s): ${f.h1s.join(" | ") || "(none)"}\nPage text: ${f.intro.slice(0, 1200) || "(none)"}\n\n` +
    `Respond: {"service_page": true|false, "service": "<service name or empty>", "confidence": 0.0-1.0}`
  return { system, user }
}

const JSON_ONLY_RETRY =
  "IMPORTANT: your previous answer was not JSON. Reply with ONLY the JSON object — no words before or after it."

// Step 1 — BLIND description. The vision model is NOT told the service: told
// "this page is about Dental Implants", a small model "sees" an implant in a
// forehead injection. Describing first, judging separately, removes that bias.
const DESCRIBE_PROMPT =
  `Reply with ONLY a JSON object, no other text.\n\n` +
  `Describe this photo objectively: who or what is in it, what is happening, which body area is involved, and any equipment or products visible. ` +
  `If it is a logo, icon, badge or text graphic, say so.\n` +
  `Respond: {"shows": "<one sentence, max 30 words>"}`

// Second, differently worded description, used only to double-check a flag.
const REDESCRIBE_PROMPT =
  `Reply with ONLY a JSON object, no other text.\n\n` +
  `Look closely at this image. Name the main subject, the action taking place, and the part of the body (face, lips, teeth, skin, body, hair …) if any. ` +
  `Do not guess at anything that is not visible.\n` +
  `Respond: {"shows": "<one sentence, max 30 words>"}`

/** "…/MOXI%C2%AE-Skin-Resurfacing-TX-768x538.webp" → "MOXI® Skin Resurfacing TX". */
export function fileNameHint(src: string): string {
  try {
    const last = decodeURIComponent(new URL(src).pathname.split("/").pop() || "")
    return clean(
      last
        .replace(/\.\w+$/, "")
        .replace(/-\d+x\d+$/, "")
        .replace(/-scaled$/, "")
        .replace(/[-_]+/g, " "),
    )
      .replace(/^(img|image|dsc|photo|pexels|shutterstock|istock|adobestock)?\s*\d+$/i, "")
      .slice(0, 120)
  } catch {
    return ""
  }
}

// Step 2 — TEXT judgement: the description against the service and page copy.
// `hints` (file name, alt/caption/heading next to the image) are passed ONLY on
// a rescue pass, after a hint-free judgement — so they can clear an image but can
// never be the reason one is called irrelevant (LLMs ignore "don't use this
// against it" instructions; this makes it structural).
export function judgePrompt(service: string, intro: string, shows: string, hints?: { near: string; fileName: string }) {
  const system =
    "You review images on business websites (usually med spas, clinics, dentists and similar). You decide whether an image fits the service a page is about. Answer with STRICT JSON only."
  const user =
    `Service page: "${service}"\n` +
    (intro ? `What the page says: ${intro.slice(0, 700)}\n` : "") +
    (hints?.near ? `Text next to the image: ${hints.near.slice(0, 200)}\n` : "") +
    (hints?.fileName ? `Image file name: ${hints.fileName}\n` : "") +
    `The image shows (written by a small vision model that can misread brand names, logos and device types): ${shows}\n\n` +
    `Classify the image for THIS page:\n` +
    `- "relevant": it depicts ${service} — the treatment/procedure being done, the body area or condition it treats, its results, or the equipment/products used for it.\n` +
    `- "neutral": generic imagery that fits any page of this business — staff/doctor portrait, clinic interior or exterior, logo, badge, text graphic, decorative image, or a generic smiling person — with nothing that contradicts ${service}.\n` +
    `- "irrelevant": it clearly depicts a DIFFERENT service, procedure or body area (e.g. a facial device or forehead injection on a dental-implants page, a dental chair on a Botox page, a body-sculpting machine on a lip-filler page), or a subject unrelated to this business (food, landscapes, office workers).\n` +
    `When the description is vague, choose "neutral".` +
    (hints
      ? ` The file name and nearby text are extra evidence: if they name this service and the description is plausibly the same kind of thing (e.g. a handheld treatment device, a face being treated), treat a brand-name or device-type mismatch in the description as a misread.`
      : "") +
    `\nRespond: {"category": "relevant"|"neutral"|"irrelevant", "confidence": 0.0-1.0, "reason": "<short reason>"}`
  return { system, user }
}

const SERVICE_STOP = new Set(["treatment", "treatments", "therapy", "service", "services", "in", "and", "the", "for", "of", "non", "surgical", "tx"])
/** True when the hint text names the service (any meaningful service word). */
export function hintNamesService(service: string, hint: string): boolean {
  const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ")
  const h = ` ${norm(hint)} `
  return norm(service)
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !SERVICE_STOP.has(w))
    .some((w) => h.includes(` ${w} `) || h.includes(` ${w}s `))
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export async function checkImageRelevance(
  pageUrl: string,
  runId: string,
  pageId: string,
  siteUrl: string,
  browser: Browser | null,
  onProgress?: (progress: number, message: string) => Promise<void>,
  brandHints: string[] = [],
): Promise<Finding[]> {
  const sharp = require("sharp")
  const { uploadScreenshot } = require("../lib/supabaseStorage")

  // URL alone already rules out the homepage and utility pages — no browser.
  const byUrl = classifyByUrl(pageUrl, siteUrl)
  if (byUrl.kind === "home" || byUrl.kind === "excluded") return []

  let ownBrowser: any = null
  let context: any = null
  let service = humanizeSlug(slugFromUrl(pageUrl)) || "this service"

  try {
    if (!browser) {
      const { chromium } = require("playwright")
      ownBrowser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
    }
    context = await (browser || ownBrowser).newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: DESKTOP_UA,
    })
    const page = await context.newPage()
    // A clicked/auto-opened tab must never hang the check.
    context.on("page", (p: any) => (p === page ? null : p.close().catch(() => {})))

    if (onProgress) await onProgress(10, "Loading page for image relevance...")
    let loadOk = true
    let status = 0
    try {
      const resp = await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 })
      status = resp?.status() || 0
    } catch (e: any) {
      if (!/Timeout|aborted|closed/i.test(e?.message || "")) throw e
      loadOk = false
    }

    if (status >= 400) {
      // A URL that is clearly a service page but errors cannot be verified; an
      // unknown URL that errors is not evidence of a service page at all.
      return byUrl.kind === "service"
        ? [lapseRow(pageUrl, service, `the page returned HTTP ${status}`, "Image relevance could not be verified.")]
        : []
    }

    // Scroll through the page so lazy-loaded images and backgrounds load.
    if (onProgress) await onProgress(20, "Scrolling to load lazy images...")
    try {
      await page.evaluate(async () => {
        const step = Math.max(400, Math.floor(window.innerHeight * 0.8))
        const deadline = Date.now() + 25000
        for (let y = 0; y < document.body.scrollHeight && Date.now() < deadline; y += step) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 250))
        }
        window.scrollTo(0, 0)
        const pending = Array.from(document.images).filter((i) => !i.complete)
        await Promise.race([
          Promise.all(pending.map((i) => new Promise((r) => ((i.onload = r), (i.onerror = r))))),
          new Promise((r) => setTimeout(r, 4000)),
        ])
      })
    } catch {}
    await page.waitForTimeout(500)

    const facts: PageFacts = await page.evaluate(collectPageFacts)

    if (facts.blocked)
      return byUrl.kind === "service"
        ? [lapseRow(pageUrl, service, "the site blocked the QACC browser (bot protection)", "Image relevance could not be verified.")]
        : []

    // Redirected to the homepage → treat as the homepage.
    if (normalizePageUrl(facts.finalUrl) === normalizePageUrl(siteUrl)) return []
    // Redirected somewhere that is plainly not a service page.
    const finalByUrl = facts.finalUrl && facts.finalUrl !== pageUrl ? classifyByUrl(facts.finalUrl, siteUrl) : byUrl
    if (finalByUrl.kind === "home" || finalByUrl.kind === "excluded") return []

    // --- Is this a service page? ---
    let host = ""
    try {
      host = new URL(facts.finalUrl || pageUrl).hostname
    } catch {}
    const hints = [facts.siteName, ...brandHints].filter(Boolean)
    const byBody = classifyByBodyClass(facts.bodyClasses)
    const here = normalizePageUrl(facts.finalUrl || pageUrl)
    const menuHit =
      facts.menuServiceLinks.find((l) => normalizePageUrl(l.href) === here) ||
      facts.menuServiceLinks.find((l) => normalizePageUrl(l.href) === normalizePageUrl(pageUrl))
    let aiName = ""

    const known = finalByUrl.kind === "service" || byBody.kind === "service" || !!menuHit
    // A blog post / archive template is not a service page unless the URL or
    // the Services menu says otherwise.
    if (byBody.kind === "excluded" && !known) return []
    if (!known) {
      if (onProgress) await onProgress(30, "Deciding whether this is a service page...")
      const { system, user } = servicePagePrompt({
        url: facts.finalUrl || pageUrl,
        title: facts.title,
        h1s: facts.h1s,
        intro: facts.intro,
      })
      let verdict: ReturnType<typeof parseServicePageVerdict> = null
      let aiErr = ""
      for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
        try {
          const r = await completeTextIsolated(system, attempt === 0 ? user : `${user}\n\n${JSON_ONLY_RETRY}`)
          verdict = parseServicePageVerdict(r.text)
          if (!verdict) aiErr = "AI reply could not be read"
        } catch (e: any) {
          aiErr = e?.message || String(e)
          break // provider failure: the retry would hit the same breaker
        }
      }
      if (!verdict)
        return [
          lapseRow(
            pageUrl,
            pickServiceName({ h1s: facts.h1s, title: facts.title, brandHints: hints, host, slug: slugFromUrl(pageUrl) }),
            aiFailureReason(aiErr),
            "QACC could not tell whether this is a service page, so its images were not checked.",
          ),
        ]
      if (!verdict.servicePage || verdict.confidence < SERVICE_AI_MIN_CONFIDENCE) return []
      aiName = verdict.service
    }

    service = pickServiceName({
      h1s: facts.h1s,
      menuLabel: menuHit?.label,
      aiName,
      title: facts.title,
      brandHints: hints,
      host,
      slug: slugFromUrl(facts.finalUrl || pageUrl),
    })

    // --- Content images ---
    if (isListingPage(facts.candidates, facts.finalUrl || pageUrl)) return []
    const seen = new Set<string>()
    const candidates = facts.candidates
      .filter((c) => !isCrossLink(c.linkHref, facts.finalUrl || pageUrl))
      .filter((c) => {
        // Unresolvable src (pure lazy placeholder) is kept: we screenshot it.
        const k = c.src ? imageKey(c.src) : `el:${c.idx}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .sort((a, b) => b.w * b.h - a.w * a.h)

    if (onProgress) await onProgress(40, `Checking ${Math.min(candidates.length, MAX_IMAGES)} image(s) against "${service}"...`)

    // Bytes for one candidate: download the file, else screenshot the element.
    const toJpeg = async (buf: Buffer): Promise<Buffer | null> => {
      try {
        return await sharp(buf, { animated: false })
          .rotate()
          .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 80 })
          .toBuffer()
      } catch {
        return null
      }
    }
    const loadImage = async (c: RawCandidate): Promise<Buffer | null> => {
      if (c.src) {
        try {
          const resp = await context.request.get(c.src, { timeout: 20000, headers: { Referer: facts.finalUrl || pageUrl } })
          if (resp.ok() && !/svg/i.test(resp.headers()["content-type"] || "")) {
            const j = await toJpeg(await resp.body())
            if (j) return j
          }
        } catch {}
      }
      try {
        const shot = await page
          .locator(`[data-qacc-ir="${c.idx}"]`)
          .first()
          .screenshot({ timeout: 10000, animations: "disabled" })
        return await toJpeg(shot)
      } catch {
        return null
      }
    }

    // Pre-load bytes with small concurrency (network only), vision stays serial.
    const toCheck = candidates.slice(0, MAX_IMAGES_EXTENDED)
    const dl = pLimit(3)
    const buffers: Promise<Buffer | null>[] = toCheck.map((c, i) =>
      i < MAX_IMAGES ? dl(() => loadImage(c)) : Promise.resolve(null),
    )

    const checked: CheckedImage[] = []
    let lastError = ""
    const uploadThumb = async (buf: Buffer, n: number): Promise<string> => {
      try {
        const thumb = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
        return await uploadScreenshot(thumb, `${runId}/imgrel_${pageId}_${n}.jpg`).catch(() => "")
      } catch {
        return ""
      }
    }

    // One AI question with one retry: small models sometimes answer in prose
    // despite the JSON rule, so an unreadable reply is asked again with a terse
    // reminder before the image is counted as unverified. A provider failure is
    // not retried (the chain already walked its fallbacks).
    let lastProvider = ""
    const ask = async <T,>(
      call: (retry: boolean) => Promise<{ ok: boolean; text: string; error?: string; provider?: string }>,
      parse: (t: string) => T | null,
      src: string,
      what: string,
    ): Promise<T | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await call(attempt > 0)
        if (!r.ok) {
          lastError = r.error || "AI unavailable"
          return null
        }
        const v = parse(r.text)
        if (v) {
          lastProvider = r.provider || ""
          return v
        }
        logger.warn(
          { pageUrl, src, attempt, provider: r.provider, reply: String(r.text).slice(0, 400) },
          `image_relevance: unreadable ${what} reply`,
        )
      }
      lastError = lastError || "AI reply could not be read"
      return null
    }
    const withRetry = (prompt: string, retry: boolean) => (retry ? `${prompt}\n\n${JSON_ONLY_RETRY}` : prompt)
    const describe = (buf: Buffer, prompt: string, src: string, strongFirst = false) =>
      ask((retry) => describeImageResult(buf, withRetry(prompt, retry), { strongFirst }), parseDescription, src, "describe")
    const judge = (shows: string, src: string, hints?: { near: string; fileName: string }) => {
      const { system, user } = judgePrompt(service, facts.intro, shows, hints)
      return ask(
        async (retry) => {
          try {
            const r = await completeTextIsolated(system, withRetry(user, retry))
            return { ok: true, text: r.text, provider: r.provider }
          } catch (e: any) {
            return { ok: false, text: "", error: e?.message || String(e) }
          }
        },
        (t) => {
          const v = parseImageVerdict(t)
          return v ? { ...v, shows } : null
        },
        src,
        "judge",
      )
    }

    for (let i = 0; i < toCheck.length; i++) {
      const c = toCheck[i]
      if (i >= MAX_IMAGES) {
        // Past the normal cap we only keep looking for a relevant image.
        const hasRelevant = checked.some(
          (x) => x.verdict?.category === "relevant" && x.verdict.confidence >= RELEVANT_MIN_CONFIDENCE,
        )
        if (hasRelevant) break
      }
      const buf = i < MAX_IMAGES ? await buffers[i] : await loadImage(c)
      const src = c.src || `${facts.finalUrl || pageUrl}#image-${c.idx}`
      if (!buf) {
        checked.push({ src, thumb: "", verdict: null, error: "image could not be downloaded or captured" })
        lastError = lastError || "image could not be read"
        continue
      }

      const hints = { near: [c.alt, c.near].filter(Boolean).join(" | "), fileName: fileNameHint(src) }
      const hasHints = !!(hints.near || hints.fileName)
      const isIrrelevant = (v: ImageVerdict | null) => v?.category === "irrelevant" && v.confidence >= IRRELEVANT_MIN_CONFIDENCE
      // Rescue pass: the same description, now with file name + nearby text.
      // Returns the downgraded verdict, or null when the hints change nothing.
      const rescue = async (shows: string, v: ImageVerdict): Promise<ImageVerdict | null> => {
        if (!hasHints) return null
        const r = await judge(shows, src, hints)
        if (!r || isIrrelevant(r)) return null
        return { ...v, category: r.category === "relevant" ? "relevant" : "neutral", confidence: r.confidence, reason: r.reason }
      }

      const shows = await describe(buf, DESCRIBE_PROMPT, src)
      const verdict = shows ? await judge(shows, src) : null
      logger.debug({ pageUrl, src, service, shows, verdict }, "image_relevance: verdict")

      const item: CheckedImage = { src, thumb: "", verdict }
      if (verdict && shows && verdict.category === "irrelevant") {
        if (!isIrrelevant(verdict)) {
          // Not sure enough to call it wrong — treat as generic.
          item.verdict = { ...verdict, category: "neutral" }
        } else {
          // Before reporting anything as wrong, it must survive:
          //   1. a rescue pass with the file name / nearby text;
          //   2. a second, differently worded description from the STRONGEST
          //      vision model available, judged hint-free;
          //   3. a rescue pass on that second description.
          const r1 = await rescue(shows, verdict)
          if (r1) item.verdict = r1
          else {
            const shows2 = await describe(buf, REDESCRIBE_PROMPT, src, true)
            // The second look must come from a DIFFERENT model than the first
            // (the free Cloudflare one). When only that model is reachable, the
            // flag cannot be independently confirmed: unverified, never reported.
            const independent = !!shows2 && lastProvider !== "cloudflare"
            if (shows2 && !independent)
              lastError = lastError || "the stronger vision model needed to confirm a flagged image is unavailable"
            const v2 = independent ? await judge(shows2!, src) : null
            logger.debug({ pageUrl, src, service, shows2, v2 }, "image_relevance: second opinion")
            if (v2 && independent) {
              if (!isIrrelevant(v2))
                item.verdict = { ...verdict, category: v2.category === "relevant" ? "relevant" : "neutral", confidence: v2.confidence }
              else {
                const r2 = await rescue(shows2!, v2)
                if (r2) item.verdict = r2
                else item.confirmed = true
              }
            }
            // v2 === null → confirmed stays undefined → counted as unverified.
          }
        }
      } else if (verdict && shows && verdict.category === "neutral" && hintNamesService(service, `${hints.fileName} ${hints.near}`)) {
        // A vague description of an image whose file name / caption names this
        // service: let the hints lift it to "relevant" (help only, never harm).
        const r = await rescue(shows, verdict)
        if (r?.category === "relevant") item.verdict = r
      }
      // Thumbnails only for images the report may show (anything not a
      // confident match: flagged, generic, or a weak "relevant").
      const strongMatch = item.verdict?.category === "relevant" && item.verdict.confidence >= RELEVANT_MIN_CONFIDENCE
      if (item.verdict && !strongMatch) item.thumb = await uploadThumb(buf, i)
      checked.push(item)

      if (onProgress) await onProgress(40 + Math.round((50 * (i + 1)) / toCheck.length), `Checked ${checked.length} image(s)...`)
    }

    if (onProgress) await onProgress(95, "Finalizing image relevance...")
    return [
      decidePage({
        pageUrl: facts.finalUrl || pageUrl,
        service,
        loadOk,
        candidates: candidates.length,
        checked,
        lastError,
      }),
    ]
  } catch (error: any) {
    return [
      lapseRow(
        pageUrl,
        service,
        "the check hit an unexpected error",
        `The check encountered an unexpected error: ${error?.message || error}.`,
      ),
    ]
  } finally {
    if (context) await context.close().catch(() => {})
    if (ownBrowser) await ownBrowser.close().catch(() => {})
  }
}
