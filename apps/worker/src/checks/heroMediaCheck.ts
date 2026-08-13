import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"
import type { ThemeType } from "../lib/themeType"

/**
 * Hero media check — block-theme / classic-theme WordPress (NO Elementor).
 *
 * Detection is driven by core Cover-block markup plus semantic fallbacks:
 *   video.wp-block-cover__video-background   Cover block background video
 *   img.wp-block-cover__image-background     Cover block background image
 *   any <video> / <img> / CSS background-image inside the resolved hero region
 *
 * The hero region is resolved by probing an ordered selector list and taking the
 * first candidate that is visible, near the top of the document and tall enough
 * to be a hero. The winning nodes are tagged with `data-qacc-hero-*` so the
 * screenshot and the video-timing pass can address them without fragile
 * selector strings.
 *
 * Honesty rule: this check runs on the homepage only, so "nothing found" is a
 * real signal, not a pass. It reports `medium` instead of silently succeeding.
 */

interface HeroProbe {
  regionFound: boolean
  regionSelector: string
  regionTag: string
  media: "video" | "image" | "css-background" | "none"
  isCoverBlock: boolean
  video: {
    src: string
    poster: string | null
    autoplay: boolean
    muted: boolean
    loop: boolean
    playsInline: boolean
    controls: boolean
    readyState: number
    outerHTML: string
  } | null
  fallbackImage: string | null
  fallbackKind: string | null
  primaryImage: { src: string; loaded: boolean; outerHTML: string } | null
  cssBackground: { url: string; loaded: boolean } | null
  brokenImages: { src: string; outerHTML: string }[]
}

// Ordered most-specific → most-generic. First visible, top-of-page, tall
// enough candidate wins.
const REGION_SELECTORS = [
  ".wp-block-cover",
  ".hero, .page-hero, .site-hero, .hero-section, .hero-banner",
  '[class*="hero" i]',
  '[id*="hero" i]',
  ".wp-block-group.has-background",
  "main > section:first-of-type",
  "main > div:first-of-type",
  "main > *:first-child",
  "[role='main'] > *:first-child",
]

// Classic PHP themes (esp. Stitch-generated) rarely use the core Cover block.
// Their hero is typically a full-bleed <section> that isn't guaranteed to be
// the FIRST child of <main> (front-page.php often has a nested <main> and
// decorative layers first). This augmented list keeps every block selector but
// also accepts a leading <section> anywhere near the top. Block/unknown themes
// keep the original list unchanged.
const REGION_SELECTORS_CLASSIC = [
  ".wp-block-cover",
  ".hero, .page-hero, .site-hero, .hero-section, .hero-banner",
  '[class*="hero" i]',
  '[id*="hero" i]',
  "main > section:first-of-type",
  "section:first-of-type",
  "body > section:first-of-type",
  "main > div:first-of-type",
  "main > *:first-child",
  "[role='main'] > *:first-child",
]

function regionSelectorsFor(themeType?: ThemeType): string[] {
  return themeType === "classic" ? REGION_SELECTORS_CLASSIC : REGION_SELECTORS
}

export async function checkHeroMedia(
  page: PlaywrightPage,
  pageRecord: any,
  runId?: string,
  onProgress?: (progress: number, message: string) => Promise<void>,
  themeType?: ThemeType,
): Promise<Finding[]> {
  const sharp = require("sharp")
  const { uploadScreenshot } = require("../lib/supabaseStorage")
  const findings: Finding[] = []
  // Classic themes get a hero-region list that also accepts a leading <section>.
  const regionSelectors = regionSelectorsFor(themeType)

  try {
    if (onProgress)
      await onProgress(10, "Opened browser, checking for hero media...")

    // --- 1. PROBE THE HERO REGION AND ITS MEDIA -----------------------------
    const probe: HeroProbe = await page.evaluate(async (selectors) => {
      const MAX_TOP = 1200 // a hero starts near the top of the document
      const MIN_HEIGHT = 180

      const visible = (el: Element): boolean => {
        const cs = getComputedStyle(el)
        if (cs.display === "none" || cs.visibility === "hidden") return false
        if (parseFloat(cs.opacity || "1") === 0) return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }

      let region: Element | null = null
      let regionSelector = ""
      for (const sel of selectors) {
        let list: Element[] = []
        try {
          list = Array.from(document.querySelectorAll(sel))
        } catch {
          continue
        }
        for (const el of list) {
          if (!visible(el)) continue
          const r = el.getBoundingClientRect()
          if (r.top + window.scrollY > MAX_TOP) continue
          if (r.height < MIN_HEIGHT) continue
          region = el
          regionSelector = sel
          break
        }
        if (region) break
      }

      const scope: Element = region || document.body
      if (region) region.setAttribute("data-qacc-hero-region", "1")

      // Loads an image URL to find out whether it actually resolves.
      const imageResolves = (url: string): Promise<boolean> =>
        new Promise((resolve) => {
          if (!url || /^data:/.test(url)) return resolve(!!url)
          const im = new Image()
          const t = setTimeout(() => resolve(false), 8000)
          im.onload = () => {
            clearTimeout(t)
            resolve(im.naturalWidth > 0)
          }
          im.onerror = () => {
            clearTimeout(t)
            resolve(false)
          }
          im.src = url
        })

      const bgUrlOf = (el: Element): string | null => {
        const bg = getComputedStyle(el).backgroundImage || ""
        const m = bg.match(/url\((['"]?)([^'")]+)\1\)/)
        return m ? m[2] : null
      }

      // --- video -----------------------------------------------------------
      const coverVideo = scope.querySelector(
        "video.wp-block-cover__video-background",
      ) as HTMLVideoElement | null
      let video: HTMLVideoElement | null = coverVideo
      if (!video) {
        const vids = Array.from(
          scope.querySelectorAll("video"),
        ) as HTMLVideoElement[]
        // A hero/background video is decorative: autoplaying, muted, looping
        // and/or without controls. Prefer that over an embedded player.
        video =
          vids.find((v) => v.autoplay || v.muted || v.loop || !v.controls) ||
          vids[0] ||
          null
      }
      if (video) video.setAttribute("data-qacc-hero-video", "1")

      // --- background / primary image --------------------------------------
      const coverImage = scope.querySelector(
        "img.wp-block-cover__image-background",
      ) as HTMLImageElement | null

      let primaryImage: HTMLImageElement | null = coverImage
      if (!primaryImage) {
        const imgs = Array.from(
          scope.querySelectorAll("img"),
        ) as HTMLImageElement[]
        // Ignore logos/icons — a hero image is large.
        primaryImage =
          imgs.find((im) => {
            const r = im.getBoundingClientRect()
            return r.width >= 320 && r.height >= 180
          }) ||
          imgs[0] ||
          null
      }

      let cssBackground: { url: string; loaded: boolean } | null = null
      const bgCandidates: Element[] = region
        ? [region, ...Array.from(region.querySelectorAll("*")).slice(0, 60)]
        : []
      for (const el of bgCandidates) {
        const u = bgUrlOf(el)
        if (u) {
          cssBackground = { url: u, loaded: await imageResolves(u) }
          break
        }
      }

      // --- fallback image behind the video ----------------------------------
      let fallbackImage: string | null = null
      let fallbackKind: string | null = null
      if (video) {
        const poster = video.getAttribute("poster")
        if (poster) {
          fallbackImage = poster
          fallbackKind = "video poster attribute"
        } else if (coverImage && coverImage.currentSrc) {
          fallbackImage = coverImage.currentSrc
          fallbackKind = "Cover block background image"
        } else if (cssBackground) {
          fallbackImage = cssBackground.url
          fallbackKind = "CSS background-image on the hero container"
        } else if (primaryImage && primaryImage !== coverImage) {
          const r = primaryImage.getBoundingClientRect()
          const cs = getComputedStyle(primaryImage)
          if (
            r.width >= 320 &&
            (cs.position === "absolute" || cs.objectFit === "cover")
          ) {
            fallbackImage = primaryImage.currentSrc || primaryImage.src
            fallbackKind = "absolutely positioned hero image"
          }
        }
      }

      // --- broken images inside the hero region -----------------------------
      const brokenImages = (
        Array.from(scope.querySelectorAll("img")) as HTMLImageElement[]
      )
        .filter((im) => im.complete && im.naturalWidth === 0)
        .slice(0, 10)
        .map((im) => ({
          src: im.currentSrc || im.src,
          outerHTML: im.outerHTML.substring(0, 300),
        }))

      const media: HeroProbe["media"] = video
        ? "video"
        : primaryImage
          ? "image"
          : cssBackground
            ? "css-background"
            : "none"

      return {
        regionFound: !!region,
        regionSelector,
        regionTag: region ? region.tagName.toLowerCase() : "",
        media,
        isCoverBlock: !!coverVideo || !!coverImage,
        video: video
          ? {
              src:
                video.currentSrc ||
                video.getAttribute("src") ||
                video.querySelector("source")?.getAttribute("src") ||
                "",
              poster: video.getAttribute("poster"),
              autoplay: video.autoplay,
              muted: video.muted || video.hasAttribute("muted"),
              loop: video.loop,
              playsInline:
                video.hasAttribute("playsinline") ||
                video.hasAttribute("webkit-playsinline"),
              controls: video.controls,
              readyState: video.readyState,
              outerHTML: video.outerHTML.substring(0, 300),
            }
          : null,
        fallbackImage,
        fallbackKind,
        primaryImage: primaryImage
          ? {
              src: primaryImage.currentSrc || primaryImage.src,
              loaded: primaryImage.complete && primaryImage.naturalWidth > 0,
              outerHTML: primaryImage.outerHTML.substring(0, 300),
            }
          : null,
        cssBackground,
        brokenImages,
      }
    }, regionSelectors)

    // --- 2. EVIDENCE SCREENSHOT OF THE RESOLVED REGION ----------------------
    if (runId) {
      try {
        const regionLoc = page.locator('[data-qacc-hero-region="1"]').first()
        const target = (await regionLoc.count()) > 0 ? regionLoc : page
        const buf = await target.screenshot().catch(() => null)
        if (buf) {
          const jpg = await sharp(buf).jpeg({ quality: 85 }).toBuffer()
          const url = await uploadScreenshot(
            jpg,
            `${runId}/hero_media_${Date.now()}.jpg`,
            { bucket: "evidence", isPublic: true },
          ).catch(() => "")
          if (url) pageRecord.desktopUrl = url
        }
      } catch {}
    }

    const screenshotUrl =
      pageRecord?.desktopUrl || pageRecord?.screenshot_url_desktop || null
    const regionLabel = probe.regionFound
      ? `<${probe.regionTag}> matched by \`${probe.regionSelector}\`${probe.isCoverBlock ? " (core Cover block)" : ""}`
      : "not identified"

    // --- 3. VIDEO HERO -----------------------------------------------------
    if (probe.media === "video" && probe.video) {
      if (onProgress)
        await onProgress(
          35,
          `Hero video found${probe.fallbackImage ? " with fallback image" : " (no fallback image)"}, measuring load time...`,
        )

      const v = probe.video

      // Autoplay contract: a background video without muted + playsinline will
      // not start on mobile Safari/Chrome regardless of how fast it loads.
      const autoplayGaps: string[] = []
      if (!v.controls) {
        if (!v.autoplay) autoplayGaps.push("<code>autoplay</code>")
        if (!v.muted) autoplayGaps.push("<code>muted</code>")
        if (!v.playsInline) autoplayGaps.push("<code>playsinline</code>")
      }
      if (autoplayGaps.length > 0) {
        findings.push({
          check_factor: "hero_media",
          title: "Hero video will not autoplay on mobile",
          description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Missing attributes</strong>: ${autoplayGaps.join(", ")}\n\nThe hero background video is missing attributes that mobile browsers require before they will start playback without a tap. iOS Safari and Android Chrome need <code>muted</code> and <code>playsinline</code> together with <code>autoplay</code>; without them mobile visitors see a static first frame or an empty hero.`,
          context_text: `Video: ${v.outerHTML}\nautoplay=${v.autoplay} muted=${v.muted} loop=${v.loop} playsinline=${v.playsInline}`,
          screenshot_url: screenshotUrl,
          status: "open",
          ai_generated: false,
        })
      }

      // An unmuted autoplay video is blocked by browser policy, not by a slow
      // stream. Measuring a 14s "stall" there would blame the wrong thing (and
      // waste 14s), so attribute the failure to the policy instead.
      const autoplayBlocked = !v.controls && v.autoplay && !v.muted
      if (autoplayBlocked) {
        if (onProgress)
          await onProgress(
            80,
            "Autoplay blocked by browser policy (video is not muted); skipping load timing",
          )
        if (!probe.fallbackImage) {
          findings.push({
            check_factor: "hero_media",
            title: "Hero video cannot autoplay and has no fallback image",
            description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Hero video</strong>: Found, blocked from autoplaying\n- <strong>Fallback image</strong>: Absent\n\nBrowsers refuse to autoplay a video with sound, so this hero never starts on its own — and there is no <code>poster</code> or background image behind it, leaving the hero blank. Add <code>muted</code> (with <code>playsinline</code>) and a poster image.`,
            context_text: `Video source: ${v.src || "unresolved"}\nautoplay=${v.autoplay} muted=${v.muted} playsinline=${v.playsInline}\nFallback: none`,
            screenshot_url: screenshotUrl,
            status: "open",
            ai_generated: false,
          })
        }
      } else {
        // Measure time-to-first-frame on the tagged element.
        let loadDurationInSeconds: number | null = null
        let timedOut = false
        try {
          loadDurationInSeconds = await page.evaluate(async () => {
            const video = document.querySelector(
              'video[data-qacc-hero-video="1"]',
            ) as HTMLVideoElement | null
            if (!video) return null

            const elapsed = () => {
              const navStart = performance.timing
                ? performance.timing.navigationStart
                : performance.timeOrigin
              return (Date.now() - navStart) / 1000
            }

            if (
              video.currentTime > 0 &&
              !video.paused &&
              !video.ended &&
              video.readyState >= 3
            ) {
              return elapsed()
            }

            return new Promise<number>((resolve) => {
              const onPlaying = () => resolve(elapsed())
              video.addEventListener("playing", onPlaying, { once: true })
              setTimeout(() => {
                video.removeEventListener("playing", onPlaying)
                resolve(-1)
              }, 14000)
            })
          })
        } catch {
          timedOut = true
        }

        const isVideoLoaded =
          loadDurationInSeconds !== null &&
          loadDurationInSeconds > 0 &&
          !timedOut

        if (!isVideoLoaded) {
          if (probe.fallbackImage) {
            findings.push({
              check_factor: "hero_media",
              title:
                "Hero video did not start playing (fallback image displayed)",
              description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Hero video</strong>: Found, never reached first frame\n- <strong>Fallback image</strong>: Present via ${probe.fallbackKind} (${probe.fallbackImage})\n\nThe hero video element exists but did not reach its first frame inside the 14 second benchmark. A fallback image is configured and is covering the gap, so visitors do not see blank space — but the video stream itself is stalling or blocked and should be inspected.`,
              context_text: `Video source: ${v.src || "unresolved"}\nFallback image: ${probe.fallbackImage}\nMeasured: ${loadDurationInSeconds === -1 ? "no first frame within 14s" : "unavailable"}`,
              screenshot_url: screenshotUrl,
              status: "open",
              ai_generated: false,
            })
          } else {
            findings.push({
              check_factor: "hero_media",
              title:
                "Hero video did not start playing and has no fallback image",
              description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Hero video</strong>: Found, never reached first frame\n- <strong>Fallback image</strong>: Absent\n\nThe hero video did not reach its first frame inside the 14 second benchmark and no poster or background image is configured behind it. Visitors land on a blank hero area. Add a <code>poster</code> attribute (or a Cover block background image) and inspect why the stream stalls.`,
              context_text: `Video source: ${v.src || "unresolved"}\nFallback image: none\nMeasured: ${loadDurationInSeconds === -1 ? "no first frame within 14s" : "unavailable"}`,
              screenshot_url: screenshotUrl,
              status: "open",
              ai_generated: false,
            })
          }
        } else if (loadDurationInSeconds && loadDurationInSeconds > 3.0) {
          findings.push({
            check_factor: "hero_media",
            title: "Hero video experienced a loading delay",
            description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Hero video</strong>: Found (first frame at ${loadDurationInSeconds.toFixed(2)}s)\n- <strong>Fallback image</strong>: ${probe.fallbackImage ? `Present via ${probe.fallbackKind}` : "Absent"}\n\nThe hero video played, but took ${loadDurationInSeconds.toFixed(2)} seconds to show its first frame against a 3.0 second benchmark. ${probe.fallbackImage ? "A fallback image covers the delay." : "No fallback image is configured, so visitors see an empty hero while waiting."}`,
            context_text: `Load time: ${loadDurationInSeconds.toFixed(2)}s\nBenchmark: 3.0s\nFallback: ${probe.fallbackImage || "none"}`,
            screenshot_url: screenshotUrl,
            status: "open",
            ai_generated: false,
          })
        } else if (!probe.fallbackImage) {
          findings.push({
            check_factor: "hero_media",
            title: "Hero video missing fallback poster image",
            description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Hero video</strong>: Found (first frame at ${loadDurationInSeconds ? loadDurationInSeconds.toFixed(2) : "0"}s)\n- <strong>Fallback image</strong>: Absent\n\nThe hero video loaded quickly on this run, but the element has no <code>poster</code> attribute and there is no Cover block background image or CSS background behind it. On a slower connection the hero renders as blank space until the stream starts.`,
            context_text: `Video source: ${v.src || "unresolved"}\nLoad time: ${loadDurationInSeconds ? loadDurationInSeconds.toFixed(2) : "n/a"}s\nFallback: none`,
            screenshot_url: screenshotUrl,
            status: "open",
            ai_generated: false,
          })
        }
      } // end of the measured-playback branch
    }

    // --- 4. IMAGE / CSS-BACKGROUND HERO ------------------------------------
    if (onProgress)
      await onProgress(70, "Checking hero images and background media...")

    if (probe.media === "image" && probe.primaryImage) {
      if (!probe.primaryImage.loaded) {
        findings.push({
          check_factor: "hero_media",
          title: "Hero image failed to load",
          description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Hero image</strong>: Present in the markup but did not decode\n\nThe main hero image is referenced by the page but the browser could not load it, leaving the hero area blank or collapsed. Verify the attachment exists and the URL resolves on the beta host.`,
          context_text: `Source: ${probe.primaryImage.src}\nElement: ${probe.primaryImage.outerHTML}`,
          screenshot_url: screenshotUrl,
          status: "open",
          ai_generated: false,
        })
      }
    }

    if (probe.cssBackground && !probe.cssBackground.loaded) {
      findings.push({
        check_factor: "hero_media",
        title: "Hero background image failed to load",
        description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>CSS background-image</strong>: ${probe.cssBackground.url}\n\nThe hero container declares a CSS <code>background-image</code> that does not resolve, so the hero renders with its bare background colour. This is usually a stale upload path carried over from another environment.`,
        context_text: `Background URL: ${probe.cssBackground.url}`,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      })
    }

    for (const img of probe.brokenImages) {
      if (probe.primaryImage && img.src === probe.primaryImage.src) continue
      findings.push({
        check_factor: "hero_media",
        title: "Broken image in the hero section",
        description: `An image inside the hero region is referenced by the page but failed to load, leaving a broken placeholder in the first thing visitors see.`,
        context_text: `Source: ${img.src}\nElement: ${img.outerHTML}`,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      })
    }

    // --- 5. NOTHING FOUND IS A REAL SIGNAL, NOT A PASS ---------------------
    if (onProgress)
      await onProgress(90, "Hero media check complete, finalizing findings...")

    if (probe.media === "none") {
      findings.push({
        check_factor: "hero_media",
        title: "No hero media found on the homepage",
        description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Hero media</strong>: none\n\nNo hero video, hero image or CSS background image was found at the top of the homepage. Detection covers the core Cover block (<code>video.wp-block-cover__video-background</code>, <code>img.wp-block-cover__image-background</code>), any <code>&lt;video&gt;</code> or large <code>&lt;img&gt;</code> in the hero region, and CSS <code>background-image</code>. Confirm the hero is intentionally text-only — otherwise the hero media is missing from this build.`,
        context_text: `Region found: ${probe.regionFound ? `yes (${probe.regionSelector})` : "no"}\nCover block markup: ${probe.isCoverBlock ? "yes" : "no"}\nMedia detected: none`,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      })
    } else if (findings.length === 0) {
      const what =
        probe.media === "video"
          ? "Hero video loaded and played within benchmark"
          : probe.media === "image"
            ? "Hero image loaded successfully"
            : "Hero background image loaded successfully"
      findings.push({
        check_factor: "hero_media",
        title: what,
        description: `- <strong>Hero region</strong>: ${regionLabel}\n- <strong>Hero media</strong>: ${probe.media}\n- <strong>Fallback image</strong>: ${probe.fallbackImage ? `Present via ${probe.fallbackKind}` : probe.media === "video" ? "Absent" : "n/a"}\n\n${what}. No hero media issues detected on this page.`,
        context_text: `Media: ${probe.media}\nRegion: ${probe.regionSelector || "n/a"}\nFallback: ${probe.fallbackImage || "n/a"}`,
        screenshot_url: screenshotUrl,
        status: "open",
        ai_generated: false,
      })
    }

    return findings
  } catch (error: any) {
    // Graceful abort on unexpected crashes
    return [
      {
        check_factor: "hero_media",
        title: "Hero Media Check Failed",
        description: `The check encountered an unexpected error: ${error.message}. Process aborted gracefully to prevent stalling the scan.`,
        context_text: "System Error",
        screenshot_url:
          pageRecord?.desktopUrl || pageRecord?.screenshot_url_desktop || null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]
  }
}
