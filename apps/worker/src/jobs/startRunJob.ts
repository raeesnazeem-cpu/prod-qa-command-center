import { Job } from "bullmq"
import { supabase } from "../lib/supabase"
import { qaQueue } from "../lib/queue"
import { crawlSitemap } from "../crawlers/sitemapCrawler"
import * as activityService from "../services/activityService"
import { wpPasswordCache } from "../lib/credentialsCache"

import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function processStartRunJob(job: Job) {
  const { runId } = job.data
  const wpPassword = job.data.wpPassword || job.data.wp_password

  if (wpPassword) {
    wpPasswordCache.set(runId, wpPassword)
  }

  if (!runId) {
    throw new Error("No runId provided to start_run job")
  }

  logger.info({ runId }, "Starting run processing")

  // Step 1: Fetch run from Supabase
  const { data: run, error: fetchError } = await supabase
    .from("qa_runs")
    .select("id, site_url, project_id, selected_urls, status, enabled_checks")
    .eq("id", runId)
    .single()

  if (fetchError || !run) {
    throw new Error(`Failed to fetch run ${runId}: ${fetchError?.message}`)
  }

  // Check if run should still proceed
  if (run.status === "cancelled" || run.status === "paused") {
    logger.info(
      { runId, status: run.status },
      "Run is cancelled or paused. Aborting start_run job.",
    )
    return
  }

  // Step 2: Update run status to 'running'
  const { error: updateError } = await supabase
    .from("qa_runs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
    })
    .eq("id", runId)

  if (updateError) {
    logger.error(
      { runId, error: updateError.message },
      "Failed to update run status to running",
    )
  }

  try {
    const ALL_PAGES_CHECKS = [
      "visual_regression",
      "accessibility",
      "performance",
      "spelling",
      "console_errors",
      "seo",
      "dummy_content",
      "dead_links",
      "learn_more_buttons",
      "url_matching",
      "url_tab_compare",
      "contact_form",
    ]

    const HOMEPAGE_ONLY_CHECKS = [
      "privacy_policy",
      "callnow_links",
      "hero_media",
      "footer_logo",
      "single_script",
      "top_bar_sticky",
      "favicon",
      "chatbot_consultation",
      "text_share",
      "verify_plugin_updates",
      "social_share_heading",
      "logo_chatbot",
    ]

    const PAGE_CHECKS = [...ALL_PAGES_CHECKS, ...HOMEPAGE_ONLY_CHECKS]
    const needsPageScan = run.enabled_checks?.some((c: string) =>
      PAGE_CHECKS.includes(c),
    )
    const hasAllPagesCheck = run.enabled_checks?.some((c: string) =>
      ALL_PAGES_CHECKS.includes(c),
    )
    const hasDeadLinks = run.enabled_checks?.includes("dead_links")
    const hasLearnMoreButtons =
      run.enabled_checks?.includes("learn_more_buttons")

    let urls: string[] = []

    if (needsPageScan) {
      logger.info({ runId }, "Determining URLs to process")

      if (hasAllPagesCheck) {
        // If dead_links check is enabled, ignore user selected_urls filter and check all pages!
        if (
          run.selected_urls &&
          run.selected_urls.length > 0 &&
          !hasDeadLinks &&
          !hasLearnMoreButtons
        ) {
          logger.info(
            { runId, count: run.selected_urls.length },
            "Using provided selected_urls",
          )
          urls = [...run.selected_urls]
        } else {
          logger.info(
            { runId, siteUrl: run.site_url },
            "Crawling site for all pages (crawlSitemap)",
          )
          urls = await crawlSitemap(run.site_url)
        }

        // Fallback to homepage URL if crawler returns nothing
        if (!urls || urls.length === 0) {
          urls = [run.site_url]
        }

        // Ensure homepage is first if hero_media or dead_links is active
        const hasHeroMedia = run.enabled_checks?.includes("hero_media")
        if (hasHeroMedia || hasDeadLinks || hasLearnMoreButtons) {
          const homepage = run.site_url
          const homepageNormalized = homepage.endsWith("/")
            ? homepage.slice(0, -1)
            : homepage
          const hasHomepage = urls.some((url) => {
            const u = url.endsWith("/") ? url.slice(0, -1) : url
            return u.toLowerCase() === homepageNormalized.toLowerCase()
          })
          if (!hasHomepage) {
            logger.info(
              { runId, homepage },
              "Forcing homepage inclusion in check sequence",
            )
            urls.unshift(homepage)
          }
        }
      } else {
        // Only homepage-specific checks are active. Restrict scan to homepage only.
        logger.info(
          { runId },
          "Only homepage-specific checks are active. Restricting scan to homepage only.",
        )
        urls = [run.site_url]
      }
    } else {
      logger.info(
        { runId },
        "No page scan checks active; skipping crawl completely",
      )
    }

    logger.info({ runId, count: urls.length }, "URL collection complete")

    // Step 4: Update run.pages_total with URL count
    const { error: totalError } = await supabase
      .from("qa_runs")
      .update({ pages_total: urls.length })
      .eq("id", runId)

    if (totalError) {
      logger.error(
        { runId, error: totalError.message },
        "Failed to update pages_total",
      )
    }

    let insertedPages = []
    if (needsPageScan && urls.length > 0) {
      // Step 5 & 6: For each URL, add a 'crawl_page' job AND insert into pages table
      logger.info(
        { runId, count: urls.length },
        "Inserting pages into database",
      )
      const pagesToInsert = urls.map((url) => ({
        run_id: runId,
        url: url,
        status: "pending",
      }))

      const { data: dbPages, error: insertError } = await supabase
        .from("pages")
        .insert(pagesToInsert)
        .select("id, url")

      if (insertError) {
        logger.error(
          { runId, error: insertError.message },
          "Failed to insert pages into DB",
        )
        throw new Error(
          `Failed to insert pages for run ${runId}: ${insertError.message}`,
        )
      }
      insertedPages = dbPages || []
    } else if (!needsPageScan) {
      // Add a single completed placeholder page with status "done" to satisfy findings table constraint
      logger.info(
        { runId },
        "Inserting a single placeholder page for general checks",
      )
      const { data: dbPages, error: insertError } = await supabase
        .from("pages")
        .insert([
          {
            run_id: runId,
            url: run.site_url,
            status: "done", // <-- Set status to "done" to satisfy check constraint!
          },
        ])
        .select("id, url")

      if (insertError) {
        logger.error(
          { runId, error: insertError.message },
          "Failed to insert placeholder page",
        )
      } else {
        // Update the run's pages_total to 1 to notify the frontend that discovery is complete!
        await supabase
          .from("qa_runs")
          .update({ pages_total: 1 })
          .eq("id", runId)
      }
      insertedPages = dbPages || []
    }

    // Add jobs to queue for each page discovered
    if (needsPageScan && insertedPages && insertedPages.length > 0) {
      logger.info({ runId, count: insertedPages.length }, "Enqueuing scan jobs")

      const BATCH_SIZE = 10
      const chunks = []
      for (let i = 0; i < insertedPages.length; i += BATCH_SIZE) {
        chunks.push(insertedPages.slice(i, i + BATCH_SIZE))
      }

      const jobs = chunks.map((chunk) => {
        if (chunk.length === 1) {
          const page = chunk[0]
          return {
            name: "crawl_page",
            data: {
              runId,
              pageId: page.id,
              url: page.url,
              projectId: run.project_id,
              enabledChecks: run.enabled_checks,
              wpPassword,
            },

            opts: {
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
            },
          }
        } else {
          return {
            name: "crawl_batch",
            data: {
              runId,
              pages: chunk.map((p) => ({ id: p.id, url: p.url })),
              projectId: run.project_id,
              wpPassword,
            },

            opts: {
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
              lockDuration: 600000,
            },
          }
        }
      })

      await qaQueue.addBulk(jobs)
      logger.info(
        { runId, jobCount: jobs.length },
        "Enqueued scan jobs successfully",
      )
    }

    // Enqueue standalone API checks if they are enabled
    const API_CHECKS = ["project_plan", "paid_media"]

    for (const check of run.enabled_checks || []) {
      if (API_CHECKS.includes(check)) {
        const jobName = `check_${check}`
        await qaQueue.add(
          jobName,
          { runId, projectId: run.project_id },
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          },
        )
        logger.info({ runId, jobName }, `Enqueued ${jobName} job successfully`)
      }
    }
  } catch (error: any) {
    logger.error({ runId, error: error.message }, "Error during sitemap crawl")

    // Update status to failed if crawling fails
    await supabase
      .from("qa_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)

    // Notify the run creator that the scan failed
    try {
      const { data: failedRun } = await supabase
        .from("qa_runs")
        .select("created_by, project_id")
        .eq("id", runId)
        .single()

      if (failedRun?.created_by) {
        const { data: projectData } = await supabase
          .from("projects")
          .select("name")
          .eq("id", failedRun.project_id)
          .single()

        await activityService.logActivity(
          { id: "system", name: "System" },
          {
            type: "RUN_FAILED",
            details: {
              projectName: projectData?.name || "Project",
              message: `Scan for ${projectData?.name || "Project"} failed during crawl: ${error.message}`,
            },
          },
          { id: runId, type: "run" },
          [failedRun.created_by],
        )
      }
    } catch (notifyErr: any) {
      logger.error(
        { runId, error: notifyErr.message },
        "[ActivityService] Failed to send run failure notification",
      )
    }

    throw error
  }
}
