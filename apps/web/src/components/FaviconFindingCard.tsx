import React from "react"
import {
  Plus,
  FileSearch,
  CheckSquare,
  Square,
  MonitorSmartphone,
  ClipboardList,
  Eye,
} from "lucide-react"
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

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isBrowserOpen, setIsBrowserOpen] = React.useState(false)
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const [isPushing, setIsPushing] = React.useState(false)
  const [isPushed, setIsPushed] = React.useState(finding.status === "confirmed")

  const [isVerified, setIsVerified] = React.useState(false)

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const currentAssignees =
        finding.tasks?.flatMap((t) =>
          (t as any).users ? [(t as any).users] : [],
        ) || []
      const allAssignees = [...currentAssignees, ...assignedUsers]
      const assigneeNames = Array.from(
        new Set(
          allAssignees
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
      }

      await api.post(`/api/findings/${finding.id}/push-basecamp`, payload)
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
              <CheckSquare size={20} strokeWidth={2.5} />
            ) : (
              <Square size={20} strokeWidth={2} />
            )}
          </button>
          <FindingSeverityEditor
            findingId={finding.id}
            pageId={finding.page_id}
            currentSeverity={finding.severity}
            canEdit={!isFalsePositive}
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
          onChange={(e) => setLocalTitle(e.target.value)}
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
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              Screenshots
            </p>
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
                    disabled={isPushed}
                    checked={isVerified}
                    onChange={(e) => setIsVerified(e.target.checked)}
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

        <div className="pt-2 flex items-center justify-start gap-3">
          <button
            onClick={() => setIsBrowserOpen(true)}
            className="btn-unified w-fit flex items-center gap-2"
          >
            <span className="text-white">See in </span>
            <MonitorSmartphone
              size={14}
              className="text-white-400 group-hover/btn:text-black transition-colors"
            />
          </button>

          {isVerified && (
            <button
              onClick={handlePushToBasecamp}
              disabled={isPushing || isPushed || !isVerified}
              className={`btn-unified px-3 flex items-center justify-center transition-all active:scale-95 ${isPushed ? "bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default" : "bg-[#0b1016] hover:bg-slate-800 text-white"}`}
            >
              {isPushing ? (
                <span className="text-[11px] font-bold px-1">...</span>
              ) : isPushed ? (
                <>
                  <span className="text-slate">Success </span>
                  <svg width="18" height="18" viewBox="0 0 35 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="pl-1"><path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path></svg>
                </>
              ) : (
                <>
                  <span className="text-white">Push to </span>
                  <svg width="18" height="18" viewBox="0 0 35 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="pl-1"><path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path></svg>
                </>
              )}
            </button>
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
                className={`btn-unified ${hasTask || isAssigned ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60" : ""}`}
              >
                {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
              </button>
            </>
          )}

          {(hasTask || isAssigned) && assignedTaskIds?.[0] && (
            <Link
              to={`/projects/${projectId}?tab=tasks&taskId=${assignedTaskIds[0]}`}
              target="_blank"
              className="p-2 text-slate-400 hover:text-accent transition-colors"
            >
              <Eye size={16} />
            </Link>
          )}
        </div>
      </div>
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
