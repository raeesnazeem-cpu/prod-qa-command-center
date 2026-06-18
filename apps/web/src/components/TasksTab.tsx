import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { ProjectWithMembers } from "../api/projects.api"
import {
  useTasks,
  useUpdateTask,
  useDeleteTask,
  useBulkDeleteTasks,
} from "../hooks/useTasks"
import {
  CheckSquare,
  Clock,
  MoreHorizontal,
  MessageSquare,
  Search,
  Filter,
  Plus,
  CheckCircle2,
  ExternalLink,
  Trash2,
  Bell,
} from "lucide-react"
import { TaskStatus } from "@qacc/shared"
import { CreateTaskModal } from "./CreateTaskModal"
import { CanDo } from "./CanDo"
import { BulkBasecampPush } from "./BulkBasecampPush"
import { PendingReminderModal } from "./PendingReminderModal"
import { TaskDetailPanel } from "./TaskDetailPanel"
import { NotResolvedModal } from "./NotResolvedModal"
import { ResolveTaskModal } from "./ResolveTaskModal"
import { useRole } from "../hooks/useRole"
import { Task } from "../api/tasks.api"

interface TasksTabProps {
  project?: ProjectWithMembers
}

const getTaskStatusColor = (status: string) => {
  switch (status) {
    case "open":
      return "text-blue-500 dark:text-blue-400"
    case "in_progress":
      return "text-amber-500 dark:text-amber-400"
    case "resolved":
      return "text-emerald-500 dark:text-emerald-400"
    case "closed":
      return "text-purple-500 dark:text-purple-400"
    default:
      return "text-slate-500 dark:text-slate-400"
  }
}

export const TasksTab = ({ project }: TasksTabProps) => {
  const { data: tasksData, isLoading } = useTasks({
    projectId: project?.id,
    limit: 1000,
  })

  const tasks = (tasksData?.data || []).filter(
    (task: any) => !task.title?.includes("[Feedback]"),
  )
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const taskIdParam = searchParams.get("taskId")

  useEffect(() => {
    if (taskIdParam && tasks.length > 0) {
      const task = tasks.find((t) => t.id === taskIdParam)
      if (task) {
        setSelectedTask(task)
      }
    }
  }, [taskIdParam, tasks])

  const [notResolvedTask, setNotResolvedTask] = useState<Task | null>(null)
  const [resolveTaskData, setResolveTaskData] = useState<Task | null>(null)
  const [isPendingReminderOpen, setIsPendingReminderOpen] = useState(false)
  const { isDeveloper } = useRole()
  const { mutate: updateTask } = useUpdateTask()
  const { mutate: deleteTask } = useDeleteTask()
  const { mutate: bulkDelete } = useBulkDeleteTasks()

  const toggleTaskSelection = (taskIds: string[]) => {
    setSelectedTaskIds((prev) => {
      const allExist = taskIds.every((id) => prev.includes(id))
      if (allExist) {
        return prev.filter((id) => !taskIds.includes(id))
      } else {
        return [...new Set([...prev, ...taskIds])]
      }
    })
  }

  const groupTasksForUI = (tasks: any[]) => {
    const groups = new Map<string, any>()
    tasks.forEach((task) => {
      const groupKey = task.finding_id || task.title
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          ...task,
          assignees: task.users ? [task.users] : [],
          allIds: [task.id],
        })
      } else {
        const group = groups.get(groupKey)
        if (
          task.users &&
          !group.assignees.some((u: any) => u.id === task.users.id)
        ) {
          group.assignees.push(task.users)
        }
        group.allIds.push(task.id)
        // Combine comments
        if (task.comments && task.comments.length > 0) {
          const existingCommentIds = new Set(
            group.comments?.map((c: any) => c.id) || [],
          )
          task.comments.forEach((c: any) => {
            if (!existingCommentIds.has(c.id)) {
              group.comments = [...(group.comments || []), c]
            }
          })
        }
      }
    })
    return Array.from(groups.values())
  }

  const groupedTasks = groupTasksForUI(tasks)

  const selectedInProgressTasks = tasks.filter(
    (t) => selectedTaskIds.includes(t.id) && t.status === "in_progress",
  )

  const columns: { id: TaskStatus; title: string }[] = [
    { id: "open", title: "To Do" },
    { id: "in_progress", title: "In Progress" },
    { id: "resolved", title: "Resolved" },
    { id: "closed", title: "Closed" },
  ]

  const handleStatusChange = (task: Task, newStatus: TaskStatus) => {
    if (isDeveloper && newStatus === "resolved") {
      setResolveTaskData(task)
      return
    }
    updateTask({ id: task.id, data: { status: newStatus } })
  }

  const handleDelete = (taskIds: string[]) => {
    if (window.confirm("Are you sure you want to delete this task?")) {
      if (taskIds.length === 1) {
        deleteTask(taskIds[0])
      } else {
        bulkDelete(taskIds)
      }
    }
  }

  const handleBulkDelete = () => {
    if (
      window.confirm(
        `Are you sure you want to delete ${selectedTaskIds.length} tasks?`,
      )
    ) {
      bulkDelete(selectedTaskIds, {
        onSuccess: () => setSelectedTaskIds([]),
      })
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800"
      case "high":
        return "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800"
      case "medium":
        return "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-800"
      case "low":
        return "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 border-yellow-100 dark:border-yellow-800"
      default:
        return "bg-slate-50 dark:bg-[#131d22] text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700"
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-200">
          {project ? `${project.name} Tasks` : "All Workspace Tasks"}
        </h2>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search tasks..."
              className="bg-slate-50 dark:bg-[#212630] text-slate-900 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent transition-all w-full md:w-64"
            />
          </div>

          {selectedTaskIds.length > 0 ? (
            <div className="flex items-center space-x-2">
              <BulkBasecampPush
                taskIds={selectedTaskIds}
                onComplete={() => setSelectedTaskIds([])}
                mode="comment"
              />
              {selectedInProgressTasks.length > 1 && (
                <button
                  onClick={() => setIsPendingReminderOpen(true)}
                  className="inline-flex items-center space-x-2 px-4 py-2 rounded-md font-bold text-sm bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-all shadow-sm active:scale-95"
                >
                  <Bell className="w-4 h-4" />
                  <span>Pending reminder</span>
                </button>
              )}
              <CanDo role="qa_engineer">
                <button
                  onClick={handleBulkDelete}
                  className="btn-unified-secondary bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50 p-2"
                  title="Delete selected tasks"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </CanDo>
            </div>
          ) : (
            <>
              <button className="btn-unified-secondary p-2">
                <Filter className="w-4 h-4" />
              </button>

              <CanDo role="qa_engineer">
                <button
                  disabled
                  className="inline-flex items-center space-x-2 bg-slate-100 dark:bg-[#1d2a31] text-slate-400 px-4 py-2 rounded-md font-bold text-sm cursor-not-allowed opacity-60"
                  title="Select tasks to see bulk actions"
                >
                  <MoreHorizontal className="w-4 h-4" />
                  <span>Bulk Actions</span>
                </button>
              </CanDo>
            </>
          )}

          <CanDo role="qa_engineer">
            <button
              onClick={() => setIsTaskModalOpen(true)}
              className="btn-unified flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Task</span>
            </button>
          </CanDo>
        </div>
      </div>

      <CreateTaskModal
        projectId={project?.id}
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {columns.map((column) => (
          <div key={column.id} className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 uppercase tracking-widest text-[11px] flex items-center gap-2">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      groupedTasks.filter((t) => t.status === column.id)
                        .length === 0
                        ? "bg-slate-300 dark:bg-slate-600"
                        : column.title === "To Do"
                          ? "bg-blue-500 dark:bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.4)]"
                          : column.title === "In Progress"
                            ? "bg-amber-500 dark:bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                            : column.title === "Resolved"
                              ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                              : column.title === "Closed"
                                ? "bg-purple-500 dark:bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)]"
                                : "bg-slate-500 dark:bg-slate-400"
                    }`}
                  />
                  {column.title}
                </h3>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white shadow-md ${
                    groupedTasks.filter((t) => t.status === column.id)
                      .length === 0
                      ? "bg-slate-300 dark:bg-slate-600"
                      : column.title === "To Do"
                        ? "bg-blue-500 dark:bg-blue-400"
                        : column.title === "In Progress"
                          ? "bg-amber-500 dark:bg-amber-400"
                          : column.title === "Resolved"
                            ? "bg-emerald-500 dark:bg-emerald-400"
                            : column.title === "Closed"
                              ? "bg-purple-500 dark:bg-purple-400"
                              : "bg-slate-500 dark:bg-slate-400"
                  }`}
                >
                  {groupedTasks.filter((t) => t.status === column.id).length}
                </span>
              </div>
              <button className="text-slate-400 hover:text-slate-600">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 min-h-[500px] bg-transparent dark:bg-transparent rounded-xl p-2 border border-dashed border-slate-200 dark:border-slate-800">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-40 space-y-2">
                  <Clock className="w-6 h-6 text-accent animate-spin" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Loading...
                  </p>
                </div>
              ) : groupedTasks.filter((t) => t.status === column.id).length ===
                0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center space-y-2 opacity-50">
                  <CheckSquare className="w-8 h-8 text-slate-200 dark:text-slate-700" />
                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest italic">
                    No tasks
                  </p>
                </div>
              ) : (
                groupedTasks
                  .filter((t) => t.status === column.id)
                  .map((task) => (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className={`bg-[#fbfbfd] dark:bg-[#1B2A30] dark:hover:bg-transparent p-4 rounded-xl border shadow-sm hover:shadow-md transition-all cursor-pointer group relative ${
                        selectedTaskIds.includes(task.id)
                          ? "border-accent ring-1 ring-accent/20"
                          : "border-transparent dark:border-slate-800 dark:hover:border-accent/40"
                      }`}
                    >
                      <div
                        className="absolute inset-0 rounded-xl pointer-events-none p-[1px] drop-shadow-sm opacity-100 dark:opacity-0 transition-opacity duration-500 overflow-hidden"
                        style={{
                          mask: "linear-gradient(#fff 0 0) content-box exclude, linear-gradient(#fff 0 0)",
                          WebkitMask:
                            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                          WebkitMaskComposite: "xor",
                        }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-200 via-accent/30 to-slate-200/30 group-hover:opacity-50 transition-opacity duration-700"></div>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300%] aspect-square bg-[conic-gradient(from_0deg,transparent_0_45deg,theme(colors.accent)_135deg,transparent_180deg_225deg,#a3d4c7_315deg,transparent_360deg)] opacity-100 dark:opacity-0 group-hover:opacity-100 group-hover:animate-[spin_4s_linear_infinite]"></div>
                      </div>
                      {/* Selection Checkbox */}
                      <div
                        className="absolute -top-2 -left-2 z-20"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleTaskSelection(task.allIds || [task.id])
                        }}
                      >
                        <div
                          className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                            task.allIds?.every((id: string) =>
                              selectedTaskIds.includes(id),
                            )
                              ? "bg-accent border-accent text-white shadow-sm"
                              : "bg-slate-50 dark:bg-[#131d22] border-slate-200 dark:border-slate-700 text-transparent hover:border-accent group-hover:text-slate-200 dark:group-hover:text-slate-700"
                          }`}
                        >
                          <CheckCircle2 size={12} strokeWidth={3} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between mb-2 relative z-10">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getSeverityColor(task.severity)}`}
                          >
                            {task.severity}
                          </span>
                          {task.basecamp_url && (
                            <div
                              className="text-emerald-600"
                              title="Synced with Basecamp"
                            >
                              <CheckCircle2 size={12} />
                            </div>
                          )}
                        </div>

                        <div className="relative group/status flex items-center space-x-2">
                          <select
                            value={task.status}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              handleStatusChange(
                                task,
                                e.target.value as TaskStatus,
                              )
                            }
                            className={`text-[10px] font-bold uppercase tracking-wider bg-slate-50 dark:bg-[#1d2a31] border-none rounded px-1.5 py-0.5 focus:ring-0 cursor-pointer appearance-none transition-colors ${getTaskStatusColor(task.status)}`}
                          >
                            {columns.map((col) => (
                              <option key={col.id} value={col.id}>
                                {col.title}
                              </option>
                            ))}
                          </select>
                          <CanDo role="qa_engineer">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(task.allIds || [task.id])
                              }}
                              className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                              title="Delete task"
                            >
                              <Trash2 size={12} />
                            </button>
                          </CanDo>
                        </div>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors leading-tight mb-4 relative z-10">
                        {(() => {
                          const match = task.title.match(
                            /^(Issue #\d+):?\s*(.*)$/,
                          )
                          if (match) {
                            return (
                              <div className="flex items-center gap-1.5">
                                <span className="text-accent font-bold whitespace-nowrap">
                                  {match[1]}
                                </span>
                                <span className="text-slate-900 dark:text-slate-200 font-bold truncate">
                                  {match[2]}
                                </span>
                              </div>
                            )
                          }
                          return task.title
                        })()}
                      </h4>
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-50 dark:border-slate-800/50 relative z-10">
                        <div className="flex items-center space-x-3 text-slate-400">
                          <div className="flex items-center space-x-1 text-sky-500 dark:text-sky-400">
                            <MessageSquare className="w-3 h-3" />
                            <span className="text-[10px] font-bold">
                              {((task as any).comments?.length || 0) +
                                ((task as any).rebuttals?.length || 0)}
                            </span>
                          </div>
                          {task.basecamp_url && (
                            <a
                              href={task.basecamp_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-sky-400"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        {column.id === "resolved" && (
                          <CanDo role="qa_engineer">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setNotResolvedTask(task)
                              }}
                              className="btn-unified-secondary py-1 px-3 text-[10px] bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50"
                            >
                              Not Resolved
                            </button>
                          </CanDo>
                        )}

                        <div className="flex items-center -space-x-2">
                          {task.assignees?.map((user: any) => (
                            <div
                              key={user.id}
                              className="w-6 h-6 rounded-full bg-slate-100 dark:bg-[#131d22] flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400 border-2 border-white dark:border-slate-600 uppercase"
                              title={`Assigned to: ${user.full_name}`}
                            >
                              {user.full_name
                                .split(" ")
                                .map((word: string) => word.charAt(0))
                                .join("")}{" "}
                            </div>
                          ))}
                          {!task.assignees?.length && (
                            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-[#131d22] flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400 border-2 border-white dark:border-[#1B2A30] uppercase">
                              ?
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        ))}
      </div>

      <TaskDetailPanel
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => {
          setSelectedTask(null)
          if (searchParams.has("taskId")) {
            searchParams.delete("taskId")
            setSearchParams(searchParams)
          }
        }}
      />

      <NotResolvedModal
        task={notResolvedTask}
        isOpen={!!notResolvedTask}
        onClose={() => setNotResolvedTask(null)}
      />

      <ResolveTaskModal
        task={resolveTaskData}
        isOpen={!!resolveTaskData}
        onClose={() => setResolveTaskData(null)}
      />

      <PendingReminderModal
        tasks={selectedInProgressTasks}
        project={project}
        isOpen={isPendingReminderOpen}
        onClose={() => setIsPendingReminderOpen(false)}
        onSuccess={() => setSelectedTaskIds([])}
      />
    </div>
  )
}
