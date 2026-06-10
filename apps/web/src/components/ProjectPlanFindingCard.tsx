import React from "react"
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Plus,
  ExternalLink,
  Search,
  FileSearch,
  Layout,
  Eye,
  Monitor,
  Activity,
  Square,
  CheckSquare,
  ClipboardList,
  MonitorSmartphone,
  Globe,
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { useProject } from "../hooks/useProjects"
import { useParams, Link } from "react-router-dom"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { RebuttalVerdictCard } from "./RebuttalVerdictCard"
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

const CHECK_FACTOR_ICONS: Record<string, React.ReactNode> = {
  broken_links: <Globe size={14} />,
  external_links: <ExternalLink size={14} />,
  meta_tags: <Search size={14} />,
  console_errors: <FileSearch size={14} />,
  dummy_content: <Layout size={14} />,
  visual_regression: <Eye size={14} />,
  accessibility: <Monitor size={14} />,
  performance: <Info size={14} />,
  seo: <Search size={14} />,
  image_compliance: <Monitor size={14} />,
  ai_content_audit: <FileSearch size={14} className="text-accent" />,
  project_plan: <ClipboardList size={14} className="text-accent" />,
  hero_media: <Monitor size={14} className="text-accent" />,
  dead_links: <Globe size={14} className="text-accent" />,
}

export const ProjectPlanFindingCard: React.FC<FindingCardProps> = ({
  finding,
  pageScreenshots,
  onConfirm,
  onFalsePositive,
  onCreateTask,
  onAssign,
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
  const [isContextModalOpen, setIsContextModalOpen] = React.useState(false)
  const [isBrowserOpen, setIsBrowserOpen] = React.useState(false)
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const isProjectPlan = true
  const isFullWidth = false

  const [isPushing, setIsPushing] = React.useState(false)
  const [isPushed, setIsPushed] = React.useState(finding.status === "confirmed")
  const [isBasecampModalOpen, setIsBasecampModalOpen] = React.useState(false)
  const [isPlanVerified, setIsPlanVerified] = React.useState(false)
  const [isReviewsVerified, setIsReviewsVerified] = React.useState(false)

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  const [isExpanded, setIsExpanded] = React.useState(false)

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const response = await api.post(
        `/api/findings/${finding.id}/push-basecamp`,
        {},
      )
      setIsPushed(true)

      if (onConfirm) {
        onConfirm(finding.id)
      }
    } catch (err: any) {
      console.error(err)
      const errorMsg =
        err.response?.data?.error ||
        "Failed to push finding to Basecamp. Please verify settings."
      alert(errorMsg)
    } finally {
      setIsPushing(false)
    }
  }

  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  const severityIcons = {
    critical: <ShieldAlert size={20} />,
    high: <AlertTriangle size={20} />,
    medium: <AlertCircle size={20} />,
    low: <Info size={20} />,
  }

  if (!canAction) {
    return (
      <div
        className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-sm hover:shadow-xl relative overflow-hidden flex flex-col gap-6 ${
          isConfirmed || isAssigned
            ? "border-emerald-500 ring-1 ring-emerald-500/20"
            : isFalsePositive
              ? "opacity-60 border-slate-200 dark:border-slate-700"
              : "border-slate-200 dark:border-slate-700 hover:border-accent/40"
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`mt-1 p-3 rounded-xl shrink-0 transition-transform group-hover:scale-110 ${
              isFalsePositive
                ? "bg-slate-100 text-slate-400"
                : finding.severity === "critical"
                  ? "bg-red-50 text-red-600"
                  : finding.severity === "high"
                    ? "bg-orange-50 text-orange-600"
                    : finding.severity === "medium"
                      ? "bg-yellow-50 text-yellow-600"
                      : "bg-blue-50 text-blue-600"
            }`}
          >
            {isFalsePositive ? (
              <XCircle size={20} />
            ) : (
              severityIcons[finding.severity]
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FindingSeverityEditor
                  findingId={finding.id}
                  pageId={finding.page_id}
                  currentSeverity={finding.severity}
                  canEdit={false}
                  symbolOnly={true}
                />
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                  {CHECK_FACTOR_ICONS[finding.check_factor] || (
                    <FileSearch size={14} />
                  )}
                  {finding.check_factor.replace(/_/g, " ")}
                </div>
              </div>
              <span className="text-[8px] font-bold text-slate-300 uppercase">
                {new Date(finding.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>

            <h4
              className={`font-bold text-slate-900 dark:text-slate-200 text-base mb-2 group-hover:text-black dark:group-hover:text-white transition-colors leading-tight ${
                isFalsePositive ? "line-through text-slate-400" : ""
              }`}
            >
              {finding.title}
            </h4>

            {finding.description && (
              <div className="mb-4">
                <p
                  className={`text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed break-words ${
                    isFalsePositive ? "text-slate-400" : ""
                  } ${!isExpanded ? "line-clamp-3" : ""}`}
                >
                  {finding.description}
                </p>
                {finding.description.length > 150 && (
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-[10px] font-bold text-accent uppercase tracking-widest mt-1 hover:text-black transition-colors"
                  >
                    {isExpanded ? "See less" : "See more"}
                  </button>
                )}
              </div>
            )}

            {finding.screenshot_url?.includes(",") && (
              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Evidence Screenshots
                </p>
                <div className="flex gap-4 mb-3">
                  {finding.screenshot_url.split(",").map((url, idx) => (
                    <div key={url} className="space-y-1">
                      <FindingCardWithScreenshot
                        finding={{ ...finding, screenshot_url: url }}
                        pageScreenshots={{}}
                      />
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest text-center">
                        {idx === 0 ? "Plan Highlight" : "Reviews Page"}
                      </p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setIsBrowserOpen(true)}
                  className="btn-unified w-fit ml-auto flex justify-end items-center gap-2 mt-3"
                >
                  <span className="text-white">See in </span>
                  <MonitorSmartphone
                    size={14}
                    className="text-white-400 group-hover/btn:text-black transition-colors"
                  />
                </button>
              </div>
            )}

            {finding.context_text && (
              <div className="mb-6">
                <p className="text-[8px] font-bold text-slate-400 uppercase mb-1.5 tracking-widest">
                  Contextual Data
                </p>
                <div className="h-[80px] p-3 bg-slate-900 dark:bg-[#131d22] rounded-[10px] border border-slate-800 font-mono text-[10px] text-slate-300 whitespace-pre-wrap break-words overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#93C0B1] [&::-webkit-scrollbar-track]:bg-transparent">
                  {finding.context_text}
                </div>
              </div>
            )}

            {finding.tasks?.[0]?.rebuttals?.[0] &&
              finding.tasks[0].rebuttals[0].ai_verdict && (
                <div className="mb-6">
                  <p className="text-[8px] font-bold text-slate-400 uppercase mb-3 tracking-widest">
                    AI Verdict on Rebuttal
                  </p>
                  <RebuttalVerdictCard
                    verdictData={{
                      verdict: finding.tasks[0].rebuttals[0].ai_verdict as
                        | "resolved"
                        | "disputed",
                      confidence:
                        finding.tasks[0].rebuttals[0].ai_confidence || 0,
                      reasoning:
                        finding.tasks[0].rebuttals[0].ai_reasoning || "",
                    }}
                  />
                </div>
              )}

            {finding.tasks?.[0]?.rebuttals?.[0] &&
              !finding.tasks[0].rebuttals[0].ai_verdict && (
                <div className="mb-6 p-4 bg-slate-50 dark:bg-[#1d2a31] rounded-md border border-slate-100 dark:border-slate-700 flex items-center gap-3">
                  <div className="p-2 bg-slate-50 dark:bg-[#131d22] rounded-lg shadow-sm">
                    <Activity
                      size={16}
                      className="text-blue-500 animate-pulse"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-900 dark:text-slate-200 uppercase tracking-tight">
                      AI Analysis Pending
                    </p>
                    <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">
                      Gemini is reviewing the developer's rebuttal...
                    </p>
                  </div>
                </div>
              )}

            {isFalsePositive && (
              <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] italic">
                  Marked as False Positive
                </span>
              </div>
            )}
          </div>
        </div>

        <BrowserOverlay
          isOpen={isBrowserOpen}
          onClose={() => setIsBrowserOpen(false)}
          url={
            project?.site_url
              ? project.site_url.endsWith("/")
                ? `${project.site_url}reviews`
                : `${project.site_url}/reviews`
              : finding.pages?.url || ""
          }
          onCapture={(img) => addImage(finding.id, img)}
          galleryCount={galleryImages.length}
          findingId={finding.id}
        />
      </div>
    )
  }

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${
        isConfirmed || isAssigned
          ? "border-emerald-500 ring-1 ring-emerald-500/20"
          : isFalsePositive
            ? "opacity-60 border-slate-200 dark:border-slate-700"
            : "border-slate-200 dark:border-slate-700 hover:border-accent/40"
      }`}
    >
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
            {CHECK_FACTOR_ICONS[finding.check_factor] || (
              <FileSearch size={14} />
            )}
            {finding.check_factor.replace(/_/g, " ")}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider">
            {new Date(finding.created_at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider">
            {new Date(finding.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
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
        <div>
          <h5 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-tight mb-2">
            Project Plan found
          </h5>
        </div>

        {finding.screenshot_url?.includes(",") && (
          <div className="space-y-2 pt-2">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              Screenshots
            </p>
            <div className="flex items-center gap-6">
              <div className="flex gap-4">
                {finding.screenshot_url.split(",").map((url, idx) => (
                  <div key={url} className="space-y-1">
                    <div>
                      <FindingCardWithScreenshot
                        finding={{ ...finding, screenshot_url: url }}
                        pageScreenshots={{}}
                        hideTabs={true}
                      />
                    </div>
                    <p className="font-bold text-slate-400 uppercase tracking-widest text-center text-[8px]">
                      {idx === 0 ? "Plan Highlight" : "Reviews Page"}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 pl-4 border-l border-slate-100 dark:border-slate-700/50">
                <label className="flex items-center gap-2 group/cb">
                  <input
                    type="checkbox"
                    disabled={isPushed}
                    checked={isPlanVerified}
                    onChange={(e) => setIsPlanVerified(e.target.checked)}
                    className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 transition-all"
                  />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer">
                    {isPlanVerified ? "Plan Verified" : "Verify Plan"}
                  </span>
                </label>
                <label className="flex items-center gap-2 group/cb">
                  <input
                    type="checkbox"
                    disabled={isPushed}
                    checked={isReviewsVerified}
                    onChange={(e) => setIsReviewsVerified(e.target.checked)}
                    className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 transition-all"
                  />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer">
                    {isReviewsVerified ? "Reviews Verified" : "Verify Reviews"}
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        <div className="pt-2 flex flex-col items-start">
          <button
            onClick={() => setIsBasecampModalOpen(true)}
            className="text-[9px] font-bold text-slate-500 uppercase tracking-widest hover:text-accent transition-colors text-left"
          >
            Click to view basecamp plan details
          </button>
        </div>

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

          <button
            onClick={handlePushToBasecamp}
            disabled={
              isPushing || isPushed || !(isPlanVerified && isReviewsVerified)
            }
            title="Push to Basecamp"
            className={`btn-unified px-3 flex items-center justify-center transition-all active:scale-95 ${
              isPushed
                ? "bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default animate-fade-in"
                : !(isPlanVerified && isReviewsVerified)
                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60 hover:border-slate-200 hover:text-slate-400"
                  : "bg-[#0b1016] hover:bg-slate-800 text-white"
            }`}
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

          <div className="w-px h-6 bg-slate-200 mx-1"></div>

          <button
            onClick={() => {
              const missingParts = []
              if (!isPlanVerified) missingParts.push("Plan")
              if (!isReviewsVerified) missingParts.push("Reviews")

              const missingText =
                missingParts.length > 0
                  ? `\n\nMissing Verifications: ${missingParts.join(" and ")}`
                  : ""

              let combinedImages = [...galleryImages]
              if (finding.screenshot_url) {
                const existingUrls = finding.screenshot_url
                  .split(",")
                  .map((s: string) => s.trim())
                  .filter(Boolean)
                const urlSet = new Set(combinedImages)
                for (const url of existingUrls) {
                  if (!urlSet.has(url)) {
                    combinedImages.push(url)
                    urlSet.add(url)
                  }
                }
              }

              onCreateTask?.({
                ...finding,
                title: localTitle,
                description: (finding.description || "") + missingText,
                gallery_images: combinedImages,
              })
            }}
            disabled={
              hasTask || isAssigned || (isPlanVerified && isReviewsVerified)
            }
            className={`btn-unified ${
              hasTask || isAssigned || (isPlanVerified && isReviewsVerified)
                ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60 hover:border-slate-200 hover:text-slate-400"
                : ""
            }`}
          >
            {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
          </button>

          {(hasTask || isAssigned) &&
            assignedTaskIds &&
            assignedTaskIds.length > 0 &&
            assignedTaskIds[0] !== finding.id && (
              <Link
                to={`/projects/${projectId}?tab=tasks&taskId=${assignedTaskIds[0]}`}
                target="_blank"
                className="p-2 text-slate-400 hover:text-accent transition-colors"
                title="View Task"
              >
                <ClipboardList size={16} />
              </Link>
            )}
        </div>
      </div>

      {isBasecampModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-slate-50 dark:bg-[#1D2A31] max-w-2xl w-full p-8 rounded-md border border-slate-200 dark:border-slate-700 shadow-2xl relative text-left">
            <button
              onClick={() => setIsBasecampModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <XCircle size={24} />
            </button>
            <h3 className="font-bold text-slate-900 dark:text-slate-200 text-lg mb-4">
              Basecamp Project Plan Details
            </h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm mb-6 leading-relaxed">
              This project plan was fetched dynamically from your Basecamp
              Message Board topic: <strong>"Project Order Details"</strong>.
            </p>
            <div className="bg-slate-50 dark:bg-[#1d2a31] border border-slate-100 dark:border-slate-700 p-6 rounded-xl text-slate-800 dark:text-slate-300 font-medium text-sm mb-6 shadow-inner max-h-[300px] overflow-y-auto">
              {finding.description}
            </div>
            <div className="flex justify-end">
              <a
                href={
                  project?.basecamp_account_id && project?.basecamp_project_id
                    ? `https://3.basecamp.com/${project.basecamp_account_id}/buckets/${project.basecamp_project_id}`
                    : `https://3.basecamp.com`
                }
                target="_blank"
                rel="noreferrer"
                className="btn-unified flex items-center gap-2"
              >
                <ExternalLink size={14} />
                Open Basecamp Workspace
              </a>
            </div>
          </div>
        </div>
      )}

      <BrowserOverlay
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        url={
          project?.site_url
            ? project.site_url.endsWith("/")
              ? `${project.site_url}reviews`
              : `${project.site_url}/reviews`
            : finding.pages?.url || ""
        }
        onCapture={(img) => addImage(finding.id, img)}
        galleryCount={galleryImages.length}
        findingId={finding.id}
      />
    </div>
  )
}
