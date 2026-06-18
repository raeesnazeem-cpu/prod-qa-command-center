import React from "react"
import {
  MonitorSmartphone,
  Square,
  CheckSquare,
  Check,
  ClipboardList,
  Eye,
  Sparkles,
  Sparkle,
  Unlink2,
  RefreshCw,
} from "lucide-react"
import { useParams, Link } from "react-router-dom"
import { useRole } from "../hooks/useRole"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { QAFinding } from "../api/runs.api"
import { useGalleryStore } from "../store/galleryStore"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useAiResultsStore } from "../store/aiResultsStore"
import { useBulkDeleteTasks } from "../hooks/useTasks"

interface FindingCardProps {
  finding: QAFinding
  onConfirm?: (id: string) => void
  onFalsePositive?: (id: string) => void
  onCreateTask?: (finding: QAFinding) => void
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  assignedTaskIds?: string[]
  assignedUsers?: any[]
  isAssigned?: boolean
}

export const SocialShareHeadingFindingCard: React.FC<FindingCardProps> = ({
  finding,
  onConfirm,
  onFalsePositive,
  onCreateTask,
  isSelected,
  onToggleSelect,
  assignedTaskIds = [],
  assignedUsers = [],
  isAssigned = false,
}) => {
  const { id: projectId } = useParams<{ id: string }>()
  const { canDo } = useRole()
  const setAiResult = useAiResultsStore((state) => state.setAiResult)

  const canAction = canDo("qa_engineer")
  const { mutate: bulkDeleteTasks, isPending: isDeleting } =
    useBulkDeleteTasks()

  const { galleryImages: allGalleryImages } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const initialIsPushed =
    finding.status === "confirmed" &&
    (!!(finding as any).basecamp_comment_url ||
      !!(finding as any).basecamp_comment_id)
  const [isManuallyVerified, setIsManuallyVerified] =
    React.useState(initialIsPushed)

  // AI states
  const [isAiModalOpen, setIsAiModalOpen] = React.useState(false)
  const [isAiLoading, setIsAiLoading] = React.useState(false)
  const [aiResultData, setAiResultData] = React.useState<any>(() => {
    try {
      const cached = sessionStorage.getItem(`aiResult_${finding.id}`)
      if (cached) return JSON.parse(cached)
      if (finding.context_text) {
        const parsed = JSON.parse(finding.context_text)
        return parsed.aiResultData || null
      }
    } catch (e) {}
    return null
  })

  const api = useAuthAxios()
  const [isPushing, setIsPushing] = React.useState(false)
  const [isPushed, setIsPushed] = React.useState(initialIsPushed)

  const [isDeletingPush, setIsDeletingPush] = React.useState(false)
  const [deleteModalAction, setDeleteModalAction] = React.useState<
    "unverify" | "unlink_check" | "unlink_uncheck" | null
  >(null)

  const [commentUrl, setCommentUrl] = React.useState<string | null>(
    finding.status === "confirmed"
      ? (finding as any).basecamp_comment_url || null
      : null,
  )

  const getAiResultsText = (data: any) => {
    if (!data || data.status === "error") return ""
    const formatStatus = (s?: string) =>
      s === "verified" ? "Verified ✓" : "Not verified ✗"

    let text = "\n\n🤖 AI Verification Results:\n"
    if (data.socialShareHeadings) {
      text += "\nSocial Share Headings:\n"
      text += `- Facebook: ${formatStatus(data.socialShareHeadings.facebook)}\n`
      text += `- Google: ${formatStatus(data.socialShareHeadings.google)}\n`
      text += `- X(Twitter): ${formatStatus(data.socialShareHeadings.twitter)}\n`
      text += `- LinkedIn: ${formatStatus(data.socialShareHeadings.linkedin)}\n`
    }
    if (data.socialShareImages) {
      text += "\nSocial Share Images:\n"
      text += `- Facebook: ${formatStatus(data.socialShareImages.facebook)}\n`
      text += `- Google: ${formatStatus(data.socialShareImages.google)}\n`
      text += `- X(Twitter): ${formatStatus(data.socialShareImages.twitter)}\n`
      text += `- LinkedIn: ${formatStatus(data.socialShareImages.linkedin)}\n`
    }
    if (data.socialMediaTags) {
      text += "\nSocial Media Tags:\n"
      text += `- Facebook: ${formatStatus(data.socialMediaTags.facebook)}\n`
      text += `- Google: ${formatStatus(data.socialMediaTags.google)}\n`
      text += `- X(Twitter): ${formatStatus(data.socialMediaTags.twitter)}\n`
      text += `- LinkedIn: ${formatStatus(data.socialMediaTags.linkedin)}\n`
    }
    return text
  }

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const response = await api.post(
        `/api/findings/${finding.id}/push-basecamp`,
        {
          aiResultsText: getAiResultsText(aiResultData),
        },
      )
      if (response.data.commentUrl) setCommentUrl(response.data.commentUrl)
      setIsPushed(true)
      if (onConfirm) onConfirm(finding.id)
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to push finding to Basecamp.")
    } finally {
      setIsPushing(false)
    }
  }

  const handleDeletePush = async (clearAiResults: boolean = false) => {
    setIsDeletingPush(true)
    try {
      await api.delete(`/api/findings/${finding.id}/delete-basecamp-push`)
      setIsPushed(false)

      const patchData: any = {
        basecamp_comment_id: null,
        basecamp_comment_url: null,
      }

      if (clearAiResults) {
        setAiResultData(null)
        sessionStorage.removeItem(`aiResult_${finding.id}`)
        patchData.context_text = JSON.stringify({ aiResultData: null })
      }

      try {
        await api.patch(`/api/findings/${finding.id}`, patchData)
      } catch (e) {
        console.error("Failed to clear state from DB", e)
      }

      return true
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to delete Basecamp push.")
      return false
    } finally {
      setIsDeletingPush(false)
    }
  }

  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  const isLocked = hasTask || isAssigned || isPushed

  const cardBorder = isLocked
    ? "border-emerald-500 ring-1 ring-emerald-500/20"
    : isFalsePositive
      ? "opacity-60 border-slate-200 dark:border-slate-800"
      : "border-slate-200 dark:border-slate-800 hover:border-accent/40"

  const screenshotUrls = finding.screenshot_url
    ? finding.screenshot_url
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean)
    : []

  const handleRunAiCheck = async (
    forceRetry: boolean | React.MouseEvent = false,
  ) => {
    const isForce = forceRetry === true
    setIsAiModalOpen(true)
    if (aiResultData && !isForce) return
    setIsAiLoading(true)

    try {
      const response = await api.post("/api/runs/verify-social-share-ai", {
        screenshotUrls: screenshotUrls,
      })
      setAiResultData(response.data)
      setAiResult(finding.id, getAiResultsText(response.data))
      sessionStorage.setItem(
        `aiResult_${finding.id}`,
        JSON.stringify(response.data),
      )

      try {
        await api.patch(`/api/findings/${finding.id}`, {
          context_text: JSON.stringify({ aiResultData: response.data }),
        })
      } catch (err) {
        console.error("Failed to save AI results:", err)
      }
    } catch (error) {
      console.error("AI check failed:", error)
      setAiResultData({
        status: "error",
        message: "Failed to connect to AI server. Please try again.",
      })
    } finally {
      setIsAiLoading(false)
    }
  }

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${cardBorder}`}
    >
      <div
        className="hidden dark:block absolute inset-0 rounded-md pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
        style={{
          WebkitMask:
            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white via-accent/30 to-white/30 group-hover:opacity-50 transition-opacity duration-700" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300%] aspect-square bg-[conic-gradient(from_0deg,transparent_0_45deg,theme(colors.accent)_135deg,transparent_180deg_225deg,#a3d4c7_315deg,transparent_360deg)] opacity-0 group-hover:opacity-100 group-hover:animate-[spin_4s_linear_infinite]" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {canAction && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelect?.(finding.id)
              }}
              className={`p-1 rounded transition-all ${isSelected ? "text-black scale-110" : "text-slate-300 hover:text-slate-400"}`}
            >
              {isSelected ? (
                <div className="flex items-center h-5 mr-3">
                  <input
                    type="checkbox"
                    name="enabled_checks"
                    className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent accent-accent"
                    value="accessibility"
                    autoComplete="new-password"
                    data-form-type="other"
                    checked
                    readOnly
                  />
                </div>
              ) : (
                <Square size={20} strokeWidth={2} />
              )}
            </button>
          )}
          <FindingSeverityEditor
            findingId={finding.id}
            pageId={finding.page_id}
            currentSeverity={finding.severity}
            canEdit={canAction && !isFalsePositive && !isLocked}
            symbolOnly={true}
          />
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
            <MonitorSmartphone size={14} className="text-accent" />
            Social Share Heading Check
          </div>
        </div>
      </div>

      {canAction && (
        <div className="relative group/input">
          <input
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            readOnly={isLocked}
            className={`w-full px-4 py-3.5 bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-600 rounded-md font-bold text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500 ${isLocked ? "pointer-events-none" : ""}`}
            placeholder="Social Share Heading Check Title"
          />
        </div>
      )}

      <div className="space-y-3">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed break-words">
          {finding.description}
        </p>
      </div>

      {screenshotUrls.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-start justify-between w-full">
            <div className="w-[50%] flex">
              {screenshotUrls.slice(0, 4).map((url, idx) => (
                <div key={url} className="space-y-1 w-1/16 gap-1 flex-shrink-0">
                  <div className="w-full">
                    <FindingCardWithScreenshot
                      finding={{ ...finding, screenshot_url: url }}
                      pageScreenshots={{}}
                      hideTabs={true}
                    />
                  </div>
                  <p
                    className="font-bold text-slate-400 uppercase tracking-widest text-center text-[8px] truncate px-1"
                    title={
                      idx === 0
                        ? "Facebook"
                        : idx === 1
                          ? "X"
                          : idx === 2
                            ? "LinkedIn"
                            : "Meta Tags"
                    }
                  >
                    {idx === 0
                      ? "Facebook"
                      : idx === 1
                        ? "X"
                        : idx === 2
                          ? "LinkedIn"
                          : "Meta Tags"}
                  </p>
                </div>
              ))}
            </div>

            <div className="w-[25%] flex flex-col gap-2 pl-4 border-l border-slate-100 dark:border-slate-700/50 ml-5">
              <label className="flex items-center gap-2 group/cb">
                <input
                  type="checkbox"
                  checked={isManuallyVerified}
                  onChange={(e) => {
                    const checked = e.target.checked
                    if (hasTask || isAssigned) {
                      setDeleteModalAction(
                        checked ? "unlink_check" : "unlink_uncheck",
                      )
                    } else if (!checked && isPushed) {
                      setDeleteModalAction("unverify")
                    } else {
                      setIsManuallyVerified(checked)
                    }
                  }}
                  className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer transition-all"
                />
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer truncate">
                  {isManuallyVerified ? "Title Verified" : "Verify Title"}
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {canAction && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-auto">
          <div className="flex items-center gap-2">
            {isFalsePositive ? (
              <button
                onClick={() => onConfirm?.(finding.id)}
                className="btn-unified"
              >
                Re-flag as genuine
              </button>
            ) : (
              <>
                {/* {isManuallyVerified && (
                  <button
                    onClick={handlePushToBasecamp}
                    disabled={isPushing || isPushed}
                    className={`btn-unified px-3 flex items-center justify-center transition-all active:scale-95 ${isPushed ? "bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default" : "bg-[#0b1016] hover:bg-slate-800 text-white"}`}
                  >
                    {isPushing ? (
                      <span className="text-[11px] font-bold px-1">...</span>
                    ) : isPushed ? (
                      <>
                        <span className="text-slate">Success </span>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 35 30"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                          className="pl-1"
                        >
                          <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                        </svg>
                      </>
                    ) : (
                      <>
                        <span className="text-white">Push to </span>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 35 30"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                          className="pl-1"
                        >
                          <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                        </svg>
                      </>
                    )}
                  </button>
                )} */}

                {isManuallyVerified && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isPushed && commentUrl) {
                          window.open(
                            commentUrl,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        } else if (!isPushed) {
                          handlePushToBasecamp()
                        }
                      }}
                      disabled={isPushing}
                      className={`btn-unified px-3 flex items-center justify-center transition-all ${isPushed ? "bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-200 cursor-pointer" : "bg-[#0b1016] hover:bg-slate-800 text-white active:scale-95"}`}
                      title={isPushed ? "View in Basecamp" : "Push to Basecamp"}
                    >
                      {isPushing ? (
                        <span className="text-[11px] font-bold px-1">...</span>
                      ) : isPushed ? (
                        <>
                          <span className="text-slate">Success </span>
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 35 30"
                            fill="currentColor"
                            xmlns="http://www.w3.org/2000/svg"
                            className="pl-1"
                          >
                            <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                          </svg>
                        </>
                      ) : (
                        <>
                          <span>Push to </span>
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 35 30"
                            fill="currentColor"
                            xmlns="http://www.w3.org/2000/svg"
                            className="pl-1"
                          >
                            <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                          </svg>
                        </>
                      )}
                    </button>

                    {isPushed && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeletePush()
                        }}
                        disabled={isDeletingPush}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                        title="Delete from Basecamp"
                      >
                        {isDeletingPush ? (
                          <span className="text-[10px] uppercase font-bold animate-pulse">
                            ...
                          </span>
                        ) : (
                          <div className="flex items-center justify-center gap-1 text-slate-600 dark:text-slate-200 hover:text-red-500 dark:hover:text-red-500 transition-colors">
                            <span className="text-[8px] font-semibold">
                              Remove from{""}
                            </span>
                            <span>
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 35 30"
                                fill="currentColor"
                                xmlns="http://www.w3.org/2000/svg"
                                className=""
                              >
                                <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                              </svg>
                            </span>
                          </div>
                        )}
                      </button>
                    )}
                  </div>
                )}

                <a
                  href={
                    finding.pages?.url
                      ? `https://socialsharepreview.com/?url=${encodeURIComponent(finding.pages.url)}`
                      : "https://socialsharepreview.com/"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-unified flex items-center gap-2 bg-[#0b1016] hover:bg-slate-800 text-white"
                  title="See in monitor"
                >
                  <span className="text-[11px]">See in </span>
                  <span>
                    <MonitorSmartphone size={14} />
                  </span>
                </a>
                {!isManuallyVerified && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        onCreateTask?.({
                          ...finding,
                          title: localTitle,
                          description:
                            (finding.description || "") +
                            (aiResultData
                              ? getAiResultsText(aiResultData)
                              : ""),
                          gallery_images: Array.from(
                            new Set([...galleryImages, ...screenshotUrls]),
                          ),
                        })
                      }
                      disabled={hasTask || isAssigned}
                      className={`btn-unified ${hasTask || isAssigned ? "bg-accent text-white cursor-not-allowed" : ""}`}
                    >
                      {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
                    </button>

                    {(hasTask || isAssigned) &&
                      (() => {
                        const activeTaskIds =
                          assignedTaskIds && assignedTaskIds.length > 0
                            ? assignedTaskIds
                            : finding.tasks?.map((t: any) => t.id) || []

                        if (
                          activeTaskIds.length === 0 ||
                          activeTaskIds[0] === finding.id
                        )
                          return null

                        return (
                          <div className="ml-1 flex items-center gap-1">
                            <Link
                              to={`/projects/${projectId}?tab=tasks&taskId=${activeTaskIds[0]}`}
                              target="_blank"
                              className="text-slate-400 hover:text-accent transition-colors"
                              title="View Task"
                            >
                              <Eye size={14} />
                            </Link>
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                bulkDeleteTasks(activeTaskIds)
                              }}
                              disabled={isDeleting}
                              className="ml-1 text-slate-400 hover:text-red-500 transition-colors"
                              title="Unlink Task"
                            >
                              <Unlink2 size={16} />
                            </button>
                          </div>
                        )
                      })()}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {assignedUsers && assignedUsers.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-[#131d22] border border-slate-100 dark:border-slate-700 p-1.5 rounded-full pl-3 pr-2">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                  Assigned
                </span>
                <div className="flex -space-x-1.5 overflow-hidden">
                  {assignedUsers.map((u, idx) => (
                    <div
                      key={u.id || idx}
                      className="w-6 h-6 rounded-full bg-slate-200 dark:bg-[#1d2a31] border-2 border-white dark:border-[#1D2A31] flex items-center justify-center text-[8px] font-bold text-slate-500 dark:text-slate-300 relative group/avatar"
                    >
                      {u.avatar_url ? (
                        <img
                          src={u.avatar_url}
                          alt={u.full_name || ""}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        u.full_name?.[0] || ""
                      )}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 group-hover/avatar:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                        {u.full_name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!aiResultData && !isPushed && (
              <button
                onClick={handleRunAiCheck}
                title="Run AI Check on Social Share Screenshots"
                className="p-1.5 rounded-md bg-transparent text-white hover:text-blue-500 transition-all flex items-center justify-center shadow-sm"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-sparkles"
                >
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>
                  <path d="M5 3v4"></path>
                  <path d="M19 17v4"></path>
                  <path d="M3 5h4"></path>
                  <path d="M17 19h4"></path>
                </svg>
              </button>
            )}

            {aiResultData && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAiModalOpen(true)}
                  className="text-xs font-semibold text-sky-400 hover:text-sky-500 tracking-wide"
                >
                  <span className="flex items-center gap-1">
                    <Sparkle size={14} />
                    <span>AI RESULTS</span>
                  </span>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (isPushed) {
                      const proceed = window.confirm(
                        "This finding is already pushed to Basecamp. Retrying the AI check will remove the current Basecamp comment. Do you want to continue?",
                      )
                      if (proceed) {
                        const success = await handleDeletePush()
                        if (success) handleRunAiCheck(true)
                      }
                    } else {
                      handleRunAiCheck(true)
                    }
                  }}
                  disabled={isAiLoading}
                  className="p-1 text-slate-400 hover:text-sky-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Retry AI Check"
                >
                  <RefreshCw
                    size={12}
                    className={isAiLoading ? "animate-spin" : ""}
                  />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Smart Results Modal */}
      {isAiModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAiModalOpen(false)
          }}
        >
          <div className="bg-slate-50 dark:bg-[#1D2A31] w-full max-w-xl rounded-md shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-widest flex items-center gap-2">
                <Sparkles size={16} className="text-sky-400" /> AI Social Share
                Verification
              </h3>
              <button
                onClick={() => setIsAiModalOpen(false)}
                className="text-[10px] font-bold px-3 py-1.5 text-slate-500 uppercase bg-white border rounded"
              >
                Close
              </button>
            </div>
            <div className="p-6">
              {isAiLoading ? (
                <div className="flex flex-col items-center py-12 space-y-4">
                  <Sparkles size={32} className="text-sky-400 animate-pulse" />
                  <p className="text-sm text-slate-500">
                    AI is reviewing the screenshots...
                  </p>
                </div>
              ) : (
                aiResultData && (
                  <div className="space-y-6">
                    {aiResultData.status === "error" ? (
                      <div className="bg-red-50 p-4 rounded border border-red-100">
                        <p className="text-sm font-bold text-red-600">
                          {aiResultData.message}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded border border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">
                            Social share headings
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <p className="text-slate-600 dark:text-slate-400">
                              Facebook:{" "}
                              <span
                                className={
                                  aiResultData.socialShareHeadings?.facebook ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareHeadings?.facebook ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              google:{" "}
                              <span
                                className={
                                  aiResultData.socialShareHeadings?.google ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareHeadings?.google ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              X(Twitter):{" "}
                              <span
                                className={
                                  aiResultData.socialShareHeadings?.twitter ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareHeadings?.twitter ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              Linkedin:{" "}
                              <span
                                className={
                                  aiResultData.socialShareHeadings?.linkedin ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareHeadings?.linkedin ||
                                  "not verified"}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded border border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">
                            Social share Images
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <p className="text-slate-600 dark:text-slate-400">
                              Facebook:{" "}
                              <span
                                className={
                                  aiResultData.socialShareImages?.facebook ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareImages?.facebook ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              google:{" "}
                              <span
                                className={
                                  aiResultData.socialShareImages?.google ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareImages?.google ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              X(Twitter):{" "}
                              <span
                                className={
                                  aiResultData.socialShareImages?.twitter ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareImages?.twitter ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              Linkedin:{" "}
                              <span
                                className={
                                  aiResultData.socialShareImages?.linkedin ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareImages?.linkedin ||
                                  "not verified"}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded border border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">
                            Social media tags in page source
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <p className="text-slate-600 dark:text-slate-400">
                              Facebook:{" "}
                              <span
                                className={
                                  aiResultData.socialMediaTags?.facebook ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialMediaTags?.facebook ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              google:{" "}
                              <span
                                className={
                                  aiResultData.socialMediaTags?.google ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialMediaTags?.google ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              X(Twitter):{" "}
                              <span
                                className={
                                  aiResultData.socialMediaTags?.twitter ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialMediaTags?.twitter ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              Linkedin:{" "}
                              <span
                                className={
                                  aiResultData.socialMediaTags?.linkedin ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialMediaTags?.linkedin ||
                                  "not verified"}
                              </span>
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
      {deleteModalAction && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteModalAction(null)
          }}
        >
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            {deleteModalAction === "unverify" ? (
              <>
                <div className="p-4 border-b border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                    Confirm Deletion
                  </h3>
                </div>
                <div className="p-4 space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    This finding is already pushed to Basecamp. Unverifying will
                    remove the current Basecamp comment. What would you like to
                    do?
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      disabled={isDeletingPush}
                      onClick={async () => {
                        const success = await handleDeletePush(false)
                        if (success) setIsManuallyVerified(false)
                        setDeleteModalAction(null)
                      }}
                      className="w-full px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors disabled:opacity-50 flex justify-center"
                    >
                      {isDeletingPush ? "Deleting..." : "Delete Comment Only"}
                    </button>
                    <button
                      disabled={isDeletingPush}
                      onClick={async () => {
                        const success = await handleDeletePush(true)
                        if (success) setIsManuallyVerified(false)
                        setDeleteModalAction(null)
                      }}
                      className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50 flex justify-center"
                    >
                      {isDeletingPush
                        ? "Deleting..."
                        : "Delete Comment & AI Results"}
                    </button>
                    <button
                      disabled={isDeletingPush}
                      onClick={() => setDeleteModalAction(null)}
                      className="w-full px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="p-4 border-b border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                    Unlink Task
                  </h3>
                </div>
                <div className="p-4 space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    This finding is currently linked to a task. Changing its
                    status will unlink the task. Do you wish to proceed?
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      disabled={isDeleting}
                      onClick={() => {
                        const taskIds =
                          assignedTaskIds && assignedTaskIds.length > 0
                            ? assignedTaskIds
                            : finding.tasks?.map((t: any) => t.id) || []
                        if (taskIds.length > 0) {
                          bulkDeleteTasks(taskIds)
                        }
                        const action = deleteModalAction

                        setDeleteModalAction(null)

                        if (action === "unlink_uncheck" && isPushed) {
                          setTimeout(() => setDeleteModalAction("unverify"), 10)
                        } else {
                          setIsManuallyVerified(action === "unlink_check")
                        }
                      }}
                      className="w-full px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-md transition-colors disabled:opacity-50 flex justify-center"
                    >
                      Proceed & Unlink Task
                    </button>
                    <button
                      disabled={isDeleting}
                      onClick={() => setDeleteModalAction(null)}
                      className="w-full px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
