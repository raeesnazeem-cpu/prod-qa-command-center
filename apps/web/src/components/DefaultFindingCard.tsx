import React from "react"
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
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
  Globe,
  MonitorSmartphone,
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { useParams, Link } from "react-router-dom"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
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
  callnow_links: <MonitorSmartphone size={14} className="text-accent" />,
  social_share_heading: <MonitorSmartphone size={14} className="text-accent" />,
}

export const DefaultFindingCard: React.FC<FindingCardProps> = ({
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
  const { canDo } = useRole()
  const canAction = canDo("qa_engineer")

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isContextModalOpen, setIsContextModalOpen] = React.useState(false)
  const [isBrowserOpen, setIsBrowserOpen] = React.useState(false)
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  // Ensure factors that require full width get it here
  const FULL_WIDTH_FACTORS = ["dead_links", "hero_media", "callnow_links"]
  const isFullWidth = FULL_WIDTH_FACTORS.includes(finding.check_factor)

  const [isExpanded, setIsExpanded] = React.useState(false)

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"

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
              ? "opacity-60 border-slate-200 dark:border-slate-800"
              : "border-slate-200 dark:border-slate-800 hover:border-accent/40"
        }`}
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

          <div className="flex-1 min-w-0 w-full">
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

            {(finding.screenshot_url || pageScreenshots?.desktop) && (
              <div className="mb-4">
                <button
                  onClick={() => setIsBrowserOpen(true)}
                  className="btn-unified w-fit flex justify-start items-center gap-2 mt-3"
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
      </div>
    )
  }

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${
        isConfirmed || isAssigned
          ? "border-emerald-500 ring-1 ring-emerald-500/20"
          : isFalsePositive
            ? "opacity-60 border-slate-200 dark:border-slate-800"
            : "border-slate-200 dark:border-slate-800 hover:border-accent/40"
      }`}
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
              <div className="flex items-center h-5 mr-3"><input type="checkbox" name="enabled_checks" className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent accent-accent" value="accessibility" autoComplete="new-password" data-form-type="other" checked readOnly /></div>
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

      <div
        className={`grid grid-cols-1 ${isFullWidth ? "w-full" : "lg:grid-cols-2"} gap-8 items-start`}
      >
        <div className={`space-y-4 ${isFullWidth ? "col-span-full" : ""}`}>
          <div className="space-y-3">
            <p
              className={`text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed break-words ${
                isExpanded ? "" : "line-clamp-3"
              }`}
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

          <div className="pt-2 flex flex-col items-start gap-3">
            <button
              onClick={() => setIsContextModalOpen(true)}
              className="text-[9px] font-bold text-slate-500 uppercase tracking-widest hover:text-accent transition-colors text-left"
            >
              Click to open contextual data
            </button>
          </div>
        </div>

        {!isFullWidth && (
          <div className="relative group/ss">
            {/* FindingCardWithScreenshot natively commented out in original file */}
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
      </div>

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
              {!(hasTask || isAssigned) && (
                <button
                  onClick={() => onFalsePositive?.(finding.id)}
                  className="btn-unified"
                >
                  False Positive
                </button>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    onCreateTask?.({
                      ...finding,
                      title: localTitle,
                      gallery_images: galleryImages,
                    })
                  }
                  disabled={hasTask || isAssigned}
                  className={`btn-unified ${hasTask || isAssigned ? "bg-accent text-white cursor-not-allowed" : ""}`}
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
                      <Eye size={16} />
                    </Link>
                  )}
              </div>
            </>
          )}
        </div>

        {assignedUsers.length > 0 && (
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
      </div>

      {isContextModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsContextModalOpen(false)
          }}
        >
          <div className="bg-slate-50 dark:bg-[#1D2A31] w-full max-w-3xl rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-[#1D2A31]">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-widest">
                    Contextual Data
                  </h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">
                    Technical implementation details
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsContextModalOpen(false)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-[#1d2a31] rounded-xl transition-all active:scale-90"
              >
                <XCircle size={24} className="text-slate-400" />
              </button>
            </div>
            <div className="p-8 overflow-y-auto bg-slate-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-words leading-relaxed selection:bg-accent/30">
              {finding.context_text ||
                "No contextual data available for this finding."}
            </div>
            <div className="p-4 bg-slate-50 dark:bg-[#1D2A31] border-t dark:border-slate-700 flex justify-end">
              <button
                onClick={() => setIsContextModalOpen(false)}
                className="btn-unified"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      <BrowserOverlay
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        url={finding.pages?.url || ""}
        onCapture={(img) => addImage(finding.id, img)}
        galleryCount={galleryImages.length}
        findingId={finding.id}
      />
    </div>
  )
}
