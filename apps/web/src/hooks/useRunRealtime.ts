import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { QARun } from "../api/runs.api"
import { REALTIME_ENABLED } from "@/lib/features"

const POLL_MS = 4000

// Same "still moving" test as useRun's refetchInterval.
const isRunActive = (run: QARun | undefined) =>
  run?.status === "running" ||
  run?.status === "pending" ||
  (run as any)?.recording_status === "recording" ||
  !!run?.pages?.some(
    (page) =>
      page.status === "processing" ||
      page.status === "pending" ||
      Object.values((page as any).check_progress || {}).some(
        (cp: any) => cp.status === "processing" || cp.status === "pending",
      ),
  )

export const useRunRealtime = (runId: string) => {
  const queryClient = useQueryClient()
  const [isConnected, setIsConnected] = useState(false)

  // No Realtime (AWS): useRun already re-polls the run itself while it is active.
  // Here we refresh findings on the same cadence and fire "run-progress-done"
  // when the run stops moving, which is what the broadcasts used to do.
  useEffect(() => {
    if (REALTIME_ENABLED || !runId) return
    let wasActive = isRunActive(queryClient.getQueryData<QARun>(["run", runId]))
    const timer = setInterval(() => {
      const active = isRunActive(queryClient.getQueryData<QARun>(["run", runId]))
      if (active || wasActive) {
        queryClient.invalidateQueries({ queryKey: ["findings"] })
        queryClient.invalidateQueries({ queryKey: ["run-findings", runId] })
      }
      if (wasActive && !active) {
        window.dispatchEvent(new CustomEvent("run-progress-done"))
      }
      wasActive = active
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [runId, queryClient])

  useEffect(() => {
    if (!REALTIME_ENABLED || !runId) return

    // 1. Subscribe to table changes for the specific run
    const runChannel = supabase
      .channel(`run-db-changes-${runId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "qa_runs",
          filter: `id=eq.${runId}`,
        },
        (payload) => {
          console.log("Run update received via Realtime:", payload)
          // Instantly update the UI cache to show live progress!
          queryClient.setQueryData<QARun>(["run", runId], (oldData) => {
            if (!oldData) return oldData
            return {
              ...oldData,
              ...payload.new,
            }
          })
          // Also fetch in background to make sure we didn't miss relations
          queryClient.invalidateQueries({ queryKey: ["run", runId] })
          queryClient.invalidateQueries({ queryKey: ["findings"] })
          queryClient.invalidateQueries({ queryKey: ["run-findings", runId] })
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pages",
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          // payload.new contains the updated page
          const newPage = payload.new as any
          if (!newPage) return

          // If a page is inserted or deleted, refetch the full run
          if (
            payload.eventType === "INSERT" ||
            payload.eventType === "DELETE"
          ) {
            queryClient.invalidateQueries({ queryKey: ["run", runId] })
            return
          }

          // If a page is updated, check if the status changed relative to current cached run
          const currentRun = queryClient.getQueryData<QARun>(["run", runId])
          const oldPage = currentRun?.pages?.find((p) => p.id === newPage.id)

          if (oldPage && oldPage.status !== newPage.status) {
            // Status changed, refetch the full run
            queryClient.invalidateQueries({ queryKey: ["run", runId] })
          } else {
            // Only progress or step changed, update cache directly with zero network requests
            queryClient.setQueryData<QARun>(["run", runId], (oldData) => {
              if (!oldData || !oldData.pages) return oldData
              return {
                ...oldData,
                pages: oldData.pages.map((p) =>
                  p.id === newPage.id
                    ? {
                        ...p,
                        progress: newPage.progress,
                        current_step: newPage.current_step,
                        status: newPage.status,
                        check_progress: newPage.check_progress,
                      }
                    : p,
                ),
              }
            })
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "findings",
          filter: `run_id=eq.${runId}`,
        },
        () => {
          // When a new finding is added, refresh the findings list
          queryClient.invalidateQueries({ queryKey: ["findings"] })
          queryClient.invalidateQueries({ queryKey: ["run-findings", runId] })
        },
      )
      .subscribe((status) => {
        console.log(`Supabase Realtime status for run ${runId}:`, status)
        if (status === "SUBSCRIBED") {
          setIsConnected(true)
        } else if (status === "CHANNEL_ERROR") {
          setIsConnected(false)
          console.error(`Supabase Realtime error for run ${runId}:`, status)
        } else if (status === "CLOSED") {
          setIsConnected(false)
          console.log(`Supabase Realtime closed for run ${runId}:`, status)
        }
      })
    let progressDebounceTimer: ReturnType<typeof setTimeout> | null = null

    // 2. Subscribe to custom broadcast channel for progress events
    const broadcastChannel = supabase
      .channel(`run:${runId}`)
      .on("broadcast", { event: "progress" }, (payload) => {
        console.log("Granular progress broadcast received:", payload)
        
        if (
          payload.payload?.status === "done" ||
          payload.payload?.status === "failed"
        ) {
          window.dispatchEvent(new CustomEvent("run-progress-done"))
        }
        
        // Debounce: when many pages finish at once, batch invalidations to avoid 429s
        if (progressDebounceTimer) clearTimeout(progressDebounceTimer)
        progressDebounceTimer = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["run", runId] })
          queryClient.invalidateQueries({ queryKey: ["findings"] })
          queryClient.invalidateQueries({ queryKey: ["run-findings", runId] })
        }, 2000)
      })
      .on("broadcast", { event: "page_progress" }, (payload) => {
        console.log("Per-page progress broadcast received:", payload)
      })
      .subscribe()

    return () => {
      if (progressDebounceTimer) clearTimeout(progressDebounceTimer)
      runChannel.unsubscribe()
      broadcastChannel.unsubscribe()
    }
  }, [runId, queryClient])

  return { isConnected }
}
