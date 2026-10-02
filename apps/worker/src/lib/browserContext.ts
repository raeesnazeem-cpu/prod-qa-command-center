/**
 * Shared browser helpers so every check can load ANY website, not just the
 * WordPress beta sites QACC was first built for.
 *
 * Why this exists: a context with no userAgent sends "HeadlessChrome", which
 * Cloudflare and other bot filters block (403 / challenge page). Some sites
 * also have broken or self-signed certificates, never reach "networkidle"
 * (chat widgets, analytics beacons), or keep loading forever. These helpers
 * give every check the same tolerant defaults.
 */

export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
export const TABLET_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

/**
 * Context options that work on any public site: a real browser UA, tolerant
 * TLS, and an English locale. Caller options win (viewport, userAgent, ...).
 */
export function realContextOptions(opts: Record<string, any> = {}): Record<string, any> {
  return {
    userAgent: DESKTOP_UA,
    ignoreHTTPSErrors: true,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
    ...opts,
  }
}

/** browser.newContext() with realContextOptions() applied. */
export async function newRealContext(browser: any, opts: Record<string, any> = {}): Promise<any> {
  return browser.newContext(realContextOptions(opts))
}

/**
 * Launch a stealth chromium (hides navigator.webdriver, the HeadlessChrome
 * token, etc.). Falls back to plain playwright if playwright-extra is missing.
 * The caller owns the browser and must close it.
 */
export async function launchStealthBrowser(): Promise<any> {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  try {
    const { chromium } = require("playwright-extra")
    const stealth = require("puppeteer-extra-plugin-stealth")()
    chromium.use(stealth)
    return await chromium.launch({ headless: true, args })
  } catch {
    const { chromium } = require("playwright")
    return chromium.launch({ headless: true, args })
  }
}

export type GotoResult = {
  ok: boolean
  status: number | null
  error?: string
}

/**
 * page.goto that never throws. Tries "load" first, then "domcontentloaded" if
 * load fails for a reason other than a timeout. A timeout is not fatal: the
 * page is usually usable even if some third-party script never finishes.
 */
export async function gotoResilient(
  page: any,
  url: string,
  opts: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" } = {},
): Promise<GotoResult> {
  const timeout = opts.timeout ?? 60000
  const first = opts.waitUntil ?? "load"
  try {
    const res = await page.goto(url, { waitUntil: first, timeout })
    return { ok: true, status: res?.status?.() ?? null }
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (/timeout/i.test(msg)) return { ok: true, status: null, error: msg }
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout })
      return { ok: true, status: res?.status?.() ?? null }
    } catch (e2: any) {
      const msg2 = String(e2?.message || e2)
      return { ok: /timeout/i.test(msg2), status: null, error: msg2 }
    }
  }
}

/** True when a page looks like a bot-challenge / block page, not the real site. */
export async function looksBlocked(page: any): Promise<boolean> {
  try {
    const title: string = (await page.title()) || ""
    const text: string = await page
      .evaluate(() => (document.body?.innerText || "").slice(0, 4000))
      .catch(() => "")
    // Challenge pages are short. A real page that merely mentions "captcha"
    // or "access denied" in its content is not a block page.
    if (text.length >= 3000) return false
    return /just a moment|attention required|access denied|verify you are human|checking your browser|cf-chl|captcha/i.test(
      `${title}\n${text}`,
    )
  } catch {
    return false
  }
}
