import React from "react"
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  Plus,
  Square,
  CheckSquare,
  ClipboardList,
  Megaphone,
  Eye,
  Unlink2,
} from "lucide-react"
import { useBulkDeleteTasks } from "../hooks/useTasks"
import { useRole } from "../hooks/useRole"
import { useParams, Link } from "react-router-dom"
import { QAFinding } from "../api/runs.api"
import { useAuthAxios } from "../lib/useAuthAxios"
import { findingBorderClass } from "../lib/findingVerdict"

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

export const PaidMediaFindingCard: React.FC<FindingCardProps> = ({
  finding,
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
  const { mutate: bulkDeleteTasks, isPending: isDeleting } =
    useBulkDeleteTasks()

  const canAction = canDo("qa_engineer")

  const [localTitle, setLocalTitle] = React.useState(finding.title)
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

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const response = await api.post(`/api/findings/${finding.id}/push-basecamp`, {})
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
        })
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


  if (!canAction) {
    return (
      <div
        className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-sm hover:shadow-xl relative overflow-hidden flex flex-col gap-6 ${
          findingBorderClass(finding)
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
                : "bg-blue-50 text-blue-600"
            }`}
          >
            {isFalsePositive ? (
              <XCircle size={20} />
            ) : (
              <AlertCircle size={20} />
            )}
          </div>

          <div className="flex-1 min-w-0 w-full">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                  <Megaphone size={14} className="text-accent" />
                  PAID MEDIA
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
      className={`group w-full p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${
        findingBorderClass(finding)
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
            className={`p-1 rounded transition-all ${
              isSelected
                ? "text-black scale-110"
                : "text-slate-300 hover:text-slate-400"
            }`}
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
            <Megaphone size={14} className="text-accent" />
            PAID MEDIA
          </div>
        </div>
        <div className="flex flex-col items-end"></div>
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

      <div className="space-y-4">
        <div>
          <h5 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-tight mb-2">
            Paid Media Details
          </h5>
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
              className="text-[9px] font-bold text-accent uppercase tracking-[0.2em] hover:text-black transition-colors mt-2"
            >
              {isExpanded ? "See less" : "See more"}
            </button>
          )}
        </div>
      </div>

    </div>
  )
}
