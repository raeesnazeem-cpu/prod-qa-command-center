import { Browser } from "playwright"
import { Finding, aiFailureReason } from "@qacc/shared"
import { realContextOptions, gotoResilient, looksBlocked, MOBILE_UA } from "../../lib/browserContext"
import { describeImageResult } from "../../lib/aiFallback"
import { gapFinding, lapseFinding } from "./findings"

/**
 * QA-gap checks that need AI vision — every page, own browser context.
 *
 *   hero_readability    hero text hard to read on its background image / video
 *                       (desktop + mobile; for a video, three frames — the
 *                       busiest frame decides)
 *   hero_video_quality  hero video low-resolution / blurry, stalling, or not
 *                       playing (playback measured; blur judged on one frame)
 *   image_text_cutoff   text that is part of an image cut off on mobile (the
 *                       full image file vs. how the phone shows it)
 *   logo_visibility     homepage header logo dim, washed out, white on a light
 *                       background, cut off or too small (desktop + mobile)
 *
 * Vision goes through describeImageResult (Cloudflare → OpenRouter → … →
 * Gemini), so a paid GEMINI_API_KEY is picked up with no code change. Every
 * vision call is pre-filtered by a deterministic test (text really sits on an
 * image, an image really is cropped …) and capped per page and per run, so
 * cost stays bounded. A vision outage is a "could not complete" row with the
 * honest reason — never a false pass or fail.
 *
 * The Growth99 FOOTER logo (wrong colour version, tagline) is already judged
 * by vision in the footer_logo check; logo_visibility covers the header logo.
 */

export const VISION_KEYS = ["hero_readability", "hero_video_quality", "image_text_cutoff", "logo_visibility"]

const PER_PAGE_MAX_CALLS = 6
const RUN_MAX_CALLS = Math.max(10, Number(process.env.GAP_VISION_MAX_CALLS) || 150)
const runCalls = new Map<string, { n: number; t: number }>()

/** Take one vision call from this run's budget. */
function takeBudget(runId: string): boolean {
  const now = Date.now()
  for (const [k, v] of runCalls) if (now - v.t > 6 * 3600_000) runCalls.delete(k)
  const b = runCalls.get(runId) || { n: 0, t: now }
  if (b.n >= RUN_MAX_CALLS) return false
  b.n++
  b.t = now
  runCalls.set(runId, b)
  return true
}
export function releaseVisionBudget(runId: string): void {
  runCalls.delete(runId)
}

/** First JSON object in a model reply, or null. Pure — unit-tested. */
export function parseVisionJson(text: string): any | null {
  const m = String(text || "").match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

/**
 * Share of an image hidden by object-fit and by clipping ancestors / the
 * screen edge. Pure — unit-tested.
 */
export function hiddenShare(
  box: { w: number; h: number },
  natural: { w: number; h: number },
  fit: string,
  visibleBoxShare: number,
): number {
  let fitShown = 1
  if (natural.w > 0 && natural.h > 0 && box.w > 0 && box.h > 0) {
    if (fit === "cover") {
      const s = Math.max(box.w / natural.w, box.h / natural.h)
      fitShown = Math.min(1, (box.w * box.h) / (natural.w * s * natural.h * s))
    } else if (fit === "none") {
      fitShown = Math.min(1, (Math.min(box.w, natural.w) * Math.min(box.h, natural.h)) / (natural.w * natural.h))
    }
  }
  return 1 - fitShown * Math.max(0, Math.min(1, visibleBoxShare))
}

interface HeroFacts {
  found: boolean
  rect: { x: number; y: number; w: number; h: number } | null
  textOverMedia: boolean
  headline: string
  video: { present: boolean; src: string; videoW: number; videoH: number; boxW: number; boxH: number; autoplay: boolean }
}

/** Runs in the page. Self-contained. Finds the hero and whether its text sits on an image / video. */
function readHero(): HeroFacts {
  const out: HeroFacts = { found: false, rect: null, textOverMedia: false, headline: "", video: { present: false, src: "", videoW: 0, videoH: 0, boxW: 0, boxH: 0, autoplay: false } }
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0" }
  const clean = (s: any) => String(s || "").replace(/\s+/g, " ").trim()
  const inHeader = (e: Element) => !!e.closest('header, [data-elementor-type="header"], #masthead, .site-header, nav')
  const cands = Array.from(document.querySelectorAll("section, .elementor-section, .e-con, .wp-block-cover, [class*=hero], [class*=banner], main > div, #content > div")).filter((e) => {
    if (inHeader(e) || !vis(e)) return false
    const r = e.getBoundingClientRect()
    return r.top + scrollY < 260 && r.height >= 280 && r.width >= innerWidth * 0.8
  })
  for (const sec of cands.slice(0, 12)) {
    const sr = sec.getBoundingClientRect()
    const area = sr.width * sr.height
    const bg = [sec, ...Array.from(sec.querySelectorAll("*")).slice(0, 60)].some((e) => { const b = getComputedStyle(e).backgroundImage; const r = e.getBoundingClientRect(); return b && /url\(/.test(b) && r.width * r.height > area * 0.6 })
    const vid = Array.from(sec.querySelectorAll("video")).find((v) => { const r = v.getBoundingClientRect(); return vis(v) && r.width * r.height > area * 0.5 }) as HTMLVideoElement | undefined
    const img = Array.from(sec.querySelectorAll("img")).find((i) => { const r = i.getBoundingClientRect(); return vis(i) && r.width * r.height > area * 0.6 })
    const iframeVid = Array.from(sec.querySelectorAll('iframe[src*="youtube"], iframe[src*="vimeo"]')).find((f) => { const r = f.getBoundingClientRect(); return r.width * r.height > area * 0.5 })
    if (!bg && !vid && !img && !iframeVid) continue
    const texts = Array.from(sec.querySelectorAll("h1, h2, h3, p")).filter((t) => vis(t) && clean((t as HTMLElement).innerText).length > 2)
    const media = (vid || img || iframeVid || sec).getBoundingClientRect()
    const over = texts.some((t) => { const r = t.getBoundingClientRect(); return r.left < media.right && r.right > media.left && r.top < media.bottom && r.bottom > media.top })
    out.found = true
    out.rect = { x: Math.max(0, sr.left), y: Math.max(0, sr.top + scrollY), w: Math.min(sr.width, innerWidth), h: Math.min(sr.height, 1400) }
    out.textOverMedia = over
    out.headline = clean((texts[0] as HTMLElement | undefined)?.innerText).slice(0, 80)
    if (vid) {
      const r = vid.getBoundingClientRect()
      out.video = { present: true, src: vid.currentSrc || vid.src || "", videoW: vid.videoWidth, videoH: vid.videoHeight, boxW: Math.round(r.width), boxH: Math.round(r.height), autoplay: vid.autoplay }
    }
    break
  }
  return out
}

/** Runs in the page. Plays the hero video for `ms` and reports how playback went. Self-contained. */
async function measureVideo(ms: number): Promise<{ advanced: number; waiting: number; stalled: number; error: number; paused: boolean; readyState: number; videoW: number }> {
  const v = Array.from(document.querySelectorAll("video")).sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height })[0] as HTMLVideoElement | undefined
  if (!v) return { advanced: 0, waiting: 0, stalled: 0, error: 0, paused: true, readyState: 0, videoW: 0 }
  let waiting = 0, stalled = 0
  const w = () => waiting++, s = () => stalled++
  v.addEventListener("waiting", w)
  v.addEventListener("stalled", s)
  if (v.paused && v.autoplay) { v.muted = true; await v.play().catch(() => {}) }
  const t0 = v.currentTime
  await new Promise((r) => setTimeout(r, ms))
  v.removeEventListener("waiting", w)
  v.removeEventListener("stalled", s)
  return { advanced: v.currentTime - t0, waiting, stalled, error: v.error ? v.error.code : 0, paused: v.paused, readyState: v.readyState, videoW: v.videoWidth }
}

/** Runs in the page. Content images that are cropped at this width, largest crop first. Self-contained. */
function readCroppedImages(): { src: string; idx: number; box: { w: number; h: number }; natural: { w: number; h: number }; fit: string; visibleBoxShare: number }[] {
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0" }
  const out: any[] = []
  const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[]
  imgs.forEach((img, idx) => {
    if (!vis(img) || !img.naturalWidth || img.closest('header, footer, nav, [data-elementor-type="header"], [data-elementor-type="footer"]')) return
    const r = img.getBoundingClientRect()
    if (r.width < 120 || r.height < 90) return
    // Visible part of the box: clipped by overflow ancestors and the screen edges.
    let left = r.left, right = r.right, top = r.top, bottom = r.bottom
    for (let a = img.parentElement, i = 0; a && i < 15; a = a.parentElement, i++) {
      const cs = getComputedStyle(a)
      if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)) {
        const ar = a.getBoundingClientRect()
        left = Math.max(left, ar.left); right = Math.min(right, ar.right); top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom)
      }
    }
    left = Math.max(left, 0); right = Math.min(right, innerWidth)
    const visibleBoxShare = Math.max(0, right - left) * Math.max(0, bottom - top) / (r.width * r.height)
    out.push({ src: img.currentSrc || img.src, idx, box: { w: r.width, h: r.height }, natural: { w: img.naturalWidth, h: img.naturalHeight }, fit: getComputedStyle(img).objectFit, visibleBoxShare })
  })
  return out
}

export async function checkVisionGaps(
  pageUrl: string,
  runId: string,
  pageId: string,
  browser: Browser,
  enabled: Set<string>,
  isHome: boolean,
): Promise<Finding[]> {
  const keys = VISION_KEYS.filter((k) => enabled.has(k) && (k !== "logo_visibility" || isHome))
  if (keys.length === 0) return []
  const { uploadScreenshot } = require("../../lib/supabaseStorage")
  const f: Finding[] = []
  const issues: Record<string, string[]> = {}
  const shots: Record<string, string | null> = {}
  const lapses: Record<string, string> = {}
  let calls = 0
  const push = (k: string, s: string) => (issues[k] = [...(issues[k] || []), s])
  const evidence = async (k: string, buf: Buffer) => {
    if (shots[k]) return
    shots[k] = (await uploadScreenshot(buf, `${runId}/vision_${k}_${pageId}.jpg`).catch(() => "")) || null
  }
  /** One budgeted vision call; null = could not ask (reason recorded as a lapse). */
  const ask = async (k: string, img: Buffer | Buffer[], prompt: string): Promise<any | null> => {
    if (calls >= PER_PAGE_MAX_CALLS) return null // per-page cap: the rest of the page stays unchecked by AI, silently capped
    if (!takeBudget(runId)) { lapses[k] = lapses[k] || `the AI call budget for this scan (${RUN_MAX_CALLS}) was used up before this page`; return null }
    calls++
    const vr = await describeImageResult(img, prompt)
    if (!vr.ok) { lapses[k] = lapses[k] || aiFailureReason(vr.error || "vision unavailable"); return null }
    const o = parseVisionJson(vr.text)
    if (!o) lapses[k] = lapses[k] || "AI reply could not be read"
    return o
  }

  let ctx: any = null
  try {
    ctx = await browser.newContext(realContextOptions({ viewport: { width: 1440, height: 900 } }))
    const page = await ctx.newPage()
    const nav = await gotoResilient(page, pageUrl, { timeout: 45000 })
    if (!nav.ok) return keys.map((k) => lapseFinding(k, `the page could not be loaded (${String(nav.error || "").split("\n")[0]})`, pageUrl))
    if (await looksBlocked(page)) return keys.map((k) => lapseFinding(k, "the site blocked the QACC browser (bot protection)", pageUrl))
    await page.waitForTimeout(2500)

    // ---------------- desktop: hero + logo
    const hero: HeroFacts = await page.evaluate(readHero)
    const clip = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x, y: r.y, width: Math.max(1, r.w), height: Math.max(1, r.h) })
    if (hero.found && hero.rect && hero.textOverMedia && enabled.has("hero_readability")) {
      const frames: Buffer[] = []
      for (let i = 0; i < (hero.video.present ? 3 : 1); i++) {
        if (i) await page.waitForTimeout(2200)
        const b = await page.screenshot({ type: "jpeg", quality: 70, clip: clip(hero.rect), fullPage: true }).catch(() => null)
        if (b) frames.push(b)
      }
      if (frames.length) {
        const o = await ask(
          "hero_readability",
          frames,
          `${frames.length > 1 ? `These are ${frames.length} frames of a website's hero section (text over a background video). ` : "This is a website's hero section (text over a background image). "}Is ALL of the hero text (headline, subtext, buttons) easy to read against what is behind it${frames.length > 1 ? " in EVERY frame" : ""}? Judge contrast as a visitor would: busy or bright areas behind light text, or dark areas behind dark text, make it hard to read. Respond with STRICT JSON only: {"readable": true|false, "confidence": 0.0-1.0, "hard_to_read": "<which text, and why — empty if readable>"}`,
        )
        if (o && o.readable === false && Number(o.confidence) >= 0.6) {
          push("hero_readability", `Desktop: hero text is hard to read${hero.headline ? ` ("${hero.headline}")` : ""} — ${String(o.hard_to_read || "low contrast with the background").slice(0, 160)}`)
          await evidence("hero_readability", frames[frames.length - 1])
        }
      }
    }

    if (hero.video.present && enabled.has("hero_video_quality")) {
      const pb = await page.evaluate(measureVideo, 5000).catch(() => null)
      const videoW = pb?.videoW || hero.video.videoW
      if (pb) {
        if (pb.error) push("hero_video_quality", `The hero video fails to play (media error ${pb.error})`)
        else if (pb.readyState < 2) push("hero_video_quality", "The hero video has not loaded after 7 seconds")
        else if (hero.video.autoplay && pb.advanced < 1) push("hero_video_quality", `The hero video is set to autoplay but barely plays (${pb.advanced.toFixed(1)}s in 5s)`)
        if (pb.waiting + pb.stalled >= 2) push("hero_video_quality", `The hero video stops and starts while playing (${pb.waiting + pb.stalled} pauses to buffer in 5s) — compress it or use a smaller file`)
      }
      if (videoW && hero.video.boxW && videoW < hero.video.boxW * 0.6)
        push("hero_video_quality", `The hero video is ${videoW}px wide but shown ${hero.video.boxW}px wide on desktop — it will look blurry; upload a higher-resolution version`)
      else if (hero.rect && !(issues.hero_video_quality || []).length) {
        const b = await page.screenshot({ type: "jpeg", quality: 80, clip: clip(hero.rect), fullPage: true }).catch(() => null)
        if (b) {
          const o = await ask(
            "hero_video_quality",
            b,
            `This is one frame of a website's hero background video. Ignore any text laid over it. Is the VIDEO itself sharp, or is it blurry, pixelated or blocky (compression artefacts)? Respond with STRICT JSON only: {"blurry": true|false, "confidence": 0.0-1.0, "note": "<short reason>"}`,
          )
          if (o && o.blurry === true && Number(o.confidence) >= 0.7) {
            push("hero_video_quality", `The hero video looks blurry or pixelated on desktop — ${String(o.note || "").slice(0, 120)}`)
            await evidence("hero_video_quality", b)
          }
        }
      }
    }

    const logoCheck = async (device: string) => {
      const box = await page.evaluate(() => {
        const hs = Array.from(document.querySelectorAll('header, [data-elementor-type="header"], #masthead, .site-header'))
        const h = hs.find((x) => x.getBoundingClientRect().height > 0) || null
        const logo = (h?.querySelector('.custom-logo, img[class*=logo i], img[src*=logo i], img[alt*=logo i], svg[class*=logo i]') || h?.querySelector("img")) as Element | null
        if (!logo) return null
        const r = logo.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return null
        return { x: Math.max(0, r.left - 24), y: Math.max(0, r.top + scrollY - 16), w: r.width + 48, h: r.height + 32, lw: r.width, lh: r.height }
      })
      if (!box) return
      if (box.lw < (device === "desktop" ? 80 : 60)) push("logo_visibility", `${device[0].toUpperCase()}${device.slice(1)}: the header logo is only ${Math.round(box.lw)}×${Math.round(box.lh)}px — too small`)
      const b = await page.screenshot({ type: "png", clip: { x: box.x, y: box.y, width: Math.min(box.w, (page.viewportSize()?.width || 1440) - box.x), height: box.h }, fullPage: true }).catch(() => null)
      if (!b) return
      const o = await ask(
        "logo_visibility",
        b,
        `This is a website's header logo with a little of the header background around it. Is the logo clearly visible and readable against that background? Flag it if it is dim, faded or washed out, white or light on a light background (or dark on dark), blurry or pixelated, or cut off. Respond with STRICT JSON only: {"clear": true|false, "confidence": 0.0-1.0, "problem": "<short — empty if clear>"}`,
      )
      if (o && o.clear === false && Number(o.confidence) >= 0.65) {
        push("logo_visibility", `${device[0].toUpperCase()}${device.slice(1)}: the header logo is hard to see — ${String(o.problem || "low contrast").slice(0, 140)}`)
        await evidence("logo_visibility", b)
      }
    }
    if (isHome && enabled.has("logo_visibility")) await logoCheck("desktop")

    // ---------------- mobile: hero text, logo, text inside cropped images
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(1200)
    if (enabled.has("hero_readability")) {
      const mh: HeroFacts = await page.evaluate(readHero)
      if (mh.found && mh.rect && mh.textOverMedia) {
        const b = await page.screenshot({ type: "jpeg", quality: 70, clip: clip(mh.rect), fullPage: true }).catch(() => null)
        if (b) {
          const o = await ask(
            "hero_readability",
            b,
            `This is a website's hero section on a phone (text over a background ${mh.video.present ? "video" : "image"}). Is ALL of the hero text easy to read against what is behind it? Respond with STRICT JSON only: {"readable": true|false, "confidence": 0.0-1.0, "hard_to_read": "<which text, and why — empty if readable>"}`,
          )
          if (o && o.readable === false && Number(o.confidence) >= 0.6) {
            push("hero_readability", `Mobile: hero text is hard to read${mh.headline ? ` ("${mh.headline}")` : ""} — ${String(o.hard_to_read || "low contrast with the background").slice(0, 160)}`)
            await evidence("hero_readability", b)
          }
        }
      }
    }
    if (isHome && enabled.has("logo_visibility")) await logoCheck("mobile")

    if (enabled.has("image_text_cutoff")) {
      // Scroll once so lazy images load at this width.
      await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < Math.min(h, 16000); y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)) } scrollTo(0, 0) }).catch(() => {})
      await page.waitForTimeout(600)
      const imgs = (await page.evaluate(readCroppedImages).catch(() => [])) as Awaited<ReturnType<typeof readCroppedImages>>
      const cropped = imgs
        .map((i) => ({ ...i, hidden: hiddenShare(i.box, i.natural, i.fit, i.visibleBoxShare) }))
        .filter((i) => i.hidden >= 0.08)
        .sort((a, b) => b.hidden - a.hidden)
        .slice(0, 3)
      for (const im of cropped) {
        const full = await ctx.request.get(im.src, { timeout: 20000 }).then((r: any) => (r.ok() ? r.body() : null)).catch(() => null)
        if (!full || full.length > 8_000_000) continue
        const el = page.locator("img").nth(im.idx)
        await el.scrollIntoViewIfNeeded().catch(() => {})
        const shown = await el.screenshot({ type: "jpeg", quality: 75 }).catch(() => null)
        if (!shown) continue
        const o = await ask(
          "image_text_cutoff",
          [full, shown],
          `Image 1 is a full image file. Image 2 is how the same image appears on a phone, where part of it is cropped off. Does Image 1 contain TEXT (words, a heading, a price, a logo with words) that is cut off or missing in Image 2? Ignore cropping that removes only background or scenery. Respond with STRICT JSON only: {"text_in_image": true|false, "text_cut_off": true|false, "confidence": 0.0-1.0, "cut_text": "<the text that is cut off — empty if none>"}`,
        )
        if (o && o.text_cut_off === true && Number(o.confidence) >= 0.65) {
          push("image_text_cutoff", `Mobile: text in ${im.src.split("/").pop()} is cut off (${Math.round(im.hidden * 100)}% of the image hidden)${o.cut_text ? ` — "${String(o.cut_text).slice(0, 80)}"` : ""}`)
          await evidence("image_text_cutoff", shown)
        }
      }
    }
  } catch (e: any) {
    for (const k of keys) if (!issues[k]) lapses[k] = lapses[k] || `the page could not be checked (${String(e?.message || e).split("\n")[0].slice(0, 120)})`
  } finally {
    await ctx?.close().catch(() => {})
  }

  const TITLES: Record<string, string> = {
    hero_readability: "Hero text hard to read",
    hero_video_quality: "Hero video quality problem",
    image_text_cutoff: "Text inside an image cut off on mobile",
    logo_visibility: "Header logo hard to see",
  }
  for (const k of keys) {
    // A real problem wins; an AI outage on a page with no problem found is "could not complete".
    if (issues[k]?.length) f.push(gapFinding(k, TITLES[k], [...new Set(issues[k])].slice(0, 8), pageUrl, "Judged by AI vision on screenshots of this page.", shots[k] || null))
    else if (lapses[k]) f.push(lapseFinding(k, lapses[k], pageUrl))
  }
  return f
}
