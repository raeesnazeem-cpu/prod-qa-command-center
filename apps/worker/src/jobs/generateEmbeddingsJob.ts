import { Job } from "bullmq"
import pino from "pino"
import { supabase } from "../lib/supabase"
import { generateEmbedding } from "@qacc/ai"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
})

export async function processGenerateEmbeddingsJob(job: Job) {
  const { runId } = job.data
  if (!runId) {
    throw new Error("runId is required for generate_embeddings job")
  }

  logger.info({ runId }, "Starting generate_embeddings job")

  // 1. Fetch run details including project name and org_id
  const { data: run, error: runError } = await supabase
    .from("qa_runs")
    .select(
      `
      id,
      org_id,
      projects (
        name,
        org_id
      )
    `,
    )
    .eq("id", runId)
    .single()

  if (runError || !run) {
    logger.error(
      { runId, error: runError },
      "Failed to fetch run for embeddings",
    )
    throw runError || new Error("Run not found")
  }

  const projectName = (run.projects as any)?.name || "Unknown Project"
  const orgId = (run.projects as any)?.org_id

  // 2. Fetch all findings for this run
  const { data: findings, error: findingsError } = await supabase
    .from("findings")
    .select(
      `
      id,
      title,
      description,
      check_factor,
      pages (
        url
      )
    `,
    )
    .eq("run_id", runId)

  if (findingsError) {
    logger.error(
      { runId, error: findingsError },
      "Failed to fetch findings for embeddings",
    )
    throw findingsError
  }

  // Process findings
  for (const finding of findings || []) {
    const url = (finding.pages as any)?.url || "Unknown URL"
    const text = `${finding.check_factor}: ${finding.title}. ${finding.description || ""}. Page: ${url}. Project: ${projectName}. Run: ${runId}`

    try {
      const vector = await generateEmbedding(text)

      const { error: upsertError } = await supabase.from("embeddings").upsert(
        {
          org_id: orgId,
          source_type: "finding",
          source_id: finding.id,
          content: text,
          embedding: vector,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source_id,source_type" },
      )

      if (upsertError) {
        logger.error(
          { findingId: finding.id, error: upsertError },
          "Failed to upsert finding embedding",
        )
      }
    } catch (err: any) {
      const isRateLimit =
        err.status === 429 ||
        err.statusCode === 429 ||
        err.response?.status === 429 ||
        (typeof err.message === "string" &&
          (err.message.includes("429") ||
            err.message.includes("RESOURCE_EXHAUSTED") ||
            err.message.includes("Quota exceeded")))
      if (isRateLimit) {
        logger.error(
          { error: err.message || err },
          "Rate limit (429) encountered. Aborting further embedding attempts for this run.",
        )
        throw err
      }
      logger.error(
        { findingId: finding.id, error: err.message || err },
        "Error embedding finding",
      )
    }
  }

  // 3. Fetch all comments for tasks associated with this run
  // First get task IDs for this run
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id")
    .eq("run_id", runId)

  if (!tasksError && tasks && tasks.length > 0) {
    const taskIds = tasks.map((t) => t.id)

    const { data: comments, error: commentsError } = await supabase
      .from("task_comments")
      .select("id, content, task_id")
      .in("task_id", taskIds)

    if (!commentsError && comments) {
      for (const comment of comments) {
        try {
          const vector = await generateEmbedding(comment.content)

          const { error: upsertError } = await supabase
            .from("embeddings")
            .upsert(
              {
                org_id: orgId,
                source_type: "comment",
                source_id: comment.id,
                content: comment.content,
                embedding: vector,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "source_id,source_type" },
            )

          if (upsertError) {
            logger.error(
              { commentId: comment.id, error: upsertError },
              "Failed to upsert comment embedding",
            )
          }
        } catch (err: any) {
          const isRateLimit =
            err.status === 429 ||
            err.statusCode === 429 ||
            err.response?.status === 429 ||
            (typeof err.message === "string" &&
              (err.message.includes("429") ||
                err.message.includes("RESOURCE_EXHAUSTED") ||
                err.message.includes("Quota exceeded")))
          if (isRateLimit) {
            logger.error(
              { error: err.message || err },
              "Rate limit (429) encountered. Aborting further embedding attempts for this run.",
            )
            throw err
          }
          logger.error(
            { commentId: comment.id, error: err.message || err },
            "Error embedding comment",
          )
        }
      }
    }
  }

  logger.info({ runId }, "Finished generate_embeddings job")
}
