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
import { FindingSeverityEditor } from "./FindingSeverityEditor"
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
  const [isPushed, setIsPushed] = React.useState(finding.status === "confirmed")
  const [isExpanded, setIsExpanded] = React.useState(false)

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      await api.post(`/api/findings/${finding.id}/push-basecamp`, {})
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
          <FindingSeverityEditor
            findingId={finding.id}
            pageId={finding.page_id}
            currentSeverity={finding.severity}
            canEdit={!isFalsePositive}
            symbolOnly={true}
          />
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

      <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-auto">
        <div className="flex items-center gap-2">
        {!(hasTask || isAssigned) && (
          <button
            onClick={handlePushToBasecamp}
            disabled={isPushing || isPushed}
            title="Push to Basecamp"
            className={`btn-unified px-3 flex items-center justify-center transition-all active:scale-95 ${
              isPushed
                ? "bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default animate-fade-in"
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
        )}

          <div className="w-px h-6 bg-slate-200 mx-1"></div>

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
              {!isPushed && (
                <button
                  onClick={() =>
                    onCreateTask?.({
                      ...finding,
                      title: localTitle,
                    })
                  }
                  disabled={hasTask || isAssigned}
                  className={`btn-unified ${
                    hasTask || isAssigned
                      ? "bg-accent text-white cursor-not-allowed"
                      : ""
                  }`}
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
                        <Unlink2 size={16} />
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
    </div>
  )
}
