import { useState, useEffect } from "react"
import { Project } from "../api/projects.api"
import {
  useRuns,
  useUpdateRunStatus,
  useDeleteRuns,
  usePinnedRuns,
  useTogglePinRun,
} from "../hooks/useRuns"
import { CreateRunModal } from "./CreateRunModal"
import { CanDo } from "./CanDo"
import {
  PlayCircle,
  ChevronRight,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  History,
  Pause,
  Play,
  Square,
  User,
  AlertCircle,
  Trash2,
  CheckSquare,
  Pin,
  PinOff,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { format } from "date-fns"

interface RunsTabProps {
  project: Project
}

const StatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#131d22] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </span>
      )
    case "running":
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800">
          <span className="relative flex h-2 w-2 mr-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          Running
        </span>
      )
    case "completed":
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Completed
        </span>
      )
    case "failed":
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </span>
      )
    case "paused":
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800">
          <Clock className="w-3 h-3 mr-1" />
          Paused
        </span>
      )
    case "cancelled":
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#131d22] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
          <AlertCircle className="w-3 h-3 mr-1" />
          Stopped
        </span>
      )
    default:
      return null
  }
}

export const RunsTab = ({ project }: RunsTabProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [page, setPage] = useState(1)
  const { data: runsData, isLoading } = useRuns(project.id, page)
  const { data: pinnedRunsData } = usePinnedRuns(project.id)
  const togglePinRun = useTogglePinRun(project.id)

  const updateStatus = useUpdateRunStatus()
  const deleteRuns = useDeleteRuns(project.id)
  const navigate = useNavigate()
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])

  const [showLimitModal, setShowLimitModal] = useState(false)
  const [showPinLimitModal, setShowPinLimitModal] = useState(false)
  const [pinRunModalId, setPinRunModalId] = useState<string | null>(null)
  const [unpinRunModalId, setUnpinRunModalId] = useState<string | null>(null)
  const [pinCustomName, setPinCustomName] = useState("")
  const [isDeletingLimit, setIsDeletingLimit] = useState(false)

  useEffect(() => {
    // Detect if we have more than 3 total runs, and we have enough data loaded to slice
    if (
      runsData &&
      runsData.pagination.total > 3 &&
      runsData.data &&
      runsData.data.length > 3 &&
      !isDeletingLimit
    ) {
      setIsDeletingLimit(true)
      setShowLimitModal(true)

      // Get all runs except the 3 most recent, filtering out pinned runs
      const runsToDelete = runsData.data
        .slice(3)
        .filter((run) => !run.is_pinned)
        .map((run) => run.id)

      if (runsToDelete.length > 0) {
        deleteRuns.mutate(runsToDelete, {
          onSettled: () => {
            // Keep modal visible slightly longer so the user can read it
            setTimeout(() => {
              setShowLimitModal(false)
              setIsDeletingLimit(false)
            }, 4000)
          },
        })
      }
    }
  }, [runsData, isDeletingLimit, deleteRuns])

  const handleToggleSelectAll = () => {
    if (!runsData?.data) return
    if (selectedRunIds.length === runsData.data.length) {
      setSelectedRunIds([])
    } else {
      setSelectedRunIds(runsData.data.map((run) => run.id))
    }
  }

  const handleDeleteSelected = () => {
    if (selectedRunIds.length === 0) return
    if (
      confirm(
        `Are you sure you want to delete ${selectedRunIds.length} run(s)? This will permanently remove all associated findings and data.`,
      )
    ) {
      deleteRuns.mutate(selectedRunIds, {
        onSuccess: () => setSelectedRunIds([]),
      })
    }
  }

  const handlePause = (e: React.MouseEvent, runId: string) => {
    e.stopPropagation()
    updateStatus.mutate({ runId, status: "paused" })
  }

  const handleResume = (e: React.MouseEvent, runId: string) => {
    e.stopPropagation()
    updateStatus.mutate({ runId, status: "running" })
  }

  const handleStop = (e: React.MouseEvent, runId: string) => {
    e.stopPropagation()
    if (confirm("Are you sure you want to stop this scan?")) {
      updateStatus.mutate({ runId, status: "cancelled" })
    }
  }

  const handlePinClick = (e: React.MouseEvent, runId: string) => {
    e.stopPropagation()
    if (
      pinnedRunsData &&
      pinnedRunsData.data &&
      pinnedRunsData.data.length >= 3
    ) {
      setShowPinLimitModal(true)
      return
    }
    setPinCustomName("")
    setPinRunModalId(runId)
  }

  const handleUnpinClick = (e: React.MouseEvent, runId: string) => {
    e.stopPropagation()
    setUnpinRunModalId(runId)
  }

  const handleConfirmPin = () => {
    if (!pinRunModalId) return
    if (!pinCustomName.trim()) {
      alert("Please enter a custom name for the pinned run.")
      return
    }
    togglePinRun.mutate(
      { runId: pinRunModalId, is_pinned: true, custom_name: pinCustomName },
      {
        onSuccess: () => {
          setPinRunModalId(null)
          setPinCustomName("")
        },
      },
    )
  }

  const handleConfirmUnpin = () => {
    if (!unpinRunModalId) return
    togglePinRun.mutate(
      { runId: unpinRunModalId, is_pinned: false },
      {
        onSuccess: () => {
          setUnpinRunModalId(null)
        },
      },
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-200 flex items-center">
            <History className="w-5 h-5 mr-2 text-slate-400" />
            QA Run History
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Monitor and trigger automated QA sessions for this project.
          </p>
        </div>
        <CanDo role="qa_engineer">
          <div className="flex items-center space-x-3">
            {selectedRunIds.length > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleteRuns.isPending}
                className="flex items-center space-x-2 px-4 py-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md text-sm font-bold hover:bg-red-100 dark:hover:bg-red-900/50 transition-all shadow-sm active:scale-95 border border-red-100 dark:border-red-800"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete ({selectedRunIds.length})</span>
              </button>
            )}
            <button
              onClick={handleToggleSelectAll}
              className="flex items-center space-x-2 px-4 py-2 bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md text-sm font-bold hover:bg-slate-50 dark:hover:bg-[#131d22] transition-all shadow-sm active:scale-95"
            >
              {selectedRunIds.length === (runsData?.data?.length || 0) &&
              (runsData?.data?.length || 0) > 0 ? (
                <Square className="w-4 h-4" />
              ) : (
                <CheckSquare className="w-4 h-4" />
              )}
              <span>
                {selectedRunIds.length === (runsData?.data?.length || 0) &&
                (runsData?.data?.length || 0) > 0
                  ? "Deselect All"
                  : "Select All"}
              </span>
            </button>
          </div>
        </CanDo>
      </div>

      {/* Pinned Runs Table */}
      {pinnedRunsData &&
        pinnedRunsData.data &&
        pinnedRunsData.data.length > 0 && (
          <div className="bg-pink-50/50 dark:bg-pink-900/10 border border-pink-200 dark:border-pink-800/30 rounded-md overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-pink-200 dark:border-pink-800/30 flex items-center justify-between">
              <h4 className="text-sm font-bold text-pink-900 dark:text-pink-300 flex items-center">
                <Pin className="w-4 h-4 mr-2" />
                Pinned Runs ({pinnedRunsData.data.length}/3)
              </h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-pink-100/50 dark:bg-pink-900/20 border-b border-pink-200 dark:border-pink-800/30">
                    <th className="px-6 py-4 text-xs font-bold text-pink-600 dark:text-pink-400 uppercase tracking-widest">
                      Name
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-pink-600 dark:text-pink-400 uppercase tracking-widest">
                      Run #
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-pink-600 dark:text-pink-400 uppercase tracking-widest">
                      Type
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-pink-600 dark:text-pink-400 uppercase tracking-widest">
                      Status
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-pink-600 dark:text-pink-400 uppercase tracking-widest text-center">
                      Issues Found
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-pink-600 dark:text-pink-400 uppercase tracking-widest">
                      Date
                    </th>
                    <th className="px-6 py-4 text-xs font-bold text-pink-600 dark:text-pink-400 uppercase tracking-widest text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pink-100 dark:divide-pink-900/20">
                  {pinnedRunsData.data.map((run, index) => (
                    <tr
                      key={run.id}
                      className="hover:bg-pink-100/50 dark:hover:bg-pink-900/30 cursor-pointer group transition-colors"
                      onClick={() =>
                        navigate(`/projects/${project.id}/runs/${run.id}`)
                      }
                    >
                      <td className="px-6 py-4">
                        <span className="text-sm font-bold text-pink-900 dark:text-pink-200">
                          {run.custom_name}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                          #{run.id.slice(0, 8)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            run.run_type === "pre_release"
                              ? "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800"
                              : "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-800"
                          }`}
                        >
                          {run.run_type.replace("_", "-")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-6 py-4 text-center">
                        {run.status === "completed" ||
                        run.status === "failed" ? (
                          <div
                            className={`inline-flex items-center px-2 py-0.5 rounded font-bold text-xs ${
                              (run.finding_counts
                                ? Object.values(run.finding_counts).reduce(
                                    (a, b) => (a as number) + (b as number),
                                    0,
                                  )
                                : 0) > 0
                                ? "text-red-600"
                                : "text-emerald-600"
                            }`}
                          >
                            {run.finding_counts
                              ? Object.values(run.finding_counts).reduce(
                                  (a, b) => (a as number) + (b as number),
                                  0,
                                )
                              : 0}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
                          <Calendar className="w-3.5 h-3.5 mr-2 text-slate-400" />
                          {format(new Date(run.created_at), "MMM d, HH:mm")}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-3">
                          <button
                            onClick={(e) => handleUnpinClick(e, run.id)}
                            className="p-1 hover:bg-pink-200 dark:hover:bg-pink-900/50 text-pink-600 dark:text-pink-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                            title="Unpin Run"
                          >
                            <PinOff size={16} />
                          </button>
                          <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-[#1d2a31] border-b border-slate-100 dark:border-slate-700">
                <th className="px-6 py-4 w-10"></th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Run #
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Type
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Creator
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Status
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">
                  Issues Found
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Date
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-6 py-4">
                      <div className="h-10 bg-slate-100 dark:bg-[#131d22] rounded-md w-full"></div>
                    </td>
                  </tr>
                ))
              ) : !runsData?.data || runsData.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <div className="p-3 bg-slate-100 dark:bg-[#131d22] rounded-full mb-3">
                        <History className="w-6 h-6 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-200">
                        No runs recorded yet
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Start your first QA session to see results here.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                runsData.data.map((run, index) => (
                  <tr
                    key={run.id}
                    className={`hover:bg-slate-50 dark:hover:bg-[#1d2a31] cursor-pointer group transition-colors ${selectedRunIds.includes(run.id) ? "bg-slate-50 dark:bg-[#1d2a31]" : ""}`}
                    onClick={() =>
                      navigate(`/projects/${project.id}/runs/${run.id}`)
                    }
                  >
                    <td
                      className="px-6 py-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRunIds.includes(run.id)}
                        onChange={(e) => {
                          setSelectedRunIds((prev) =>
                            e.target.checked
                              ? [...prev, run.id]
                              : prev.filter((id) => id !== run.id),
                          )
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-black focus:ring-black cursor-pointer"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                        #
                        {runsData.pagination.total -
                          (page - 1) * runsData.pagination.limit -
                          index}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          run.run_type === "pre_release"
                            ? "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800"
                            : "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-800"
                        }`}
                      >
                        {run.run_type.replace("_", "-")}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <User size={12} className="text-slate-400" />
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300 truncate max-w-[100px]">
                          {run.created_by_name || "System"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-6 py-4 text-center">
                      {run.status === "completed" || run.status === "failed" ? (
                        <div
                          className={`inline-flex items-center px-2 py-0.5 rounded font-bold text-xs ${
                            (run.finding_counts
                              ? Object.values(run.finding_counts).reduce(
                                  (a, b) => (a as number) + (b as number),
                                  0,
                                )
                              : 0) > 0
                              ? "text-red-600"
                              : "text-emerald-600"
                          }`}
                        >
                          {run.finding_counts
                            ? Object.values(run.finding_counts).reduce(
                                (a, b) => (a as number) + (b as number),
                                0,
                              )
                            : 0}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-400">
                        <Calendar className="w-3.5 h-3.5 mr-2 text-slate-400" />
                        {format(new Date(run.created_at), "MMM d, HH:mm")}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-3">
                        {(run.status === "running" ||
                          run.status === "pending" ||
                          run.status === "paused") && (
                          <div
                            className="flex items-center gap-1.5 bg-slate-50 dark:bg-[#1d2a31] p-1 rounded-md border border-slate-100 dark:border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {run.status === "running" ? (
                              <button
                                onClick={(e) => handlePause(e, run.id)}
                                disabled={updateStatus.isPending}
                                className="p-1 hover:bg-amber-50 dark:hover:bg-amber-900/30 text-amber-600 rounded transition-colors"
                                title="Pause Scan"
                              >
                                <Pause size={14} fill="currentColor" />
                              </button>
                            ) : run.status === "paused" ? (
                              <button
                                onClick={(e) => handleResume(e, run.id)}
                                disabled={updateStatus.isPending}
                                className="p-1 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-emerald-600 rounded transition-colors"
                                title="Resume Scan"
                              >
                                <Play size={14} fill="currentColor" />
                              </button>
                            ) : null}
                            <button
                              onClick={(e) => handleStop(e, run.id)}
                              disabled={updateStatus.isPending}
                              className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 rounded transition-colors"
                              title="Stop Scan"
                            >
                              <Square size={14} fill="currentColor" />
                            </button>
                          </div>
                        )}
                        <button
                          onClick={(e) => handlePinClick(e, run.id)}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors opacity-0 group-hover:opacity-100"
                          title="Pin Run"
                        >
                          <Pin size={16} />
                        </button>
                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {runsData && runsData.pagination.total > runsData.pagination.limit && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-xs text-slate-500 font-medium">
            Showing{" "}
            <span className="text-slate-900 dark:text-slate-200">
              {(page - 1) * runsData.pagination.limit + 1}
            </span>{" "}
            to{" "}
            <span className="text-slate-900 dark:text-slate-200">
              {Math.min(
                page * runsData.pagination.limit,
                runsData.pagination.total,
              )}
            </span>{" "}
            of{" "}
            <span className="text-slate-900 dark:text-slate-200">
              {runsData.pagination.total}
            </span>{" "}
            runs
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-[#131d22] disabled:opacity-50 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={
                page * runsData.pagination.limit >= runsData.pagination.total
              }
              className="px-3 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-[#131d22] disabled:opacity-50 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <CreateRunModal
        project={project}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />

      {/* Limitation Modal */}
      {showLimitModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-amber-100 dark:bg-amber-900/50 rounded-full mb-4">
              <AlertCircle className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-200 text-center mb-2">
              Limit Exceeded
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 text-center mb-6">
              More than 3 QA runs exist for this project. We are automatically
              deleting older runs to keep only the latest 3 records.
            </p>
            <div className="flex justify-center">
              <span className="inline-flex items-center px-4 py-2 bg-slate-100 dark:bg-[#1d2a31] text-slate-700 dark:text-slate-300 rounded-md text-sm font-bold">
                <span className="relative flex h-2 w-2 mr-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500"></span>
                </span>
                Cleaning up...
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Pin Run Setup Modal */}
      {pinRunModalId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-200 mb-4">
              Pin Run
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              Enter a custom name for this run. Pinned runs will not be deleted
              by the auto-cleanup process.
            </p>
            <input
              type="text"
              autoFocus
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131d22] rounded-md text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-accent mb-6"
              placeholder="e.g. Pre-Launch Golden Run"
              value={pinCustomName}
              onChange={(e) => setPinCustomName(e.target.value)}
            />
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setPinRunModalId(null)}
                className="px-4 py-2 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPin}
                className="px-4 py-2 text-sm font-bold text-white bg-accent hover:bg-accent/90 rounded-md transition-colors"
              >
                Pin Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pin Limit Exceeded Modal */}
      {showPinLimitModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-amber-100 dark:bg-amber-900/50 rounded-full mb-4">
              <AlertCircle className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-200 text-center mb-2">
              Pin Limit Exceeded
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 text-center mb-6">
              You can only have up to 3 pinned runs. Please unpin an existing
              run before pinning a new one.
            </p>
            <div className="flex justify-center">
              <button
                onClick={() => setShowPinLimitModal(false)}
                className="px-4 py-2 text-sm font-bold text-white bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-md transition-colors"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unpin Confirmation Modal */}
      {unpinRunModalId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-amber-100 dark:bg-amber-900/50 rounded-full mb-4">
              <AlertCircle className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-200 text-center mb-2">
              Unpin Run
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 text-center mb-6">
              Making this run unpinned will make it automatically deletable if
              it is older than the latest 3 runs. Are you sure?
            </p>
            <div className="flex justify-center space-x-3">
              <button
                onClick={() => setUnpinRunModalId(null)}
                className="px-4 py-2 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmUnpin}
                className="px-4 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
              >
                Yes, Unpin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
