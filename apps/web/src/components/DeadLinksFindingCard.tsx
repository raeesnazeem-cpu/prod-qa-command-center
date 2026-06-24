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
  Unlink2,
} from "lucide-react"
import { useBulkDeleteTasks } from "../hooks/useTasks"
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
}

export const DeadLinksFindingCard: React.FC<FindingCardProps> = ({
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
  const { mutate: bulkDeleteTasks, isPending: isDeleting } =
    useBulkDeleteTasks()

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isContextModalOpen, setIsContextModalOpen] = React.useState(false)
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isBrowserOpen, setIsBrowserOpen] = React.useState(false)
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  // Dead Links is ALWAYS full width
  const isFullWidth = true

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
  const [isExpanded, setIsExpanded] = React.useState(false)

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  const isLocked = hasTask || isAssigned || isPushed

  const links = React.useMemo(() => {
    if (!finding.description) return []
    try {
      // 1. Try to parse as JSON first
      return JSON.parse(finding.description)
    } catch (e) {
      const extracted: any[] = []
      
      // 2. Try to parse Markdown Table (new format)
      if (finding.description.includes("| Error | URL | Anchor Text | Linked From |")) {
        const lines = finding.description.split("\n")
        let inTable = false
        for (const line of lines) {
          if (line.includes("| Error | URL |")) {
            inTable = true
            continue
          }
          if (inTable && line.includes("|---|---|")) continue
          
          if (inTable && line.trim().startsWith("|")) {
            const parts = line.split("|").map(p => p.trim())
            if (parts.length >= 5) {
              extracted.push({
                reason: parts[1],
                url: parts[2],
                link_text: parts[3].replace(/`/g, ""),
                found_on: parts[4], 
              })
            }
          }
        }
        if (extracted.length > 0) return extracted
      }

      // 3. Fallback to old bullet format
      const regex =
        /- \*\*(.*?)\*\*\s*\* Reason:\s*(.*?)\s*\* Link Text:\s*(.*?)\s*\* Found on:\s*(.*?)(?=\s+- \*\*|$)/gs
      let match
      while ((match = regex.exec(finding.description)) !== null) {
        extracted.push({
          url: match[1].trim(),
          reason: match[2].trim(),
          link_text: match[3].trim(),
          found_on: match[4].trim(),
        })
      }
      return extracted
    }
  }, [finding.description])

  const renderFoundOn = (text: string) => {
    if (!text) return "-"
    
    // Check if it's our new consolidated format with <br> and markdown links
    if (text.includes("](") || text.includes("<br>")) {
      const parts = text.split("<br>").map(p => p.trim()).filter(Boolean)
      return (
        <div className="flex flex-col gap-1">
          {parts.map((p, i) => {
            const match = p.match(/\[(.*?)\]\((.*?)\)/)
            if (match) {
              return (
                <a key={i} href={match[2]} target="_blank" rel="noreferrer" className="hover:underline text-blue-500 block">
                  {match[1]}
                </a>
              )
            }
            return <span key={i} className="text-slate-500">{p}</span>
          })}
        </div>
      )
    }

    // Fallback for old single-url format
    return (
      <a href={text} target="_blank" rel="noreferrer" className="hover:underline text-blue-500">
        {text}
      </a>
    )
  }

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const response = await api.post(
        `/api/findings/${finding.id}/push-basecamp`,
        {},
      )
      if (response.data?.commentUrl) setCommentUrl(response.data.commentUrl)
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

  const handleDeletePush = async () => {
    setIsDeletingPush(true)
    try {
      await api.delete(`/api/findings/${finding.id}/delete-basecamp-push`)
      setIsPushed(false)
      try {
        await api.patch(`/api/findings/${finding.id}`, {
          basecamp_comment_id: null,
          basecamp_comment_url: null,
          status: "pending",
        })
        if (onConfirm) {
          onConfirm(finding.id)
        }
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

  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  const currentAssigneesForUI =
    finding.tasks?.flatMap((t: any) =>
      t.users ? (Array.isArray(t.users) ? t.users : [t.users]) : [],
    ) || []
  const allAssigneesListForUI = [...currentAssigneesForUI, ...assignedUsers]
    .flatMap((u: any) => (Array.isArray(u) ? u : [u]))
    .filter(
      (v, i, a) =>
        a.findIndex((t: any) => {
          const tId = String(t.userId || t.user_id || t.id || "t_" + i)
          const vId = String(v.userId || v.user_id || v.id || "v_" + i)
          if (tId !== "undefined" && vId !== "undefined" && tId === vId)
            return true
          if (t.email && v.email && t.email === v.email) return true
          const tName = (t.full_name || t.name || "").trim().toLowerCase()
          const vName = (v.full_name || v.name || "").trim().toLowerCase()
          if (tName && vName && tName === vName) return true
          return false
        }) === i,
    )

  const severityIcons = {
    critical: <ShieldAlert size={20} />,
    high: <AlertTriangle size={20} />,
    medium: <AlertCircle size={20} />,
    low: <Info size={20} />,
  }

  if (!canAction) {
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
                {(finding.context_text?.includes("Total unique URLs checked") || finding.context_text?.includes("URLs extracted from this page")) && (
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-600 border border-emerald-200 uppercase">
                      {Math.max(
                        0,
                        ...Array.from(
                          finding.context_text.matchAll(
                            /(?:Total unique URLs checked in run so far:|Total URLs checked in run so far:|URLs extracted from this page:)\s*(\d+)/g,
                          ),
                          (m) => parseInt(m[1], 10),
                        ),
                      )}{" "}
                      URLs Scanned
                    </span>
                  </div>
                )}
                {(() => {
                  if (!finding.description) return null

                  if (Array.isArray(links) && links.length > 0) {
                    const displayLinks = links.slice(0, 3)
                    const hasMore = links.length > 3
                    return (
                      <div className="flex flex-col gap-2">
                        <div className="overflow-x-auto overflow-y-auto max-h-[140px] border border-slate-200 rounded-md my-2 relative [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-200 hover:[&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
                          <table className="w-full text-[10px] text-left">
                            <thead className="bg-slate-50 dark:bg-[#131d22] text-slate-500 dark:text-slate-400 sticky top-0 z-10 shadow-[0_1px_0_0_#e2e8f0] dark:shadow-[0_1px_0_0_#334155]">
                              <tr>
                                <th className="px-3 py-2 font-bold uppercase tracking-wider">
                                  URL
                                </th>
                                <th className="px-3 py-2 font-bold uppercase tracking-wider">
                                  Reason
                                </th>
                                <th className="px-3 py-2 font-bold uppercase tracking-wider">
                                  Link Text
                                </th>
                                <th className="px-3 py-2 font-bold uppercase tracking-wider">
                                  Found On
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-slate-600 dark:text-slate-300">
                              {displayLinks.map((link: any, idx: number) => (
                                <tr
                                  key={idx}
                                  className="hover:bg-slate-50/50 dark:hover:bg-[#1d2a31]"
                                >
                                  <td className="px-3 py-2 break-all text-blue-500 min-w-[150px]">
                                    <a
                                      href={link.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="hover:underline"
                                    >
                                      {link.url}
                                    </a>
                                  </td>
                                  <td className="px-3 py-2">{link.reason}</td>
                                  <td className="px-3 py-2">
                                    {link["Link text"] || link.link_text}
                                  </td>
                                  <td className="px-3 py-2 break-all text-blue-500 min-w-[150px]">
                                    {link.found_on ? (
                                      <a
                                        href={link.found_on}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="hover:underline"
                                      >
                                        {link.found_on}
                                      </a>
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {hasMore && (
                          <button
                            onClick={() => setIsModalOpen(true)}
                            className="flex items-center text-accent hover:underline text-[10px] font-bold uppercase tracking-widest"
                          >
                            <Globe className="w-3 h-3 mr-2" />
                            View all {links.length} dead links
                          </button>
                        )}
                      </div>
                    )
                  }

                  // Ultimate fallback to raw text if no links could be extracted
                  return (
                    <>
                      <p
                        className={`text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed break-words ${isFalsePositive ? "text-slate-400" : ""} ${!isExpanded ? "line-clamp-3" : ""}`}
                      >
                        {finding.description}
                      </p>
                      {finding.description &&
                        finding.description.length > 150 && (
                          <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="text-[10px] font-bold text-accent uppercase tracking-widest mt-1 hover:text-black transition-colors"
                          >
                            {isExpanded ? "See less" : "See more"}
                          </button>
                        )}
                    </>
                  )
                })()}
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
          readOnly={isLocked}
          onChange={(e) => setLocalTitle(e.target.value)}
          className={`w-full px-4 py-3.5 bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-600 rounded-md font-bold text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500 ${isLocked ? "pointer-events-none" : ""}`}
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
          {(finding.context_text?.includes("Total unique URLs checked") || finding.context_text?.includes("URLs extracted from this page")) && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-600 border border-emerald-200 uppercase">
                {Math.max(
                  0,
                  ...Array.from(
                    finding.context_text.matchAll(
                      /(?:Total unique URLs checked in run so far:|Total URLs checked in run so far:|URLs extracted from this page:)\s*(\d+)/g,
                    ),
                    (m) => parseInt(m[1], 10),
                  ),
                )}{" "}
                URLs Scanned
              </span>
            </div>
          )}

          <div className="space-y-3">
            {(() => {
              if (!finding.description) return null

              if (Array.isArray(links) && links.length > 0) {
                const displayLinks = links.slice(0, 3)
                const hasMore = links.length > 3
                return (
                  <div className="flex flex-col gap-2">
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-md my-2">
                      <table className="w-full text-[10px] text-left">
                        <thead className="bg-slate-50 dark:bg-[#131d22] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            <th className="px-3 py-2 font-bold uppercase tracking-wider">
                              URL
                            </th>
                            <th className="px-3 py-2 font-bold uppercase tracking-wider">
                              Reason
                            </th>
                            <th className="px-3 py-2 font-bold uppercase tracking-wider">
                              Link Text
                            </th>
                            <th className="px-3 py-2 font-bold uppercase tracking-wider">
                              Found On
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-slate-600 dark:text-slate-300">
                          {displayLinks.map((link: any, idx: number) => (
                            <tr
                              key={idx}
                              className="hover:bg-slate-50/50 dark:hover:bg-[#1d2a31]"
                            >
                              <td className="px-3 py-2 break-all text-blue-500 min-w-[150px]">
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:underline"
                                >
                                  {link.url}
                                </a>
                              </td>
                              <td className="px-3 py-2">{link.reason}</td>
                              <td className="px-3 py-2">
                                {link["Link text"] || link.link_text}
                              </td>
                              <td className="px-3 py-2 break-all text-blue-500 min-w-[150px]">
                                {renderFoundOn(link.found_on)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {hasMore && (
                      <button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center text-accent hover:underline text-[10px] font-bold uppercase tracking-widest"
                      >
                        <Globe className="w-3 h-3 mr-2" />
                        View all {links.length} dead links
                      </button>
                    )}
                  </div>
                )
              }

              // Ultimate fallback to raw text if no links could be extracted
              return (
                <>
                  <p
                    className={`text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed break-words ${isFalsePositive ? "text-slate-400" : ""} ${!isExpanded ? "line-clamp-3" : ""}`}
                  >
                    {finding.description}
                  </p>
                  {finding.description && finding.description.length > 150 && (
                    <button
                      onClick={() => setIsExpanded(!isExpanded)}
                      className="text-[10px] font-bold text-accent uppercase tracking-widest mt-1 hover:text-black transition-colors"
                    >
                      {isExpanded ? "See less" : "See more"}
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-auto">
        <div className="flex items-center gap-2">
          {!(hasTask || isAssigned) && (
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
                disabled={isPushing}
                title={isPushed ? "View in Basecamp" : "Push to Basecamp"}
                className={`btn-unified px-3 flex items-center justify-center transition-all whitespace-nowrap active:scale-95 ${
                  isPushed
                    ? "bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-200 cursor-pointer animate-fade-in"
                    : "bg-[#0b1016] hover:bg-slate-800 text-white"
                }`}
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
          {isFalsePositive ? (
            <button
              onClick={() => onConfirm?.(finding.id)}
              className="btn-unified"
            >
              Re-flag as genuine
            </button>
          ) : (
            <>
              {!(hasTask || isAssigned || isPushed) && (
                <button
                  onClick={() => onFalsePositive?.(finding.id)}
                  className="btn-unified"
                >
                  False Positive
                </button>
              )}
              <div className="flex items-center gap-2">
                {!isPushed && (
                  <button
                    onClick={() =>
                      onCreateTask?.({
                        ...finding,
                        title: localTitle,
                        gallery_images: galleryImages,
                      })
                    }
                    disabled={hasTask || isAssigned}
                    className={`btn-unified ${hasTask || isAssigned ? "bg-accent text-white border-accent cursor-not-allowed" : ""}`}
                  >
                    {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
                  </button>
                )}

                {(hasTask || isAssigned) &&
                  assignedTaskIds &&
                  assignedTaskIds.length > 0 &&
                  assignedTaskIds[0] !== finding.id && (
                    <div className="ml-1 flex items-center gap-1">
                      <Link
                        to={`/projects/${projectId}?tab=tasks&taskId=${assignedTaskIds[0]}`}
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
                          bulkDeleteTasks(assignedTaskIds)
                        }}
                        disabled={isDeleting}
                        className="ml-1 text-slate-400 hover:text-red-500 transition-colors"
                        title="Unlink Task"
                      >
                        <Unlink2 size={14} />
                      </button>
                    </div>
                  )}
              </div>
            </>
          )}
        </div>

        {allAssigneesListForUI.length > 0 && (
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-[#131d22] border border-slate-100 dark:border-slate-700 p-1.5 rounded-full pl-3 pr-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">
              Assigned
            </span>
            <div className="flex -space-x-1.5 overflow-hidden">
              {allAssigneesListForUI.map((u, idx) => (
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
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-[#131d22]/80 backdrop-blur-sm transition-opacity duration-200">
          <div
            className="absolute inset-0 bg-transparent"
            onClick={() => setIsModalOpen(false)}
          />
          <div className="relative w-full max-w-5xl bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl overflow-hidden transition-all duration-200 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1d2a31] flex-shrink-0">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-accent/10 dark:bg-accent/20 rounded-md text-accent">
                  <Globe className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  All Dead Links
                </h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-0 overflow-y-auto flex-1">
              <table className="w-full text-[10px] text-left">
                <thead className="bg-slate-100 dark:bg-[#131d22] sticky top-0 shadow-sm z-10 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest w-12 text-center">
                      #
                    </th>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                      URL
                    </th>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                      Reason
                    </th>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                      Link Text
                    </th>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                      Found On
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-slate-600 dark:text-slate-300">
                  {links.map((link: any, idx: number) => (
                    <tr
                      key={idx}
                      className="hover:bg-slate-50/50 dark:hover:bg-[#131d22] transition-colors"
                    >
                      <td className="px-4 py-3 text-center text-slate-400 dark:text-slate-500 font-bold">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3 break-all text-blue-500 min-w-[200px]">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {link.url}
                        </a>
                      </td>
                      <td className="px-4 py-3 min-w-[150px]">{link.reason}</td>
                      <td className="px-4 py-3 font-medium">
                        {link["Link text"] || link.link_text}
                      </td>
                      <td className="px-4 py-3 break-all text-blue-500 min-w-[200px]">
                        {renderFoundOn(link.found_on)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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
    </div>
  )
}
