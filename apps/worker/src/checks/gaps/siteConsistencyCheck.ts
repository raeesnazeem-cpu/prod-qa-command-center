import { Finding } from "@qacc/shared"
import { PageFacts, getFacts, samePageKey, imageKey } from "./factsStore"
import { gapFinding, lapseFinding } from "./findings"
import { matchSlugToTitle, slugFromUrl } from "../urlTabMatchingCheck"

/**
 * QA-gap checks across the WHOLE site — run once at the end of the run, from the
 * facts every page's gap read stored (factsStore). Deterministic, no AI, no
 * extra page loads except two small HTTP reads (live sitemap, WP REST).
 *
 *   booking_links       every Book Now goes to one place; none goes to the contact page
 *   business_info       one phone / email across pages; tel: link matches the number shown
 *   map_links           each map link opens the address it sits by; every address has a map link
 *   service_names       dropdown name vs page heading vs URL for each service
 *   service_order       services landing page in the same order as the dropdown, none missing
 *   menu_coverage       crawled pages that no menu links to
 *   image_reuse         one image used for several services / blogs; gallery duplicates; featured = banner
 *   service_image_match a service card's image (home / services page) vs the service's own page
 *   logo_consistency    the same header logo on every page
 *   case_consistency    service-page headings in capitals on some pages, normal case on others
 *   mobile_order        image-first vs text-first stacking on mobile across the site
 *   location_content    a location page that names another location's city
 *   url_problems        test / gogroth / copy / -2 / sample in URLs; city-state in URL vs address
 *   legal_pages         Terms & Conditions without this business's name / email
 *   html_sitemap        duplicate entries on the HTML sitemap page
 *   live_pages_parity   live-site pages missing on beta and not redirected
 *   backend_extras      duplicate pages and dummy media in WordPress (public REST)
 */

export interface SiteRun {
  id: string
  site_url: string
  live_site_url?: string | null
  run_type?: string
}

const norm = (s: string) => (s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "")
const pathOf = (u: string) => { try { return new URL(u).pathname.replace(/\/+$/, "") || "/" } catch { return u } }
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }
const BOOK = /\b(book|schedule|appointment|reserve)\b/i
const MAP_RE = /(google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page|share\.google)/i
const UTILITY = /\/(blog|news|category|tag|author|page|feed|privacy|terms|cookie|accessibility|thank|thanks|thank-you|sitemap|search|cart|checkout|my-account|shop|product|wp-|404)(\/|$)/i
const SERVICE_PARENT = /(service|treatment|procedure|aesthetic|injectable|skin|body|face|wellness|condition|laser|med ?spa|what we (do|offer))/i

/** Two names describe the same thing (shared stems, either way round). */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return true
  if (norm(a) === norm(b)) return true
  return matchSlugToTitle(a, b).verdict === "pass" || matchSlugToTitle(b, a).verdict === "pass"
}

/** Services dropdown(s) from the homepage menu. Pure — unit-tested. */
export function serviceMenus(nav: PageFacts["nav"]): { parent: string; parentHref: string; items: { text: string; href: string }[] }[] {
  const out: { parent: string; parentHref: string; items: { text: string; href: string }[] }[] = []
  for (const top of nav.filter((i) => i.depth === 0)) {
    if (!SERVICE_PARENT.test(top.text)) continue
    const items = nav.filter((i) => i.depth >= 1 && i.parent === top.text && i.href && !/#$/.test(i.href))
    if (items.length >= 2) out.push({ parent: top.text, parentHref: top.href, items: items.map((i) => ({ text: i.text, href: i.href })) })
  }
  return out
}

/** Order problems: landing-page order vs dropdown order. Pure — unit-tested. */
export function orderProblems(menu: string[], landing: string[]): { missing: string[]; outOfOrder: boolean } {
  const missing = menu.filter((m) => !landing.includes(m))
  const common = menu.filter((m) => landing.includes(m))
  const landOrder = landing.filter((l, i) => common.includes(l) && landing.indexOf(l) === i)
  return { missing, outOfOrder: common.length >= 3 && common.join("|") !== landOrder.join("|") }
}

const CITY_STATE = /\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){0,2}),\s*([A-Z]{2})\s*\d{5}/g

export async function runSiteConsistencyChecks(run: SiteRun, enabled: Set<string>, crawledUrls: string[]): Promise<Finding[]> {
  const facts = getFacts(run.id)
  const keys = [
    "booking_links", "business_info", "map_links", "service_names", "service_order", "menu_coverage", "image_reuse",
    "service_image_match", "logo_consistency", "case_consistency", "mobile_order", "location_content", "url_problems",
    "legal_pages", "html_sitemap", "live_pages_parity", "backend_extras",
  ].filter((k) => enabled.has(k))
  if (keys.length === 0) return []
  const site = run.site_url
  const desktopFacts = facts.filter((f) => f.finalUrl)
  if (desktopFacts.length === 0) {
    return keys.filter((k) => !["live_pages_parity", "backend_extras", "url_problems"].includes(k)).map((k) =>
      lapseFinding(k, "no page data was collected in this scan (the pages could not be read, or the worker restarted mid-scan)", site),
    )
  }
  const coverage = crawledUrls.length > desktopFacts.length ? `Compared ${desktopFacts.length} of ${crawledUrls.length} scanned pages.` : `Compared ${desktopFacts.length} pages.`
  const f: Finding[] = []
  const add = (key: string, title: string, items: string[]) => {
    const uniq = [...new Set(items)]
    if (enabled.has(key) && uniq.length) f.push(gapFinding(key, title, uniq.slice(0, 20), site, coverage))
  }
  const home = desktopFacts.find((p) => samePageKey(p.url) === samePageKey(site)) || desktopFacts[0]
  const byKey = new Map(desktopFacts.map((p) => [samePageKey(p.url), p]))
  const factsFor = (href: string) => byKey.get(samePageKey(href))
  const menus = serviceMenus(home.nav)
  const serviceHrefs = new Set(menus.flatMap((m) => m.items.map((i) => samePageKey(i.href))))
  const isService = (p: PageFacts) => serviceHrefs.has(samePageKey(p.url))
  const allAddresses = [...new Set(desktopFacts.flatMap((p) => p.addresses))]
  const streetKey = (a: string) => (a.match(/^\d{2,6}\s+\S+/)?.[0] || a).toLowerCase()
  const locations = new Set(allAddresses.map(streetKey))
  const singleLocation = locations.size <= 1

  // ---------------- booking_links
  if (enabled.has("booking_links")) {
    const dest = new Map<string, Set<string>>()
    const toContact: string[] = []
    for (const p of desktopFacts) for (const l of p.links) {
      if (!BOOK.test(l.text) || l.text.length > 40) continue
      if (/^(tel|mailto|sms):/i.test(l.href) || /#$/.test(l.href)) continue
      let key = ""
      try { const u = new URL(l.href); key = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") } catch { continue }
      if (!dest.has(key)) dest.set(key, new Set())
      dest.get(key)!.add(`${pathOf(p.url)}${l.area === "header" ? " (header)" : l.area === "floating" ? " (floating button)" : ""}`)
      if (hostOf(l.href) === hostOf(site) && /\/contact/i.test(pathOf(l.href)) && toContact.length < 5) toContact.push(`"${l.text}" on ${pathOf(p.url)} goes to the contact page (${pathOf(l.href)}) instead of the booking system`)
    }
    const external = [...dest.keys()].filter((k) => !k.startsWith(hostOf(site)))
    const items: string[] = [...toContact]
    if (external.length > 1) items.push(`Book buttons go to ${external.length} different booking links: ${external.map((k) => `${k} (${[...dest.get(k)!].slice(0, 3).join(", ")})`).join("; ")}`)
    const mob = home.mobileNav?.filter((i) => BOOK.test(i.text)) || []
    const head = home.links.filter((l) => l.area === "header" && BOOK.test(l.text))
    for (const m of mob) if (head.length && m.href && !head.some((h) => samePageKey(h.href) === samePageKey(m.href))) items.push(`Hamburger "${m.text}" goes to ${m.href} but the header button goes to ${head[0].href}`)
    add("booking_links", "Booking links are not consistent", items)
  }

  // ---------------- business_info
  if (enabled.has("business_info")) {
    const items: string[] = []
    for (const p of desktopFacts) for (const ph of p.phones) {
      const shown = ph.display.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
      if (ph.href && shown.length >= 10 && shown !== ph.digits) items.push(`On ${pathOf(p.url)} the number shown (${ph.display}) is not the number dialled (${ph.href})`)
    }
    const nums = new Map<string, Set<string>>()
    for (const p of desktopFacts) for (const ph of p.phones) { if (!nums.has(ph.digits)) nums.set(ph.digits, new Set()); nums.get(ph.digits)!.add(pathOf(p.url)) }
    if (singleLocation && nums.size > 1) {
      const fmt = (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
      items.push(`${nums.size} different phone numbers on a single-location site: ${[...nums.entries()].sort((a, b) => b[1].size - a[1].size).map(([d, s]) => `${fmt(d)} on ${s.size} page(s)${s.size <= 3 ? ` (${[...s].join(", ")})` : ""}`).join("; ")}`)
    }
    const emails = new Map<string, Set<string>>()
    for (const p of desktopFacts) for (const e of p.emails) { if (/(growth99|gogroth|wordpress|example|sentry|wixpress)/.test(e.email)) continue; if (!emails.has(e.email)) emails.set(e.email, new Set()); emails.get(e.email)!.add(pathOf(p.url)) }
    if (singleLocation && emails.size > 1) items.push(`${emails.size} different email addresses: ${[...emails.entries()].map(([e, s]) => `${e} on ${s.size} page(s)${s.size <= 3 ? ` (${[...s].join(", ")})` : ""}`).join("; ")}`)
    add("business_info", "Phone number or email differs between pages", items)
  }

  // ---------------- map_links
  if (enabled.has("map_links")) {
    const items: string[] = []
    const mapLinks = desktopFacts.flatMap((p) => p.links.filter((l) => MAP_RE.test(l.href)).map((l) => ({ ...l, page: pathOf(p.url) })))
    for (const l of mapLinks) {
      if (!l.addressNear) continue
      const num = l.addressNear.match(/^\d{2,6}/)?.[0]
      const q = decodeURIComponent(l.href).replace(/\+/g, " ")
      // Only judge links that spell the place out (q=/place/). Short links (goo.gl, maps.app) can't be read offline.
      if (num && /[?&](q|query|daddr|destination)=|\/place\/|\/dir\//.test(q) && !q.includes(num)) items.push(`On ${l.page}, the map link next to "${l.addressNear}" opens a different place (${l.href.slice(0, 90)})`)
    }
    const byAddr = new Map<string, Set<string>>()
    for (const l of mapLinks) if (l.addressNear) { const k = streetKey(l.addressNear); if (!byAddr.has(k)) byAddr.set(k, new Set()); byAddr.get(k)!.add(l.href.split("?")[0] + (l.href.match(/[?&](q|query)=[^&]+/)?.[0] || "")) }
    for (const [a, set] of byAddr) if (set.size > 1) items.push(`The address starting "${a}" uses ${set.size} different map links across the site`)
    const linkedAddr = new Set([...byAddr.keys()])
    if (mapLinks.length || locations.size) for (const a of locations) if (!linkedAddr.has(a) && mapLinks.length < locations.size * 2) {
      const full = allAddresses.find((x) => streetKey(x) === a)
      if (full) items.push(`No map link found for the address "${full}"`)
    }
    add("map_links", "Map link problems", items)
  }

  // ---------------- service names / order
  if (enabled.has("service_names") || enabled.has("service_order")) {
    const nameItems: string[] = []
    const orderItems: string[] = []
    if (menus.length === 0) {
      // No services dropdown → nothing to compare; silent pass.
    }
    for (const m of menus) {
      for (const it of m.items) {
        const pf = factsFor(it.href)
        const slug = slugFromUrl(it.href).replace(/[-_]/g, " ")
        if (slug && !namesMatch(it.text, slug)) nameItems.push(`Dropdown "${it.text}" → URL /${slugFromUrl(it.href)} uses a different name`)
        if (pf?.h1[0] && !namesMatch(it.text, pf.h1[0])) nameItems.push(`Dropdown "${it.text}" → page heading is "${pf.h1[0]}"`)
        const mob = home.mobileNav?.find((x) => x.href && samePageKey(x.href) === samePageKey(it.href))
        if (mob && norm(mob.text) !== norm(it.text)) nameItems.push(`"${it.text}" is called "${mob.text}" in the hamburger dropdown`)
      }
      const landing = m.parentHref ? factsFor(m.parentHref) : undefined
      if (landing) {
        const menuKeys = m.items.map((i) => samePageKey(i.href))
        const landKeys = landing.links.filter((l) => l.area === "main").map((l) => samePageKey(l.href)).filter((k) => menuKeys.includes(k))
        const { missing, outOfOrder } = orderProblems(menuKeys, landKeys)
        const nameOf = (k: string) => m.items.find((i) => samePageKey(i.href) === k)?.text || k
        if (missing.length && missing.length < menuKeys.length) orderItems.push(`On the ${m.parent} page (${pathOf(m.parentHref)}), these dropdown services are not listed: ${missing.map(nameOf).join(", ")}`)
        if (outOfOrder) orderItems.push(`The ${m.parent} page lists services in a different order than the dropdown. Dropdown: ${menuKeys.filter((k) => landKeys.includes(k)).map(nameOf).join(" › ")}. Page: ${[...new Set(landKeys)].map(nameOf).join(" › ")}`)
        // Same service, different name on the landing page.
        for (const l of landing.links.filter((x) => x.area === "main" && x.text && x.text.length < 60 && !/^(learn|read|view|see|explore|discover|book)/i.test(x.text))) {
          const it = m.items.find((i) => samePageKey(i.href) === samePageKey(l.href))
          if (it && !namesMatch(it.text, l.text)) nameItems.push(`"${it.text}" (dropdown) is called "${l.text}" on the ${m.parent} page`)
        }
      }
    }
    add("service_names", "Service names don't match", nameItems)
    add("service_order", "Service order or list doesn't match the dropdown", orderItems)
  }

  // ---------------- menu coverage
  if (enabled.has("menu_coverage")) {
    const linked = new Set<string>([
      ...home.nav.map((i) => samePageKey(i.href)),
      ...(home.mobileNav || []).map((i) => samePageKey(i.href)),
      ...home.footerNav.map((i) => samePageKey(i.href)),
      ...home.links.filter((l) => l.area === "header" || l.area === "footer").map((l) => samePageKey(l.href)),
    ])
    for (const m of menus) { const lp = m.parentHref ? factsFor(m.parentHref) : null; lp?.links.filter((l) => l.area === "main").forEach((l) => linked.add(samePageKey(l.href))) }
    const orphan = desktopFacts.filter((p) => !p.isBlogPost && samePageKey(p.url) !== samePageKey(site) && !linked.has(samePageKey(p.url)) && !UTILITY.test(pathOf(p.url)) && !/(^|\/)(location|locations|team|staff|provider)s?\//i.test(pathOf(p.url)))
    add("menu_coverage", "Pages not linked from any menu", orphan.slice(0, 25).map((p) => `${pathOf(p.url)}${p.h1[0] ? ` ("${p.h1[0]}")` : ""} is not in the header, dropdown or footer menu`))
  }

  // ---------------- image reuse / service image match
  if (enabled.has("image_reuse")) {
    const items: string[] = []
    const svc = desktopFacts.filter(isService)
    const posts = desktopFacts.filter((p) => p.isBlogPost)
    const group = (pages: PageFacts[], pick: (p: PageFacts) => string[], label: string) => {
      const m = new Map<string, Set<string>>()
      for (const p of pages) for (const k of new Set(pick(p))) { if (!k || /logo|icon|placeholder/.test(k)) continue; if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(pathOf(p.url)) }
      for (const [k, s] of m) if (s.size > 1) items.push(`Image "${k}" is used on ${s.size} different ${label}: ${[...s].slice(0, 6).join(", ")}`)
    }
    group(svc, (p) => p.images.slice(0, 3), "service pages")
    group(posts, (p) => [p.featuredImage, ...p.images.slice(0, 1)], "blog posts")
    for (const p of desktopFacts) {
      if (/(gallery|before-after|before-and-after|results)/i.test(p.url)) {
        const seen = new Map<string, number>()
        p.images.forEach((k) => seen.set(k, (seen.get(k) || 0) + 1))
        const dups = [...seen.entries()].filter(([, c]) => c > 1)
        if (dups.length) items.push(`Gallery ${pathOf(p.url)} shows the same photo twice: ${dups.slice(0, 4).map(([k]) => k).join(", ")}`)
      }
      if (p.isBlogPost && p.featuredImage && p.bannerImage && p.featuredImage === p.bannerImage) items.push(`On ${pathOf(p.url)} the featured image is the same as the banner / breadcrumb image`)
    }
    add("image_reuse", "Same image used in several places", items)
  }
  if (enabled.has("service_image_match")) {
    const items: string[] = []
    const sources = [home, ...menus.map((m) => (m.parentHref ? factsFor(m.parentHref) : undefined)).filter(Boolean) as PageFacts[]]
    for (const src of sources) for (const l of src.links) {
      if (!l.hasImg || l.area !== "main" || !serviceHrefs.has(samePageKey(l.href))) continue
      const target = factsFor(l.href)
      if (!target || target.images.length === 0) continue
      const onPage = new Set([...target.images, target.bannerImage, target.featuredImage])
      if (!onPage.has(l.hasImg)) items.push(`The ${pathOf(src.url) === "/" ? "home page" : pathOf(src.url)} card for ${pathOf(l.href)} uses "${l.hasImg}", which is not on that service's own page`)
    }
    add("service_image_match", "Service image differs between pages", items)
  }

  // ---------------- logo
  if (enabled.has("logo_consistency")) {
    const m = new Map<string, string[]>()
    for (const p of desktopFacts) if (p.logo) m.set(p.logo, [...(m.get(p.logo) || []), pathOf(p.url)])
    if (m.size > 1) {
      const sorted = [...m.entries()].sort((a, b) => b[1].length - a[1].length)
      add("logo_consistency", "Header logo differs on some pages", sorted.slice(1).map(([k, pages]) => `Logo "${k}" (not "${sorted[0][0]}") on: ${pages.slice(0, 8).join(", ")}`))
    }
  }

  // ---------------- heading case
  if (enabled.has("case_consistency")) {
    const svc = desktopFacts.filter((p) => isService(p) && p.headings.length >= 2)
    const caps = svc.filter((p) => p.headings.filter((h) => h.caps).length > p.headings.length / 2)
    const normal = svc.filter((p) => p.headings.filter((h) => !h.caps).length > p.headings.length / 2)
    if (caps.length && normal.length) {
      const minority = caps.length < normal.length ? caps : normal
      add("case_consistency", "Heading case differs between service pages", [`Headings are in ${caps.length < normal.length ? "CAPITALS" : "normal case"} on ${minority.length} service page(s) but ${caps.length < normal.length ? "normal case" : "CAPITALS"} on ${Math.max(caps.length, normal.length)}: ${minority.slice(0, 10).map((p) => pathOf(p.url)).join(", ")}`])
    }
  }

  // ---------------- mobile order
  if (enabled.has("mobile_order")) {
    const withOrder = facts.filter((p) => p.mobileOrder)
    const img = withOrder.flatMap((p) => p.mobileOrder!.imageFirst.map((s) => ({ p: pathOf(p.url), s })))
    const txt = withOrder.flatMap((p) => p.mobileOrder!.textFirst.map((s) => ({ p: pathOf(p.url), s })))
    if (img.length && txt.length) {
      const minority = txt.length <= img.length ? txt : img
      const rule = txt.length <= img.length ? "image first, then text" : "text first, then image"
      add("mobile_order", "Image / text order on mobile is not consistent", minority.slice(0, 15).map((x) => `On ${x.p}, "${x.s}" stacks ${rule === "image first, then text" ? "text before the image" : "the image before the text"} on mobile (most sections: ${rule})`))
    }
  }

  // ---------------- location content
  if (enabled.has("location_content")) {
    const cities = new Map<string, string>()
    for (const a of allAddresses) for (const m of a.matchAll(CITY_STATE)) cities.set(m[1].toLowerCase(), m[2])
    const items: string[] = []
    if (cities.size >= 2) {
      for (const p of desktopFacts) {
        const where = `${pathOf(p.url)} ${p.title}`.toLowerCase().replace(/-/g, " ")
        const own = [...cities.keys()].filter((c) => where.includes(c))
        if (own.length !== 1) continue
        const text = p.text.toLowerCase()
        const others = [...cities.keys()].filter((c) => c !== own[0] && new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text))
        if (others.length) items.push(`The ${own[0].replace(/\b\w/g, (x) => x.toUpperCase())} page ${pathOf(p.url)} mentions ${others.map((c) => c.replace(/\b\w/g, (x) => x.toUpperCase())).join(", ")}`)
      }
    }
    add("location_content", "Location page mentions another city", items)
  }

  // ---------------- URL problems
  if (enabled.has("url_problems")) {
    const items: string[] = []
    const cityState = new Map<string, string>()
    for (const a of allAddresses) for (const m of a.matchAll(CITY_STATE)) cityState.set(m[1].toLowerCase().replace(/[.\s]+/g, "-"), m[2].toLowerCase())
    const urls = [...new Set([...crawledUrls, ...desktopFacts.map((p) => p.url)])]
    for (const u of urls) {
      const p = pathOf(u).toLowerCase()
      if (p === "/") continue
      const segs = p.split("/").filter(Boolean)
      const last = segs[segs.length - 1] || ""
      if (/(^|[-/])(test|testing|dummy|sample|lorem|copy|draft|old|temp)([-/]|$)/.test(p)) items.push(`${p} has a test / placeholder word in the URL`)
      else if (/gogroth/.test(p)) items.push(`${p} still has "gogroth" in the URL`)
      else if (/-\d$/.test(last) && !/^\d{4}$/.test(last) && !segs.includes("page")) items.push(`${p} ends in "-${last.split("-").pop()}" — a WordPress duplicate-page URL`)
      for (const [city, st] of cityState) {
        const m = p.match(new RegExp(`${city}-([a-z]{2})(?:[-/]|$)`))
        if (m && m[1] !== st && /^(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)$/.test(m[1]))
          items.push(`${p} says ${city}-${m[1].toUpperCase()} but the address is in ${city.replace(/-/g, " ")}, ${st.toUpperCase()}`)
      }
    }
    add("url_problems", "Problems in page URLs", items)
  }

  // ---------------- legal pages
  if (enabled.has("legal_pages")) {
    const terms = desktopFacts.find((p) => /terms|conditions/i.test(pathOf(p.url)) && !/privacy/i.test(pathOf(p.url)))
    if (terms) {
      const items: string[] = []
      const name = home.siteName || (home.title.split(/[|–—-]/).pop() || "").trim()
      if (name && norm(name).length >= 4 && !norm(terms.text).includes(norm(name))) items.push(`${pathOf(terms.url)} does not mention the business name "${name}"`)
      const siteEmails = new Set(desktopFacts.filter((p) => p !== terms).flatMap((p) => p.emails.map((e) => e.email)))
      for (const e of terms.emails) if (siteEmails.size && !siteEmails.has(e.email) && !/growth99/.test(e.email)) items.push(`${pathOf(terms.url)} uses the email ${e.email}, which appears nowhere else on the site`)
      for (const ph of terms.phones) if (!desktopFacts.some((p) => p !== terms && p.phones.some((x) => x.digits === ph.digits))) items.push(`${pathOf(terms.url)} uses the phone ${ph.display}, which appears nowhere else on the site`)
      if (/gogroth|test/i.test(pathOf(terms.url))) items.push(`The Terms URL ${pathOf(terms.url)} still has "gogroth" / "test" in it`)
      if (/\[(business|company) name\]|<<|lorem ipsum|your company/i.test(terms.text)) items.push(`${pathOf(terms.url)} still has template placeholders`)
      add("legal_pages", "Terms & Conditions details wrong", items)
    }
  }

  // ---------------- HTML sitemap
  if (enabled.has("html_sitemap")) {
    const sm = desktopFacts.find((p) => /\/(sitemap|site-map)(\/|$)/i.test(pathOf(p.url)) && !/\.xml$/i.test(p.url))
    if (sm) {
      const main = sm.links.filter((l) => l.area === "main" && hostOf(l.href) === hostOf(site))
      const c = new Map<string, number>()
      main.forEach((l) => c.set(samePageKey(l.href), (c.get(samePageKey(l.href)) || 0) + 1))
      const dups = [...c.entries()].filter(([, n]) => n > 1)
      if (dups.length) add("html_sitemap", "HTML sitemap lists pages twice", dups.slice(0, 15).map(([k, n]) => `${k.replace(/^[^/]+/, "") || "/"} is listed ${n} times`))
    }
  }

  // ---------------- live vs beta
  if (enabled.has("live_pages_parity") && run.live_site_url && hostOf(run.live_site_url) && hostOf(run.live_site_url) !== hostOf(site)) {
    try {
      const { crawlSitemap } = require("../../crawlers/sitemapCrawler")
      const live: string[] = (await crawlSitemap(run.live_site_url)).slice(0, 400)
      const beta = new Set(crawledUrls.map(pathOf))
      const missingPaths = [...new Set(live.map(pathOf))].filter((p) => p !== "/" && !beta.has(p) && !/\.(xml|pdf|jpe?g|png|webp)$/i.test(p) && !/\/(tag|author|feed|page|wp-|category)\b/i.test(p))
      const items: string[] = []
      const got = require("got")
      const origin = new URL(site).origin
      for (const p of missingPaths.slice(0, 40)) {
        try {
          const r = await got(origin + p, { throwHttpErrors: false, followRedirect: true, timeout: { request: 10000 }, headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } })
          if (r.statusCode === 404 || r.statusCode === 410) items.push(`${p} exists on the live site but is missing on beta (404) and not redirected`)
        } catch {}
      }
      if (missingPaths.length > 40) items.push(`${missingPaths.length - 40} more live-site URLs were not checked`)
      add("live_pages_parity", "Live-site pages missing on beta", items)
    } catch (e: any) {
      f.push(lapseFinding("live_pages_parity", `the live site's page list could not be read (${String(e?.message || e).slice(0, 100)})`, run.live_site_url))
    }
  }

  // ---------------- WordPress backend leftovers (public REST, login-free)
  if (enabled.has("backend_extras")) {
    try {
      const got = require("got")
      const origin = new URL(site).origin
      const opts = { throwHttpErrors: false, timeout: { request: 15000 }, responseType: "json" as const, headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } }
      const pr = await got(`${origin}/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,title,link`, opts)
      if (pr.statusCode === 200 && Array.isArray(pr.body)) {
        const items: string[] = []
        const byTitle = new Map<string, string[]>()
        for (const pg of pr.body as any[]) {
          const t = norm(String(pg?.title?.rendered || ""))
          if (t) byTitle.set(t, [...(byTitle.get(t) || []), pathOf(String(pg.link || ""))])
          if (/-\d$/.test(String(pg.slug || ""))) items.push(`Page "${String(pg?.title?.rendered || pg.slug)}" has a duplicate slug (${pg.slug})`)
        }
        for (const [, links] of byTitle) if (links.length > 1) items.push(`${links.length} published pages share the same title: ${links.join(", ")}`)
        const mr = await got(`${origin}/wp-json/wp/v2/media?per_page=100&_fields=id,slug,source_url`, opts)
        if (mr.statusCode === 200 && Array.isArray(mr.body)) {
          const dummy = (mr.body as any[]).filter((m) => /(placeholder|dummy|sample|lorem|demo|test-image|stock-photo|image-placeholder)/i.test(`${m.slug} ${m.source_url}`))
          if (dummy.length) items.push(`Dummy / placeholder media in the library: ${dummy.slice(0, 8).map((m) => String(m.source_url).split("/").pop()).join(", ")}`)
        }
        add("backend_extras", "WordPress backend leftovers", items)
      }
      // REST not public / not WordPress → nothing to read; no row.
    } catch {}
  }

  return f
}

export { imageKey }
