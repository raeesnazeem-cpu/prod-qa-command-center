import { useState, useEffect } from "react"
import { useRole } from "../hooks/useRole"
import { useQuery } from "@tanstack/react-query"
import { useAuthAxios } from "../lib/useAuthAxios"
import toast from "react-hot-toast"
import {
  Upload,
  X,
  Send,
  CheckSquare,
  ArrowUpRight,
  ExternalLink,
  MessageSquare,
  CheckCircle2,
  Trash2,
  ClipboardList,
} from "lucide-react"
import { Link } from "react-router-dom"
import { TaskDetailPanel } from "../components/TaskDetailPanel"
import { NotResolvedModal } from "../components/NotResolvedModal"
import { useDeleteTask, useUpdateTask } from "../hooks/useTasks"
import { Skeleton } from "../components/Skeleton"
import { useProjects } from "../hooks/useProjects"

// Sub-components duplicated for Kanban rendering
const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "critical":
      return "bg-red-50 text-red-600 border-red-100"
    case "high":
      return "bg-amber-50 text-amber-600 border-amber-100"
    case "medium":
      return "bg-amber-50 text-amber-600 border-amber-100"
    case "low":
      return "bg-yellow-50 text-yellow-600 border-yellow-100"
    default:
      return "bg-slate-50 text-slate-500 border-slate-200"
  }
}

const groupTasksForUI = (tasks: any[]) => {
  const groups = new Map<string, any>()
  tasks.forEach((task) => {
    const groupKey = task.finding_id || task.title
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        ...task,
        assignees: task.users ? [task.users] : [],
      })
    } else {
      const group = groups.get(groupKey)
      if (
        task.users &&
        !group.assignees.some((u: any) => u.id === task.users.id)
      ) {
        group.assignees.push(task.users)
      }
      if (task.comments && task.comments.length > 0) {
        const existingCommentIds = new Set(
          group.comments?.map((c: any) => c.id) || [],
        )
        task.comments.forEach((c: any) => {
          if (!existingCommentIds.has(c.id))
            group.comments = [...(group.comments || []), c]
        })
      }
    }
  })
  return Array.from(groups.values())
}

const KanbanCard = ({ task, onClick, role, onDelete, onNotResolved }: any) => {
  const isQA = role === "qa_engineer"
  const isSuperAdmin = role === "super_admin"
  const isAdmin = role === "admin" || role === "super_admin"
  const isNonAdmin = !isAdmin
  const { mutate: updateTask } = useUpdateTask()

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    updateTask({
      id: task.id,
      data: {
        status: e.target.value as
          | "open"
          | "in_progress"
          | "resolved"
          | "closed",
      },
    })
  }

  const handleSeverityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    updateTask({
      id: task.id,
      data: {
        severity: e.target.value as "critical" | "high" | "medium" | "low",
      },
    })
  }

  return (
    <div
      onClick={() => onClick(task)}
      className="bg-[#fbfbfd] dark:bg-[#1B2A30] dark:hover:bg-transparent p-4 rounded-xl border border-transparent dark:border-slate-700 shadow-lg hover:shadow-xl transition-all cursor-pointer group relative"
    >
      <div className="flex items-center justify-between mb-2 relative z-10">
        <select
          value={task.severity || "medium"}
          onChange={handleSeverityChange}
          onClick={(e) => e.stopPropagation()}
          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border cursor-pointer appearance-none outline-none ${getSeverityColor(task.severity)}`}
        >
          <option value="critical">CRITICAL</option>
          <option value="high">HIGH</option>
          <option value="medium">MEDIUM</option>
          <option value="low">LOW</option>
        </select>
        <div className="flex items-center gap-2">
          {task.basecamp_url && (
            <CheckCircle2 size={12} className="text-emerald-600" />
          )}
          <select
            value={task.status}
            onChange={handleStatusChange}
            onClick={(e) => e.stopPropagation()}
            disabled={isNonAdmin}
            className={`text-[10px] font-bold uppercase tracking-wider bg-slate-50 dark:bg-[#1d2a31] border-none rounded px-1.5 py-0.5 focus:ring-0 appearance-none text-slate-400 transition-colors ${
              isNonAdmin ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            <option value="open">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            {(isSuperAdmin || task.status === "closed") && <option value="closed">Closed</option>}
          </select>
          {isQA && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(task.id)
              }}
              className="p-1 text-slate-300 hover:text-red-500 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      <h4 className={`text-sm font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors leading-tight relative z-10 ${task.status === "closed" ? "mb-1" : "mb-4"}`}>
        {task.title}
      </h4>
      {task.status === "closed" && (
        <p className="text-[10px] font-bold text-slate-400 mb-4 relative z-10">
          Closed by Super Admin
        </p>
      )}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-50 dark:border-slate-700 relative z-10">
        <div className="flex items-center space-x-3 text-slate-400">
          <div className="flex items-center space-x-1">
            <MessageSquare className="w-3 h-3" />
            <span className="text-[10px] font-bold">
              {task.comments?.length || 0}
            </span>
          </div>
          {task.basecamp_url && (
            <ExternalLink className="w-3 h-3 text-emerald-500" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {task.status === "resolved" && isNonAdmin && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNotResolved(task)
              }}
              className="text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded-md hover:bg-red-100 transition-colors"
            >
              Not Resolved
            </button>
          )}
          {task.creator && (
            <div
              className="w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center text-[10px] font-bold border border-accent/20 shrink-0"
              title={task.creator.full_name || task.creator.email}
            >
              {(task.creator.full_name || task.creator.email || "?")
                .charAt(0)
                .toUpperCase()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const KanbanColumn = ({ title, tasks, onTaskClick, role, onDelete, onNotResolved }: any) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between px-2">
      <h3 className="font-bold text-slate-900 dark:text-slate-100 uppercase tracking-widest text-[11px] flex items-center gap-2">
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            tasks.length === 0
              ? "bg-slate-300 dark:bg-slate-600"
              : title === "To Do"
                ? "bg-blue-500 dark:bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.4)]"
                : title === "In Progress"
                  ? "bg-amber-500 dark:bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                  : title === "Resolved"
                    ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                    : title === "Closed"
                      ? "bg-purple-500 dark:bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)]"
                      : "bg-slate-500 dark:bg-slate-400"
          }`}
        />
        {title}
      </h3>
      <span
        className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white shadow-md ${
          tasks.length === 0
            ? "bg-slate-300 dark:bg-slate-600"
            : title === "To Do"
              ? "bg-blue-500 dark:bg-blue-400"
              : title === "In Progress"
                ? "bg-amber-500 dark:bg-amber-400"
                : title === "Resolved"
                  ? "bg-emerald-500 dark:bg-emerald-400"
                  : title === "Closed"
                    ? "bg-purple-500 dark:bg-purple-400"
                    : "bg-slate-500 dark:bg-slate-400"
        }`}
      >
        {tasks.length}
      </span>
    </div>
    <div className="space-y-4 min-h-[200px] bg-transparent rounded-md p-2 border border-dashed border-slate-200/60">
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-center space-y-2 opacity-30 grayscale">
          <CheckSquare className="w-6 h-6 text-slate-400" />
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest italic">
            No tasks
          </p>
        </div>
      ) : (
        tasks.map((task: any) => (
          <KanbanCard
            key={task.id}
            task={task}
            onClick={onTaskClick}
            role={role}
            onDelete={onDelete}
            onNotResolved={onNotResolved}
          />
        ))
      )}
    </div>
  </div>
)

const ProjectKanban = ({
  project,
  tasks,
  onTaskClick,
  role,
  onDelete,
  onNotResolved,
}: any) => {
  const groupedTasks = groupTasksForUI(tasks)
  const columns = [
    { id: "open", title: "To Do" },
    { id: "in_progress", title: "In Progress" },
    { id: "resolved", title: "Resolved" },
    { id: "closed", title: "Closed" },
  ]
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4">
          <div className="w-1.5 h-8 bg-accent rounded-full shadow-sm shadow-accent/20" />
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
              {project.name}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-0.5">
              Feedback Workflow
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {columns.map((col) => (
          <KanbanColumn
            key={col.id}
            title={col.title}
            tasks={groupedTasks.filter((t) => t.status === col.id)}
            onTaskClick={onTaskClick}
            role={role}
            onDelete={onDelete}
            onNotResolved={onNotResolved}
          />
        ))}
      </div>
    </div>
  )
}

export const FeedbackPage = () => {
  const { role, isLoading, isAdmin, profile } = useRole()
  const axios = useAuthAxios()
  const { data: projectsData, isLoading: isProjectsLoading } = useProjects()

  const [heading, setHeading] = useState("")
  const [description, setDescription] = useState("")
  const [projectId, setProjectId] = useState("")
  const [stage, setStage] = useState("")
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedTask, setSelectedTask] = useState<any>(null)
  const [notResolvedTask, setNotResolvedTask] = useState<any>(null)
  const { mutate: deleteTask } = useDeleteTask()

  const { data: tasksData, isLoading: isTasksLoading } = useQuery({
    queryKey: ["tasks", "feedback-tasks"],
    queryFn: async () => {
      const response = await axios.get("/api/tasks?limit=1000")
      return response.data
    },
    enabled: !isLoading && isAdmin,
  })

  const { data: userTasksData, isLoading: isUserTasksLoading } = useQuery({
    queryKey: ["tasks", "user-feedback-tasks"],
    queryFn: async () => {
      const response = await axios.get("/api/tasks?limit=1000")
      return response.data
    },
    enabled: !isLoading && !isAdmin,
  })

  const [activeTab, setActiveTab] = useState<"report" | "history">("report")
  const [isDragging, setIsDragging] = useState(false)

  const processFiles = (files: File[]) => {
    const newFiles = files.filter((f) => f.type.startsWith("image/"))
    if (newFiles.length === 0) return

    setScreenshots((prev) => {
      if (prev.length + newFiles.length > 3) {
        toast.error("You can only upload up to 3 screenshots.")
        return prev
      }
      return [...prev, ...newFiles].slice(0, 3)
    })
  }

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files) {
        processFiles(Array.from(e.clipboardData.files))
      }
    }
    window.addEventListener("paste", handlePaste)
    return () => window.removeEventListener("paste", handlePaste)
  }, [])

  if (isLoading || (isAdmin && isTasksLoading) || (!isAdmin && isUserTasksLoading)) {
    return (
      <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20 p-8">
        <Skeleton className="h-10 w-64" />
      </div>
    )
  }

  // Super-admin / admin sees the filtered kanban task board
  if (isAdmin) {
    // Only see tasks designated as Feedback
    const feedbackTasks = (tasksData?.data || []).filter((t: any) =>
      t.title?.includes("[Feedback]"),
    )

    return (
      <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-sm transition-all">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
              Feedback Zone
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
              Feedback and corrections needed on app functioning.
            </p>
          </div>
        </div>

        <div className="space-y-20">
          {feedbackTasks.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-md p-12 text-center text-slate-400 text-sm font-medium italic">
              No feedback tasks found.
            </div>
          ) : (
            (() => {
              const groupedTasks = feedbackTasks.reduce(
                (acc: Record<string, any[]>, task: any) => {
                  const projectId = task.project_id || "unassigned"
                  if (!acc[projectId]) acc[projectId] = []
                  acc[projectId].push(task)
                  return acc
                },
                {},
              )

              return Object.keys(groupedTasks).map((projectId) => (
                <ProjectKanban
                  key={projectId}
                  project={{
                    id: projectId,
                    name:
                      groupedTasks[projectId][0]?.projects?.name ||
                      "Feedback Project",
                  }}
                  tasks={groupedTasks[projectId]}
                  onTaskClick={setSelectedTask}
                  role={role!}
                  onDelete={(id: string) => {
                    if (window.confirm("Are you sure?")) deleteTask(id)
                  }}
                  onNotResolved={setNotResolvedTask}
                />
              ))
            })()
          )}
        </div>
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          isFeedbackMode={true}
        />
        <NotResolvedModal
          task={notResolvedTask}
          isOpen={!!notResolvedTask}
          onClose={() => setNotResolvedTask(null)}
        />
      </div>
    )
  }

  // QA and Developers see the form

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files) {
      processFiles(Array.from(e.dataTransfer.files))
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files))
    }
  }

  const removeScreenshot = (index: number) => {
    setScreenshots(screenshots.filter((_, i) => i !== index))
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = (error) => reject(error)
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!heading || !description || !projectId || !stage) {
      toast.error("Please fill in all required fields")
      return
    }

    setIsSubmitting(true)
    try {
      const selectedProject = projectsData?.find((p: any) => p.id === projectId)
      const projectNameStr = selectedProject
        ? selectedProject.name
        : "Unknown Project"

      const uploadedUrls: string[] = []
      if (screenshots.length > 0) {
        for (const file of screenshots) {
          const base64 = await fileToBase64(file)
          const res = await axios.post("/api/storage/upload", {
            base64,
            fileName: file.name,
          })
          if (res.data?.url) {
            uploadedUrls.push(res.data.url)
          }
        }
      }

      const payload = {
        project_id: projectId,
        title: `[Feedback] ${heading}`,
        description: `Project: ${projectNameStr}\nStage: ${stage}\n\n${description}\n\n*Note: Tasks created via Feedback are intended for Super Admin review.*`,
        severity: "medium",
        status: "open",
        gallery_images: uploadedUrls.length > 0 ? uploadedUrls : undefined,
      }

      await axios.post("/api/tasks", payload)
      toast.success("Feedback submitted successfully")
      setHeading("")
      setDescription("")
      setProjectId("")
      setStage("")
      setScreenshots([])
    } catch (error) {
      console.error("Error submitting feedback:", error)
      toast.error("Failed to submit feedback")
    } finally {
      setIsSubmitting(false)
    }
  }

  const userFeedbackTasks = (userTasksData?.data || []).filter(
    (t: any) =>
      t.title?.includes("[Feedback]") &&
      (t.creator?.id === profile?.id || t.created_by === profile?.id),
  )

  if (isUserTasksLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20 p-8">
        <Skeleton className="h-10 w-64" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/60 dark:bg-[#1D2A31] backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-sm transition-all">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
            Feedback Zone
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Feedback and corrections needed on app functioning.
          </p>
        </div>
      </div>

      <div className="flex justify-center w-full">
        <div className="flex items-center gap-1 p-1 bg-slate-100/50 dark:bg-slate-800/50 rounded-md border border-slate-200 dark:border-slate-700 w-fit overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setActiveTab("report")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
              activeTab === "report"
                ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-700"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
          >
            <MessageSquare size={14} />
            Report Issue
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
              activeTab === "history"
                ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-700"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
          >
            <ClipboardList size={14} />
            Feedback History
          </button>
        </div>
      </div>

      {activeTab === "report" ? (
        <div className="max-w-3xl mx-auto">
          <section className="bg-slate-50 dark:bg-[#131d22] border border-slate-400/40 dark:border-slate-800 rounded-xl overflow-hidden shadow-lg dark:shadow-sm transition-all">
            <div className="px-6 py-4 border-b border-slate-400/40 dark:border-slate-800/50 flex items-center space-x-3 bg-slate-50/50 dark:bg-[#1D2A31]">
              <div className="p-2 bg-slate-50 dark:bg-[#131D22] border border-slate-400/40 dark:border-slate-700 rounded-lg text-slate-400 dark:text-slate-500">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-200">
                  Feedback Details
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Provide necessary information for the feedback ticket.
                </p>
              </div>
            </div>
            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      Project
                    </label>
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="w-full bg-[#F2F6FC] dark:bg-[#1D2A31] border border-slate-400/40 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      required
                    >
                      <option value="" disabled>
                        Select a project
                      </option>
                      {projectsData?.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      Stage
                    </label>
                    <input
                      type="text"
                      value={stage}
                      onChange={(e) => setStage(e.target.value)}
                      className="w-full bg-[#F2F6FC] dark:bg-[#1D2A31] border border-slate-400/40 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                      placeholder="e.g. Production, Staging"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Issue Heading
                  </label>
                  <input
                    type="text"
                    value={heading}
                    onChange={(e) => setHeading(e.target.value)}
                    className="w-full bg-[#F2F6FC] dark:bg-[#1D2A31] border border-slate-400/40 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                    placeholder="Brief summary of the issue"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                    className="w-full bg-[#F2F6FC] dark:bg-[#1D2A31] border border-slate-400/40 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-accent focus:border-transparent outline-none resize-none"
                    placeholder="Detailed description of the issue..."
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Screenshots (Up to 3)
                  </label>
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center gap-4 p-8 border-2 border-dashed rounded-lg transition-colors ${
                      isDragging
                        ? "border-accent bg-accent/5 dark:bg-accent/10"
                        : "border-slate-300 dark:border-slate-700 bg-[#F2F6FC] dark:bg-[#1D2A31] hover:bg-slate-50 dark:hover:bg-[#23353D]"
                    }`}
                  >
                    <div className="flex flex-col items-center gap-2 text-center">
                      <Upload className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Drag and drop images here, or copy and paste
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        PNG, JPG up to 10MB
                      </p>
                    </div>
                    <label className="cursor-pointer bg-white dark:bg-[#131D22] border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors shadow-sm hover:shadow">
                      <Upload className="w-4 h-4" />
                      Browse Files
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={screenshots.length >= 3}
                      />
                    </label>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {screenshots.length}/3 attached
                    </span>
                  </div>

                  {screenshots.length > 0 && (
                    <div className="grid grid-cols-3 gap-4 mt-4">
                      {screenshots.map((file, idx) => (
                        <div
                          key={idx}
                          className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700"
                        >
                          <img
                            src={URL.createObjectURL(file)}
                            alt={`Screenshot ${idx + 1}`}
                            className="w-full h-24 object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removeScreenshot(idx)}
                            className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-unified flex items-center justify-center space-x-2 w-full sm:w-auto"
                  >
                    {isSubmitting ? (
                      <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span>
                      {isSubmitting ? "Submitting..." : "Submit Feedback"}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-20">
          {userFeedbackTasks.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-md p-12 text-center text-slate-400 text-sm font-medium italic">
              No feedback tasks found.
            </div>
          ) : (
            (() => {
              const groupedTasks = userFeedbackTasks.reduce(
                (acc: Record<string, any[]>, task: any) => {
                  const projectId = task.project_id || "unassigned"
                  if (!acc[projectId]) acc[projectId] = []
                  acc[projectId].push(task)
                  return acc
                },
                {},
              )

              return Object.keys(groupedTasks).map((projectId) => (
                <ProjectKanban
                  key={projectId}
                  project={{
                    id: projectId,
                    name:
                      groupedTasks[projectId][0]?.projects?.name ||
                      "Feedback Project",
                  }}
                  tasks={groupedTasks[projectId]}
                  onTaskClick={setSelectedTask}
                  role={role!}
                  onDelete={(id: string) => {
                    if (window.confirm("Are you sure?")) deleteTask(id)
                  }}
                  onNotResolved={setNotResolvedTask}
                />
              ))
            })()
          )}
          <TaskDetailPanel
            task={selectedTask}
            isOpen={!!selectedTask}
            onClose={() => setSelectedTask(null)}
            isFeedbackMode={true}
          />
          <NotResolvedModal
            task={notResolvedTask}
            isOpen={!!notResolvedTask}
            onClose={() => setNotResolvedTask(null)}
          />
        </div>
      )}
    </div>
  )
}
