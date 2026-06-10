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
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { useParams, Link } from "react-router-dom"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { QAFinding } from "../api/runs.api"
import { useGalleryStore } from "../store/galleryStore"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { useAuthAxios } from "../lib/useAuthAxios"

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
        ? "opacity-60 border-slate-200 dark:border-slate-700"
        : "border-slate-200 dark:border-slate-700 hover:border-accent/40"

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${cardBorder}`}
    >
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
                <CheckSquare size={20} strokeWidth={2.5} />
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

      {/* Checkbox for verification & AI trigger */}
      <div className="flex items-center gap-4 py-2">
        <label className="flex items-center gap-2 cursor-pointer group/verify">
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isManuallyVerified ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-slate-600 bg-white dark:bg-[#131d22] group-hover/verify:border-accent"}`}
          >
            {isManuallyVerified && <Check size={12} strokeWidth={3} />}
          </div>
          <input
            type="checkbox"
            className="hidden"
            checked={isManuallyVerified}
            onChange={(e) => setIsManuallyVerified(e.target.checked)}
          />
          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">
            Verify Updates
          </span>
        </label>

        {/* The AI Check Button */}
        {!aiResultData && (
          <button
            onClick={handleRunAiCheck}
            title="Run AI Check on Plugins Screenshot"
            className="p-1.5 rounded-md bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200 transition-all flex items-center justify-center shadow-sm"
          >
            <Sparkles size={14} />
          </button>
        )}

        {/* AI Results Link */}
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

      {/* Thumbnail / Screenshot Lightbox */}
      {finding.screenshot_url && (
        <div className="pt-2">
          <FindingCardWithScreenshot
            finding={finding}
            pageScreenshots={{}}
            hideTabs={true}
          />
        </div>
      )}

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
                      gallery_images: galleryImages,
                    })
                  }
                  disabled={hasTask || isAssigned}
                  className={`btn-unified ${hasTask || isAssigned ? "bg-accent text-white cursor-not-allowed" : ""}`}
                >
                  {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
                </button>
              </>
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
