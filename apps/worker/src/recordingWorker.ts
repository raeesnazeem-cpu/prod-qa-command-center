import { chromium } from "playwright"
import { supabase } from "./lib/supabase"
import fs from "fs"
import path from "path"
import "dotenv/config"
import { Storage } from "@google-cloud/storage"

async function autoScroll(page: any) {
  await page.evaluate(async () => {
    while (true) {
      const currentHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      )
      window.scrollBy(0, 100)

      if (window.scrollY + window.innerHeight >= currentHeight) {
        await new Promise((r) => setTimeout(r, 1000))
        const newHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
        )
        if (newHeight === currentHeight) {
          break
        }
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  })
}

async function run() {
  const viewportType = process.env.VIEWPORT_TYPE || "desktop"
  const runId = process.env.RUN_ID

  if (!runId) {
    console.error("Missing required environment variables: RUN_ID")
    process.exit(1)
  }

  console.log(
    `Starting full project recording for RUN: ${runId} [${viewportType}]`,
  )

  const viewports: Record<string, { width: number; height: number }> = {
    desktop: { width: 1920, height: 1080 },
    tablet: { width: 1024, height: 1366 },
    mobile: { width: 440, height: 956 },
  }

  const viewport = viewports[viewportType] || viewports.desktop
  const videoDir = "/tmp/videos"

  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true })
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport,
    recordVideo: {
      dir: videoDir,
      size: viewport,
    },
  })

  const page = await context.newPage()

  try {
    // 1. Fetch all scanned pages/URLs for this runId directly
    const { data: pages, error: fetchError } = await supabase
      .from("pages")
      .select("url")
      .eq("run_id", runId)

    if (fetchError) throw fetchError

    // 1.5 Dynamically extract all internal links from the root page
    const { data: runData } = await supabase
      .from("qa_runs")
      .select("site_url")
      .eq("id", runId)
      .single()
    const baseUrl = runData?.site_url || pages?.[0]?.url
    let extractedUrls: string[] = []

    if (baseUrl) {
      console.log(`Extracting internal links from ${baseUrl}...`)
      try {
        await page.goto(baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        })
        const hrefs = await page.evaluate(() => {
          return Array.from(document.querySelectorAll("a[href]")).map(
            (a) => (a as HTMLAnchorElement).href,
          )
        })
        const baseDomain = new URL(baseUrl).hostname

        extractedUrls = hrefs
          .map((href) => {
            try {
              const urlObj = new URL(href)
              // Keep internal links only, ignore external/mailto/tel
              if (
                urlObj.hostname === baseDomain &&
                urlObj.protocol.startsWith("http")
              ) {
                urlObj.hash = "" // Strip hash to prevent duplicate page visits
                return urlObj.href
              }
            } catch {}
            return null
          })
          .filter(Boolean) as string[]
      } catch (err) {
        console.error("Failed to extract links:", err)
      }
    }

    // Filter out duplicate URLs and non-webpages (like .kml, .xml, .pdf) so we don't record them
    const uniqueUrls = [
      ...new Set([
        ...(pages?.map((p) => p.url).filter(Boolean) || []),
        ...extractedUrls,
      ]),
    ].filter((url: any) => {
      try {
        const pathname = new URL(url).pathname.toLowerCase()
        return !pathname.match(
          /\.(kml|xml|pdf|jpg|jpeg|png|gif|svg|zip|csv|mp4|webm|doc|docx|xls|xlsx|txt)$/i,
        )
      } catch {
        return false
      }
    })

    // Categorize and sort URLs
    const categorizedUrls = {
      home: [] as string[],
      about: [] as string[],
      services: [] as string[],
      contact: [] as string[],
      blogs: [] as string[],
      others: [] as string[],
    }
    uniqueUrls.forEach((url: any) => {
      try {
        const path = new URL(url).pathname.toLowerCase()
        if (path === "/" || path === "") categorizedUrls.home.push(url)
        else if (path.includes("about")) categorizedUrls.about.push(url)
        else if (path.includes("service")) categorizedUrls.services.push(url)
        else if (path.includes("contact")) categorizedUrls.contact.push(url)
        else if (
          path.includes("blog") ||
          path.includes("post") ||
          path.includes("news")
        )
          categorizedUrls.blogs.push(url)
        else categorizedUrls.others.push(url)
      } catch {
        categorizedUrls.others.push(url)
      }
    })

    const sortedUrls = [
      ...categorizedUrls.home,
      ...categorizedUrls.about,
      ...categorizedUrls.services,
      ...categorizedUrls.contact,
      ...categorizedUrls.blogs,
      ...categorizedUrls.others,
    ]

    // 2. Loop through all URLs and record in the SAME browser context (One long video!)
    let urlIndex = 0
    for (const url of sortedUrls) {
      console.log(`Navigating to ${url}...`)

      try {
        await page.goto(url as string, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        })

        await page.evaluate((currentUrl) => {
          const bar = document.createElement("div")
          bar.style.position = "fixed"
          bar.style.top = "12px"
          bar.style.left = "50%"
          bar.style.transform = "translateX(-50%)"
          bar.style.backgroundColor = "rgba(255, 255, 255, 0.85)"
          bar.style.backdropFilter = "blur(4px)"
          bar.style.border = "1px solid rgba(0, 0, 0, 0.1)"
          bar.style.borderRadius = "20px"
          bar.style.zIndex = "2147483647"
          bar.style.padding = "8px 16px"
          bar.style.fontFamily = "monospace"
          bar.style.fontSize = "13px"
          bar.style.color = "#111"
          bar.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"
          bar.style.pointerEvents = "none"
          bar.innerHTML = `<span style="color: #27ae60;">🔒</span> ${currentUrl}`
          document.body.appendChild(bar)
        }, url as string)

        // Force lazy-loaded iframes to load before scrolling begins
        await page.evaluate(() => {
          document.querySelectorAll("iframe").forEach((iframe) => {
            const lazySrc =
              iframe.getAttribute("data-src") ||
              iframe.getAttribute("data-lazy-src")
            if (lazySrc && !iframe.getAttribute("src")) {
              iframe.setAttribute("src", lazySrc)
            }
          })
        })

        // Perform auto-scroll to trigger lazy loading

        await page.waitForTimeout(1000)
        await autoScroll(page)

        // Wait a bit at the bottom before jumping to the next page
        await page.waitForTimeout(3000)
      } catch (navError) {
        console.error(`Skipping ${url} due to error:`, navError)
        // We continue to the next URL instead of crashing the whole run
      }

      // --- NEW: Calculate and update progress in the database ---
      urlIndex++
      const progressPercentage = Math.round(
        (urlIndex / uniqueUrls.length) * 100,
      )

      // Update our specific viewport's percentage securely via RPC
      const { error: progressError } = await supabase.rpc(
        "merge_qa_run_recording_progress",
        {
          p_run_id: runId,
          p_viewport: viewportType,
          p_progress: progressPercentage,
        },
      )
      if (progressError) console.error("Progress RPC Error:", progressError)
    }
    // 3. Close context to finalize and flush the ONE long video
    await context.close()
    await browser.close()

    // 4. Find the video file locally in /tmp
    const videoFile = await page.video()?.path()
    if (!videoFile) {
      throw new Error("Video file not found")
    }

    const fileName = `${runId}/full_project_${viewportType}.webm`

    // 5. Upload video to Google Cloud Storage (GCS)
    console.log(`Uploading full project video to GCS: ${fileName}`)
    const storage = new Storage()
    const bucketName = process.env.GCS_BUCKET_NAME || "my-agency-qa-videos" // Set this ENV in Cloud Run UI!
    const bucket = storage.bucket(bucketName)

    await bucket.upload(videoFile, {
      destination: fileName,
      contentType: "video/webm",
    })

    // Make it publicly accessible
    await bucket.file(fileName).makePublic()
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`
    console.log(`Video uploaded successfully to GCS: ${publicUrl}`)

    // 6. Update the RUN directly with the new video URL securely via RPC
    const { error: urlError } = await supabase.rpc(
      "merge_qa_run_recording_url",
      {
        p_run_id: runId,
        p_viewport: viewportType,
        p_url: publicUrl,
      },
    )
    if (urlError) console.error("URL RPC Error:", urlError)

    // Clean up local video file from memory
    fs.unlinkSync(videoFile)
  } catch (error) {
    console.error("Error during recording process:", error)
    const { data: runData } = await supabase
      .from("qa_runs")
      .select("recording_progress")
      .eq("id", runId)
      .single()
    await supabase
      .from("qa_runs")
      .update({
        recording_status: "error",
        recording_progress: {
          ...(runData?.recording_progress || {}),
          [viewportType]: -1,
        },
      })
      .eq("id", runId)
    await browser.close()
    process.exit(0)
  }
}

run()
