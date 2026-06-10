import { useState } from "react"
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
} from "lucide-react"
import { Link } from "react-router-dom"
import { TaskDetailPanel } from "../components/TaskDetailPanel"
import { useDeleteTask } from "../hooks/useTasks"
import { Skeleton } from "../components/Skeleton"

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

const KanbanCard = ({ task, onClick, role, onDelete }: any) => {
  const isQA = role === "qa_engineer"
  return (
    <div
      onClick={() => onClick(task)}
      className="bg-[#fbfbfd] dark:bg-[#1B2A30] dark:hover:bg-transparent p-4 rounded-xl border border-transparent dark:border-slate-700 shadow-lg hover:shadow-xl transition-all cursor-pointer group relative"
    >
      <div className="flex items-center justify-between mb-2 relative z-10">
        <span
          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${getSeverityColor(task.severity)}`}
        >
          {task.severity}
        </span>
        {task.basecamp_url && (
          <CheckCircle2 size={12} className="text-emerald-600" />
        )}
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
      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors leading-tight mb-4 relative z-10">
        {task.title}
      </h4>
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
      </div>
    </div>
  )
}

const KanbanColumn = ({ title, tasks, onTaskClick, role, onDelete }: any) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between px-2">
      <h3 className="font-bold text-slate-900 dark:text-slate-100 uppercase tracking-widest text-[11px] flex items-center gap-2">
        {title}
      </h3>
      <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
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
          />
        ))}
      </div>
    </div>
  )
}

export const FeedbackPage = () => {
  const { role, isLoading, isAdmin } = useRole()
  const axios = useAuthAxios()

  const [heading, setHeading] = useState("")
  const [description, setDescription] = useState("")
  const [projectName, setProjectName] = useState("")
  const [stage, setStage] = useState("")
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedTask, setSelectedTask] = useState<any>(null)
  const { mutate: deleteTask } = useDeleteTask()

  const { data: tasksData, isLoading: isTasksLoading } = useQuery({
    queryKey: ["tasks", "feedback-tasks"],
    queryFn: async () => {
      const response = await axios.get("/api/tasks?limit=1000")
      return response.data
    },
    enabled: !isLoading && isAdmin,
  })

  if (isLoading || (isAdmin && isTasksLoading)) {
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
                />
              ))
            })()
          )}
        </div>
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      </div>
    )
  }

  // QA and Developers see the form
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      if (screenshots.length + newFiles.length > 3) {
        toast.error("You can only upload up to 3 screenshots.")
        return
      }
      setScreenshots([...screenshots, ...newFiles].slice(0, 3))
    }
  }

  const removeScreenshot = (index: number) => {
    setScreenshots(screenshots.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!heading || !description || !projectName || !stage) {
      toast.error("Please fill in all required fields")
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        title: `[Feedback] ${heading}`,
        description: `Project: ${projectName}\nStage: ${stage}\n\n${description}\n\n*Note: Tasks created via Feedback are intended for Super Admin review.*`,
        severity: "medium",
        status: "open",
      }

      await axios.post("/api/tasks", payload)
      toast.success("Feedback submitted successfully")
      setHeading("")
      setDescription("")
      setProjectName("")
      setStage("")
      setScreenshots([])
    } catch (error) {
      console.error("Error submitting feedback:", error)
      toast.error("Failed to submit feedback")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      {/* <div className="bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
          Feedback Zone
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Feedback and corrections needed on app functioning.
        </p>
      </div> */}

      <div className="bg-[#fbfbfd] dark:bg-[#1B2A30] p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-white dark:bg-[#131D22] border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
                placeholder="e.g. Acme Corp"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Stage
              </label>
              <input
                type="text"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full bg-white dark:bg-[#131D22] border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
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
              className="w-full bg-white dark:bg-[#131D22] border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-accent focus:border-transparent outline-none"
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
              className="w-full bg-white dark:bg-[#131D22] border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-accent focus:border-transparent outline-none resize-none"
              placeholder="Detailed description of the issue..."
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
              Screenshots (Up to 3)
            </label>
            <div className="flex items-center gap-4">
              <label className="cursor-pointer bg-slate-100 dark:bg-[#1D2A31] hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors">
                <Upload className="w-4 h-4" />
                Upload Images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={screenshots.length >= 3}
                />
              </label>
              <span className="text-xs text-slate-500 dark:text-slate-400">
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
              <span>{isSubmitting ? "Submitting..." : "Submit Feedback"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
