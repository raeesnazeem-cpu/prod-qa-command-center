import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { QARun } from "../api/runs.api"

export const useRunRealtime = (runId: string) => {
  const queryClient = useQueryClient()
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!runId) return

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
          // Instead of manually updating with partial data (which lacks Joined fields like 'pages'),
          // we invalidate to trigger a clean fetch from the API.
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
