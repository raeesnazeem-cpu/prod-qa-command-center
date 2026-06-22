import React from "react"
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  Plus,
  FileSearch,
  Globe,
  Square,
  CheckSquare,
  ClipboardList,
  Sparkles,
  Sparkle,
  Eye,
  Unlink2,
  RefreshCw,
} from "lucide-react"

import { useQueryClient } from "@tanstack/react-query"
import { useBulkDeleteTasks } from "../hooks/useTasks"
import { useRole } from "../hooks/useRole"
import { useParams, Link } from "react-router-dom"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { QAFinding } from "../api/runs.api"
import { useGalleryStore } from "../store/galleryStore"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useAiResultsStore } from "../store/aiResultsStore"

interface FindingCardProps {
  finding: QAFinding
  pageScreenshots?: {
    desktop?: string | null
    tablet?: string | null
    mobile?: string | null
  }
  onConfirm?: (id: string) => void
  onFalsePositive?: (id: string) => void
  onCreateTask?: (finding: QAFinding) => void
  onAssign?: (id: string) => void
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  assignedTaskIds?: string[]
  assignedUsers?: any[]
  isAssigned?: boolean
}

interface UrlEntry {
  url: string
  title: string
}

interface CompareData {
  devPages: UrlEntry[]
  livePages: UrlEntry[]
}

function parseContextData(contextText: string | null | undefined): CompareData {
  if (!contextText) return { devPages: [], livePages: [] }
  try {
    return JSON.parse(contextText)
  } catch {
    return { devPages: [], livePages: [] }
  }
}

function getPathname(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/"
  } catch {
    return url
  }
}

export const UrlTabCompareFindingCard: React.FC<FindingCardProps> = ({
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
  const queryClient = useQueryClient()
  const { mutate: bulkDeleteTasks, isPending: isDeleting } =
    useBulkDeleteTasks()

  const axios = useAuthAxios()
  const { galleryImages: allGalleryImages } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isUrlModalOpen, setIsUrlModalOpen] = React.useState(false)
  const [isExpanded, setIsExpanded] = React.useState(false)

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

  const compareData = parseContextData(finding.context_text)
  const { devPages, livePages } = compareData

  const handleRunAiCheck = async (forceRetry: boolean | React.MouseEvent = false) => {
    const isForce = forceRetry === true
    setIsAiModalOpen(true)
    if (aiResultData && !isForce) return

    setIsAiLoading(true)

    try {
      const response = await axios.post("/api/runs/compare-urls-ai", {
        devPages: compareData?.devPages || [],
        livePages: compareData?.livePages || [],
      })

      const data = response.data

      setAiResultData(data)
      setAiResult(finding.id, getAiResultsText(data))
      sessionStorage.setItem(`aiResult_${finding.id}`, JSON.stringify(data))

      try {
        await axios.patch(`/api/findings/${finding.id}`, {
          context_text: JSON.stringify({
            ...compareData,
            aiResultData: data
          })
        })
      } catch (err) {
        console.error("Failed to save AI results to DB", err)
      }
    } catch (error) {
      console.error("AI check failed:", error)
      setAiResultData({
        status: "error",
        message: "Failed to connect to AI server. Please try again.",
        missingInDev: [],
        missingInLive: [],
      })
    } finally {
      setIsAiLoading(false)
    }
  }

  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  
  const currentAssignees =
    finding.tasks?.flatMap((t: any) => t.users ? [t.users] : []) || []
  const allAssigneesList = [...currentAssignees, ...assignedUsers].filter(
    (v, i, a) => a.findIndex((t) => (t.userId || t.id) === (v.userId || v.id)) === i,
  )

  const [isPushing, setIsPushing] = React.useState(false)
  const [isPushed, setIsPushed] = React.useState(
    finding.status === "confirmed"
      ? !!(finding as any).basecamp_comment_url
      : false,
  )
  const [commentUrl, setCommentUrl] = React.useState<string | null>(
    (finding as any).basecamp_comment_url || null,
  )
  const [isDeletingPush, setIsDeletingPush] = React.useState(false)
  const isLocked = hasTask || isAssigned || isPushed

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const tableRows = devPages
        .map((dev: any, i: number) => {
          const live = livePages[i]
          return `<tr><td style="padding: 8px; border: 1px solid #e2e8f0;">${dev?.url || ""}</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${dev?.title || ""}</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${live?.url || ""}</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${live?.title || ""}</td></tr>`
        })
        .join("")
      const tableHtml = `<br/><table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; margin-top: 10px;"><thead><tr style="background-color: #f8fafc;"><th style="padding: 8px; border: 1px solid #e2e8f0;">Dev URL</th><th style="padding: 8px; border: 1px solid #e2e8f0;">Dev Tab Name</th><th style="padding: 8px; border: 1px solid #e2e8f0;">Live URL</th><th style="padding: 8px; border: 1px solid #e2e8f0;">Live Tab Name</th></tr></thead><tbody>${tableRows}</tbody></table><br/>`
      const aiText = aiResultData ? getAiResultsText(aiResultData) : ""

      const response = await axios.post(
        `/api/findings/${finding.id}/push-basecamp`,
        {
          urlsTableHtml: tableHtml,
          aiResultsText: aiText,
        },
      )
      if (response.data.commentUrl) setCommentUrl(response.data.commentUrl)
      setIsPushed(true)
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to push finding to Basecamp.")
    } finally {
      setIsPushing(false)
    }
  }

  const handleDeletePush = async () => {
    setIsDeletingPush(true)
    try {
      await axios.delete(`/api/findings/${finding.id}/delete-basecamp-push`)
      setIsPushed(false)
      setCommentUrl(null)

      try {
        await axios.patch(`/api/findings/${finding.id}`, {
          basecamp_comment_id: null,
          basecamp_comment_url: null,
        })
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
  // Compute missing URLs
  const devPaths = devPages.map((p) => getPathname(p.url))
  const livePaths = livePages.map((p) => getPathname(p.url))

  const missingInDev = livePages.filter(
    (lp) => !devPaths.includes(getPathname(lp.url)),
  )
  const missingInLive = devPages.filter(
    (dp) => !livePaths.includes(getPathname(dp.url)),
  )

  const severityIcons: Record<string, React.ReactNode> = {
    critical: <ShieldAlert size={20} />,
    high: <AlertTriangle size={20} />,
    medium: <AlertCircle size={20} />,
    low: <Info size={20} />,
  }

  const cardBorder =
    isConfirmed || isAssigned
      ? "border-emerald-500 ring-1 ring-emerald-500/20"
      : isFalsePositive
        ? "opacity-60 border-slate-200 dark:border-slate-800"
        : "border-slate-200 dark:border-slate-800 hover:border-accent/40"

  const getAiResultsText = (data: any) => {
    if (!data || data.status === "error") return ""
    let text = "\n\n🤖 AI Smart Comparison Results:\n"
    if (data.missingInDev && data.missingInDev.length > 0) {
      text += "\nTruly Missing in Dev:\n"
      data.missingInDev.forEach((item: any) => {
        text += `- ${item.url} (${item.title}) — ${item.reason}\n`
      })
    }
    if (data.missingInLive && data.missingInLive.length > 0) {
      text += "\nTruly Missing in Live:\n"
      data.missingInLive.forEach((item: any) => {
        text += `- ${item.url} (${item.title}) — ${item.reason}\n`
      })
    }
    if (!data.missingInDev?.length && !data.missingInLive?.length) {
      text += "\nAll pages match contextually ✓\n"
    }
    return text
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
      {/* Top Row: Checkbox + Severity + Check Factor + Date */}
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
            <Globe size={14} className="text-accent" />
            URL & Tab Compare
          </div>
        </div>
      </div>

      {/* Title Input */}
      {canAction && (
        <div className="relative group/input">
          <input
            value={localTitle}
            onChange={(e) => {
              if (!isLocked) setLocalTitle(e.target.value)
            }}
            className="w-full px-4 py-3.5 bg-slate-50 dark:bg-[#131d22]/50 border border-slate-200 dark:border-slate-600 rounded-md font-bold text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500"
            placeholder="URL & Tab Name Comparison"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover/input:opacity-100 transition-opacity">
            <Plus size={14} className="text-slate-300" />
          </div>
        </div>
      )}

      {/* Description */}
      <div className="space-y-3">
        <p
          className={`text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed break-words ${isFalsePositive ? "text-slate-400" : ""} ${!isExpanded ? "line-clamp-3" : ""}`}
        >
          {finding.description}
        </p>
        {finding.description && finding.description.length > 150 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[9px] font-bold text-accent uppercase tracking-[0.2em] hover:text-black transition-colors"
          >
            {isExpanded ? "See less" : "See more"}
          </button>
        )}
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-[10px] font-bold text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800 uppercase">
          <Globe size={10} />
          {livePages.length} Live Site Pages
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 uppercase">
          <Globe size={10} />
          {devPages.length} Dev Site Pages
        </span>
        {missingInDev.length > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 dark:bg-red-900/20 text-[10px] font-bold text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800 uppercase">
            {missingInDev.length} Missing in Dev
          </span>
        )}
        {missingInLive.length > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800 uppercase">
            {missingInLive.length} Not in Live
          </span>
        )}
      </div>

      {/* Show URLs Area */}
      <div className="flex items-center gap-3 py-2">
        {/* The Original Show URLs Button */}
        <button
          onClick={() => setIsUrlModalOpen(true)}
          className="text-[9px] font-bold text-accent uppercase tracking-widest hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5"
        >
          <Globe size={12} />
          Show URLs
        </button>
      </div>

      {/* Action Footer */}
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
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {!(hasTask || isAssigned) && (
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
                    )}

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
                                width="12"
                                height="12"
                                viewBox="0 0 35 30"
                                fill="currentColor"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                              </svg>
                            </span>
                          </div>
                        )}
                      </button>
                    )}
                  </div>

                  {!isPushed && (
                    <>
                      <button
                        onClick={() => {
                          const tableRows = devPages
                            .map((dev: any, i: number) => {
                              const live = livePages[i]
                              return `<tr><td style="padding: 8px; border: 1px solid #e2e8f0;">${dev?.url || ""}</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${dev?.title || ""}</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${live?.url || ""}</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${live?.title || ""}</td></tr>`
                            })
                            .join("")
                          const tableHtml = `<br/><table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; margin-top: 10px;"><thead><tr style="background-color: #f8fafc;"><th style="padding: 8px; border: 1px solid #e2e8f0;">Dev URL</th><th style="padding: 8px; border: 1px solid #e2e8f0;">Dev Tab Name</th><th style="padding: 8px; border: 1px solid #e2e8f0;">Live URL</th><th style="padding: 8px; border: 1px solid #e2e8f0;">Live Tab Name</th></tr></thead><tbody>${tableRows}</tbody></table><br/>`
                          const aiHtml = aiResultData
                            ? `<br/><div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 16px;"><strong>${getAiResultsText(aiResultData).replace(/\n/g, "<br/>")}</strong></div>`
                            : ""

                          onCreateTask?.({
                            ...finding,
                            title: localTitle,
                            description:
                              (finding.description || "") + tableHtml + aiHtml,
                            gallery_images: finding.screenshot_url
                              ? Array.from(
                                  new Set([
                                    ...galleryImages,
                                    ...finding.screenshot_url
                                      .split(",")
                                      .map((s: string) => s.trim())
                                      .filter(Boolean),
                                  ]),
                                )
                              : galleryImages,
                          })
                        }}
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
                                  bulkDeleteTasks(activeTaskIds, {
                                    onSuccess: () => {
                                      queryClient.invalidateQueries()
                                    },
                                  })
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
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {allAssigneesList.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-[#131d22] border border-slate-100 dark:border-slate-700 p-1.5 rounded-full pl-3 pr-2">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                  Assigned
                </span>
                <div className="flex -space-x-1.5 overflow-hidden">
                  {allAssigneesList.map((u, idx) => (
                    <div
                      key={u.id || idx}
                      className="w-6 h-6 rounded-full bg-slate-200 dark:bg-[#1d2a31] border-2 border-white dark:border-[#1D2A31] flex items-center justify-center text-[8px] font-bold text-slate-500 dark:text-slate-300 relative group/avatar"
                    >
                      {u.avatar_url ? (
                        <img
                          src={u.avatar_url}
                          alt={u.full_name || u.name || ""}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        (u.full_name || u.name)?.[0]?.toUpperCase() || "U"
                      )}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 group-hover/avatar:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                        {u.full_name || u.name || "Assigned User"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!aiResultData && (
              <button
                onClick={handleRunAiCheck}
                title="Run AI Check on Plugins Screenshot"
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

      {/* Show URLs Modal */}
      {isUrlModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsUrlModalOpen(false)
          }}
        >
          <div className="bg-slate-50 dark:bg-[#1D2A31] w-full max-w-5xl rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-[#1D2A31] shrink-0">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-widest">
                  URL & Tab Name Comparison
                </h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight mt-1">
                  Client Live Site (Left) vs Our Dev Site (Right)
                </p>
              </div>
              <button
                onClick={() => setIsUrlModalOpen(false)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-[#1d2a31] rounded-xl transition-all active:scale-90"
              >
                <XCircle size={24} className="text-slate-400" />
              </button>
            </div>

            {/* Side-by-side columns */}
            <div className="flex flex-1 overflow-hidden min-h-0">
              {/* LEFT: Live Site */}
              <div className="flex-1 flex flex-col border-r dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b dark:border-slate-700 shrink-0">
                  <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                    Client Live Site — {livePages.length} pages
                  </p>
                </div>
                <div className="overflow-y-auto flex-1 p-3 space-y-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#93C0B1] [&::-webkit-scrollbar-track]:bg-transparent">
                  {livePages.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic p-4">
                      No pages collected
                    </p>
                  ) : (
                    livePages.map((entry, i) => {
                      const path = getPathname(entry.url)
                      const isMissingInDev = !devPaths.includes(path)
                      return (
                        <div
                          key={i}
                          className={`p-2 rounded border text-[10px] ${isMissingInDev ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30" : "bg-white dark:bg-[#131d22] border-slate-100 dark:border-slate-700"}`}
                        >
                          <p className="font-mono text-slate-700 dark:text-slate-300 break-all font-medium">
                            {path}
                          </p>
                          <p className="text-slate-400 mt-0.5 truncate">
                            Tab: {entry.title}
                          </p>
                          {isMissingInDev && (
                            <span className="text-[8px] font-bold text-red-500 uppercase mt-1 block">
                              ⚠ Missing in dev
                            </span>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* RIGHT: Dev Site */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 border-b dark:border-slate-700 shrink-0">
                  <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                    Dev / Project Site — {devPages.length} pages
                  </p>
                </div>
                <div className="overflow-y-auto flex-1 p-3 space-y-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#93C0B1] [&::-webkit-scrollbar-track]:bg-transparent">
                  {devPages.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic p-4">
                      No pages collected
                    </p>
                  ) : (
                    devPages.map((entry, i) => {
                      const path = getPathname(entry.url)
                      const isMissingInLive = !livePaths.includes(path)
                      return (
                        <div
                          key={i}
                          className={`p-2 rounded border text-[10px] ${isMissingInLive ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30" : "bg-white dark:bg-[#131d22] border-slate-100 dark:border-slate-700"}`}
                        >
                          <p className="font-mono text-slate-700 dark:text-slate-300 break-all font-medium">
                            {path}
                          </p>
                          <p className="text-slate-400 mt-0.5 truncate">
                            Tab: {entry.title}
                          </p>
                          {isMissingInLive && (
                            <span className="text-[8px] font-bold text-amber-500 uppercase mt-1 block">
                              ⚠ Not in live
                            </span>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 dark:bg-[#1D2A31] border-t dark:border-slate-700 flex justify-end shrink-0">
              <button
                onClick={() => setIsUrlModalOpen(false)}
                className="btn-unified"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Smart Results Modal */}
      {isAiModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAiModalOpen(false)
          }}
        >
          <div className="bg-slate-50 dark:bg-[#1D2A31] w-full max-w-3xl rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 border-b dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-[#1D2A31] shrink-0">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-widest flex items-center gap-2">
                <Sparkles size={16} className="text-sky-400" />
                AI Smart Comparison
              </h3>
              <button
                onClick={() => setIsAiModalOpen(false)}
                className="text-[10px] font-bold px-3 py-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors bg-white dark:bg-[#131d22] rounded border border-slate-200 dark:border-slate-700 uppercase"
              >
                Close
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto">
              {/* If the API is still fetching data, show a loading message */}
              {isAiLoading && (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Sparkles size={32} className="text-sky-400 animate-pulse" />
                  <p className="text-sm text-slate-500 font-medium tracking-wide">
                    AI is analyzing the URLs contextually. Please wait...
                  </p>
                </div>
              )}

              {/* If the data is ready, show the missing pages */}
              {!isAiLoading && aiResultData && (
                <div className="space-y-6">
                  {aiResultData.message && (
                    <p
                      className={`text-sm font-bold ${aiResultData.status === "error" ? "text-red-500" : "text-slate-700 dark:text-slate-300"}`}
                    >
                      {aiResultData.message}
                    </p>
                  )}

                  {/* Missing in Dev Section */}
                  {aiResultData.missingInDev &&
                    aiResultData.missingInDev.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-3">
                          Truly Missing in Dev Site
                        </h4>
                        <div className="space-y-2">
                          {aiResultData.missingInDev.map(
                            (item: any, index: number) => (
                              <div
                                key={index}
                                className="bg-red-50 dark:bg-red-900/10 p-3 rounded border border-red-100 dark:border-red-800/30"
                              >
                                <p className="text-xs font-mono text-slate-800 dark:text-slate-200 font-bold">
                                  {item.url}
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                                  Title: {item.title}
                                </p>
                                <p className="text-[11px] text-red-600 dark:text-red-400 mt-2 font-medium">
                                  AI Reason: {item.reason}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    )}

                  {/* Missing in Live Section */}
                  {aiResultData.missingInLive &&
                    aiResultData.missingInLive.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-3">
                          Truly Missing in Live Site
                        </h4>
                        <div className="space-y-2">
                          {aiResultData.missingInLive.map(
                            (item: any, index: number) => (
                              <div
                                key={index}
                                className="bg-amber-50 dark:bg-amber-900/10 p-3 rounded border border-amber-100 dark:border-amber-800/30"
                              >
                                <p className="text-xs font-mono text-slate-800 dark:text-slate-200 font-bold">
                                  {item.url}
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                                  Title: {item.title}
                                </p>
                                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 font-medium">
                                  AI Reason: {item.reason}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    )}

                  {/* What if AI found a perfect match for everything? */}
                  {aiResultData.status !== "error" &&
                    aiResultData.missingInDev?.length === 0 &&
                    aiResultData.missingInLive?.length === 0 && (
                      <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-green-200 dark:border-green-900/30 rounded-lg bg-green-50/50 dark:bg-green-900/10">
                        <p className="text-sm text-green-600 dark:text-green-400 font-bold tracking-wide">
                          Great news! AI found that all pages match
                          contextually.
                        </p>
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
