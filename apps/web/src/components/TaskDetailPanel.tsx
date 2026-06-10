import { useState } from "react"
import {
  X,
  Layers,
  Calendar,
  ShieldAlert,
  CheckCircle2,
  Image as ImageIcon,
  Clock,
  ExternalLink,
  ChevronDown,
} from "lucide-react"
import { format } from "date-fns"
import { Task, TaskStatus, TaskSeverity } from "../api/tasks.api"
import {
  useTask,
  useUpdateTask,
  useAddRebuttal,
  useAssignTask,
  usePushToBasecamp,
  useCreateTask,
  useDeleteTask,
} from "../hooks/useTasks"
import { useProject } from "../hooks/useProjects"
import { useRole } from "../hooks/useRole"
import { CanDo } from "./CanDo"
import { BasecampPushButton, BasecampTaskLink } from "./BasecampPushButton"
import { CommentThread } from "./CommentThread"
import { ResolveTaskModal } from "./ResolveTaskModal"
import { TaskActivityFeed } from "./TaskActivityFeed"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "../lib/supabase"
import { useEffect } from "react"

interface TaskDetailPanelProps {
  task: Task | null
  isOpen: boolean
  onClose: () => void
}

export const TaskDetailPanel = ({
  task: initialTask,
  isOpen,
  onClose,
}: TaskDetailPanelProps) => {
  const [rebuttalText, setRebuttalText] = useState("")
  const [rebuttalUrl, setRebuttalUrl] = useState("")
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false)

  // Ensure we only fetch if we have a valid task and the panel is open
  const isValidTask = initialTask && (initialTask as any).project_id
  const { data: latestTask } = useTask(
    isValidTask && isOpen ? initialTask.id : "",
  )
  const task = latestTask || initialTask
  const { isDeveloper } = useRole()
  const hasRebuttals = (task?.rebuttals?.length || 0) > 0

  const { mutate: updateTask } = useUpdateTask()
  const { mutate: addRebuttal } = useAddRebuttal()
  const { mutate: assignTask } = useAssignTask()
  const { mutate: createTask } = useCreateTask()
  const { mutate: deleteTask } = useDeleteTask()
  const {
    mutate: pushToBasecamp,
    isPending: isPushing,
    isSuccess: pushSuccess,
  } = usePushToBasecamp()

  const queryClient = useQueryClient()

  // Real-time listener for THIS specific task
  useEffect(() => {
    if (!task?.id || !isOpen) return

    const channel = supabase
      .channel("tasks")
      .on("broadcast", { event: "task_updated" }, (payload) => {
        if (payload.payload?.taskId === task.id) {
          console.log("[Realtime] Refreshing task details and activity...")
          queryClient.invalidateQueries({ queryKey: ["tasks", task.id] })
          queryClient.invalidateQueries({
            queryKey: ["task-activity", task.id],
          })
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [task?.id, isOpen, queryClient])

  const { data: project } = useProject(task?.project_id || "")

  if (!task) return null

  const handlePush = () => {
    const isHeroMedia =
      task.findings?.check_factor === "hero_media" ||
      (task as any).check_factor === "hero_media"
    const isDeadLink =
      task.findings?.check_factor === "dead_links" ||
      (task as any).check_factor === "dead_links"
    const isLogoChatbot =
      task.findings?.check_factor === "logo_chatbot" ||
      (task as any).check_factor === "logo_chatbot"

    if (isHeroMedia) {
      console.log("Pushing hero media task to specific checklist item...", {
        taskId: task.id,
      })
    } else if (isDeadLink) {
      console.log("Pushing dead link task to specific checklist item...", {
        taskId: task.id,
      })
    } else if (isLogoChatbot) {
      console.log(
        "Pushing logo on chatbot task to specific checklist item...",
        {
          taskId: task.id,
        },
      )
    } else {
      console.log("Pushing task...", { taskId: task.id })
    }

    pushToBasecamp(task.id)
  }

  const handleStatusChange = (status: TaskStatus) => {
    if (isDeveloper && status === "resolved") {
      setIsResolveModalOpen(true)
      return
    }
    updateTask({ id: task.id, data: { status } })
  }

  const handleAssigneeChange = (userId: string) => {
    assignTask({ id: task.id, userId })
  }

  const handleAddRebuttal = (e: React.FormEvent) => {
    e.preventDefault()
    if (!rebuttalText.trim()) return
    addRebuttal(
      {
        taskId: task.id,
        data: { text: rebuttalText, screenshot_url: rebuttalUrl || undefined },
      },
      {
        onSuccess: () => {
          setRebuttalText("")
          setRebuttalUrl("")
        },
      },
    )
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity !mt-0"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 bottom-10 right-0 w-full max-w-xl bg-slate-50 dark:bg-[#131D22] shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col overflow-hidden !mt-0 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-[#131D22]">
          <div className="flex items-center space-x-3">
            <h2 className="font-bold text-slate-900 dark:text-white">
              Task Details
            </h2>
            <span
              className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${getSeverityStyles(task.severity)}`}
            >
              {task.severity}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 dark:hover:bg-[#1d2a31] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Main Content */}
          <div className="p-6 space-y-8">
            {/* Title & Status */}
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">
                {(() => {
                  const match = task.title.match(/^(Issue #\d+):?\s*(.*)$/)
                  if (match) {
                    return (
                      <div className="flex flex-col space-y-1">
                        <span className="text-accent text-sm font-bold uppercase tracking-[0.2em]">
                          {match[1]}
                        </span>
                        <span>{match[2]}</span>
                      </div>
                    )
                  }
                  return task.title
                })()}
              </h1>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                    Current Status
                  </span>
                  <select
                    value={task.status}
                    onChange={(e) =>
                      handleStatusChange(e.target.value as TaskStatus)
                    }
                    className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border focus:outline-none focus:ring-2 focus:ring-accent/20 ${getStatusStyles(task.status)}`}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    {!isDeveloper && <option value="closed">Closed</option>}
                  </select>
                </div>

                <CanDo role="qa_engineer">
                  <div className="flex flex-col space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      Assignees
                    </span>
                    <div className="flex flex-wrap gap-2 items-center">
                      {task.assignees?.map((a) => (
                        <div
                          key={a.taskId}
                          className={`flex items-center border rounded px-2.5 py-1 space-x-2 transition-all ${
                            a.taskId === task.id
                              ? "bg-accent/10 border-accent/20 text-accent"
                              : "bg-slate-50 dark:bg-[#1D2A31] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <span className="text-[11px] font-bold uppercase tracking-wider">
                            {a.name}
                          </span>
                          <button
                            onClick={() => {
                              if (
                                task.assignees &&
                                task.assignees.length <= 1
                              ) {
                                toast.error("Cannot remove the last assignee")
                                return
                              }
                              deleteTask(a.taskId, {
                                onSuccess: () => {
                                  if (a.taskId === task.id) onClose()
                                },
                              })
                            }}
                            className="p-0.5 hover:bg-slate-200/50 dark:hover:bg-[#1d2a31]/50 rounded-full transition-colors"
                          >
                            <X size={10} strokeWidth={3} />
                          </button>
                        </div>
                      ))}

                      <div className="relative">
                        <select
                          value=""
                          onChange={(e) => {
                            const userId = e.target.value
                            if (!userId) return
                            createTask({
                              project_id: task.project_id,
                              finding_id: task.finding_id,
                              title: task.title,
                              description: task.description,
                              severity: task.severity,
                              assigned_to: userId,
                              status: task.status,
                              gallery_images: task.gallery_images,
                            } as any)
                          }}
                          className="appearance-none bg-slate-50 dark:bg-[#1D2A31] border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-accent hover:text-accent text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-widest rounded-lg px-3 py-1 pr-8 cursor-pointer transition-all focus:outline-none"
                        >
                          <option value="">+ Add Dev</option>
                          {project?.project_members
                            .filter(
                              (m) =>
                                !task.assignees?.some(
                                  (a) => a.userId === m.user_id,
                                ),
                            )
                            .map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.users.full_name}
                              </option>
                            ))}
                        </select>
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                          <ChevronDown size={12} />
                        </div>
                      </div>
                    </div>
                  </div>
                </CanDo>

                {project?.basecamp_account_id &&
                  project?.basecamp_project_id &&
                  (project?.basecamp_todo_list_id ||
                    project?.basecamp_post_todo_list_id) && (
                    <BasecampPushButton
                      task={task}
                      onPush={handlePush}
                      isPending={isPushing}
                      isSuccess={pushSuccess}
                    />
                  )}
              </div>
            </div>

            {/* Meta Grid */}
            <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-50 dark:border-slate-800">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center">
                  <Layers className="w-3 h-3 mr-1" /> Project
                </span>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {task.projects?.name || "N/A"}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center">
                  <Calendar className="w-3 h-3 mr-1" /> Created
                </span>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {format(new Date(task.created_at), "MMM d, yyyy")}
                </p>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                Description
              </span>
              <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-50 dark:bg-[#1D2A31] p-4 rounded-xl border border-slate-100 dark:border-slate-700 min-h-[100px]">
                {task.description || "No description provided."}
              </div>
            </div>

            {/* Evidence Gallery */}
            {task.gallery_images && task.gallery_images.length > 0 && (
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center">
                  <ImageIcon className="w-3 h-3 mr-1" /> Evidence Gallery
                </span>
                <div className="grid grid-cols-3 gap-3">
                  {task.gallery_images.map((img, i) => (
                    <a
                      key={i}
                      href={img}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aspect-square bg-slate-100 dark:bg-[#1D2A31] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 group/img relative"
                    >
                      <img
                        src={img}
                        className="w-full h-full object-cover transition-transform group-hover/img:scale-110"
                        alt={`Evidence ${i + 1}`}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
                        <ExternalLink
                          size={16}
                          className="text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
                        />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Comment Thread */}
            <div className="pt-8 border-t border-slate-100 dark:border-slate-800">
              <CommentThread
                taskId={task.id}
                comments={task.comments || []}
                rebuttals={task.rebuttals || []}
              />
            </div>

            {/* Rebuttal Section */}
            {(hasRebuttals || isDeveloper) && (
              <div className="space-y-4 pt-8 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center space-x-2 text-red-600">
                  <ShieldAlert className="w-4 h-4" />
                  <h3 className="font-bold uppercase tracking-widest text-xs">
                    Developer Rebuttal
                  </h3>
                </div>

                <div className="bg-red-50/50 border border-red-100 rounded-xl p-4 space-y-4">
                  {isDeveloper && (
                    <p className="text-xs text-red-600 font-medium leading-relaxed">
                      If you disagree with this finding, provide a detailed
                      rebuttal and optional screenshot. QA will review it.
                    </p>
                  )}

                  {hasRebuttals && (
                    <div className="space-y-4">
                      {task.rebuttals?.map((r) => (
                        <div
                          key={r.id}
                          className="bg-slate-50 dark:bg-[#1D2A31] border border-red-100 dark:border-red-900/50 p-3 rounded-lg space-y-2"
                        >
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-red-400">
                            <span>{r.users?.full_name}</span>
                            <span>
                              {format(new Date(r.created_at), "MMM d, HH:mm")}
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300 italic">
                            {r.text}
                          </p>
                          {r.screenshot_url && (
                            <a
                              href={r.screenshot_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-[10px] font-bold text-accent hover:underline"
                            >
                              <ImageIcon className="w-3 h-3" />
                              <span>View Screenshot</span>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <CanDo role="developer">
                    <form onSubmit={handleAddRebuttal} className="space-y-3">
                      <textarea
                        value={rebuttalText}
                        onChange={(e) => setRebuttalText(e.target.value)}
                        placeholder="Explain why this finding is incorrect..."
                        className="w-full bg-slate-50 dark:bg-[#1D2A31] border border-red-100 dark:border-red-900/50 rounded-lg px-3 py-2 text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/20 resize-none min-h-[80px]"
                      />
                      <div className="flex items-center space-x-2">
                        <div className="relative flex-1">
                          <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input
                            type="url"
                            value={rebuttalUrl}
                            onChange={(e) => setRebuttalUrl(e.target.value)}
                            placeholder="Screenshot URL (optional)"
                            className="w-full bg-slate-50 dark:bg-[#1D2A31] border border-red-100 dark:border-red-900/50 rounded-lg pl-10 pr-3 py-2 text-xs dark:text-white focus:outline-none"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={!rebuttalText.trim()}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-red-700 transition-all active:scale-95 disabled:opacity-50"
                        >
                          Submit
                        </button>
                      </div>
                    </form>
                  </CanDo>
                </div>
              </div>
            )}

            {/* Activity Feed Sidebar/Section */}
            <div className="pt-8 border-t border-slate-100 dark:border-slate-800">
              <TaskActivityFeed taskId={task.id} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131D22] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              Last update:
              <br /> {format(new Date(task.updated_at), "MMM d, HH:mm")}
            </span>
          </div>
          <div className="flex items-center space-x-4">
            {task.basecamp_url && (
              <div className="animate-in fade-in zoom-in duration-300">
                <BasecampTaskLink url={task.basecamp_url} />
              </div>
            )}
            <button
              disabled
              className="inline-flex items-center space-x-2 text-slate-400 font-bold text-xs cursor-not-allowed opacity-60"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Mark as Resolved</span>
            </button>
          </div>
        </div>
      </div>

      <ResolveTaskModal
        task={task}
        isOpen={isResolveModalOpen}
        onClose={() => setIsResolveModalOpen(false)}
      />
    </>
  )
}

const getSeverityStyles = (severity: TaskSeverity) => {
  switch (severity) {
    case "critical":
      return "bg-red-50 text-red-600 border-red-100 dark:bg-[#1D2A31] dark:border-red-900/50 dark:text-red-400"
    case "high":
      return "bg-orange-50 text-orange-600 border-orange-100 dark:bg-[#1D2A31] dark:border-orange-900/50 dark:text-orange-400"
    case "medium":
      return "bg-yellow-50 text-yellow-600 border-yellow-100 dark:bg-[#1D2A31] dark:border-yellow-900/50 dark:text-yellow-400"
    case "low":
      return "bg-yellow-50 text-yellow-600 border-yellow-100 dark:bg-[#1D2A31] dark:border-yellow-900/50 dark:text-yellow-400"
    default:
      return "bg-slate-50 text-slate-600 border-slate-100 dark:bg-[#1D2A31] dark:border-slate-700 dark:text-slate-400"
  }
}

const getStatusStyles = (status: TaskStatus) => {
  switch (status) {
    case "open":
      return "bg-blue-50 text-blue-600 border-blue-100 dark:bg-[#1D2A31] dark:border-blue-900/50 dark:text-blue-400"
    case "in_progress":
      return "bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-[#1D2A31] dark:border-indigo-900/50 dark:text-indigo-400"
    case "resolved":
      return "bg-green-50 text-green-600 border-green-100 dark:bg-[#1D2A31] dark:border-green-900/50 dark:text-green-400"
    case "closed":
      return "bg-slate-50 text-slate-600 border-slate-100 dark:bg-[#1D2A31] dark:border-slate-700 dark:text-slate-400"
    default:
      return "bg-slate-50 text-slate-600 border-slate-100 dark:bg-[#1D2A31] dark:border-slate-700 dark:text-slate-400"
  }
}
