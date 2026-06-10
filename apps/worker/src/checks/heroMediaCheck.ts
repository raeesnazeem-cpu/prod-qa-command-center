import { Page as PlaywrightPage } from "playwright"
import { Finding } from "@qacc/shared"

export async function checkHeroMedia(
  page: PlaywrightPage,
  pageRecord: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const findings: Finding[] = []

  try {
    if (onProgress)
      await onProgress(10, "Opened browser, checking for hero media...")

    // --- 1. DETECT ELEMENTOR OR STANDARD HERO VIDEO ---

    // --- 1. DETECT ELEMENTOR OR STANDARD HERO VIDEO ---
    // Locate the FIRST Elementor video container on the page
    const firstVideoContainer = page
      .locator('.elementor-element[data-settings*="video"]')
      .first()
    const hasElementorVideo = (await firstVideoContainer.count()) > 0

    let fallbackImageLink: string | null = null
    let hasVideoElement = false
    let videoSelector = ""
    let isHeroVideo = false

    if (hasElementorVideo) {
      if (onProgress)
        await onProgress(30, "Hero media found, checking for fallback image...")
      isHeroVideo = true

      // CHECK FOR FALLBACK IMAGE SETUP AND EXTRACT ITS LINK
      // Elementor stores the fallback image metadata in the `data-settings` attribute
      const dataSettingsAttr =
        await firstVideoContainer.getAttribute("data-settings")
      if (dataSettingsAttr) {
        try {
          const settings = JSON.parse(dataSettingsAttr)
          if (
            settings.background_video_fallback &&
            settings.background_video_fallback.url
          ) {
            fallbackImageLink = settings.background_video_fallback.url
          }
        } catch (e) {
          // Fallback: Parse via regex if JSON parsing behaves strictly
          const match = dataSettingsAttr.match(
            /background_video_fallback&quot;:.*?&quot;url&quot;:&quot;([^&]+)/,
          )
          if (match) fallbackImageLink = match[1].replace(/\\/g, "")
        }
      }

      // If Elementor has already triggered the fallback layout, it applies it via inline style CSS
      if (!fallbackImageLink) {
        const styleAttr =
          (await firstVideoContainer.getAttribute("style")) || ""
        const cssMatch = styleAttr.match(
          /background-image:\s*url\(['"]?([^'")]+)['"]?\)/,
        )
        if (cssMatch) fallbackImageLink = cssMatch[1]
      }

      const videoElement = firstVideoContainer.locator(
        "video.elementor-background-video-hosted",
      )
      hasVideoElement = (await videoElement.count()) > 0
      videoSelector =
        '.elementor-element[data-settings*="video"] video.elementor-background-video-hosted'
    } else {
      // FALLBACK TO STANDARD VIDEO ELEMENT IN A HERO CONTAINER
      // Find all video elements on the page inside hero context
      const standardVideoDetails = await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll("video"))
        const heroElements = Array.from(
          document.querySelectorAll('[class*="hero" i], [id*="hero" i]'),
        )

        const match = videos.find(
          (v) =>
            heroElements.some((hero) => hero.contains(v)) ||
            v.outerHTML.toLowerCase().includes("hero"),
        )
        if (!match) return null

        return {
          outerHTML: match.outerHTML.substring(0, 300),
          poster: match.getAttribute("poster") || null,
          src: match.currentSrc || match.src || "",
        }
      })

      if (standardVideoDetails) {
        if (onProgress)
          await onProgress(
            30,
            "Hero media found, checking for fallback image...",
          )
        isHeroVideo = true
        hasVideoElement = true
        fallbackImageLink = standardVideoDetails.poster
        videoSelector = "video" // Simple selector if standard video
      }
    }

    // --- 2. AUDIT LOGIC IF HERO VIDEO DETECTED ---
    if (isHeroVideo) {
      const screenshotUrl =
        pageRecord?.desktopUrl || pageRecord?.screenshot_url_desktop || null

      if (!hasVideoElement) {
        // Container exists but video element is missing entirely
        findings.push({
          check_factor: "hero_media",
          severity: "high",
          title: "Hero section video element missing",
          description: `- <strong>Hero Video</strong>: Not Found\n- <strong>Fallback Image</strong>: ${fallbackImageLink ? `Present (${fallbackImageLink})` : "Absent"}\n\nAn Elementor background or hero video container was detected, but the actual video element (e.g., <video>) is missing from the DOM. A static fallback image was ${fallbackImageLink ? `found: ${fallbackImageLink}` : "NOT found, leaving a blank space"}.`,
          context_text: `Fallback Image: ${fallbackImageLink || "None"}\nElementor Container: ${hasElementorVideo ? "Yes" : "No"}`,
          screenshot_url: screenshotUrl,
          status: "open",
          ai_generated: false,
        })
      } else {
        if (onProgress)
          await onProgress(
            50,
            `Fallback image ${fallbackImageLink ? "found" : "not found"}, measuring load time...`,
          )
        // 3. MEASURE VIDEO LOAD TIME (PLAY TIME)

        let loadDurationInSeconds: number | null = null
        let timedOut = false

        try {
          // Evaluate inside the browser window to see when the 'playing' event triggers, or if it already did
          loadDurationInSeconds = await page.evaluate(async (selector) => {
            const video = document.querySelector(
              selector,
            ) as HTMLVideoElement | null
            if (!video) return null

            // If already playing, capture instant time
            if (
              video.currentTime > 0 &&
              !video.paused &&
              !video.ended &&
              video.readyState >= 3
            ) {
              const navStart = performance.timing
                ? performance.timing.navigationStart
                : performance.timeOrigin
              return (Date.now() - navStart) / 1000
            }

            // Otherwise, wait for the 'playing' event listener to trigger
            return new Promise<number>((resolve) => {
              const onPlaying = () => {
                const navStart = performance.timing
                  ? performance.timing.navigationStart
                  : performance.timeOrigin
                const loadTime = (Date.now() - navStart) / 1000
                resolve(loadTime)
              }

              video.addEventListener("playing", onPlaying, { once: true })

              // Timeout protection inside evaluation (14 seconds)
              setTimeout(() => {
                video.removeEventListener("playing", onPlaying)
                resolve(-1)
              }, 14000)
            })
          }, videoSelector)
        } catch (error) {
          timedOut = true
        }

        const isVideoLoaded =
          loadDurationInSeconds !== null &&
          loadDurationInSeconds > 0 &&
          !timedOut

        if (!isVideoLoaded) {
          // VIDEO FAILED TO LOAD / PLAY (STALLED OR TIMED OUT)
          if (fallbackImageLink) {
            findings.push({
              check_factor: "hero_media",
              severity: "medium",
              title: "Hero video failed to load (fallback image displayed)",
              description: `- <strong>Hero Video</strong>: Found (Failed to load)\n- <strong>Fallback Image</strong>: Present (${fallbackImageLink})\n\nThe hero video element failed to autoplay or load within the benchmark time limit (15 seconds). Fortunately, a fallback image was found and is displaying: ${fallbackImageLink}. Please inspect why the background video stream is stalling or blocked.`,
              context_text: `Fallback Image URL: ${fallbackImageLink}\nMeasured Load Duration: ${loadDurationInSeconds === -1 ? "Timeout (>14s)" : "N/A"}`,
              screenshot_url: screenshotUrl,
              status: "open",
              ai_generated: false,
            })
          } else {
            findings.push({
              check_factor: "hero_media",
              severity: "critical",
              title:
                "Hero video failed to load with no fallback image (blank space)",
              description: `- <strong>Hero Video</strong>: Found (Failed to load)\n- <strong>Fallback Image</strong>: Absent\n\nThe hero video failed to autoplay or load within the benchmark time limit (15 seconds), and NO fallback image was configured for this container. This creates a blank space or visual delay on the website immediately upon opening.`,
              context_text: `Status: Critical - No fallback image configured.\nMeasured Load Duration: ${loadDurationInSeconds === -1 ? "Timeout (>14s)" : "N/A"}`,
              screenshot_url: screenshotUrl,
              status: "open",
              ai_generated: false,
            })
          }
        } else if (loadDurationInSeconds && loadDurationInSeconds > 3.0) {
          // DELAY IN LOADING (Video loaded, but exceeds 3.0s delay threshold)
          findings.push({
            check_factor: "hero_media",
            severity: "medium",
            title: "Hero video experienced a loading delay",
            description: `- <strong>Hero Video</strong>: Found (Delayed Load: ${loadDurationInSeconds.toFixed(2)}s)\n- <strong>Fallback Image</strong>: ${fallbackImageLink ? `Present (${fallbackImageLink})` : "Absent"}\n\nThe hero video eventually loaded successfully, but experienced a significant delay of ${loadDurationInSeconds.toFixed(2)} seconds to start playing (first frame). The recommended benchmark is under 3.0 seconds. A fallback image is ${fallbackImageLink ? `configured (${fallbackImageLink}) to cover this delay.` : "NOT configured, meaning users see a blank/empty hero container while waiting."}`,
            context_text: `Load Time: ${loadDurationInSeconds.toFixed(2)}s\nBenchmark Limit: 3.0s\nFallback Setup: ${fallbackImageLink ? "Yes" : "No"}`,
            screenshot_url: screenshotUrl,
            status: "open",
            ai_generated: false,
          })
        } else if (!fallbackImageLink) {
          // VIDEO LOADED FAST, BUT MISSING FALLBACK IMAGE SETUP (Risk on slower connections)
          findings.push({
            check_factor: "hero_media",
            severity: "medium",
            title: "Hero video missing fallback poster image setup",
            description: `- <strong>Hero Video</strong>: Found (Loaded immediately: ${loadDurationInSeconds ? loadDurationInSeconds.toFixed(2) : "0"}s)\n- <strong>Fallback Image</strong>: Absent\n\nThe hero video loaded immediately within ${loadDurationInSeconds ? loadDurationInSeconds.toFixed(2) : "0"} seconds, but the container has no fallback poster image configured. A fallback image is critical to prevent blank spaces for users on slower connections before the video starts stream loading.`,
            context_text: `Load Time: ${loadDurationInSeconds ? loadDurationInSeconds.toFixed(2) : "N/A"}s\nFallback Setup: None`,
            screenshot_url: screenshotUrl,
            status: "open",
            ai_generated: false,
          })
        }
      }
    }

    // --- 3. CHECK OTHER HERO IMAGES AS FALLBACK/PRIMARY ---
    if (onProgress)
      await onProgress(70, "Checking standard hero images and fallbacks...")
    // (Retains original checks for general hero images loaded status)

    const heroImages = await page.evaluate(() => {
      const heroElements = Array.from(
        document.querySelectorAll('[class*="hero" i], [id*="hero" i]'),
      )
      return heroElements.flatMap((hero) => {
        return Array.from(hero.querySelectorAll("img")).map((img) => {
          return {
            outerHTML: img.outerHTML.substring(0, 300),
            src: img.src,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
          }
        })
      })
    })

    for (const img of heroImages) {
      if (!img.complete || img.naturalWidth === 0) {
        findings.push({
          check_factor: "hero_media",
          severity: "high",
          title: "Hero section image/fallback failed to load",
          description: `An image element in the hero section (which serves as a primary visual or fallback image) failed to load successfully or is completely broken.`,
          context_text: `Source: ${img.src}\nElement: ${img.outerHTML}`,
          screenshot_url:
            pageRecord?.desktopUrl ||
            pageRecord?.screenshot_url_desktop ||
            null,
          status: "open",
          ai_generated: false,
        })
      }
    }

    // --- 4. SUCCESS / INFORMATIONAL FINDING IF NO ISSUES FOUND ---
    if (onProgress)
      await onProgress(90, "Hero media check complete, finalizing findings...")
    if (findings.length === 0) {
      const screenshotUrl =
        pageRecord?.desktopUrl || pageRecord?.screenshot_url_desktop || null

      if (isHeroVideo) {
        findings.push({
          check_factor: "hero_media",
          severity: "low",
          title: "Hero media loaded successfully",
          description: `- <strong>Hero Video</strong>: Found (Loaded properly)\n- <strong>Fallback Image</strong>: Present (${fallbackImageLink})\n\nThe hero video was detected, loaded successfully within benchmark limits, and a fallback image is properly configured.`,
          context_text: `Fallback Image URL: ${fallbackImageLink}\nMeasured Load Duration: Fast\nFallback Setup: Yes`,
          screenshot_url: screenshotUrl,
          status: "open",
          ai_generated: false,
        })
      } else {
        findings.push({
          check_factor: "hero_media",
          severity: "low",
          title: "No hero video detected (Standard images loaded)",
          description: `No background hero video was detected on this page. All standard hero section images loaded successfully without issues.`,
          context_text: `Status: No Hero Video.\nFallback Setup: N/A`,
          screenshot_url: screenshotUrl,
          status: "open",
          ai_generated: false,
        })
      }
    }

    return findings
  } catch (error: any) {
    // Graceful abort on unexpected crashes
    return [
      {
        check_factor: "hero_media",
        severity: "high",
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
