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
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { useParams, Link } from "react-router-dom"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { QAFinding } from "../api/runs.api"
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
  const canAction = canDo("qa_engineer")
  const axios = useAuthAxios()
  const { galleryImages: allGalleryImages } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isUrlModalOpen, setIsUrlModalOpen] = React.useState(false)
  const [isExpanded, setIsExpanded] = React.useState(false)

  const [isAiModalOpen, setIsAiModalOpen] = React.useState(false)
  const [isAiLoading, setIsAiLoading] = React.useState(false)
  const [aiResultData, setAiResultData] = React.useState<any>(null)

  const handleRunAiCheck = async () => {
    // 1. Open the modal immediately
    setIsAiModalOpen(true)

    // 2. If we already have the results, do nothing else. Just show it!
    if (aiResultData) return

    // 3. Otherwise, start the loading spinner
    setIsAiLoading(true)

    try {
      // 4. Send the dev and live pages to our new AI API endpoint
      const response = await axios.post("/api/runs/compare-urls-ai", {
        devPages: compareData?.devPages || [],
        livePages: compareData?.livePages || [],
      })

      const data = response.data

      // 5. Save the smart AI results in our state
      setAiResultData(data)
    } catch (error) {
      console.error("AI check failed:", error)
    } finally {
      // 6. Stop the loading spinner
      setIsAiLoading(false)
    }
  }

  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"

  const compareData = parseContextData(finding.context_text)
  const { devPages, livePages } = compareData

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
        ? "opacity-60 border-slate-200 dark:border-slate-700"
        : "border-slate-200 dark:border-slate-700 hover:border-accent/40"

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${cardBorder}`}
    >
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
            <Globe size={14} className="text-accent" />
            URL & Tab Compare
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

      {/* Title Input */}
      {canAction && (
        <div className="relative group/input">
          <input
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
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

      {/* Show URLs and AI Button Area */}
      <div className="flex items-center gap-3 py-2">
        {/* The Original Show URLs Button */}
        <button
          onClick={() => setIsUrlModalOpen(true)}
          className="text-[9px] font-bold text-accent uppercase tracking-widest hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5"
        >
          <Globe size={12} />
          Show URLs
        </button>

        {/* The New AI Star Button (Shows only if AI hasn't run yet) */}
        {!aiResultData && (
          <button
            onClick={handleRunAiCheck}
            title="Run Smart AI Comparison"
            className="p-1.5 rounded-md bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:scale-105 active:scale-95 border border-purple-200 dark:border-purple-800/30 transition-all flex items-center justify-center shadow-sm"
          >
            <Sparkles size={14} />
          </button>
        )}

        {/* The New AI Results Link (Shows only AFTER AI finishes) */}
        {aiResultData && (
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="text-[10px] font-bold text-sky-400 hover:text-sky-500 underline tracking-wider capitalize"
          >
            AI Results
          </button>
        )}
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
                        <ClipboardList size={16} />
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
                <Sparkles size={16} className="text-purple-500" />
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
                  <Sparkles
                    size={32}
                    className="text-purple-500 animate-pulse"
                  />
                  <p className="text-sm text-slate-500 font-medium tracking-wide">
                    AI is analyzing the URLs contextually. Please wait...
                  </p>
                </div>
              )}

              {/* If the data is ready, show the missing pages */}
              {!isAiLoading && aiResultData && (
                <div className="space-y-6">
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
                  {aiResultData.missingInDev?.length === 0 &&
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
