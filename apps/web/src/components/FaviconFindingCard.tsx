import React from "react"
import {
  Plus,
  FileSearch,
  CheckSquare,
  Square,
  MonitorSmartphone,
  ClipboardList,
  Eye,
  Unlink2,
  Sparkle,
  RefreshCw,
} from "lucide-react"
import toast from "react-hot-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useBulkDeleteTasks } from "../hooks/useTasks"
import { useRole } from "../hooks/useRole"
import { useProject } from "../hooks/useProjects"
import { useParams, Link } from "react-router-dom"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { QAFinding } from "../api/runs.api"
import { BrowserOverlay } from "./BrowserOverlay"
import { useGalleryStore } from "../store/galleryStore"
import { useAuthAxios } from "../lib/useAuthAxios"

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

export const FaviconFindingCard: React.FC<FindingCardProps> = ({
  finding,
  onConfirm,
  onCreateTask,
  isSelected,
  onToggleSelect,
  assignedTaskIds = [],
  assignedUsers = [],
  isAssigned = false,
}) => {
  const api = useAuthAxios()
  const { id: projectId } = useParams<{ id: string }>()
  const { data: project } = useProject(projectId || "")
  const { canDo } = useRole()
  const canAction = canDo("qa_engineer")
  const queryClient = useQueryClient()
  const { mutate: bulkDeleteTasks, isPending: isDeleting } =
    useBulkDeleteTasks()

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isBrowserOpen, setIsBrowserOpen] = React.useState(false)
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []
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

  const getAiResultsText = (data: any) => {
    if (!data || !data.faviconPresence) return ""
    return `Desktop: ${data.faviconPresence.desktop}\nTablet: ${data.faviconPresence.tablet}\nMobile: ${data.faviconPresence.mobile}\nSource Code: ${data.faviconPresence.sourceCode}`
  }

  const handleRunAiCheck = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()

    setIsAiLoading(true)
    try {
      const response = await api.post("/api/runs/verify-favicon-ai", {
        screenshotUrls: screenshotUrls,
      })
      if (response.data) {
        setAiResultData(response.data)
        sessionStorage.setItem(
          `aiResult_${finding.id}`,
          JSON.stringify(response.data),
        )
        try {
          await api.patch(`/api/findings/${finding.id}`, {
            context_text: JSON.stringify({ aiResultData: response.data }),
          })
        } catch (err) {
          console.error("Failed to save AI results to DB", err)
        }
        setIsAiModalOpen(true)
      }
    } catch (error) {
      console.error("Failed to run AI check:", error)
      toast.error("Failed to run AI verification")
    } finally {
      setIsAiLoading(false)
    }
  }

  const initialIsPushed =
    finding.status === "confirmed" &&
    (!!(finding as any).basecamp_comment_url ||
      !!(finding as any).basecamp_comment_id)

  const [isPushing, setIsPushing] = React.useState(false)
  const [isPushed, setIsPushed] = React.useState(initialIsPushed)

  const [isDeletingPush, setIsDeletingPush] = React.useState(false)
  const [commentUrl, setCommentUrl] = React.useState<string | null>(
    finding.status === "confirmed"
      ? (finding as any).basecamp_comment_url || null
      : null,
  )

  const [isVerified, setIsVerified] = React.useState(initialIsPushed)

  const handleDeletePush = async () => {
    setIsDeletingPush(true)
    try {
      await api.delete(`/api/findings/${finding.id}/delete-basecamp-push`)
      setIsPushed(false)

      const patchData: any = {
        basecamp_comment_id: null,
        basecamp_comment_url: null,
      }

      // If we wanted to clear AI results, we could do it here, but typically we keep them.
      // E.g. patchData.context_text = JSON.stringify({ aiResultData: null })

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

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  const isLocked = hasTask || isAssigned || isPushed

  const currentAssignees =
    finding.tasks?.flatMap((t: any) => t.users ? [t.users] : []) || []
  const allAssigneesList = [...currentAssignees, ...assignedUsers].filter(
    (v, i, a) => a.findIndex((t) => (t.userId || t.id) === (v.userId || v.id)) === i,
  )

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const assigneeNames = Array.from(
        new Set(
          allAssigneesList
            .map((u: any) =>
              `${u.first_name || ""} ${u.last_name || ""}`.trim(),
            )
            .filter(Boolean),
        ),
      ).join(", ")

      const payload = {
        isVerified,
        hasTask: hasTask || isAssigned,
        assigneeNames,
        aiResultsText: aiResultData
          ? getAiResultsText(aiResultData)
          : undefined,
      }

      const response = await api.post(
        `/api/findings/${finding.id}/push-basecamp`,
        payload,
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

  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  if (!canAction) return null

  const screenshotUrls = finding.screenshot_url
    ? finding.screenshot_url
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean)
    : []

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 relative overflow-hidden flex flex-col gap-6 ${isConfirmed || isAssigned ? "border-emerald-500 ring-1 ring-emerald-500/20" : isFalsePositive ? "opacity-60 border-slate-200 dark:border-slate-800" : "border-slate-200 dark:border-slate-800 hover:border-accent/40"}`}
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
          <FindingSeverityEditor
            findingId={finding.id}
            pageId={finding.page_id}
            currentSeverity={finding.severity}
            canEdit={!isFalsePositive && !isLocked}
            symbolOnly={true}
          />
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
            <FileSearch size={14} className="text-accent" />
            {finding.check_factor.replace(/_/g, " ")}
          </div>
        </div>
      </div>

      <div className="relative group/input">
        <input
          value={localTitle}
          onChange={(e) => {
            if (!isLocked) setLocalTitle(e.target.value)
          }}
          className="w-full px-4 py-3.5 bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-600 rounded-md font-bold text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500"
          placeholder="Input for Heading to be entered by Admin / QA"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover/input:opacity-100 transition-opacity">
          <Plus size={14} className="text-slate-300" />
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-[11px] text-slate-500 font-medium leading-relaxed break-words">
          {finding.description}
        </p>

        {screenshotUrls.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-start justify-between w-full">
              <div className="w-[50%] flex">
                {screenshotUrls.slice(0, 4).map((url, idx) => (
                  <div
                    key={url}
                    className="space-y-1 w-1/16 gap-1 flex-shrink-0"
                  >
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
                          ? "Desktop"
                          : idx === 1
                            ? "Tablet"
                            : idx === 2
                              ? "Mobile"
                              : "Code Snippet"
                      }
                    >
                      {idx === 0
                        ? "Desktop"
                        : idx === 1
                          ? "Tablet"
                          : idx === 2
                            ? "Mobile"
                            : "Code Snippet"}
                    </p>
                  </div>
                ))}
              </div>

              <div className="w-[25%] flex flex-col gap-2 pl-4 border-l border-slate-100 dark:border-slate-700/50 ml-5">
                <label className="flex items-center gap-2 group/cb">
                  <input
                    type="checkbox"
                    checked={isVerified}
                    onChange={(e) => {
                      if (!isLocked) setIsVerified(e.target.checked)
                    }}
                    className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer disabled:cursor-not-allowed transition-all"
                  />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer truncate">
                    {isVerified ? "Favicon Verified" : "Verify Favicon"}
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-auto w-full">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsBrowserOpen(true)}
              className="btn-unified w-fit flex items-center gap-2"
            >
              <MonitorSmartphone
                size={14}
                className="text-white-400 group-hover/btn:text-black transition-colors"
              />
            </button>

            {isVerified && (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isPushed && commentUrl) {
                      window.open(commentUrl, "_blank", "noopener,noreferrer")
                    } else if (!isPushed) {
                      handlePushToBasecamp()
                    }
                  }}
                  disabled={isPushing || (!isPushed && !isVerified)}
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

            {!isVerified && (
              <>
                <div className="w-px h-6 bg-slate-200 mx-1"></div>
                <button
                  onClick={() => {
                    onCreateTask?.({
                      ...finding,
                      title: localTitle,
                      description: `Task Linked. Verified? ${isVerified}`,
                      gallery_images: galleryImages,
                    })
                  }}
                  disabled={hasTask || isAssigned}
                  className={`btn-unified ${hasTask || isAssigned ? "bg-accent text-white cursor-not-allowed" : ""}`}
                >
                  {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
                </button>
              </>
            )}

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

            {!aiResultData && !isPushed && (
              <button
                onClick={handleRunAiCheck as any}
                title="Run AI Check on Favicon Screenshots"
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
                        if (success) handleRunAiCheck(e)
                      }
                    } else {
                      handleRunAiCheck(e)
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
      </div>

      {isAiModalOpen && aiResultData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#151e23] rounded-xl shadow-2xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Sparkle className="text-sky-500" size={20} />
              AI Verification Results
            </h3>
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 font-mono text-sm">
                <pre className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {getAiResultsText(aiResultData)}
                </pre>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setIsAiModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isAiLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#151e23] rounded-xl shadow-xl p-6 flex flex-col items-center">
            <Sparkle className="text-sky-500 animate-pulse mb-3" size={32} />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              AI is analyzing screenshots...
            </p>
          </div>
        </div>
      )}

      <BrowserOverlay
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        url={finding.pages?.url || project?.site_url || ""}
        onCapture={(img) => addImage(finding.id, img)}
        galleryCount={galleryImages.length}
        findingId={finding.id}
      />
    </div>
  )
}
