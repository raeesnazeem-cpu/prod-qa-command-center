import { Job } from "bullmq"
import { checkLearnMoreButtons } from "../checks/learnMoreButtonsCheck"
import { checkPageSpeed } from "../checks/pageSpeedCheck"
import { chromium } from "playwright"
import { supabase } from "../lib/supabase"
import { qaQueue } from "../lib/queue"
import {
  postFinalReportToTED,
  postScanCompleteComment,
  markAllTedTasksCompleted,
} from "../lib/tedSync"
import { runCrossBrowserCheck } from "../checks/crossBrowserCheck"
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
import { checkFalseBreakpoints } from "../checks/falseBreakpointCheck"
import { checkBackend } from "../checks/backendCheck"
import { checkReviewReputation } from "../checks/reviewReputationCheck"
import { checkFunctionality } from "../checks/functionalityCheck"
import { checkHamburgerMenu } from "../checks/hamburgerMenuCheck"
import { checkBlogVerification } from "../checks/blogVerificationCheck"
import { checkImageQuality } from "../checks/imageQualityCheck"
import { checkGbp } from "../checks/gbpCheck"
import { checkGrammar } from "../checks/grammarCheck"
import { checkAccessibility } from "../checks/accessibilityCheck"
import {
  checkPrivacyPolicy,
  checkFooterLogo,
  checkSingleScript,
  checkTopBarAndStickyHeader,
  checkFavicon,
  checkGrowth99ContactForm,
  checkChatbotAndConsultation,
  checkTextShareMetadata,
  checkCallnowLinks,
  checkUrlTabComparison,
  checkSocialShareHeading,
  checkLogoOnChatbot,
} from "../checks/preReleaseSuite"
import {
  checkPluginCount,
  checkPluginUpdatesCredentialFree,
  checkLiveSiteLink,
} from "../checks/postReleaseSuite"
import { checkGsr } from "../checks/gsrCheck"
import type { ThemeType } from "../lib/themeType"
import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

// When a check throws all the way to the caller, we must NOT swallow it into an
// empty result — an empty result is indistinguishable from "check ran, found
// nothing" and gets reported to the client as a clean pass. Instead we emit a
// tool-lapse finding (title contains "Check Failed" so tedSync's
// isToolLapseFinding() marks the check "could not complete" rather than
// "passed"). The check_factor MUST match what the real check emits so the lapse
// is attributed to the right subtask.
function lapse(checkFactor: string) {
  return (e: any): any[] => {
    const msg = e?.message || String(e)
    logger.error({ checkFactor, error: msg }, "Check threw; recording tool lapse")
    return [
      {
        check_factor: checkFactor,
        title: "Check Failed",
        description: `The ${checkFactor} check encountered an unexpected error: ${msg}. Process aborted gracefully.`,
        context_text: "System Error",
        screenshot_url: null,
        status: "open",
        ai_generated: false,
      },
    ]
  }
}

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
      "status, is_woocommerce, site_url, enabled_checks, project_id, live_site_url, released_site_url, theme_type",
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

  // Theme type resolved once at scan start (startRunJob) and stored on the run.
  // Threaded into the checks whose logic diverges between a classic PHP theme
  // and a block/FSE theme; everything else ignores it. Absent → "unknown", which
  // every consumer treats as the existing (block) behaviour.
  const themeType: ThemeType = (run.theme_type as ThemeType) || "unknown"

  // Check if run is paused or cancelled
  if (run.status === "paused" || run.status === "cancelled") {
    logger.info(
      { runId, pageId, status: run.status },
      "Run is paused or cancelled. Aborting crawl_page job.",
    )
    return
  }

  const updateProgress = async (progress: number, step: string) => {
    if (!job.data.overrideChecks) {
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
    }

    const progressChannel = supabase.channel(`run:${runId}`)
    await progressChannel.send({
      type: "broadcast",
      event: "page_progress",
      payload: {
        pageId,
        progress,
        current_step: step,
      },
    })
  }
  const { data: pageData } = await supabase
    .from("pages")
    .select("check_progress")
    .eq("id", pageId)
    .single()

  let currentCheckProgress: Record<string, { progress: number; step: string }> =
    pageData?.check_progress || {}

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
    await progressChannel.send({
      type: "broadcast",
      event: "page_progress",
      payload: {
        pageId,
        check_progress: currentCheckProgress,
      },
    })
  }

  try {
    if (!job.data.overrideChecks) {
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
    }

    // Immediate broadcast to update UI
    const initialChannel = supabase.channel(`run:${runId}`)
    await initialChannel.send({
      type: "broadcast",
      event: "page_progress",
      payload: { pageId, progress: 2, current_step: "Starting page crawl..." },
    })

    const enabledChecks = job.data.overrideChecks || run?.enabled_checks || []

    // We only need screenshots if we are doing visual regression, accessibility, or hero media!
    // const needsScreenshots = enabledChecks.some(
    //   (c) => c !== "dead_links" && c !== "project_plan",
    // )
    const needsScreenshots = false

    let screenshots: any = {}

    // We dont capture 3 viewports for the page.
    logger.info({ pageId }, "Skipping 3-viewport screenshot capture")

    if (!job.data.overrideChecks) {
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
          "Failed to update page status",
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

      const enabledChecks = job.data.overrideChecks || run?.enabled_checks || []
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
            checkHeroMedia(page, screenshots, runId, async (p, m) => {
              await updateCheckProgress("hero_media", p, m)
              await new Promise((resolve) => setTimeout(resolve, 1500))
            }, themeType).catch((e) => {
              logger.error("Hero media check failed:", e)
              return lapse("hero_media")(e)
            }),
          )
        }
      }

      if (enabledChecks.includes("visual_regression")) {
        // broken_links retired — dead_links (optimizedLinksCheck) supersets it
        // (all assets + cross-page dedup) and is the one TED actually enqueues.
        checkPromises.push(
          checkExternalLinks(page, screenshots).catch((e) => {
            logger.error("External links check failed:", e)
            return lapse("external_links")(e)
          }),
        )
        checkPromises.push(
          checkImageCompliance(page, screenshots).catch((e) => {
            logger.error("Image compliance check failed:", e)
            return lapse("image_compliance")(e)
          }),
        )
      }

      if (enabledChecks.includes("accessibility")) {
        checkPromises.push(
          checkMeta(page, screenshots).catch((e) => {
            logger.error("Meta check failed:", e)
            return lapse("meta_tags")(e)
          }),
        )
        checkPromises.push(
          checkDummyContent(page, screenshots).catch((e) => {
            logger.error("Dummy content check failed:", e)
            return lapse("dummy_content")(e)
          }),
        )
        checkPromises.push(
          checkSpelling(page, screenshots).catch((e) => {
            logger.error("Spelling check failed:", e)
            return lapse("spelling")(e)
          }),
        )
        if (hasForms) {
          checkPromises.push(
            checkForms(page, screenshots, runId).catch((e) => {
              logger.error("Forms check failed:", e)
              return lapse("forms")(e)
            }),
          )
        }
      }

      if (enabledChecks.includes("console_errors")) {
        checkPromises.push(
          checkConsoleErrors(page, screenshots, consoleErrors, criticalErrors).catch((e) => {
            logger.error("Console errors check failed:", e)
            return lapse("console_errors")(e)
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
                  isRetry: !!job.data.overrideChecks,
                },
                undefined,
                async (p, m) => {
                  await updateCheckProgress("dead_links", p, m)
                },
              )
            } catch (e) {
              logger.error("Dead links check failed:", e)
              return lapse("dead_links")(e)
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
              return lapse("contact_form")(e)
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
              return lapse("learn_more_buttons")(e)
            }
          })(),
        )
      }


      if (enabledChecks.includes("false_breakpoint")) {
        checkPromises.push(
          checkFalseBreakpoints(pageUrl, runId, browser, async (p, m) => {
            await updateCheckProgress("false_breakpoint", p, m)
          }).catch((e) => {
            logger.error("False breakpoint check failed:", e)
            return lapse("false_breakpoint")(e)
          }),
        )
      }

      if (enabledChecks.includes("functionality_check")) {
        checkPromises.push(
          checkFunctionality(pageUrl, runId, browser, async (p, m) => {
            await updateCheckProgress("functionality_check", p, m)
          }).catch((e) => {
            logger.error("Functionality check failed:", e)
            return lapse("functionality_check")(e)
          }),
        )
      }

      // Spelling / Grammar / Accessibility — all-pages, shared-page checks.
      if (enabledChecks.includes("spelling")) {
        checkPromises.push(
          checkSpelling(page, screenshots).catch((e) => {
            logger.error("Spelling check failed:", e)
            return lapse("spelling")(e)
          }),
        )
      }
      if (enabledChecks.includes("grammar")) {
        checkPromises.push(
          checkGrammar(page, screenshots).catch((e) => {
            logger.error("Grammar check failed:", e)
            return lapse("grammar")(e)
          }),
        )
      }
      if (enabledChecks.includes("accessibility_check")) {
        checkPromises.push(
          checkAccessibility(page, screenshots).catch((e) => {
            logger.error("Accessibility check failed:", e)
            return lapse("accessibility_check")(e)
          }),
        )
      }

      if (enabledChecks.includes("image_quality")) {
        checkPromises.push(
          checkImageQuality(pageUrl, runId, browser, async (p, m) => {
            await updateCheckProgress("image_quality", p, m)
          }).catch((e) => {
            logger.error("Image quality check failed:", e)
            return lapse("image_quality")(e)
          }),
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
              return lapse("woocommerce")(e)
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
              return lapse("privacy_policy")(e)
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
              return lapse("footer_logo")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("hamburger_menu")) {
          checkPromises.push(
            checkHamburgerMenu(
              pageUrl,
              runId,
              browser,
              async (p, m) => {
                await updateCheckProgress("hamburger_menu", p, m)
              },
              themeType,
            ).catch((e) => {
              logger.error("Hamburger menu check failed:", e)
              return lapse("hamburger_menu")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("blog_verification")) {
          checkPromises.push(
            checkBlogVerification(pageUrl, runId).catch((e) => {
              logger.error("Blog verification check failed:", e)
              return lapse("blog_verification")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (
          enabledChecks.includes("single_script") &&
          false /* Defer to end */
        ) {
          checkPromises.push(
            checkSingleScript(pageUrl, runId, pageId, browser, async (p, m) => {
              await updateCheckProgress("single_script", p, m)
            }).catch((e) => {
              logger.error("Single script check failed:", e)
              return lapse("single_script")(e)
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
              themeType,
            ).catch((e) => {
              logger.error("Top bar & sticky header check failed:", e)
              return lapse("top_bar_sticky")(e)
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
              return lapse("favicon")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("chatbot_consultation")) {
          checkPromises.push(
            checkChatbotAndConsultation(page, runId, {
              projectId: run.project_id,
              projectName,
              siteUrl: run.site_url,
            }).catch((e) => {
              logger.error("Chatbot consultation check failed:", e)
              return lapse("chatbot_consultation")(e)
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
              return lapse("logo_chatbot")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("text_share")) {
          checkPromises.push(
            checkTextShareMetadata(page, projectName).catch((e) => {
              logger.error("Text share metadata check failed:", e)
              return lapse("text_share")(e)
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
              return lapse("callnow_links")(e)
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
              return lapse("url_tab_compare")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("verify_plugin_updates")) {
          checkPromises.push(
            checkPluginUpdatesCredentialFree(
              pageUrl,
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("verify_plugin_updates", p, m)
              },
            ).catch((e) => {
              logger.error("Plugin updates check failed:", e)
              return lapse("verify_plugin_updates")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("plugin_number")) {
          checkPromises.push(
            checkPluginCount(
              pageUrl,
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("plugin_number", p, m)
              },
            ).catch((e) => {
              logger.error("Plugin count check failed:", e)
              return lapse("plugin_number")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("live_site_link")) {
          checkPromises.push(
            checkLiveSiteLink(
              {
                notesUrl: run.live_site_url,
                releasedUrl: run.released_site_url,
                fallbackUrl: pageUrl,
              },
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("live_site_link", p, m)
              },
            ).catch((e) => {
              logger.error("Live site link check failed:", e)
              return lapse("live_site_link")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("page_speed")) {
          checkPromises.push(
            checkPageSpeed(pageUrl, runId, pageId, async (p, m) => {
              await updateCheckProgress("page_speed", p, m)
            }).catch((e) => {
              logger.error("Page speed check failed:", e)
              return lapse("page_speed")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("backend_check")) {
          checkPromises.push(
            checkBackend(
              pageUrl,
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("backend_check", p, m)
              },
              run.project_id,
            ).catch((e) => {
              logger.error("Backend check failed:", e)
              return lapse("backend_check")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("review_reputation_check")) {
          checkPromises.push(
            checkReviewReputation(
              pageUrl,
              runId,
              pageId,
              browser,
              async (p, m) => {
                await updateCheckProgress("review_reputation_check", p, m)
              },
            ).catch((e) => {
              logger.error("Review & reputation check failed:", e)
              return lapse("review_reputation_check")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("gbp_check")) {
          checkPromises.push(
            checkGbp(
              run.project_id,
              run.live_site_url || run.site_url,
              async (p, m) => {
                await updateCheckProgress("gbp_check", p, m)
              },
            ).catch((e) => {
              logger.error("GBP check failed:", e)
              return lapse("gbp_check")(e)
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
              return lapse("social_share_heading")(e)
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
              return lapse("single_script")(e)
            }),
          )
        }

        await Promise.all(checkPromises)
        if (enabledChecks.includes("gsr_check")) {
          checkPromises.push(
            checkGsr(
              page,
              { url: run.live_site_url || pageUrl },
              async (p, m) => {
                await updateCheckProgress("gsr_check", p, m)
              },
            )
              .then((res) => {
                updateCheckProgress("gsr_check", 100, "Done").catch(() => {})
                return res
              })
              .catch((err) => {
                logger.error("GSR check failed:", err)
                updateCheckProgress(
                  "gsr_check",
                  100,
                  `Failed: ${err.message}`,
                ).catch(() => {})
                return lapse("gsr_check")(err)
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

            const isGsrCheck = findingsToInsert[0]?.check_factor === "gsr_check"
            if (isGsrCheck) {
              await supabase
                .from("findings")
                .delete()
                .eq("run_id", runId)
                .eq("page_id", pageId)
                .eq("check_factor", "gsr_check")
            }

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
      if (!job.data.overrideChecks) {
        await supabase
          .from("pages")
          .update({
            status: "done",
            progress: 100,
            current_step: "All checks complete",
          })
          .eq("id", pageId)
      } else {
        // If it's an override, we only mark the specific check as done in check_progress
        const checkKey = job.data.overrideChecks[0]
        if (checkKey) {
          const { data: pageData } = await supabase
            .from("pages")
            .select("check_progress")
            .eq("id", pageId)
            .single()
          if (pageData) {
            const updatedCheckProgress = {
              ...(pageData.check_progress || {}),
              [checkKey]: {
                progress: 100,
                status: "done",
                step: "Check complete",
              },
            }
            await supabase
              .from("pages")
              .update({ check_progress: updatedCheckProgress })
              .eq("id", pageId)
          }
        }
      }
    } finally {
      if (browser) {
        await browser
          .close()
          .catch((e: any) =>
            logger.error({ err: e }, "Failed to close browser"),
          )
      }
    }
  } catch (error: any) {
    logger.error(
      { runId, pageUrl, error: error.message },
      "Error during page crawl",
    )

    if (pageId) {
      const errorMessage = error.message.split("\n")[0] || "Unknown error"
      if (!job.data.overrideChecks) {
        await supabase
          .from("pages")
          .update({
            status: "failed",
            current_step: `Error: ${errorMessage}`,
          })
          .eq("id", pageId)
      } else {
        const checkKey = job.data.overrideChecks[0]
        if (checkKey) {
          const { data: pageData } = await supabase
            .from("pages")
            .select("check_progress")
            .eq("id", pageId)
            .single()
          if (pageData) {
            const updatedCheckProgress = {
              ...(pageData.check_progress || {}),
              [checkKey]: {
                progress: 0,
                status: "failed",
                step: `Error: ${errorMessage}`,
              },
            }
            await supabase
              .from("pages")
              .update({ check_progress: updatedCheckProgress })
              .eq("id", pageId)
          }
        }
      }
    }

    throw error
  } finally {
    if (!job.data.overrideChecks) {
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
          .select("pages_processed, pages_total, status, ted_task_id")
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

          // Run-level cross-browser visual check (no-op unless enabled). Runs
          // before the TED report so its findings are included in the summary.
          await runCrossBrowserCheck(runId).catch((e) =>
            logger.error("Cross-browser check failed:", e),
          )

          // Post the final QA report back to TED (idempotent — see tedSync).
          if (runCheck.ted_task_id) {
            const report = await postFinalReportToTED(
              runId,
              runCheck.ted_task_id,
            ).catch((e) => {
              logger.error("TED Sync failed:", e)
              return null
            })
            // Only trigger the AI fix when the report actually posted AND there
            // were real issues. All-passed → say so and skip the fix.
            await maybeTriggerAiFix(runId, runCheck.ted_task_id, report)
          }
        }
      } else if (isComplete) {
        logger.info({ runId }, "Run marked as completed")

        // Run-level cross-browser visual check (no-op unless enabled). Runs
        // before the TED report so its findings are included in the summary.
        await runCrossBrowserCheck(runId).catch((e) =>
          logger.error("Cross-browser check failed:", e),
        )

        // Post the final QA report back to TED (idempotent — see tedSync).
        const { data: finalRun } = await supabase
          .from("qa_runs")
          .select("ted_task_id")
          .eq("id", runId)
          .single()
        if (finalRun?.ted_task_id) {
          const report = await postFinalReportToTED(
            runId,
            finalRun.ted_task_id,
          ).catch((e) => {
            logger.error("TED Sync failed:", e)
            return null
          })
          // Only trigger the AI fix when the report actually posted AND there
          // were real issues. All-passed → say so and skip the fix.
          await maybeTriggerAiFix(runId, finalRun.ted_task_id, report)
        }
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

      const spinnerChannel = supabase.channel(`spinner-clear-${runId}`)
      await spinnerChannel.send({
        type: "broadcast",
        event: "progress",
        payload: { pageId, status: "done" },
      })
    }

    logger.info({ pageId, runId }, "Page crawl lifecycle finished")
  }
}

/**
 * Decide whether to run the AI fix after a run's TED report is posted.
 * - report === null  → the report didn't post (duplicate path / error): do nothing.
 * - AI fix module off → do nothing (the summary already went out).
 * - real issues found → post the "scan complete, AI Fix running" comment and
 *   queue the ai_fix_run job.
 * - everything passed → post a short "AI Fix skipped, no issues" comment and do
 *   NOT queue the fix.
 */
async function maybeTriggerAiFix(
  runId: string,
  tedTaskId: string,
  report: { hasIssues: boolean; issueCount: number } | null,
): Promise<void> {
  if (!report) return

  // If the AI-fix module is off, the run is finished here — close out the TED
  // tasks so nothing is left "In Progress" and the flow can advance.
  if (process.env.AI_FIX_MODULE_ENABLED !== "true") {
    await markAllTedTasksCompleted(runId, tedTaskId)
    return
  }

  if (report.hasIssues) {
    // Real issues → hand off to the AI-fix pass. It posts the ONE combined
    // section-wise report (issue → fix → pass) and then calls
    // markAllTedTasksCompleted itself, so tasks close AFTER the fix.
    await postScanCompleteComment(tedTaskId, runId)
    qaQueue
      .add("ai_fix_run", { runId, tedTaskId })
      .catch((e) => logger.error("Failed to queue ai_fix_run:", e))
  } else {
    // Everything passed — postFinalReportToTED already posted the section-wise
    // report (each check named + how it passed), so there's nothing to add here.
    // No fix pass runs; just close out the TED tasks.
    await markAllTedTasksCompleted(runId, tedTaskId)
  }
}
