import { supabase } from "./supabase"

/**
 * Broadcasts a task update via Supabase Realtime.
 * Channel: "tasks"
 */
export async function broadcastTaskUpdate(
  taskId: string,
  payload: any,
): Promise<void> {
  const channel = supabase.channel("tasks")

  try {
    await channel.httpSend("task_updated", {
      taskId,
      ...payload,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error(
      `[RealtimeService] Failed to send broadcast for ${taskId}:`,
      error,
    )
  }
}

/**
 * Broadcasts QA run progress via Supabase Realtime.
 * Channel: "run:{runId}"
 */
export async function broadcastRunProgress(
  runId: string,
  payload: any,
): Promise<void> {
  const channel = supabase.channel(`run:${runId}`)

  try {
    await channel.httpSend("progress_update", {
      runId,
      ...payload,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error(
      `[RealtimeService] Failed to broadcast run progress for ${runId}:`,
      error,
    )
  }
}
