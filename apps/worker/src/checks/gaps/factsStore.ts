/**
 * Per-run store of what each page's gap checks saw, for the run-end
 * (cross-page) checks in siteConsistencyCheck.ts.
 *
 * In memory, keyed by runId then page URL. Production runs ONE worker process
 * (WORKER_CONCURRENCY jobs inside it), so every page of a run lands here. If the
 * worker restarts mid-run, pages crawled before the restart are missing: the
 * run-end checks then say how many pages they could compare instead of
 * pretending they saw the whole site. Released in finalizeRun.
 */

export interface LinkFact {
  text: string
  href: string
  /** header | footer | main | floating (fixed-position widget) */
  area: "header" | "footer" | "main" | "floating"
  hasImg?: string // normalized image key when the link wraps an image
  addressNear?: string // address text the link wraps or sits next to (map links)
}

export interface MenuItem {
  text: string
  href: string
  depth: number
  parent?: string
}

export interface PageFacts {
  url: string
  finalUrl: string
  title: string
  siteName: string
  h1: string[]
  /** h2/h3 headings in the main content: text + whether shown in capitals. */
  headings: { text: string; caps: boolean }[]
  isBlogPost: boolean
  hasToc: boolean
  h2Count: number
  /** Desktop header menu, top level + submenus, in order. */
  nav: MenuItem[]
  /** A separate mobile/hamburger menu found in the DOM, or null. */
  mobileNav: MenuItem[] | null
  footerNav: { text: string; href: string }[]
  links: LinkFact[]
  phones: { digits: string; display: string; href: string; area: string }[]
  emails: { email: string; area: string }[]
  addresses: string[]
  /** Content images (main area, sizeable), normalized keys, in page order. */
  images: string[]
  /** First wide banner / breadcrumb background image key. */
  bannerImage: string
  /** Featured image key (posts) or og:image key. */
  featuredImage: string
  logo: string
  /** Main-area text (no header/footer), capped. */
  text: string
  /** Section ordering facts from the responsive pass (null if not run). */
  mobileOrder: { imageFirst: string[]; textFirst: string[] } | null
}

const store = new Map<string, Map<string, PageFacts>>()
const touched = new Map<string, number>()

export function putFacts(runId: string, facts: PageFacts): void {
  let m = store.get(runId)
  if (!m) store.set(runId, (m = new Map()))
  const prev = m.get(facts.url)
  // The responsive pass may land before or after the desktop read.
  m.set(facts.url, prev ? { ...prev, ...facts, mobileOrder: facts.mobileOrder ?? prev.mobileOrder } : facts)
  touched.set(runId, Date.now())
}

export function putMobileOrder(runId: string, url: string, order: { imageFirst: string[]; textFirst: string[] }): void {
  let m = store.get(runId)
  if (!m) store.set(runId, (m = new Map()))
  const prev = m.get(url)
  if (prev) prev.mobileOrder = order
  else m.set(url, { ...emptyFacts(url), mobileOrder: order, _partial: true } as any)
  touched.set(runId, Date.now())
}

export function getFacts(runId: string): PageFacts[] {
  return [...(store.get(runId)?.values() || [])].filter((f: any) => !f._partial || f.mobileOrder)
}

export function releaseFacts(runId: string): void {
  store.delete(runId)
  touched.delete(runId)
}

/** Drop runs untouched for 6h (a run that never finalized). */
export function sweepFacts(now = Date.now()): void {
  for (const [id, t] of touched) if (now - t > 6 * 3600_000) releaseFacts(id)
}

export function emptyFacts(url: string): PageFacts {
  return {
    url,
    finalUrl: url,
    title: "",
    siteName: "",
    h1: [],
    headings: [],
    isBlogPost: false,
    hasToc: false,
    h2Count: 0,
    nav: [],
    mobileNav: null,
    footerNav: [],
    links: [],
    phones: [],
    emails: [],
    addresses: [],
    images: [],
    bannerImage: "",
    featuredImage: "",
    logo: "",
    text: "",
    mobileOrder: null,
  }
}

/**
 * One key per image FILE, so the same upload in another size / format
 * matches: drops the query, the WordPress size suffix (-768x538), -scaled,
 * -e1234567890 edit suffixes and the extension.
 */
export function imageKey(src: string): string {
  if (!src) return ""
  let s = String(src).trim()
  if (s.startsWith("data:")) return ""
  try {
    const u = new URL(s, "https://x.invalid")
    s = u.pathname
  } catch {}
  s = decodeURIComponent(s).toLowerCase()
  const file = s.split("/").pop() || ""
  return file
    .replace(/\.(jpe?g|png|webp|avif|gif)$/i, "")
    .replace(/\.(jpe?g|png)$/i, "") // .jpg.webp
    .replace(/-\d{2,4}x\d{2,4}$/, "")
    .replace(/-scaled$/, "")
    .replace(/-e\d{10,}$/, "")
}

/** Same page regardless of scheme, www, trailing slash, query or hash. */
export function samePageKey(u: string): string {
  try {
    const x = new URL(u)
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase()
  } catch {
    return String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "")
  }
}
