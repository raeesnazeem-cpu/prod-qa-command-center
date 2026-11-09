import { Browser } from "playwright"
import { Finding } from "@qacc/shared"
import { realContextOptions, gotoResilient, looksBlocked, MOBILE_UA } from "../../lib/browserContext"
import { gapFinding, lapseFinding } from "./findings"

/**
 * cart_add_to_cart — Add to Cart on a phone, end to end (WooCommerce sites).
 *
 * QA keeps finding "View Cart not showing after Add to Cart on mobile". This
 * check does what QA does, at iPhone size (390×844, touch):
 *   1. pick one in-stock, simple product (WooCommerce Store API, else /shop)
 *   2. open it and tap Add to Cart
 *   3. "View cart" (notice or button) must appear
 *   4. the header / hamburger cart count must go up (when the theme shows one)
 *   5. the cart page must list the product
 *
 * SAFE BY DESIGN — test phase only:
 *   • a guest cart: WooCommerce keeps it in a browser session; nothing is
 *     ordered, no stock changes, no account or payment is touched
 *   • never checks out
 *   • the browser context (and its cart) is thrown away at the end
 *   • never runs on post-release scans (the client's live shop); full scans
 *     only on a beta / staging host (see isTestPhaseHost)
 */

export const CART_FLOW_KEY = "cart_add_to_cart"

/** A "Check Skipped" row: the shared verdict counts it as not run, never as a pass. */
function skipped(reason: string, pageUrl: string): Finding {
  return {
    check_factor: CART_FLOW_KEY,
    title: "Check Skipped",
    description: `Add to Cart on mobile was ${reason}.`,
    context_text: `Page: ${pageUrl}\nSkipped: ${reason}`,
    screenshot_url: null,
    status: "open",
    ai_generated: false,
  } as Finding
}

/** Beta / staging hosts where a test cart is fine. Pure — unit-tested. */
export function isTestPhaseHost(siteUrl: string): boolean {
  let host = ""
  try {
    host = new URL(siteUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  return (
    /(^|\.)gogroth\.com$/.test(host) ||
    /(^|[.-])(beta|staging|stage|dev|test|qa|preview|sandbox)([.-]|$)/.test(host) ||
    /\.(local|test|localhost)$/.test(host) ||
    host === "localhost" ||
    host === "127.0.0.1"
  )
}

/** Should the add-to-cart flow run for this scan? Pure — unit-tested. */
export function cartFlowAllowed(runType: string | undefined, siteUrl: string): { ok: boolean; why?: string } {
  if (runType === "post_release") return { ok: false, why: "post-release scans test the client's live shop" }
  if (runType === "pre_release" || runType === "internal_qa") return { ok: true }
  if (isTestPhaseHost(siteUrl)) return { ok: true }
  return { ok: false, why: "the site is not on a beta / staging host" }
}

/** One in-stock simple product from the public WooCommerce Store API. Pure — unit-tested. */
export function pickProduct(products: any[]): { name: string; url: string } | null {
  for (const p of products || []) {
    const purchasable = p?.is_purchasable !== false && p?.is_in_stock !== false
    const simple = !p?.type || p.type === "simple"
    const needsOptions = Array.isArray(p?.variations) && p.variations.length > 0
    if (purchasable && simple && !needsOptions && p?.permalink) return { name: String(p.name || "product").replace(/<[^>]+>/g, ""), url: String(p.permalink) }
  }
  return null
}

interface CartState { count: number | null; viewCart: boolean; cartHref: string }

/** Runs in the page. Self-contained. */
function readCart(): CartState {
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0" }
  // Cart count shown in the header / mini-cart (theme dependent).
  const countEls = Array.from(document.querySelectorAll(
    ".cart-contents .count, .cart-contents-count, .elementor-button-icon-qty, .wc-block-mini-cart__badge, .cart-count, .header-cart-count, [class*=cart] [class*=count], [class*=cart-count], [data-counter]",
  ))
  let count: number | null = null
  for (const e of countEls) {
    const n = parseInt(((e as HTMLElement).innerText || e.getAttribute("data-counter") || "").replace(/\D/g, ""), 10)
    if (!isNaN(n)) { count = Math.max(count ?? 0, n); }
  }
  const viewLinks = (Array.from(document.querySelectorAll("a")) as HTMLAnchorElement[]).filter(
    (a) => vis(a) && (/view\s*cart|go to cart/i.test(a.innerText || "") || a.matches("a.added_to_cart, .woocommerce-message a.wc-forward, .wc-block-components-notice-banner a")),
  )
  const cartLink = (document.querySelector('a[href*="/cart"]') as HTMLAnchorElement | null)?.href || ""
  return { count, viewCart: viewLinks.length > 0, cartHref: viewLinks[0]?.href || cartLink }
}

async function storeProducts(origin: string): Promise<any[] | null> {
  try {
    const got = require("got")
    const r = await got(`${origin}/wp-json/wc/store/v1/products?per_page=20&stock_status=instock`, {
      throwHttpErrors: false,
      timeout: { request: 15000 },
      responseType: "json",
      headers: { "user-agent": MOBILE_UA },
    })
    return r.statusCode === 200 && Array.isArray(r.body) ? r.body : null
  } catch {
    return null
  }
}

export async function checkCartFlow(
  pageUrl: string,
  browser: Browser,
  opts: { runType?: string; isWoo?: boolean },
): Promise<Finding[]> {
  const origin = new URL(pageUrl).origin
  // Is this a WooCommerce shop at all? (Store API is public on WooCommerce 5+.)
  const products = await storeProducts(origin)
  // Not a shop: nothing to test, no row — same as the woocommerce check.
  if (!products && !opts.isWoo) return []
  const allowed = cartFlowAllowed(opts.runType, pageUrl)
  // A shop we must not touch (live site): say so — a missing row would read as "passed".
  if (!allowed.ok) return [skipped(`not run — ${allowed.why}; Add to Cart is only tested on beta / staging sites`, pageUrl)]
  let product = products ? pickProduct(products) : null

  let context: any = null
  try {
    context = await browser.newContext(
      realContextOptions({ viewport: { width: 390, height: 844 }, userAgent: MOBILE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }),
    )
    const page = await context.newPage()

    // No Store API (or nothing listed): find a product from the shop page.
    if (!product) {
      const nav = await gotoResilient(page, `${origin}/shop/`, { timeout: 40000 })
      if (nav.ok && !(await looksBlocked(page))) {
        const href: string | null = await page.evaluate(() => {
          const a = document.querySelector("li.product a.woocommerce-LoopProduct-link, .products .product a[href*='/product/'], a[href*='/product/']") as HTMLAnchorElement | null
          return a ? a.href : null
        })
        if (href) product = { name: "first shop product", url: href }
      }
    }
    if (!product) {
      return [gapFinding(CART_FLOW_KEY, "No product to test Add to Cart with", ["The site looks like a shop, but no in-stock simple product could be found on the Store API or the /shop page"], pageUrl)]
    }

    const nav = await gotoResilient(page, product.url, { timeout: 45000 })
    if (!nav.ok) return [lapseFinding(CART_FLOW_KEY, `the product page could not be loaded (${String(nav.error || "").split("\n")[0]})`, product.url)]
    if (await looksBlocked(page)) return [lapseFinding(CART_FLOW_KEY, "the site blocked the QACC browser (bot protection)", product.url)]
    await page.waitForTimeout(1500)

    const before: CartState = await page.evaluate(readCart)
    const btn = page.locator("button.single_add_to_cart_button, button[name='add-to-cart'], .wc-block-components-product-button__button, a.add_to_cart_button").first()
    const items: string[] = []
    if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) {
      return [gapFinding(CART_FLOW_KEY, "Add to Cart button missing on mobile", [`No visible Add to Cart button on "${product.name}" (${product.url}) at phone size`], product.url)]
    }
    await btn.scrollIntoViewIfNeeded().catch(() => {})
    try {
      await btn.tap({ timeout: 8000 })
    } catch {
      try {
        await btn.click({ timeout: 8000 })
      } catch (e: any) {
        return [gapFinding(CART_FLOW_KEY, "Add to Cart can't be tapped on mobile", [`Tapping Add to Cart on "${product.name}" failed — something covers the button or it is disabled (${String(e?.message || e).split("\n")[0].slice(0, 100)})`], product.url)]
      }
    }
    // A full-page submit reloads; an AJAX add updates in place. Wait for either.
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {})
    let after: CartState = await page.evaluate(readCart).catch(() => before)
    for (let i = 0; i < 8 && !after.viewCart; i++) {
      await page.waitForTimeout(1000)
      after = await page.evaluate(readCart).catch(() => after)
    }
    if (!after.viewCart) items.push(`After tapping Add to Cart on "${product.name}", no "View cart" link or button appeared on mobile`)
    if (before.count !== null && after.count !== null && after.count <= before.count)
      items.push(`The header cart count stayed at ${after.count} after adding a product`)
    if (before.count !== null && after.count === null) items.push("The cart count disappeared from the mobile header after adding a product")

    // The cart page must list the product.
    const cartUrl = after.cartHref || `${origin}/cart/`
    const cnav = await gotoResilient(page, cartUrl, { timeout: 40000 })
    if (cnav.ok) {
      await page.waitForTimeout(2500)
      const listed = await page.evaluate(() => {
        const rows = document.querySelectorAll(".woocommerce-cart-form .cart_item, .wc-block-cart-items__row, .wc-block-cart-item, tr.cart_item")
        const empty = !!document.querySelector(".cart-empty, .wc-block-cart__empty-cart__title, .wp-block-woocommerce-empty-cart-block")
        return { rows: rows.length, empty }
      })
      if (listed.rows === 0 || listed.empty) items.push(`The cart page (${new URL(cartUrl).pathname}) is empty after adding "${product.name}"`)
    } else {
      items.push(`The cart page ${cartUrl} did not load after adding a product`)
    }

    return items.length
      ? [gapFinding(CART_FLOW_KEY, "Add to Cart does not work properly on mobile", items, product.url, "Tested as a guest at iPhone size (390×844). Nothing was ordered; the test cart was discarded.")]
      : []
  } catch (e: any) {
    return [lapseFinding(CART_FLOW_KEY, `the add-to-cart test failed (${String(e?.message || e).split("\n")[0].slice(0, 120)})`, pageUrl)]
  } finally {
    // Discards the guest session and its cart.
    await context?.close().catch(() => {})
  }
}
