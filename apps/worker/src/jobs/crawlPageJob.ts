import { Job } from "bullmq"
import { checkLearnMoreButtons } from "../checks/learnMoreButtonsCheck"
import { chromium } from "playwright"
import { supabase } from "../lib/supabase"
import { qaQueue } from "../lib/queue"
import { screenshotPage } from "../crawlers/pageScreenshotter"
import { checkBrokenLinks } from "../checks/brokenLinksCheck"
import { checkExternalLinks } from "../checks/externalLinkCheck"
import { checkMeta } from "../checks/metaCheck"
import { checkConsoleErrors } from "../checks/consoleErrorCheck"
import { checkDummyContent } from "../checks/dummyContentCheck"
import { checkSpelling } from "../checks/spellingCheck"
import { checkImageCompliance } from "../checks/imageComplianceCheck"
import { checkForms } from "../checks/formTestingCheck"
import { checkWooCommerce } from "../checks/wooCommerceCheck"
import { checkResponsiveVisual } from "../checks/responsiveVisualCheck"
import { checkHeroMedia } from "../checks/heroMediaCheck"
import { checkOptimizedLinks } from "../checks/optimizedLinksCheck"
import { wpPasswordCache } from "../lib/credentialsCache"
import {
  checkPrivacyPolicy,
  checkFooterLogo,
  checkSingleScript,
  checkTopBarAndStickyHeader,
  checkFavicon,
  checkUrlAndTabMatching,
  checkGrowth99ContactForm,
  checkChatbotAndConsultation,
  checkTextShareMetadata,
  checkCallnowLinks,
  checkUrlTabComparison,
  checkPluginUpdates,
  checkSocialShareHeading,
  checkLogoOnChatbot,
} from "../checks/preReleaseSuite"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function processCrawlPageJob(job: Job) {
  const { runId, pageId, url: pageUrl } = job.data
  const wpPassword = job.data.wpPassword || wpPasswordCache.get(runId)

  if (!runId || !pageId || !pageUrl) {
    throw new Error(
      "Missing required data for crawl_page job (runId, pageId, or url)",
    )
  }

  logger.info({ runId, pageId, pageUrl }, "Processing page crawl")

  // Fetch run settings for conditional checks
  const { data: run, error: runError } = await supabase
    .from("qa_runs")
    .select(
      "status, is_woocommerce, site_url, enabled_checks, project_id, live_site_url",
    )
    .eq("id", runId)
    .single()

  if (runError || !run) {
    logger.error(
      { runId, error: runError?.message },
      "Failed to fetch run status for crawl_page job",
    )
    throw new Error(`Failed to fetch run status: ${runError?.message}`)
  }

  // Check if run is paused or cancelled
  if (run.status === "paused" || run.status === "cancelled") {
    logger.info(
      { runId, pageId, status: run.status },
      "Run is paused or cancelled. Aborting crawl_page job.",
    )
    return
  }

  const updateProgress = async (progress: number, step: string) => {
    const { error: progressError } = await supabase
      .from("pages")
      .update({ progress, current_step: step })
      .eq("id", pageId)

    if (progressError) {
      logger.error(
        { pageId, error: progressError.message, progress, step },
        "Failed to update page progress in DB",
      )
    }

    const progressChannel = supabase.channel(`run:${runId}`)
    await progressChannel.httpSend("page_progress", {
      pageId,
      progress,
      current_step: step,
    })
  }
  let currentCheckProgress: Record<string, { progress: number; step: string }> =
    {}

  const updateCheckProgress = async (
    checkKey: string,
    progress: number,
    step: string,
  ) => {
    currentCheckProgress[checkKey] = { progress, step }

    const { error: progressError } = await supabase
      .from("pages")
      .update({ check_progress: currentCheckProgress })
      .eq("id", pageId)

    if (progressError) {
      logger.error(
        { pageId, error: progressError.message, progress, step },
        "Failed to update check progress",
      )
    }

    const progressChannel = supabase.channel(`run:${runId}`)
    await progressChannel.httpSend("page_progress", {
      pageId,
      check_progress: currentCheckProgress,
    })
  }

  try {
    // Step 1: Update page status to 'processing' and set initial step
    logger.info({ pageId }, "Setting page status to processing")
    const { error: statusError } = await supabase
      .from("pages")
      .update({
        status: "processing",
        current_step: "Starting page crawl...",
        progress: 2,
      })
      .eq("id", pageId)

    if (statusError) {
      logger.error(
        { pageId, error: statusError.message },
        "Failed to update page status to processing",
      )
    }

    // Immediate broadcast to update UI
    const initialChannel = supabase.channel(`run:${runId}`)
    await initialChannel.send({
      type: "broadcast",
      event: "page_progress",
      payload: { pageId, progress: 2, current_step: "Starting page crawl..." },
    })

    const enabledChecks = run?.enabled_checks || []

    // We only need screenshots if we are doing visual regression, accessibility, or hero media!
    // const needsScreenshots = enabledChecks.some(
    //   (c) => c !== "dead_links" && c !== "project_plan",
    // )
    const needsScreenshots = false

    // Step 2: Call screenshotPage(pageUrl, runId, pageId)
    let screenshots: any = {}
    if (needsScreenshots) {
      screenshots = await screenshotPage(pageUrl, runId, pageId, updateProgress)

      // Step 3: Update page record with screenshot URLs and status='screenshotted'
      const { error: updatePageError } = await supabase
        .from("pages")
        .update({
          screenshot_url_desktop: screenshots.desktopUrl,
          screenshot_url_tablet: screenshots.tabletUrl,
          screenshot_url_mobile: screenshots.mobileUrl,
          status: "screenshotted",
        })
        .eq("id", pageId)

      if (updatePageError) {
        logger.error(
          { pageId, error: updatePageError.message },
          "Failed to update page record with screenshots",
        )
      }
    } else {
      // If we don't need screenshots, update status directly to 'screenshotted' with nulls!
      logger.info(
        { pageId },
        "Skipping screenshot capture: Not needed for active checks",
      )

      const { error: updatePageError } = await supabase
        .from("pages")
        .update({
          screenshot_url_desktop: null,
          screenshot_url_tablet: null,
          screenshot_url_mobile: null,
          status: "screenshotted",
        })
        .eq("id", pageId)

      if (updatePageError) {
        logger.error(
          { pageId, error: updatePageError.message },
          "Failed to update page status directly",
        )
      }
    }

    // Step 3.5: Responsive Visual Check (Check Factor 12)
    let responsiveFindings: any[] = []
    // if (screenshots.desktopBuffer && screenshots.mobileBuffer) {
    //   logger.info({ pageId }, "Running responsive visual check")
    //   responsiveFindings = await checkResponsiveVisual(
    //     screenshots.desktopBuffer,
    //     screenshots.mobileBuffer,
    //     pageUrl,
    //   ).catch((e) => {
    //     logger.error("Responsive visual check failed:", e)
    //     return []
    //   })
    // }

    // Step 4: Run automated checks
    // Step 4: Run automated checks
    logger.info({ pageId }, "Running automated checks")

    const isOnlyFastScanChecks =
      enabledChecks.length > 0 &&
      enabledChecks.every(
        (c: string) => c === "dead_links" || c === "learn_more_buttons",
      )

    let browser: any = null
    let context: any = null
    let page: any = null
    const consoleErrors: string[] = []
    const criticalErrors: string[] = []
    let hasForms = false

    if (!isOnlyFastScanChecks) {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      })
    }

    try {
      if (!isOnlyFastScanChecks) {
        context = await browser.newContext()
        page = await context.newPage()

        // Console error check listener must be attached before goto
        page.on("console", (msg: any) => {
          if (
            msg.type() === "error" &&
            consoleErrors.length + criticalErrors.length < 80
          ) {
            consoleErrors.push(msg.text())
          }
        })

        page.on("pageerror", (err: any) => {
          if (consoleErrors.length + criticalErrors.length < 80) {
            criticalErrors.push(err.message)
          }
        })

        await updateProgress(
          10,
          "Navigating to website (this takes a moment)...",
        )
        try {
          await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 })
        } catch (e: any) {
          if (
            e.message.includes("Timeout") ||
            e.message.includes("aborted") ||
            e.message.includes("closed")
          ) {
            logger.warn(
              { pageUrl, error: e.message },
              "Page load timed out or was aborted, proceeding with checks anyway",
            )
          } else {
            throw e
          }
        }
        await updateProgress(15, "Website loaded, initializing checks...")

        // Check for forms on page
        try {
          hasForms = (await page.$("form")) !== null
        } catch {
          hasForms = false
        }
      }

      const enabledChecks = run?.enabled_checks || []
      const checkPromises: Promise<any[]>[] = []

      // Fetch project details and settings for pre-release checks
      let projectName = ""
      let devUrls: string[] = []

      if (
        enabledChecks.includes("text_share") ||
        enabledChecks.includes("url_tab_compare")
      ) {
        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", run.project_id)
          .single()

        projectName = project?.name || ""

        if (enabledChecks.includes("url_tab_compare")) {
          const { data: runPages } = await supabase
            .from("pages")
            .select("url")
            .eq("run_id", runId)
          devUrls = runPages?.map((p) => p.url) || []
        }
      }

      if (enabledChecks.includes("hero_media")) {
        const normalize = (u: string) =>
          u
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/$/, "")
            .toLowerCase()
        const isHomepage = normalize(pageUrl) === normalize(run.site_url)

        if (isHomepage) {
          checkPromises.push(
            checkHeroMedia(page, screenshots, async (p, m) => {
              await updateCheckProgress("hero_media", p, m)
              await new Promise((resolve) => setTimeout(resolve, 1500))
            }).catch((e) => {
              logger.error("Hero media check failed:", e)
              return []
            }),
          )
        }
      }

      if (enabledChecks.includes("visual_regression")) {
        checkPromises.push(
          checkBrokenLinks(page, screenshots).catch((e) => {
            logger.error("Broken links check failed:", e)
            return []
          }),
        )
        checkPromises.push(
          checkExternalLinks(page, screenshots).catch((e) => {
            logger.error("External links check failed:", e)
            return []
          }),
        )
        checkPromises.push(
          checkImageCompliance(page, screenshots).catch((e) => {
            logger.error("Image compliance check failed:", e)
            return []
          }),
        )
      }

      if (enabledChecks.includes("accessibility")) {
        checkPromises.push(
          checkMeta(page, screenshots).catch((e) => {
            logger.error("Meta check failed:", e)
            return []
          }),
        )
        checkPromises.push(
          checkDummyContent(page, screenshots).catch((e) => {
            logger.error("Dummy content check failed:", e)
            return []
          }),
        )
        checkPromises.push(
          checkSpelling(page, screenshots).catch((e) => {
            logger.error("Spelling check failed:", e)
            return []
          }),
        )
        if (hasForms) {
          checkPromises.push(
            checkForms(page, screenshots).catch((e) => {
              logger.error("Forms check failed:", e)
              return []
            }),
          )
        }
      }

      if (enabledChecks.includes("console_errors")) {
        checkPromises.push(
          checkConsoleErrors(page, screenshots).catch((e) => {
            logger.error("Console errors check failed:", e)
            return []
          }),
        )
      }

      if (enabledChecks.includes("dead_links")) {
        checkPromises.push(
          (async () => {
            try {
              return await checkOptimizedLinks(
                page,
                {
                  id: pageId,
                  run_id: runId,
                  site_url: run.site_url,
                  url: pageUrl,
                },
                undefined,
                async (p, m) => {
                  await updateCheckProgress("dead_links", p, m)
                },
              )
            } catch (e) {
              logger.error("Dead links check failed:", e)
              return []
            }
          })(),
        )
      }

      if (enabledChecks.includes("contact_form")) {
        checkPromises.push(
          (async () => {
            try {
              return await checkGrowth99ContactForm(
                pageUrl,
                runId,
                pageId,
                browser,
                async (p, m) => {
                  await updateCheckProgress("contact_form", p, m)
                },
              )
            } catch (e) {
              logger.error("Contact form check failed:", e)
              return []
            }
          })(),
        )
      }

      if (enabledChecks.includes("learn_more_buttons")) {
        checkPromises.push(
          (async () => {
            try {
              return await checkLearnMoreButtons(
                pageUrl,
                runId,
                pageId,
                async (p, m) => {
                  await updateCheckProgress("learn_more_buttons", p, m)
                },
              )
            } catch (e) {
              logger.error(e, "Learn More Buttons check failed:")
              return []
            }
          })(),
        )
      }

      if (run?.is_woocommerce && enabledChecks.includes("woocommerce")) {
        checkPromises.push(
          (async () => {
            const wooPage = await context.newPage()
            try {
              return await checkWooCommerce(wooPage, run.site_url, run)
            } catch (e) {
              logger.error("WooCommerce check failed:", e)
              return []
            } finally {
              await wooPage.close()
            }
          })(),
        )
      }

      const normalizeUrl = (u: string) =>
        u
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .replace(/\/$/, "")
          .toLowerCase()
      const isHomepage = normalizeUrl(pageUrl) === normalizeUrl(run.site_url)

      // --- HOMEPAGE-ONLY CHECKS ---
      if (isHomepage) {
        await Promise.all(checkPromises)
        if (enabledChecks.includes("privacy_policy")) {
          checkPromises.push(
            checkPrivacyPolicy(
              pageUrl,
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("privacy_policy", p, m)
              },
            ).catch((e) => {
              logger.error("Privacy policy check failed:", e)
              return []
            }),
          )
        }
        await Promise.all(checkPromises)
        if (enabledChecks.includes("footer_logo")) {
          checkPromises.push(
            checkFooterLogo(pageUrl, runId, pageId, browser, async (p, m) => {
              await updateCheckProgress("footer_logo", p, m)
            }).catch((e) => {
              logger.error("Footer logo check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("single_script")) {
          checkPromises.push(
            checkSingleScript(pageUrl, runId, pageId, browser, async (p, m) => {
              await updateCheckProgress("single_script", p, m)
            }).catch((e) => {
              logger.error("Single script check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("top_bar_sticky")) {
          checkPromises.push(
            checkTopBarAndStickyHeader(
              pageUrl,
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("top_bar_sticky", p, m)
              },
            ).catch((e) => {
              logger.error("Top bar & sticky header check failed:", e)
              return []
            }),
          )
        }
        await Promise.all(checkPromises)
        if (enabledChecks.includes("favicon")) {
          checkPromises.push(
            checkFavicon(pageUrl, runId, pageId, browser, async (p, m) => {
              await updateCheckProgress("favicon", p, m)
            }).catch((e) => {
              logger.error("Favicon check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("chatbot_consultation")) {
          checkPromises.push(
            checkChatbotAndConsultation(page).catch((e) => {
              logger.error("Chatbot consultation check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("logo_chatbot")) {
          checkPromises.push(
            checkLogoOnChatbot(
              pageUrl,
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("logo_chatbot", p, m)
              },
            ).catch((e) => {
              logger.error("Logo on chatbot check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("text_share")) {
          checkPromises.push(
            checkTextShareMetadata(page, projectName).catch((e) => {
              logger.error("Text share metadata check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("callnow_links")) {
          checkPromises.push(
            checkCallnowLinks(
              pageUrl,
              runId,
              pageId,
              wpPassword,
              browser,
              async (p, m) => {
                await updateCheckProgress("callnow_links", p, m)
              },
            ).catch((e) => {
              logger.error("Callnow & Links check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("url_tab_compare") && run.live_site_url) {
          checkPromises.push(
            checkUrlTabComparison(
              pageUrl,
              run.live_site_url,
              runId,
              pageId,
              devUrls,
              async (p, m) => {
                await updateCheckProgress("url_tab_compare", p, m)
              },
            ).catch((e) => {
              logger.error("URL Tab Comparison check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("verify_plugin_updates")) {
          checkPromises.push(
            checkPluginUpdates(
              pageUrl,
              runId,
              pageId,
              wpPassword,
              browser,
              async (p, m) => {
                await updateCheckProgress("verify_plugin_updates", p, m)
              },
            ).catch((e) => {
              logger.error("Plugin updates check failed:", e)
              return []
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("social_share_heading")) {
          checkPromises.push(
            checkSocialShareHeading(
              pageUrl,
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("social_share_heading", p, m)
              },
            ).catch((e) => {
              logger.error("Social share heading check failed:", e)
              return []
            }),
          )
        }
      }

      // --- ALL-PAGES CHECKS ---

      // Attach a .then to stream findings into DB the instant each individual check finishes

      const streamingPromises = checkPromises.map((p) =>
        p.then(async (results) => {
          if (results && results.length > 0) {
            const findingsToInsert = results.map((f) => ({
              ...f,
              page_id: pageId,
              run_id: runId,
            }))
            const { error: insertError } = await supabase
              .from("findings")
              .insert(findingsToInsert)
            if (insertError) {
              logger.error(
                { pageId, error: insertError.message },
                "Failed to stream insert finding",
              )
            }
          }
        }),
      )

      // Wait for all streamed checks to finish
      await Promise.all(streamingPromises)

      // Insert responsive findings immediately since they resolve synchronously
      if (responsiveFindings && responsiveFindings.length > 0) {
        const responsiveToInsert = responsiveFindings.map((f) => ({
          ...f,
          page_id: pageId,
          run_id: runId,
        }))
        await supabase.from("findings").insert(responsiveToInsert)
      }

      // Add AI Check jobs decoupled to perform asynchronously
      // const pageText = await page
      //   .evaluate(() => document.body.innerText)
      //   .catch(() => "")

      // qaQueue
      //   .add("run_ai_checks", {
      //     runId,
      //     pageId,
      //     pageUrl,
      //     pageText,
      //     enabled_checks: run?.enabled_checks || [],
      //   })
      //   .catch((e) => logger.error("Failed to queue run_ai_checks:", e))

      // Step 5: Update page status to 'done'
      await supabase
        .from("pages")
        .update({
          status: "done",
          progress: 100,
          current_step: "All checks complete",
        })
        .eq("id", pageId)
    } finally {
      if (browser) {
        await browser
          .close()
          .catch((e: any) => logger.error({ err: e }, "Failed to close browser"))
      }
    }
  } catch (error: any) {
    logger.error(
      { runId, pageUrl, error: error.message },
      "Error during page crawl",
    )

    if (pageId) {
      const errorMessage = error.message.split("\n")[0] || "Unknown error"
      await supabase
        .from("pages")
        .update({
          status: "failed",
          current_step: `Error: ${errorMessage}`,
        })
        .eq("id", pageId)
    }

    throw error
  } finally {
    // Step 6 & 7: Atomically increment pages_processed and check for run completion
    const { data: isComplete, error: rpcError } = await supabase.rpc(
      "increment_and_check_completion",
      { run_id_param: runId },
    )

    if (rpcError) {
      logger.warn(
        { runId, error: rpcError.message },
        "RPC increment_and_check_completion failed, falling back",
      )

      // Fallback: use old increment RPC
      await supabase.rpc("increment_pages_processed", { run_id_param: runId })

      // Fallback: check completion separately
      const { data: runCheck } = await supabase
        .from("qa_runs")
        .select("pages_processed, pages_total, status")
        .eq("id", runId)
        .single()

      if (
        runCheck &&
        runCheck.status === "running" &&
        runCheck.pages_total > 0 &&
        runCheck.pages_processed >= runCheck.pages_total
      ) {
        await supabase
          .from("qa_runs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId)

        logger.info({ runId }, "Run marked as completed (fallback)")

        qaQueue
          .add("generate_embeddings", { runId })
          .catch((e) => logger.error("Failed to queue generate_embeddings:", e))
      }
    } else if (isComplete) {
      logger.info({ runId }, "Run marked as completed")

      qaQueue
        .add("generate_embeddings", { runId })
        .catch((e) => logger.error("Failed to queue generate_embeddings:", e))
    }

    // Step 8: Broadcast progress update
    const finalChannel = supabase.channel(`run:${runId}`)
    await finalChannel.send({
      type: "broadcast",
      event: "progress",
      payload: {
        pageUrl,
        status: "done",
        pageId,
      },
    })

    logger.info({ pageId, runId }, "Page crawl lifecycle finished")
  }
}
