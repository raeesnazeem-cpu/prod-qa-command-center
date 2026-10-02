import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"

/**
 * QA Blog Sidebar — every blog post must have a sidebar with, at minimum, a
 * search bar, a Recent Posts section and a Categories section.
 *
 * FULL SCAN ONLY, every page. Scan only — there is no automated fix.
 *
 * Runs on the crawl's already-loaded shared page (no extra navigation), as the
 * FIRST job on the serial shared-page lane so no other check has clicked,
 * submitted or navigated it yet. It only reads the DOM — one page.evaluate —
 * and, on a failure, takes one viewport screenshot as evidence.
 *
 * Which pages: WordPress marks a single blog post with the `single-post` body
 * class (classic, block and Elementor theme-builder templates alike); a post
 * whose theme strips body classes is still recognised by core's `type-post`
 * class on its <article>. A non-WordPress post (Squarespace, Webflow, Shopify,
 * Ghost, Next.js, static) is recognised by structured signals instead — see
 * isNonWpPost below. Every other page returns [] — silent, no row.
 *
 * What counts as the sidebar: a region laid out BESIDE the post content at
 * desktop width, outside the header / footer / nav and outside the post body.
 * Each section is found by WordPress / block / Elementor markup first, then by
 * its heading text ("Recent Posts", "Categories"), and must be visible and
 * non-empty. Sections stacked under the post or living in the footer are not a
 * sidebar, and the report says exactly that.
 *
 * Complexity: O(N) in DOM size — a fixed number of querySelectorAll passes plus
 * an O(depth) climb per matched section (capped) — and O(1) extra memory beyond
 * the matched nodes.
 */

const CHECK_FACTOR = "blog_sidebar"

// Exact titles — the shared verdict matches these, never free text.
export const BLOG_SIDEBAR_PASS_TITLE = "No blog sidebar issues found"
export const BLOG_SIDEBAR_LAPSE_TITLE = "Blog Sidebar Check Failed"
export const BLOG_SIDEBAR_MISSING_TITLE = "Blog post has no sidebar"
export const BLOG_SIDEBAR_INCOMPLETE_TITLE = "Blog post sidebar is incomplete"

export type SectionKey = "search" | "recent" | "categories"
export const SECTION_LABEL: Record<SectionKey, string> = {
  search: "search bar",
  recent: "Recent Posts section",
  categories: "Categories section",
}
const SECTIONS: SectionKey[] = ["search", "recent", "categories"]

// Facts the page-side collector returns.
export interface SidebarFacts {
  isPost: boolean
  blocked: boolean
  readyState: string
  finalUrl: string
  viewportW: number
  contentFound: boolean
  // Sections found inside a region beside the post content.
  beside: Record<SectionKey, boolean>
  // A sidebar-shaped region (beside the content) exists, even if empty.
  sidebarRegion: boolean
  // Sections found elsewhere (below the post, footer) — not in a sidebar.
  elsewhere: Record<SectionKey, boolean>
}

export type SidebarVerdict =
  | { kind: "skip" }
  | { kind: "lapse"; reason: string }
  | { kind: "pass" }
  | { kind: "fail"; noSidebar: boolean; missing: SectionKey[]; notInSidebar: SectionKey[] }

/** Pure decision from the collected facts. Unit-tested. */
export function decideSidebar(f: SidebarFacts): SidebarVerdict {
  if (f.blocked) return { kind: "lapse", reason: "the site blocked the QACC browser (bot protection)" }
  if (!f.isPost) return { kind: "skip" }
  const missing = SECTIONS.filter((k) => !f.beside[k])
  if (missing.length === 0) return { kind: "pass" }
  // A half-loaded page cannot prove a section is absent.
  if (f.readyState === "loading") return { kind: "lapse", reason: "the page did not finish loading" }
  if (!f.contentFound && !f.sidebarRegion)
    return { kind: "lapse", reason: "the post content area could not be located on the page" }
  const noSidebar = !f.sidebarRegion && SECTIONS.every((k) => !f.beside[k])
  return { kind: "fail", noSidebar, missing, notInSidebar: missing.filter((k) => f.elsewhere[k]) }
}

/**
 * Page-side collector. Self-contained — runs inside page.evaluate, so it may
 * not reference anything from module scope.
 */
function collectSidebarFacts(): SidebarFacts {
  const body = document.body
  const empty = { search: false, recent: false, categories: false }
  const base: SidebarFacts = {
    isPost: false,
    blocked: false,
    readyState: document.readyState,
    finalUrl: location.href,
    viewportW: window.innerWidth,
    contentFound: false,
    beside: { ...empty },
    sidebarRegion: false,
    elsewhere: { ...empty },
  }
  if (!body) return base

  // A bot-challenge page (Cloudflare etc.) — the title alone could be a real
  // post called "Access Denied", so it also must carry no WordPress assets.
  const title = (document.title || "").toLowerCase()
  if (
    /just a moment|attention required|access denied|verify you are human|checking your browser/.test(title) &&
    !body.classList.contains("single-post") &&
    !document.querySelector('link[href*="/wp-content/"], script[src*="/wp-content/"], script[src*="/wp-includes/"]')
  ) {
    base.blocked = true
    return base
  }

  // --- Is this a single blog post? ------------------------------------
  const cl = body.classList
  const NOT_POST = ["home", "blog", "archive", "search", "error404", "page", "attachment"]
  const byBodyClass = cl.contains("single-post")
  const byArticle =
    !byBodyClass &&
    !NOT_POST.some((c) => cl.contains(c)) &&
    document.querySelectorAll("article.type-post").length === 1
  // Any-platform post: a single article page, proven by TWO independent
  // signals so a marketing page with og:type=article (Yoast sets that on every
  // page) is never mistaken for a post.
  //   (1) structured data says it is an article: JSON-LD / microdata
  //       BlogPosting / NewsArticle / Article, or og:type=article with an
  //       article:published_time.
  //   (2) the page looks like ONE dated article: a post-style URL
  //       (/blog/<slug>, /news/<slug>, /posts/<slug>, /articles/<slug>,
  //       /YYYY/MM/<slug>) or exactly one <article> holding a <time>.
  // WordPress pages that WP itself marks as non-posts are never re-promoted.
  const isNonWpPost = (): boolean => {
    if (document.querySelector('link[href*="/wp-content/"], script[src*="/wp-includes/"]') && cl.length > 0)
      return false // a WP page without single-post / type-post: WP said "not a post"
    let structured = false
    for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      const txt = s.textContent || ""
      if (/"@type"\s*:\s*(\[[^\]]*)?"(BlogPosting|NewsArticle|Article|TechArticle)"/.test(txt)) {
        structured = true
        break
      }
    }
    if (!structured && document.querySelector('[itemtype*="schema.org/BlogPosting" i], [itemtype*="schema.org/NewsArticle" i], [itemtype*="schema.org/Article" i]'))
      structured = true
    const ogType = (document.querySelector('meta[property="og:type"]')?.getAttribute("content") || "").toLowerCase()
    if (!structured && ogType === "article" && document.querySelector('meta[property="article:published_time"]'))
      structured = true
    if (!structured) return false
    const path = location.pathname.replace(/\/+$/, "")
    // Listing pages (category / tag / author / pagination) are not a post.
    if (/\/(category|categories|tag|tags|author|page)\//i.test(`${path}/`)) return false
    const postUrl =
      /\/(blog|blogs|news|posts?|articles?|journal|insights|stories)\/[^/]+(\/[^/]+)*$/i.test(path) ||
      /\/(19|20)\d{2}\/\d{1,2}\/[^/]+$/.test(path)
    const articles = document.querySelectorAll("article")
    const datedArticle = articles.length === 1 && !!articles[0].querySelector("time")
    return postUrl || datedArticle
  }
  if (!byBodyClass && !byArticle && !isNonWpPost()) return base
  base.isPost = true

  // Entrance animations (Elementor `elementor-invisible`, AOS, WOW) keep a
  // below-the-fold widget visibility:hidden / opacity:0 until it is scrolled
  // to. That is not "missing", so opacity is ignored and hidden-by-animation
  // counts as visible. display:none (rendered size 0) never does.
  const ANIM_SEL = ".elementor-invisible, [data-aos], .wow, .animated"
  const visible = (el: Element | null): el is HTMLElement => {
    if (!el) return false
    const anyEl = el as any
    if (typeof anyEl.checkVisibility === "function" && !anyEl.checkVisibility()) return false
    const r = el.getBoundingClientRect()
    if (!(r.width > 1 && r.height > 1)) return false
    if (getComputedStyle(el).visibility === "hidden" && !el.closest(ANIM_SEL)) return false
    return true
  }

  // Header / footer / nav / modals: anything in here is never the sidebar.
  const ZONE_SEL = [
    "header",
    "footer",
    "[role=banner]",
    "[role=contentinfo]",
    "[role=dialog]",
    "#masthead",
    "#colophon",
    ".site-header",
    ".site-footer",
    ".elementor-location-header",
    ".elementor-location-footer",
    ".elementor-location-popup",
    ".wp-block-template-part.site-header",
    ".wp-block-template-part.site-footer",
  ].join(",")
  // --- The post body (most specific first). ---------------------------
  const CONTENT_SEL = [
    ".entry-content",
    ".wp-block-post-content",
    ".elementor-widget-theme-post-content",
    ".post-content",
    ".single-post-content",
    "article.type-post",
    // Any-platform post bodies (schema.org, Squarespace, Webflow, Shopify,
    // Ghost, generic class names), then a lone <article>.
    "[itemprop='articleBody']",
    ".blog-item-content, .w-richtext, .article-template__content, .gh-content, .article-content, .article-body, .post-body, .blog-post-content",
    "article",
  ]
  // Per selector, the LARGEST visible match: a related-posts excerpt in the
  // sidebar may reuse `.entry-content`, but the post body dwarfs it.
  const largest = (sel: string): HTMLElement | null => {
    let best: HTMLElement | null = null
    let bestArea = 0
    for (const e of Array.from(document.querySelectorAll(sel))) {
      if (e.closest(ZONE_SEL) || !visible(e)) continue
      const r = e.getBoundingClientRect()
      const area = r.width * r.height
      if (area > bestArea) {
        bestArea = area
        best = e as HTMLElement
      }
    }
    return best
  }
  let content: HTMLElement | null = null
  for (const sel of CONTENT_SEL) if ((content = largest(sel))) break
  // Last resort: the post title itself. Never its parent — that wrapper may
  // also hold the sidebar, which would then read as "inside the post".
  if (!content) content = Array.from(document.querySelectorAll("h1")).find((e) => visible(e) && !e.closest(ZONE_SEL)) as HTMLElement || null
  base.contentFound = !!content
  // Inside the article an inline <header>/<footer> is just post meta — only
  // page-level ones (not inside the post body) make a zone.
  const inZone = (el: Element) => {
    const z = el.closest(ZONE_SEL)
    return !!z && !(content && content.contains(z) && z !== content)
  }

  // --- Sections, by markup then by heading. ---------------------------
  const MAX_PER_KIND = 40
  const found: Record<SectionKey, Set<Element>> = { search: new Set(), recent: new Set(), categories: new Set() }
  // Sections in the page footer are never the sidebar, but the report names
  // them ("found in the footer") so the fix is obvious. Header search is normal
  // site chrome and is ignored outright.
  const FOOTER_SEL = "footer, [role=contentinfo], #colophon, .site-footer, .elementor-location-footer"
  const add = (k: SectionKey, el: Element | null) => {
    if (!el || found[k].size >= MAX_PER_KIND) return
    if (inZone(el)) {
      if (el.closest(FOOTER_SEL) && visible(el)) base.elsewhere[k] = true
      return
    }
    if (content && content.contains(el)) return
    if (!visible(el)) return
    found[k].add(el)
  }
  const hasLink = (el: Element) => !!el.querySelector("a[href]")

  // Search: any WP search form (core uses `s`) or a builder search widget,
  // with a real input.
  for (const inp of Array.from(
    document.querySelectorAll(
      'input[name="s"]:not([type="hidden"]), input[type="search"], form[role="search"] input:not([type="hidden"]), input[name="q"]:not([type="hidden"]), input[name="query"]:not([type="hidden"]), input[placeholder*="search" i]',
    ),
  )) {
    add("search", inp.closest("form, .widget, .wp-block-search, [class*='elementor-widget-search'], [role='search']") || inp)
  }

  const RECENT_SEL =
    ".widget_recent_entries, .wp-block-latest-posts, .elementor-widget-wp-widget-recent-posts, .widget_rpwe_widget, .widget-recent-posts"
  for (const el of Array.from(document.querySelectorAll(RECENT_SEL))) if (hasLink(el)) add("recent", el)

  const CATS_SEL =
    ".widget_categories, .wp-block-categories, .elementor-widget-wp-widget-categories, .wp-block-categories-dropdown"
  for (const el of Array.from(document.querySelectorAll(CATS_SEL)))
    if (hasLink(el) || el.querySelector("select option")) add("categories", el)
  // wp_list_categories() output outside a known widget wrapper.
  for (const li of Array.from(document.querySelectorAll("li.cat-item"))) add("categories", li.closest("ul") || li)

  // Heading fallback — the section is the heading's nearest ancestor that also
  // holds links (the list under it), bounded so it never swallows the page.
  const RECENT_RE = /^(recent|latest|new)\s+(blog\s+)?(posts?|articles?|blogs?|news|stories)$/i
  const CATS_RE = /^(blog\s+|post\s+)?categor(y|ies)$/i
  const HEAD_SEL = "h2, h3, h4, h5, h6, .widget-title, .widgettitle, .wp-block-heading, .elementor-heading-title"
  // The list must FOLLOW the heading (a later sibling at the heading's level
  // or one of up to 3 ancestors' levels) — never just "links somewhere near".
  const listAfter = (h: Element): Element | null => {
    let cur: Element | null = h
    for (let d = 0; cur && d < 4; d++, cur = cur.parentElement) {
      let sib = cur.nextElementSibling
      for (let n = 0; sib && n < 3; n++, sib = sib.nextElementSibling) {
        if (sib.matches(HEAD_SEL) || sib.querySelector(HEAD_SEL)) break // next section starts
        if (hasLink(sib) || sib.querySelector("select option")) return sib
      }
    }
    return null
  }
  for (const h of Array.from(document.querySelectorAll(HEAD_SEL))) {
    const t = (h.textContent || "").replace(/\s+/g, " ").trim()
    if (!t || t.length > 40) continue
    const kind: SectionKey | null = RECENT_RE.test(t) ? "recent" : CATS_RE.test(t) ? "categories" : null
    if (!kind) continue
    const list = listAfter(h)
    if (list && !(content && list.contains(content))) add(kind, list)
  }

  // --- Which sections sit in a region beside the post? -----------------
  // Climb from a section while the parent still excludes the post content and
  // is not a zone: the top of that climb is the column the section lives in.
  const regionOf = (el: Element): Element => {
    let r: Element = el
    while (
      r.parentElement &&
      r.parentElement !== body &&
      !(content && r.parentElement.contains(content)) &&
      !r.parentElement.matches(ZONE_SEL)
    )
      r = r.parentElement
    return r
  }
  // Compare a region with the post's own column: the child of the region's
  // parent that holds the content (title + featured image + body). A short
  // sidebar next to a tall hero still counts as beside the post.
  const columnOf = (reg: Element): Element | null => {
    if (!content) return null
    const parent = reg.parentElement
    if (!parent || parent === body || !parent.contains(content)) return content
    let col: Element = content
    while (col.parentElement && col.parentElement !== parent) col = col.parentElement
    return col
  }
  const besideContent = (el: Element) => {
    const col = columnOf(el)
    if (!col) return false
    const cRect = col.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const overlapX = Math.min(r.right, cRect.right) - Math.max(r.left, cRect.left)
    const overlapY = Math.min(r.bottom, cRect.bottom) - Math.max(r.top, cRect.top)
    return overlapX <= 0.1 * Math.min(r.width, cRect.width) && overlapY > 0
  }
  const regionBeside = new Map<Element, boolean>()
  const isBeside = (el: Element) => {
    const reg = regionOf(el)
    let b = regionBeside.get(reg)
    if (b === undefined) {
      b = besideContent(reg)
      regionBeside.set(reg, b)
    }
    return b
  }
  const KINDS: SectionKey[] = ["search", "recent", "categories"]
  for (const k of KINDS) {
    for (const el of found[k]) {
      if (isBeside(el)) base.beside[k] = true
      else base.elsewhere[k] = true
      if (base.beside[k]) break
    }
  }
  for (const b of regionBeside.values()) if (b) base.sidebarRegion = true

  // An explicit sidebar container beside the post (possibly empty).
  if (!base.sidebarRegion) {
    const SIDEBAR_SEL =
      "#secondary, #sidebar, .sidebar, aside, [role=complementary], .widget-area, .elementor-widget-sidebar, [class*='sidebar' i], [id*='sidebar' i]"
    for (const el of Array.from(document.querySelectorAll(SIDEBAR_SEL))) {
      if (inZone(el) || (content && (content.contains(el) || el.contains(content)))) continue
      if (visible(el) && besideContent(el)) {
        base.sidebarRegion = true
        break
      }
    }
  }
  return base
}

/** Shape the verdict into the finding row. Pure. Unit-tested. */
export function buildFinding(
  v: SidebarVerdict,
  pageUrl: string,
  finalUrl: string,
  screenshotUrl: string | null,
): Finding | null {
  const ctx = (extra: string) =>
    `Page: ${pageUrl}${finalUrl && finalUrl !== pageUrl ? `\nFinal URL: ${finalUrl}` : ""}\n${extra}`
  if (v.kind === "skip") return null
  if (v.kind === "pass")
    return {
      check_factor: CHECK_FACTOR,
      title: BLOG_SIDEBAR_PASS_TITLE,
      description: "This blog post has a sidebar with a search bar, a Recent Posts section and a Categories section.",
      context_text: ctx("Sidebar: search, recent posts, categories — all present"),
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding
  if (v.kind === "lapse")
    return {
      check_factor: CHECK_FACTOR,
      title: BLOG_SIDEBAR_LAPSE_TITLE,
      description: `Could not complete: ${v.reason}. Process aborted gracefully.`,
      context_text: ctx(`System Error: ${v.reason}`),
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding
  const missing = v.missing.map((k) => SECTION_LABEL[k])
  const elsewhere = v.notInSidebar.length
    ? ` Found outside a sidebar (below the post or in the footer): ${v.notInSidebar.map((k) => SECTION_LABEL[k]).join(", ")}.`
    : ""
  return {
    check_factor: CHECK_FACTOR,
    title: v.noSidebar ? BLOG_SIDEBAR_MISSING_TITLE : BLOG_SIDEBAR_INCOMPLETE_TITLE,
    description: v.noSidebar
      ? `This blog post has no sidebar. Add a sidebar with a search bar, a Recent Posts section and a Categories section.${elsewhere}`
      : `This blog post's sidebar is missing: ${missing.join(", ")}.${elsewhere}`,
    context_text: ctx(`Missing: ${v.missing.join(", ")}`),
    screenshot_url: screenshotUrl,
    status: "open",
    ai_generated: false,
  } as Finding
}

export async function checkBlogSidebar(
  page: PlaywrightPage,
  pageUrl: string,
  runId: string,
  pageId: string,
): Promise<Finding[]> {
  // One retry: a late client-side redirect or SPA hydration can destroy the
  // evaluate context mid-read. A second failure is a real "could not read".
  let facts: SidebarFacts
  try {
    facts = await page.evaluate(collectSidebarFacts)
  } catch {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {})
    try {
      facts = await page.evaluate(collectSidebarFacts)
    } catch (e: any) {
      const f = buildFinding(
        { kind: "lapse", reason: `the page could not be read (${String(e?.message || e).slice(0, 120)})` },
        pageUrl,
        pageUrl,
        null,
      )
      return f ? [f] : []
    }
  }
  const verdict = decideSidebar(facts)
  if (verdict.kind === "skip") return []

  let shot: string | null = null
  if (verdict.kind === "fail") {
    try {
      const { uploadScreenshot } = require("../lib/supabaseStorage")
      const buf = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false })
      shot = (await uploadScreenshot(buf, `${runId}/blogsb_${pageId}.jpg`).catch(() => "")) || null
    } catch {}
  }
  const f = buildFinding(verdict, pageUrl, facts.finalUrl, shot)
  return f ? [f] : []
}
