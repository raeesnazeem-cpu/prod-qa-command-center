import { supabase } from "./supabase"
import { qaQueue, addRunJob } from "./queue"

// Shared run lifecycle engine (pause / resume / cancel).
//
// This is the SAME transition + resume behavior that powers the Clerk-guarded
// UI endpoint `PATCH /api/runs/:id/status` (apps/api/src/routes/runs.ts). It is
// factored out here so the TED-facing webhook endpoints
// (/webhooks/ted/pause|resume|cancel) can drive the exact same machinery
// WITHOUT needing a Clerk login/session.
//
// IMPORTANT: the UI PATCH endpoint is intentionally left untouched and keeps its
// own inline copy of this logic (plus Clerk-only activity logging). If you change
// the transition table or the resume re-enqueue below, mirror it there too so the
// two entry points stay in sync.

// Allowed status transitions — mirrors runs.ts:500.
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["running", "cancelled"],
  running: ["completed", "failed", "paused", "cancelled"],
  paused: ["running", "cancelled"],
}

export type TransitionCode =
  | "ok"
  | "not_found"
  | "invalid_transition"
  | "error"

export interface TransitionResult {
  ok: boolean
  code: TransitionCode
  /** The run's status BEFORE the attempted change (when known). */
  fromStatus?: string
  /** The run's status AFTER the change (equals newStatus on success). */
  toStatus?: string
  /** The updated run row on success (used by callers for follow-up work). */
  run?: any
  error?: string
}

/**
 * Move a QA run to a new lifecycle status, applying the same validation and
 * (on paused -> running) the same resume re-enqueue that the UI uses.
 *
 * Best-effort but transactional-ish: the status row is updated first, then the
 * resume jobs are enqueued. Returns a structured result instead of throwing so
 * webhook callers can map it to a clean HTTP status.
 */
export async function transitionRunStatus(
  runId: string,
  newStatus: "running" | "paused" | "cancelled",
): Promise<TransitionResult> {
  try {
    // 1. Fetch current status.
    const { data: run, error: fetchError } = await supabase
      .from("qa_runs")
      .select("status")
      .eq("id", runId)
      .single()

    if (fetchError || !run) {
      return { ok: false, code: "not_found", error: "Run not found" }
    }

    const currentStatus = run.status as string

    // Idempotency: asking for the status it's already in is a no-op success, not
    // an "invalid transition" error. TED may retry a button; don't punish it.
    if (currentStatus === newStatus) {
      return {
        ok: true,
        code: "ok",
        fromStatus: currentStatus,
        toStatus: newStatus,
      }
    }

    // 2. Validate transition.
    if (!VALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
      return {
        ok: false,
        code: "invalid_transition",
        fromStatus: currentStatus,
        error: `Invalid status transition from ${currentStatus} to ${newStatus}`,
      }
    }

    // 3. Apply the status change.
    // Of the three statuses this engine drives, only "cancelled" is terminal and
    // gets a completed_at stamp (mirrors the UI PATCH, which also stamps
    // completed/failed — those are set by the worker, not this control path).
    const updateData: any = { status: newStatus }
    if (newStatus === "cancelled") {
      updateData.completed_at = new Date().toISOString()
    }

    const { data: updatedRun, error: updateError } = await supabase
      .from("qa_runs")
      .update(updateData)
      .eq("id", runId)
      .select()
      .single()

    if (updateError) {
      return { ok: false, code: "error", error: updateError.message }
    }

    // 4. Resume trigger: paused -> running re-enqueues remaining work.
    //    Mirrors runs.ts:529-608 exactly.
    if (currentStatus === "paused" && newStatus === "running") {
      const { data: pages, error: pagesError } = await supabase
        .from("pages")
        .select("id, url, status")
        .eq("run_id", runId)

      if (pagesError) {
        return { ok: false, code: "error", error: pagesError.message }
      }

      if (!pages || pages.length === 0) {
        // Bypassed Phase 1: re-queue sitemap discovery from scratch.
        await addRunJob(runId)
      } else {
        // Bypassed Phase 2: re-queue only the pages that never finished.
        const remainingPages = pages.filter(
          (p) => p.status !== "done" && p.status !== "failed",
        )

        if (remainingPages.length > 0) {
          const remainingPageIds = remainingPages.map((p) => p.id)

          await supabase
            .from("pages")
            .update({
              status: "pending",
              current_step: "Queued for resume...",
              progress: 0,
            })
            .in("id", remainingPageIds)

          const BATCH_SIZE = 10
          const chunks: (typeof remainingPages)[] = []
          for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
            chunks.push(remainingPages.slice(i, i + BATCH_SIZE))
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
                  projectId: updatedRun.project_id,
                  enabledChecks: updatedRun.enabled_checks,
                },
                opts: {
                  attempts: 3,
                  backoff: { type: "exponential", delay: 5000 },
                },
              }
            }
            return {
              name: "crawl_batch",
              data: {
                runId,
                pages: chunk.map((p) => ({ id: p.id, url: p.url })),
                projectId: updatedRun.project_id,
              },
              opts: {
                attempts: 3,
                backoff: { type: "exponential", delay: 5000 },
                lockDuration: 600000,
              },
            }
          })

          await qaQueue.addBulk(jobs as any)
        }
      }
    }

    return {
      ok: true,
      code: "ok",
      fromStatus: currentStatus,
      toStatus: newStatus,
      run: updatedRun,
    }
  } catch (err: any) {
    return { ok: false, code: "error", error: err?.message || String(err) }
  }
}
