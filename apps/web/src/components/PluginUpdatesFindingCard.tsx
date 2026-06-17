import React from "react"
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  Plus,
  MonitorSmartphone,
  Square,
  CheckSquare,
  ClipboardList,
  Sparkles,
  Check,
  Sparkle,
  Eye,
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { useParams, Link } from "react-router-dom"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { QAFinding } from "../api/runs.api"
import { useGalleryStore } from "../store/galleryStore"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useAiResultsStore } from "../store/aiResultsStore"

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

export const PluginUpdatesFindingCard: React.FC<FindingCardProps> = ({
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
  const api = useAuthAxios()
  const { id: projectId } = useParams<{ id: string }>()
  const { canDo } = useRole()
  const setAiResult = useAiResultsStore((state) => state.setAiResult)

  const canAction = canDo("qa_engineer")
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isExpanded, setIsExpanded] = React.useState(false)

  // AI states
  const [isAiModalOpen, setIsAiModalOpen] = React.useState(false)
  const [isAiLoading, setIsAiLoading] = React.useState(false)
  const [aiResultData, setAiResultData] = React.useState<any>(null)

  // Manual verify checkbox state
  const [isManuallyVerified, setIsManuallyVerified] = React.useState(false)

  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  const handleRunAiCheck = async () => {
    setIsAiModalOpen(true)
    if (aiResultData) return
    setIsAiLoading(true)

    try {
      const response = await api.post("/api/runs/verify-plugins-ai", {
        screenshotUrl: finding.screenshot_url,
      })

      setAiResultData(response.data)
      setAiResult(finding.id, getAiResultsText(response.data))
    } catch (error) {
      console.error("AI check failed:", error)
      setAiResultData({
        status: "error",
        message: "Failed to connect to AI server. Please try again.",
        outdatedPlugins: [],
        excludedPlugins: [],
      })
    } finally {
      setIsAiLoading(false)
    }
  }

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"

  const cardBorder =
    isConfirmed || isAssigned
      ? "border-emerald-500 ring-1 ring-emerald-500/20"
      : isFalsePositive
        ? "opacity-60 border-slate-200 dark:border-slate-800"
        : "border-slate-200 dark:border-slate-800 hover:border-accent/40"

  const getAiResultsText = (data: any) => {
    if (!data || data.status === "error") return ""
    let text = `\n\n🤖 AI Plugin Verification Results:\n${data.message || ""}\n`
    if (data.outdatedPlugins && data.outdatedPlugins.length > 0) {
      text += "\nOutdated Plugins:\n"
      data.outdatedPlugins.forEach((p: any) => {
        text += `- ${p.name}: v${p.current} -> v${p.available}\n`
      })
    } else {
      text += "\nAll required plugins are up to date ✓\n"
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
      {/* Header */}
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
            canEdit={canAction && !isFalsePositive}
            symbolOnly={true}
          />
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
            <MonitorSmartphone size={14} className="text-accent" />
            Verify Plugin Updates
          </div>
        </div>
      </div>

      {/* Title Input */}
      {canAction && (
        <div className="relative group/input">
          <input
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            className="w-full px-4 py-3.5 bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-600 rounded-md font-bold text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500"
            placeholder="Plugin Updates Title"
          />
        </div>
      )}

      {/* Description */}
      <div className="space-y-3">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed break-words">
          {finding.description}
        </p>
      </div>

      {/* Thumbnail / Screenshot Lightbox & Checkbox */}
      <div className="flex items-start justify-between w-full pt-2">
        <div className="w-[50%] flex">
          {finding.screenshot_url && (
            <div className="w-full">
              <FindingCardWithScreenshot
                finding={finding}
                pageScreenshots={{}}
                hideTabs={true}
              />
            </div>
          )}
        </div>

        <div className="w-[25%] flex flex-col gap-2 pl-4 border-l border-slate-100 dark:border-slate-700/50 ml-5">
          <label className="flex items-center gap-2 group/cb">
            <input
              type="checkbox"
              checked={isManuallyVerified}
              onChange={(e) => setIsManuallyVerified(e.target.checked)}
              className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer transition-all"
            />
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer truncate">
              {isManuallyVerified ? "Updates Verified" : "Verify Updates"}
            </span>
          </label>
        </div>
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
                {!(hasTask || isAssigned) && (
                  <button
                    onClick={() => onFalsePositive?.(finding.id)}
                    className="btn-unified"
                  >
                    False Positive
                  </button>
                )}
                <button
                  onClick={() =>
                    onCreateTask?.({
                      ...finding,
                      title: localTitle,
                      description: finding.description,

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
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
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
              <button
                onClick={() => setIsAiModalOpen(true)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-500 tracking-wide"
              >
                <span className="flex items-center gap-1">
                  <Sparkle size={14} />
                  <span>AI RESULTS</span>
                </span>
              </button>
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
                <Sparkles size={16} className="text-purple-500" /> AI Plugin
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
                  <Sparkles
                    size={32}
                    className="text-purple-500 animate-pulse"
                  />
                  <p className="text-sm text-slate-500">
                    AI is reviewing the screenshot...
                  </p>
                </div>
              ) : (
                aiResultData && (
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      {aiResultData.message}
                    </p>
                    {aiResultData.outdatedPlugins.length > 0 ? (
                      <div className="bg-red-50 p-4 rounded border border-red-100">
                        <p className="text-xs font-bold text-red-600 uppercase mb-2">
                          Outdated Plugins Found:
                        </p>
                        {aiResultData.outdatedPlugins.map(
                          (p: any, idx: number) => (
                            <p key={idx} className="text-sm text-red-800">
                              {p.name} (v{p.current} ➔ v{p.available})
                            </p>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="bg-emerald-50 p-4 rounded border border-emerald-100">
                        <p className="text-xs font-bold text-emerald-600">
                          All required plugins are up to date!
                        </p>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-500 italic mt-4">
                      Excluded from check:{" "}
                      {aiResultData.excludedPlugins.join(", ")}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
