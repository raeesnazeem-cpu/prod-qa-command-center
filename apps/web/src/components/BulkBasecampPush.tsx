import { useState } from "react"
import { ExternalLink, Loader2, CheckCircle2, X } from "lucide-react"
import { useAuthAxios } from "../lib/useAuthAxios"
import {
  pushToBasecamp,
  bulkPushToBasecamp,
  bulkPushCommentsToBasecamp,
} from "../api/tasks.api"
import { useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { CanDo } from "./CanDo"

interface BulkBasecampPushProps {
  taskIds: string[]
  onComplete?: () => void
  mode?: "todo" | "comment"
}

export const BulkBasecampPush = ({
  taskIds,
  onComplete,
  mode = "todo",
}: BulkBasecampPushProps) => {
  const axios = useAuthAxios()
  const queryClient = useQueryClient()
  const [isPushing, setIsPushing] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [pushedCount, setPushedCount] = useState(0)
  const [selectedStatus, setSelectedStatus] = useState<"pending" | "completed">(
    "pending",
  )

  const handleButtonClick = () => {
    if (mode === "comment") {
      setIsModalOpen(true)
    } else {
      handleBulkPush()
    }
  }

  const handleBulkPush = async () => {
    if (taskIds.length === 0) return

    setIsPushing(true)
    setCurrentIndex(0)
    setPushedCount(0)

    try {
      const result = await bulkPushToBasecamp(axios, taskIds)
      setPushedCount(result.count)

      toast.success(
        (t) => (
          <div className="flex items-center space-x-3">
            <div className="flex flex-col">
              <span className="font-bold text-sm">
                {result.count} tasks pushed to Basecamp
              </span>
              <a
                href={result.basecampUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#F97316] hover:underline flex items-center mt-1"
                onClick={() => toast.dismiss(t.id)}
              >
                View To-do <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>
          </div>
        ),
        {
          position: "bottom-left",
          duration: 5000,
        },
      )
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      onComplete?.()
    } catch (error: any) {
      console.error(`Failed to push tasks:`, error)
      toast.error(
        `Failed to push tasks: ${error.response?.data?.error || error.message}`,
      )
    } finally {
      setIsPushing(false)
    }
  }

  const handleConfirmCommentPush = async () => {
    if (taskIds.length === 0) return

    setIsPushing(true)
    try {
      const result = await bulkPushCommentsToBasecamp(
        axios,
        taskIds,
        selectedStatus,
      )
      toast.success(`Pushed ${result.count} updates to Basecamp as comments.`)
      if (result.skipped > 0) {
        toast.error(
          `${result.skipped} tasks were skipped as they are not synced with Basecamp yet.`,
          { duration: 4000 },
        )
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      setIsModalOpen(false)
      onComplete?.()
    } catch (error: any) {
      console.error(`Failed to push comments:`, error)
      toast.error(
        `Failed to push comments: ${error.response?.data?.error || error.message}`,
      )
    } finally {
      setIsPushing(false)
    }
  }

  if (taskIds.length === 0) return null

  return (
    <>
      <CanDo role="qa_engineer">
        <button
          onClick={handleButtonClick}
          disabled={isPushing}
          className={`inline-flex items-center space-x-2 px-4 py-2 rounded-md font-bold text-sm transition-all shadow-sm active:scale-95 disabled:opacity-70 ${
            isPushing
              ? "bg-slate-100 dark:bg-[#1d2a31] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-[#131d22]"
              : "bg-[#F97316] dark:bg-[#EA580C] text-white hover:bg-[#EA580C] dark:hover:bg-[#C2410C]"
          }`}
        >
          {isPushing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {mode === "comment"
                  ? "Pushing comments..."
                  : `Pushing ${currentIndex} of ${taskIds.length}...`}
              </span>
            </>
          ) : pushedCount > 0 && !isPushing && mode === "todo" ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>{pushedCount} tasks pushed to Basecamp</span>
            </>
          ) : (
            <>
              <span>Push {taskIds.length} to </span>
              <svg width="18" height="18" viewBox="0 0 35 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="pl-1"><path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path></svg>
            </>
          )}
        </button>
      </CanDo>

      {/* Status Selection Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="absolute inset-0"
            onClick={() => !isPushing && setIsModalOpen(false)}
          />
          <div className="relative w-full max-w-sm bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-[#1d2a31] rounded-[12px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-[#1d2a31] bg-slate-50/50 dark:bg-[#1d2a31]/50 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-lg tracking-tight">
                  Select Status
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-0.5">
                  Basecamp Comment Workflow
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                disabled={isPushing}
                className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-8">
              <div className="flex justify-center items-center gap-6">
                <button
                  onClick={() => setSelectedStatus("pending")}
                  disabled={isPushing}
                  className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all group ${
                    selectedStatus === "pending"
                      ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 shadow-md scale-105"
                      : "bg-slate-50 dark:bg-[#1d2a31] border-slate-100 dark:border-[#1d2a31] hover:border-slate-200 dark:hover:border-slate-700 grayscale opacity-60"
                  }`}
                >
                  <div
                    className={`p-2 rounded-lg ${selectedStatus === "pending" ? "bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400" : "bg-slate-50 dark:bg-[#131d22] text-slate-400 dark:text-slate-500"}`}
                  >
                    <Loader2
                      className={`w-5 h-5 ${selectedStatus === "pending" && !isPushing ? "animate-pulse" : ""}`}
                    />
                  </div>
                  <span
                    className={`text-[11px] font-bold uppercase tracking-widest ${selectedStatus === "pending" ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500"}`}
                  >
                    Pending
                  </span>
                </button>

                <button
                  onClick={() => setSelectedStatus("completed")}
                  disabled={isPushing}
                  className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all group ${
                    selectedStatus === "completed"
                      ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 shadow-md scale-105"
                      : "bg-slate-50 dark:bg-[#1d2a31] border-slate-100 dark:border-[#1d2a31] hover:border-slate-200 dark:hover:border-slate-700 grayscale opacity-60"
                  }`}
                >
                  <div
                    className={`p-2 rounded-lg ${selectedStatus === "completed" ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400" : "bg-slate-50 dark:bg-[#131d22] text-slate-400 dark:text-slate-500"}`}
                  >
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <span
                    className={`text-[11px] font-bold uppercase tracking-widest ${selectedStatus === "completed" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}`}
                  >
                    Completed
                  </span>
                </button>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleConfirmCommentPush}
                  disabled={isPushing}
                  className="w-full btn-unified flex items-center justify-center space-x-2 py-3"
                >
                  {isPushing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Pushing Updates...</span>
                    </>
                  ) : (
                    <>
                      <span>Push to </span>
                      <svg width="18" height="18" viewBox="0 0 35 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="pl-1"><path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path></svg>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setIsModalOpen(false)}
                  disabled={isPushing}
                  className="w-full py-2 text-xs font-bold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
