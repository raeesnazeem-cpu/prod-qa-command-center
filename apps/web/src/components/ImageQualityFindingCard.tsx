import React from "react"
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  Square,
  Image as ImageIcon,
  ExternalLink,
  Eye,
  Unlink2,
} from "lucide-react"
import { useBulkDeleteTasks } from "../hooks/useTasks"
import { useRole } from "../hooks/useRole"
import { useParams, Link } from "react-router-dom"
import { QAFinding } from "../api/runs.api"
import { useAuthAxios } from "../lib/useAuthAxios"

interface FindingCardProps {
  finding: QAFinding
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

interface ImgIssue {
  type: "blur" | "watermark"
  src: string
  thumb: string
  note: string
}

export const ImageQualityFindingCard: React.FC<FindingCardProps> = ({
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
  const { mutate: bulkDeleteTasks, isPending: isDeleting } = useBulkDeleteTasks()

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isPushing, setIsPushing] = React.useState(false)
  const initialIsPushed =
    finding.status === "confirmed" &&
    (!!(finding as any).basecamp_comment_url || !!(finding as any).basecamp_comment_id)
  const [isPushed, setIsPushed] = React.useState(initialIsPushed)
  const [commentUrl, setCommentUrl] = React.useState<string | null>(
    finding.status === "confirmed" ? (finding as any).basecamp_comment_url || null : null,
  )

  React.useEffect(() => setLocalTitle(finding.title), [finding.title])

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  const isLocked = hasTask || isAssigned || isPushed

  // The check stores the offending images as a JSON array in context_text.
  const issues: ImgIssue[] = React.useMemo(() => {
    try {
      const arr = JSON.parse(finding.context_text || "[]")
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  }, [finding.context_text])


  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const response = await api.post(`/api/findings/${finding.id}/push-basecamp`, {})
      if (response.data?.commentUrl) setCommentUrl(response.data.commentUrl)
      setIsPushed(true)
      if (onConfirm) onConfirm(finding.id)
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to push finding to Basecamp.")
    } finally {
      setIsPushing(false)
    }
  }

  const currentAssigneesForUI =
    finding.tasks?.flatMap((t: any) =>
      t.users ? (Array.isArray(t.users) ? t.users : [t.users]) : [],
    ) || []
  const allAssignees = [...currentAssigneesForUI, ...assignedUsers].flatMap((u: any) =>
    Array.isArray(u) ? u : [u],
  )

  const ImageRow: React.FC<{ it: ImgIssue; idx: number }> = ({ it, idx }) => (
    <tr className="hover:bg-slate-50/50 dark:hover:bg-[#1d2a31]">
      <td className="px-3 py-2 align-top text-center text-slate-400 font-bold">{idx + 1}</td>
      <td className="px-3 py-2 align-top">
        {it.thumb ? (
          <a href={it.thumb} target="_blank" rel="noreferrer">
            <img
              src={it.thumb}
              alt={it.type}
              className="w-24 h-16 object-cover rounded border border-slate-200 dark:border-slate-700"
            />
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
            it.type === "watermark"
              ? "bg-red-50 text-red-600 border border-red-200"
              : "bg-yellow-50 text-yellow-700 border border-yellow-200"
          }`}
        >
          {it.type}
        </span>
      </td>
      <td className="px-3 py-2 align-top break-all text-blue-500 min-w-[160px]">
        <a href={it.src} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">
          <ExternalLink size={11} /> {it.src}
        </a>
      </td>
      <td className="px-3 py-2 align-top text-slate-500 dark:text-slate-400">{it.note}</td>
    </tr>
  )

  const displayIssues = issues.slice(0, 4)
  const hasMore = issues.length > 4

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-sm hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${
        isConfirmed || isAssigned
          ? "border-emerald-500 ring-1 ring-emerald-500/20"
          : isFalsePositive
            ? "opacity-60 border-slate-200 dark:border-slate-800"
            : "border-slate-200 dark:border-slate-800 hover:border-accent/40"
      }`}
    >
      <div className="flex items-center gap-3">
        {canAction && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.(finding.id)
            }}
            className={`p-1 rounded transition-all ${isSelected ? "text-black scale-110" : "text-slate-300 hover:text-slate-400"}`}
          >
            {isSelected ? <CheckboxOn /> : <Square size={20} strokeWidth={2} />}
          </button>
        )}
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
          <ImageIcon size={14} className="text-accent" />
          image quality
        </div>
      </div>

      <div className="flex items-start gap-3">
        <div
          className={`mt-1 p-3 rounded-xl shrink-0 ${
            "bg-yellow-50 text-yellow-600"
          }`}
        >
          {<AlertCircle size={20} />}
        </div>
        <h4 className="font-bold text-slate-900 dark:text-slate-200 text-base leading-tight">
          {finding.title}
        </h4>
      </div>

      {issues.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-md">
            <table className="w-full text-[10px] text-left">
              <thead className="bg-slate-50 dark:bg-[#131d22] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 font-bold uppercase tracking-wider w-8">#</th>
                  <th className="px-3 py-2 font-bold uppercase tracking-wider">Reference Image</th>
                  <th className="px-3 py-2 font-bold uppercase tracking-wider">Issue</th>
                  <th className="px-3 py-2 font-bold uppercase tracking-wider">Image Link</th>
                  <th className="px-3 py-2 font-bold uppercase tracking-wider">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-slate-600 dark:text-slate-300">
                {displayIssues.map((it, idx) => (
                  <ImageRow key={idx} it={it} idx={idx} />
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center text-accent hover:underline text-[10px] font-bold uppercase tracking-widest"
            >
              <ImageIcon className="w-3 h-3 mr-2" />
              View all {issues.length} images
            </button>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{finding.description}</p>
      )}

      {/* Actions */}
      {canAction && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-auto">
          <div className="flex items-center gap-2">
            {!(hasTask || isAssigned) && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (isPushed && commentUrl) window.open(commentUrl, "_blank", "noopener,noreferrer")
                  else if (!isPushed) handlePushToBasecamp()
                }}
                disabled={isPushing}
                className={`btn-unified px-3 ${isPushed ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-[#0b1016] text-white"}`}
              >
                {isPushing ? "..." : isPushed ? "View in Basecamp" : "Push to Basecamp"}
              </button>
            )}
            {isFalsePositive ? (
              <button onClick={() => onConfirm?.(finding.id)} className="btn-unified">
                Re-flag as genuine
              </button>
            ) : (
              <>
                {!(hasTask || isAssigned || isPushed) && (
                  <button onClick={() => onFalsePositive?.(finding.id)} className="btn-unified">
                    False Positive
                  </button>
                )}
                {!isPushed && (
                  <button
                    onClick={() => onCreateTask?.({ ...finding, title: localTitle })}
                    disabled={hasTask || isAssigned}
                    className={`btn-unified ${hasTask || isAssigned ? "bg-accent text-white border-accent cursor-not-allowed" : ""}`}
                  >
                    {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
                  </button>
                )}
                {(hasTask || isAssigned) &&
                  assignedTaskIds.length > 0 &&
                  assignedTaskIds[0] !== finding.id && (
                    <div className="ml-1 flex items-center gap-1">
                      <Link
                        to={`/projects/${projectId}?tab=tasks&taskId=${assignedTaskIds[0]}`}
                        target="_blank"
                        className="text-slate-400 hover:text-accent"
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
                        className="ml-1 text-slate-400 hover:text-red-500"
                        title="Unlink Task"
                      >
                        <Unlink2 size={14} />
                      </button>
                    </div>
                  )}
              </>
            )}
          </div>
          {allAssignees.length > 0 && (
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-[#131d22] border border-slate-100 dark:border-slate-700 p-1.5 rounded-full pl-3 pr-2">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Assigned</span>
              <div className="flex -space-x-1.5">
                {allAssignees.map((u, idx) => (
                  <div
                    key={u?.id || idx}
                    className="w-6 h-6 rounded-full bg-slate-200 dark:bg-[#1d2a31] border-2 border-white dark:border-[#1D2A31] flex items-center justify-center text-[8px] font-bold text-slate-500 dark:text-slate-300"
                  >
                    {u?.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      (u?.full_name || u?.name)?.[0]?.toUpperCase() || "U"
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* View-all modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-[#131d22]/80 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setIsModalOpen(false)} />
          <div className="relative w-[90vw] max-w-[90vw] bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                All flagged images ({issues.length})
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="p-1 rounded-md text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-0 overflow-y-auto flex-1">
              <table className="w-full text-[10px] text-left">
                <thead className="bg-slate-100 dark:bg-[#131d22] sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest w-8">#</th>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Reference Image</th>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Issue</th>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Image Link</th>
                    <th className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-slate-600 dark:text-slate-300">
                  {issues.map((it, idx) => (
                    <ImageRow key={idx} it={it} idx={idx} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const CheckboxOn: React.FC = () => (
  <div className="flex items-center h-5 mr-3">
    <input
      type="checkbox"
      className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent accent-accent"
      checked
      readOnly
    />
  </div>
)
