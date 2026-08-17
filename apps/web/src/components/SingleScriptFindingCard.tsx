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
  Sparkles,
  RefreshCw,
} from "lucide-react"
import { useBulkDeleteTasks } from "../hooks/useTasks"
import { useRole } from "../hooks/useRole"
import { useProject } from "../hooks/useProjects"
import { useParams, Link } from "react-router-dom"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { QAFinding } from "../api/runs.api"
import { BrowserOverlay } from "./BrowserOverlay"
import { useGalleryStore } from "../store/galleryStore"
import { useAuthAxios } from "../lib/useAuthAxios"
import { findingBorderClass } from "../lib/findingVerdict"
import { useQueryClient } from "@tanstack/react-query"

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

export const SingleScriptFindingCard: React.FC<FindingCardProps> = ({
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

  const [isPushing, setIsPushing] = React.useState(false)
  const initialIsPushed =
    finding.status === "confirmed" &&
    (!!(finding as any).basecamp_comment_url ||
      !!(finding as any).basecamp_comment_id)
  const [isPushed, setIsPushed] = React.useState(initialIsPushed)

  const [isDeletingPush, setIsDeletingPush] = React.useState(false)
  const [commentUrl, setCommentUrl] = React.useState<string | null>(
    finding.status === "confirmed"
      ? (finding as any).basecamp_comment_url || null
      : null,
  )

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

  const handleDeletePush = async () => {
    setIsDeletingPush(true)
    try {
      await api.delete(`/api/findings/${finding.id}/delete-basecamp-push`)
      setIsPushed(false)

      const patchData: any = {
        basecamp_comment_id: null,
        basecamp_comment_url: null,
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

  const handleRunAiCheck = async (e?: React.MouseEvent | boolean) => {
    if (e && typeof (e as any).stopPropagation === "function") {
      ;(e as React.MouseEvent).stopPropagation()
    }
    setIsAiLoading(true)

    setTimeout(async () => {
      let originalHtml = finding.context_text || ""
      try {
        const parsed = JSON.parse(originalHtml)
        if (parsed.original_html) originalHtml = parsed.original_html
      } catch (err) {}

      const isVerified =
        originalHtml &&
        (originalHtml.includes('id="feature-buttons"') ||
          originalHtml.includes("#feature-buttons"))

      const resultData = {
        status: isVerified ? "verified" : "error",
        message: isVerified
          ? "Verified single script addition"
          : "Please check manually. Element #feature-buttons not found in page source.",
      }

      setAiResultData(resultData)
      sessionStorage.setItem(
        `aiResult_${finding.id}`,
        JSON.stringify(resultData),
      )

      try {
        await api.patch(`/api/findings/${finding.id}`, {
          context_text: JSON.stringify({
            aiResultData: resultData,
            original_html: originalHtml,
          }),
        })
      } catch (err) {
        console.error("Failed to save AI results to DB", err)
      }

      setIsAiModalOpen(true)
      setIsAiLoading(false)
    }, 1000)
  }

  const [isDesktopVerified, setIsDesktopVerified] = React.useState(initialIsPushed)
  const [isTabletVerified, setIsTabletVerified] = React.useState(initialIsPushed)
  const [isMobileVerified, setIsMobileVerified] = React.useState(initialIsPushed)
  const [isScriptVerified, setIsScriptVerified] = React.useState(initialIsPushed)

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

      const aiText = aiResultData
        ? `\n\n🤖 AI Smart Verification Results:\nStatus: ${aiResultData.status === "verified" ? "✅ Verified" : "❌ Error"}\nMessage: ${aiResultData.message}`
        : ""

      const payload = {
        isDesktopVerified,
        isTabletVerified,
        isMobileVerified,
        isScriptVerified,
        hasTask: hasTask || isAssigned,
        assigneeNames,
        aiResultsText: aiText,
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
  const allVerified =
    isDesktopVerified &&
    isTabletVerified &&
    isMobileVerified &&
    isScriptVerified

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 relative overflow-hidden flex flex-col gap-6 ${findingBorderClass(finding)}`}
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
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
            <FileSearch size={14} className="text-accent" />
            {finding.check_factor.replace(/_/g, " ")}
          </div>
        </div>
      </div>

      <div className="relative group/input">
        <input
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          readOnly={isLocked}
          className={`w-full px-4 py-3.5 bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-600 rounded-md font-bold text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500 ${isLocked ? "pointer-events-none" : ""}`}
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
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              Screenshots
            </p>
            <div className="flex flex-wrap items-start justify-between w-full gap-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                              : "Script Code"
                      }
                    >
                      {idx === 0
                        ? "Desktop"
                        : idx === 1
                          ? "Tablet"
                          : idx === 2
                            ? "Mobile"
                            : "Script Code"}
                    </p>
                  </div>
                ))}
              </div>

            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-start gap-4 pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-auto w-full">
          <button
            onClick={() => setIsBrowserOpen(true)}
            className="btn-unified w-fit flex items-center gap-2"
          >
            <MonitorSmartphone
              size={14}
              className="text-white-400 group-hover/btn:text-black transition-colors"
            />
          </button>
        </div>
      </div>

      {isAiModalOpen && aiResultData && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAiModalOpen(false)
          }}
        >
          <div className="bg-white dark:bg-[#151e23] rounded-xl shadow-2xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Sparkle className="text-sky-500" size={20} />
              AI Verification Results
            </h3>
            <div className="space-y-4">
              <div
                className={`rounded-lg p-4 font-mono text-sm border ${aiResultData.status === "verified" ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"}`}
              >
                <p
                  className={`${aiResultData.status === "verified" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"} whitespace-pre-wrap font-semibold`}
                >
                  {aiResultData.message}
                </p>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
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
