import { chromium } from "playwright"
import { Finding } from "@qacc/shared"
import sharp from "sharp"
import { uploadScreenshot } from "../lib/supabaseStorage"
import pino from "pino"
import axios from "axios"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function checkProjectPlan(
  projectSettings: {
    basecamp_token: string
    basecamp_account_id: string | number
    basecamp_project_id: string | number
  },
  pageRecord?: any,
  onProgress?: (progress: number, message: string) => Promise<void>,
): Promise<Finding[]> {
  const { basecamp_token, basecamp_account_id, basecamp_project_id } =
    projectSettings

  if (!basecamp_token || !basecamp_account_id || !basecamp_project_id) {
    logger.warn(
      "Basecamp integration settings are missing credentials for project plan check.",
    )
    return []
  }

  logger.info(
    { basecamp_account_id, basecamp_project_id },
    "Starting Basecamp project plan check",
  )

  const userAgent = process.env.BASECAMP_USER_AGENT || "QACC (dev@growth99.com)"
  
  const headers = {
    Authorization: `Bearer ${basecamp_token}`,
    "User-Agent": userAgent,
    "Content-Type": "application/json",
    Accept: "application/json",
  }

  try {
    axios.defaults.timeout = 15000
    if (onProgress) await onProgress(20, "Fetching Basecamp bucket details...")
    // 1. Fetch project bucket details
    const bucketUrl = `https://3.basecampapi.com/${basecamp_account_id}/buckets/${basecamp_project_id}.json`
    logger.info({ bucketUrl }, "Fetching Basecamp bucket via API")

    const bucketResponse = await axios.get(bucketUrl, { headers })
    const bucketData = bucketResponse.data

    if (onProgress) await onProgress(40, "Locating Message Board tool...")

    // 2. Find Message Board tool
    const messageBoardTool = bucketData.dock?.find(
      (tool: any) =>
        tool.title === "Message Board" ||
        tool.url?.includes("/message_boards/"),
    )

    if (!messageBoardTool) {
      throw new Error(
        `Message Board tool not found in project dock for bucket: ${bucketData.name || basecamp_project_id}`,
      )
    }

    if (onProgress)
      await onProgress(60, "Fetching messages from Message Board...")

    // 3. Fetch messages from Message Board with pagination
    let messages: any[] = []
    let nextUrl: string | null = messageBoardTool.url.replace(".json", "/messages.json")
    let orderDetailsMsg: any = null
    let pagesFetched = 0

    while (nextUrl && !orderDetailsMsg && pagesFetched < 10) {
      logger.info({ nextUrl, page: pagesFetched + 1 }, "Fetching messages from Message Board via API")
      const messagesResponse = await axios.get(nextUrl, { headers })
      const currentMessages = messagesResponse.data || []
      messages = messages.concat(currentMessages)
      pagesFetched++

      orderDetailsMsg = messages.find((msg: any) =>
        (msg.subject || msg.title || "")
          .toLowerCase()
          .includes("order details"),
      )

      if (orderDetailsMsg) {
        break
      }

      // Basecamp uses Link header for pagination
      const linkHeader = messagesResponse.headers.link
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
        nextUrl = match ? match[1] : null
      } else {
        nextUrl = null
      }
    }

    let contentHtml = ""
    let planValue = ""
    let screenshotUrl = null

    if (orderDetailsMsg) {
      logger.info(
        { messageId: orderDetailsMsg.id },
        "Found Project Order Details message",
      )

      // Fetch the detailed message content
      const msgUrl = `https://3.basecampapi.com/${basecamp_account_id}/buckets/${basecamp_project_id}/messages/${orderDetailsMsg.id}.json`
      const msgResponse = await axios.get(msgUrl, { headers })
      contentHtml = msgResponse.data.content || ""

      // Fetch all comments (replies) on this Message Board post
      const commentsUrl = `https://3.basecampapi.com/${basecamp_account_id}/buckets/${basecamp_project_id}/recordings/${orderDetailsMsg.id}/comments.json`
      const commentsResponse = await axios.get(commentsUrl, { headers })
      const comments = commentsResponse.data || []

      // Extract plan value using regex and fallbacks from main message body
      const cleanText = contentHtml.replace(/<[^>]*>/g, " ")
      let match = cleanText.match(/Growth99\s+Plan:\s*([^\n\r<]+)/i)
      if (match && match[1]) {
        planValue = match[1].trim()
      } else {
        const idx = cleanText.toLowerCase().indexOf("growth99 plan:")
        if (idx !== -1) {
          const sub = cleanText.substring(idx + "growth99 plan:".length).trim()
          planValue = sub.split(/\r?\n/)[0].trim()
        }
      }

      // If not in main message, check the comments/replies thread
      if (!planValue) {
        for (const comment of comments) {
          const commentHtml = comment.content || ""
          const cleanCommentText = commentHtml.replace(/<[^>]*>/g, " ")
          match = cleanCommentText.match(/Growth99\s+Plan:\s*([^\n\r<]+)/i)
          if (match && match[1]) {
            planValue = match[1].trim()
            contentHtml = commentHtml // Set HTML to show only this reply card!
            break
          } else {
            const idx2 = cleanCommentText
              .toLowerCase()
              .indexOf("growth99 plan:")
            if (idx2 !== -1) {
              const sub2 = cleanCommentText
                .substring(idx2 + "growth99 plan:".length)
                .trim()
              planValue = sub2.split(/\r?\n/)[0].trim()
              contentHtml = commentHtml // Set HTML to show only this reply card!
              break
            }
          }
        }
      }

      logger.info(
        { planValue, hasCommentHtml: !!contentHtml },
        "Extracted plan details from Message post comments",
      )
    }

    // 5. Render HTML in local Playwright page and take a screenshot
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    })

    try {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
        },
        bypassCSP: true,
      })

      // Add stealth script to bypass basic bot detection
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        })
      })

      const page = await context.newPage()

      page.setDefaultTimeout(15000)
      page.setDefaultNavigationTimeout(15000)
      if (onProgress) await onProgress(80, "Capturing visual evidence...")

      const availableSubjects = messages.map((m: any) => m.subject || m.title || "Untitled").slice(0, 10).join(", ")
      const styledHtml = `
        <html>
          <head>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background-color: #f4f5f7;
                margin: 0;
                padding: 40px;
                color: #2e3033;
              }
              .container {
                background: white;
                border-radius: 8px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                overflow: hidden;
                max-width: 800px;
                margin: 0 auto;
              }
              .header {
                background: #f8f9fa;
                padding: 24px 32px;
                border-bottom: 1px solid #e1e3e8;
              }
              .title {
                margin: 0 0 8px 0;
                font-size: 24px;
                color: #2e3033;
              }
              .meta {
                font-size: 14px;
                color: #747679;
              }
              .content {
                padding: 32px;
                font-size: 16px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 class="title">${orderDetailsMsg ? orderDetailsMsg.subject || orderDetailsMsg.title || "Order Details" : "Message Board Info"}</h1>
                <div class="meta">Basecamp Integration • QA Command Center</div>
              </div>
              <div class="content">
                ${contentHtml || `<em>No message containing "order details" found. Evaluated ${messages.length} messages. Subjects found: ${availableSubjects || "None"}</em>`}
              </div>
            </div>
          </body>
        </html>
      `

      await page.setContent(styledHtml)
      await page.waitForLoadState("networkidle")

      let screenshotBuffer: Buffer

      // 1st screenshot: Target specifically the section where "Growth99 Plan:" is mentioned
      const planLocator = page.locator("text=/growth99\\s*plan/i")
      if ((await planLocator.count()) > 0) {
        // Grab closest parent paragraph/div/list block to give beautiful, focused context!
        const contextLocator = planLocator
          .locator(
            "xpath=./ancestor::p | ./ancestor::div | ./ancestor::li | ./ancestor::tr",
          )
          .first()
        if ((await contextLocator.count()) > 0) {
          logger.info("Taking crop screenshot of plan details block")
          await contextLocator.evaluate((el) => (el.style.padding = "10px"))
          screenshotBuffer = await contextLocator.screenshot()
        } else {
          logger.info("Taking direct text screenshot of plan details")
          screenshotBuffer = await planLocator.screenshot()
        }
      } else {
        logger.info(
          "Plan text locator not found; falling back to message card crop",
        )
        const container = page.locator(".container")
        if ((await container.count()) > 0) {
          screenshotBuffer = await container.screenshot()
        } else {
          screenshotBuffer = await page.screenshot()
        }
      }

      const compressedBuffer = await sharp(screenshotBuffer)
        .jpeg({ quality: 85 })
        .toBuffer()

      const timestamp = Date.now()
      const storagePath = `evidence/project-plan/${pageRecord?.id || "run"}-${timestamp}.jpg`
      const firstScreenshotUrl = await uploadScreenshot(
        compressedBuffer,
        storagePath,
        {
          bucket: "evidence",
          isPublic: true,
        },
      ).catch((err) => {
        logger.error(
          { error: err.message },
          "Failed to upload project plan screenshot to Supabase",
        )
        return ""
      })

      screenshotUrl = firstScreenshotUrl

      // 2nd screenshot: Navigate to site_url/reviews and take viewport screenshot
      if (pageRecord?.siteUrl && firstScreenshotUrl) {
        let reviewsUrl = pageRecord.siteUrl
        if (reviewsUrl.endsWith("/")) {
          reviewsUrl = `${reviewsUrl}reviews`
        } else {
          reviewsUrl = `${reviewsUrl}/reviews`
        }

        logger.info(
          { reviewsUrl },
          "Navigating to reviews page for 2nd screenshot",
        )
        const reviewsPage = await context.newPage()
        await reviewsPage.setViewportSize({ width: 1920, height: 1080 })

        try {
          await reviewsPage.goto(reviewsUrl, {
            waitUntil: "networkidle",
            timeout: 25000,
          })
        } catch (e: any) {
          logger.warn(
            { error: e.message },
            "Failed to load reviews page with networkidle, trying domcontentloaded",
          )
          try {
            await reviewsPage.goto(reviewsUrl, {
              waitUntil: "domcontentloaded",
              timeout: 15000,
            })
          } catch (e2) {
            logger.error("Failed to load reviews page completely")
          }
        }

        logger.info("Waiting 5 seconds for reviews to fully load before screenshot")
        await reviewsPage.waitForTimeout(5000)

        const reviewsScreenshotBuffer = await reviewsPage
          .screenshot()
          .catch(() => null)
        if (reviewsScreenshotBuffer) {
          const reviewsCompressed = await sharp(reviewsScreenshotBuffer)
            .jpeg({ quality: 85 })
            .toBuffer()

          const reviewsStoragePath = `evidence/project-plan/${pageRecord?.id || "run"}-reviews-${timestamp}.jpg`
          const reviewsScreenshotUrl = await uploadScreenshot(
            reviewsCompressed,
            reviewsStoragePath,
            {
              bucket: "evidence",
              isPublic: true,
            },
          ).catch((err) => {
            logger.error(
              { error: err.message },
              "Failed to upload reviews page screenshot to Supabase",
            )
            return ""
          })

          if (reviewsScreenshotUrl) {
            // Concatenate both urls as comma-separated
            screenshotUrl = `${firstScreenshotUrl},${reviewsScreenshotUrl}`
            logger.info("Dual screenshots captured and stored successfully")
          }
        }
      }

      await browser.close()
    } catch (browserErr: any) {
      logger.error(
        { error: browserErr.message },
        "Failed to capture screenshot via Playwright",
      )
      await browser.close()
    }

    // 6. Return findings
    let title = "Project Plan Retrieved"
    let description = ""
    let severity: "low" | "medium" | "high" = "low"
    let status: "open" | "failed" = "open"

    if (!orderDetailsMsg) {
      status = "failed"
      title = 'Project Plan - "Order Details" message not found'
      description = `We connected to your Basecamp project "${bucketData.name || basecamp_project_id}", but could not find any message containing "order details" in the Message Board. Evaluated ${messages.length} messages. Subjects found: ${availableSubjects || "None"}`
    } else if (!planValue) {
      status = "failed"
      title = "Project Plan - Content extraction failed"
      description = `Successfully fetched "${orderDetailsMsg.subject || orderDetailsMsg.title}" from Basecamp, but no "Growth99 Plan: <Plan>" section was found inside the message body.`
    } else {
      description = `Successfully fetched project plan from Basecamp: "${planValue}"`
    }

    const findings: Finding[] = [
      {
        check_factor: "project_plan",
        severity,
        title,
        description,
        context_text: planValue || "No plan details found.",
        screenshot_url: screenshotUrl || pageRecord?.desktopUrl || null,
        status: "open",
        ai_generated: false,
      } as Finding,
    ]

    return findings
  } catch (error: any) {
    logger.error(
      { error: error.message },
      "Error in Basecamp project plan check",
    )
    if (error) {
      return [
        {
          check_factor: "project_plan",
          severity: "high",
          title: "Project Plan Check Failed or Timed Out",
          description: `The check encountered a timeout or error: ${error.message}. Process aborted gracefully to prevent stalling.`,
          status: "open",
          ai_generated: false,
        } as Finding,
      ]
    }
    throw error
  }
}
