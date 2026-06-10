import React, { useState } from "react"
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Plus,
  FileSearch,
  Activity,
  UserPlus,
  Globe,
  ExternalLink,
} from "lucide-react"
import { useParams, Link } from "react-router-dom"
import { useRole } from "../hooks/useRole"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { RebuttalVerdictCard } from "./RebuttalVerdictCard"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { QAFinding } from "../api/runs.api"
import { BrowserOverlay } from "./BrowserOverlay"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useGalleryStore } from "../store/galleryStore"

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
  assignedTaskIds?: string[]
  assignedUsers?: any[]
  isAssigned?: boolean
}

export const SpellingFindingCard: React.FC<FindingCardProps> = ({
  finding,
  pageScreenshots,
  onConfirm,
  onFalsePositive,
  onCreateTask,
  onAssign,
  assignedTaskIds = [],
  assignedUsers = [],
  isAssigned = false,
}) => {
  const { canDo } = useRole()
  const axios = useAuthAxios()
  const canAction = canDo("qa_engineer")
  const { id: projectId } = useParams<{ id: string }>()

  const [isAddingAllowlist, setIsAddingAllowlist] = useState(false)
  const [isBrowserOpen, setIsBrowserOpen] = useState(false)
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const severityIcons = {
    critical: <ShieldAlert size={20} />,
    high: <AlertTriangle size={20} />,
    medium: <AlertCircle size={20} />,
    low: <Info size={20} />,
  }

  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  const hasTask = finding.tasks && finding.tasks.length > 0
  const [isExpanded, setIsExpanded] = useState(false)

  // Extract misspelled word from title (e.g., "Misspelled: word")
  const titleMatch = finding.title.match(/Misspelled:\s*(.+)/i)
  const misspelledWord = titleMatch ? titleMatch[1] : ""

  // Extract suggestion from description (e.g., "Suggestion: word" or "No suggestions found")
  const descMatch = finding.description?.match(/Suggestion:\s*(.+)/i)
  const suggestion = descMatch ? descMatch[1] : ""

  const handleAllowlist = async () => {
    if (!projectId || !misspelledWord) return
    setIsAddingAllowlist(true)
    try {
      await axios.post(
        `/api/findings/projects/${projectId}/spelling-allowlist`,
        { word: misspelledWord },
      )
    } catch (e) {
      console.error("Failed to add to allowlist", e)
    } finally {
      setIsAddingAllowlist(false)
    }
  }

  const renderContextText = () => {
    if (!finding.context_text) return null
    if (!misspelledWord) return finding.context_text

    // Case-insensitive replace for highlighting the precise mispelled word
    const regex = new RegExp(`(${misspelledWord})`, "gi")
    const parts = finding.context_text.split(regex)

    return parts.map((part, i) =>
      part.toLowerCase() === misspelledWord.toLowerCase() ? (
        <span
          key={i}
          className="text-red-500 font-bold bg-red-500/10 px-1 rounded"
        >
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
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
      {/* Status Indicators */}

      <div className="flex items-start gap-4">
        {/* Severity Icon */}
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
          {/* Header Info */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FindingSeverityEditor
                findingId={finding.id}
                pageId={finding.page_id}
                currentSeverity={finding.severity}
                canEdit={canAction && !isFalsePositive}
                symbolOnly={true}
              />
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                <FileSearch size={14} />
                SPELLING
              </div>
            </div>
            <span className="text-[8px] font-bold text-slate-300 uppercase">
              {new Date(finding.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>

          {/* Title & Description */}
          <h4
            className={`font-bold text-slate-900 text-base mb-2 group-hover:text-black transition-colors leading-tight ${
              isFalsePositive ? "line-through text-slate-400" : ""
            }`}
          >
            {finding.title}
          </h4>
          {finding.description && (
            <div className="mb-4">
              <p
                className={`text-[11px] text-slate-500 font-medium leading-relaxed break-words ${
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

          {/* Screenshot Thumbnail */}
          {(finding.screenshot_url || pageScreenshots?.desktop) && (
            <div className="mb-4 relative group/img cursor-pointer max-w-[200px]">
              <FindingCardWithScreenshot
                finding={finding}
                pageScreenshots={pageScreenshots}
              />
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-widest">
                {finding.screenshot_url
                  ? "Click to expand evidence"
                  : "Click to view page context"}
              </p>
              <button
                onClick={() => setIsBrowserOpen(true)}
                className="btn-unified w-fit ml-auto flex justify-end items-center gap-2 mt-3"
              >
                <span>
                  <Globe
                    size={14}
                    className="text-slate-400 group-hover/btn:text-black transition-colors"
                  />
                </span>
                <span className="text-[11px]">See in Browser</span>
              </button>
            </div>
          )}

          {/* Context Text and Suggestions */}
          {finding.context_text && (
            <div className="mb-6">
              <p className="text-[8px] font-bold text-slate-400 uppercase mb-1.5 tracking-widest">
                Context Sentence
              </p>
              <div className="h-[80px] p-3 bg-slate-900 rounded-[10px] border border-slate-800 font-mono text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#93C0B1] [&::-webkit-scrollbar-track]:bg-transparent">
                {renderContextText()}
              </div>
              {suggestion && (
                <div className="mt-2 text-[11px] font-medium text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200">
                  <span className="font-bold uppercase tracking-wider text-[9px] mr-1.5">
                    Suggested:
                  </span>
                  {suggestion}
                </div>
              )}
            </div>
          )}

          {/* AI Rebuttal Verdict */}
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
                    reasoning: finding.tasks[0].rebuttals[0].ai_reasoning || "",
                  }}
                />
              </div>
            )}

          {finding.tasks?.[0]?.rebuttals?.[0] &&
            !finding.tasks[0].rebuttals[0].ai_verdict && (
              <div className="mb-6 p-4 bg-slate-50 rounded-md border border-slate-100 flex items-center gap-3">
                <div className="p-2 bg-slate-50 rounded-lg shadow-sm">
                  <Activity size={16} className="text-blue-500 animate-pulse" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-900 uppercase tracking-tight">
                    AI Analysis Pending
                  </p>
                  <p className="text-[9px] text-slate-500 font-medium">
                    Gemini is reviewing the developer's rebuttal...
                  </p>
                </div>
              </div>
            )}

          {/* Action Buttons */}
          {canAction && !isFalsePositive && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 flex-wrap">
                {!isConfirmed && (
                  <button
                    onClick={() => onConfirm?.(finding.id)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-[10px] hover:bg-emerald-600 transition-colors"
                  >
                    <CheckCircle2 size={12} />
                    Confirm
                  </button>
                )}
                {!(hasTask || isAssigned) && (
                  <button
                    onClick={() => onFalsePositive?.(finding.id)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-200 text-slate-500 text-[9px] font-bold uppercase tracking-widest rounded-[10px] hover:bg-slate-50 transition-colors"
                  >
                    <XCircle size={12} />
                    False Positive
                  </button>
                )}
                <button
                  onClick={() => onAssign?.(finding.id)}
                  className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-200 text-slate-500 text-[9px] font-bold uppercase tracking-widest rounded-[10px] hover:bg-slate-50 transition-colors"
                >
                  <UserPlus size={12} />
                  Assign
                </button>
                {misspelledWord && (
                  <button
                    onClick={handleAllowlist}
                    disabled={isAddingAllowlist}
                    className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-600 border border-indigo-200 text-[9px] font-bold uppercase tracking-widest rounded-[10px] hover:bg-indigo-100 transition-colors disabled:opacity-50"
                  >
                    <Plus size={12} />
                    {isAddingAllowlist ? "Adding..." : "Add to Allowlist"}
                  </button>
                )}

                {/* Assigned Users Avatars */}
                {assignedUsers.length > 0 && (
                  <div className="flex items-center ml-4 -space-x-2">
                    {assignedUsers.map((user: any, i: number) => (
                      <div
                        key={user.id || i}
                        className="w-6 h-6 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-slate-600 shadow-sm"
                        title={user.full_name}
                      >
                        {user.full_name?.charAt(0) || "U"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    onCreateTask?.({
                      ...finding,
                      gallery_images: galleryImages,
                    })
                  }
                  disabled={hasTask || isAssigned}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[9px] font-bold uppercase tracking-widest rounded-[10px] transition-colors shrink-0 ${
                    hasTask || isAssigned
                      ? "bg-accent text-white cursor-not-allowed"
                      : "bg-black text-accent hover:bg-slate-800"
                  }`}
                >
                  <Plus size={12} />
                  {hasTask || isAssigned ? "Task Linked" : "Create Task"}
                </button>
                {(hasTask || isAssigned) &&
                  assignedTaskIds &&
                  assignedTaskIds.length > 0 && (
                    <Link
                      to={`/projects/${projectId}?tab=tasks&taskId=${assignedTaskIds[0]}`}
                      className="p-2 text-slate-400 hover:text-accent transition-colors"
                      title="View Task"
                    >
                      <ExternalLink size={14} />
                    </Link>
                  )}
              </div>
            </div>
          )}

          {isFalsePositive && (
            <div className="pt-4 border-t border-slate-100 flex justify-end">
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
        url={finding.pages?.url || ""}
        onCapture={(img) => addImage(finding.id, img)}
        galleryCount={galleryImages.length}
        findingId={finding.id}
      />
    </div>
  )
}
