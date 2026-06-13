import { useState } from "react"
import {
  CheckSquare,
  Plus,
  ChevronRight,
  ArrowUpRight,
  Zap,
  ExternalLink,
  MessageSquare,
  CheckCircle2,
  Trash2,
  Loader2,
} from "lucide-react"
import { Link, Navigate } from "react-router-dom"
import { useRole } from "../hooks/useRole"
import { CreateTaskModal } from "../components/CreateTaskModal"
import { TaskDetailPanel } from "../components/TaskDetailPanel"
import { useDeleteTask } from "../hooks/useTasks"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "../components/Skeleton"

// Helper component for severities
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

// Sub-components duplicated from TasksPage.tsx to ensure absolute isolation
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
          if (!existingCommentIds.has(c.id)) {
            group.comments = [...(group.comments || []), c]
          }
        })
      }
    }
  })
  return Array.from(groups.values())
}

const KanbanCard = ({
  task,
  onClick,
  role,
  onDelete,
}: {
  task: any
  onClick: any
  role: string
  onDelete: (taskId: string) => void
}) => {
  const isAdmin =
    role === "super_admin" || role === "admin" || role === "sub_admin"
  const isQA = role === "qa_engineer"
  const isDev = role === "developer"

  return (
    <div
      onClick={() => onClick(task)}
      className="bg-[#fbfbfd] dark:bg-[#1B2A30] dark:hover:bg-transparent p-4 rounded-xl border border-transparent dark:border-slate-700 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md transition-all cursor-pointer group relative dark:hover:border-accent/50"
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
      <div className="flex items-center justify-between mb-2 relative z-10">
        <span
          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border ${getSeverityColor(task.severity)}`}
        >
          {task.severity}
        </span>
        {task.basecamp_url && (
          <div className="text-emerald-600" title="Synced with Basecamp">
            <CheckCircle2 size={12} />
          </div>
        )}
        {isQA && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(task.id)
            }}
            className="p-1 text-slate-300 hover:text-red-500 transition-colors"
            title="Delete task"
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
        <div className="flex items-center -space-x-2">
          {(isAdmin || isDev) && task.creator && (
            <div
              className="w-6 h-6 rounded-full bg-[#93c0b1] flex items-center justify-center text-[10px] font-bold text-white border-2 border-white dark:border-[#1B2A30] uppercase"
              title={`Assigner: ${task.creator.full_name}`}
            >
              {task.creator.full_name.charAt(0)}
            </div>
          )}
          {(isAdmin || isQA) &&
            task.assignees &&
            task.assignees.length > 0 &&
            task.assignees.map((user: any) => (
              <div
                key={user.id}
                className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400 border-2 border-white dark:border-[#1B2A30] uppercase"
                title={`Assigned to: ${user.full_name}`}
              >
                {user.full_name.charAt(0)}
              </div>
            ))}
          {!task.assignees?.length && !task.users && !task.creator && (
            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400 border-2 border-white dark:border-[#1B2A30] uppercase">
              ?
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const KanbanColumn = ({
  title,
  tasks,
  onTaskClick,
  role,
  onDelete,
}: {
  title: string
  tasks: any[]
  onTaskClick: any
  role: string
  onDelete: (taskId: string) => void
}) => (
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
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white shadow-md ${
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
      }`}>
        {tasks.length}
      </span>
    </div>

    <div className="space-y-4 min-h-[200px] bg-transparent dark:bg-transparent rounded-md p-2 border border-dashed border-slate-200/60">
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-center space-y-2 opacity-30 grayscale">
          <CheckSquare className="w-6 h-6 text-slate-400" />
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest italic">
            No tasks
          </p>
        </div>
      ) : (
        tasks.map((task) => (
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
}: {
  project: any
  tasks: any[]
  onTaskClick: any
  role: string
  onDelete: (taskId: string) => void
}) => {
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
              Project Workflow
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
            {tasks.length} Total Assigned
          </span>
          <Link
            to={`/projects/${project.id}`}
            className="p-2 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl text-slate-400 dark:text-slate-300 hover:text-accent dark:hover:text-accent hover:border-accent/20 transition-all shadow-sm"
          >
            <ArrowUpRight size={16} />
          </Link>
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

export const AllTasksPage = () => {
  const { role, isLoading: isRoleLoading, isAdmin } = useRole()
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<any>(null)
  const axios = useAuthAxios()
  const { mutate: deleteTask } = useDeleteTask()

  // High-limit direct fetch for all tasks to sync with real-time and bypass 10-task default pagination limit
  const { data: tasksData, isLoading: isTasksLoading } = useQuery({
    queryKey: ["tasks", "all-workspace-tasks"],
    queryFn: async () => {
      const response = await axios.get("/api/tasks?limit=1000")
      return response.data
    },
    enabled: !isRoleLoading && isAdmin,
  })

  const handleDeleteTask = (taskId: string) => {
    if (window.confirm("Are you sure you want to delete this task?")) {
      deleteTask(taskId)
    }
  }

  // Security check: Redirect non-admins to dashboard
  if (!isRoleLoading && !isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  if (isRoleLoading || isTasksLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-lg p-6 shadow-lg dark:shadow-sm transition-all">
          <div className="space-y-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-md h-64 overflow-hidden relative">
                <Skeleton className="absolute inset-0" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const myTasks = (tasksData?.data || []).filter((task: any) => !task.title?.includes("[Feedback]"))

  return (
    <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-sm transition-all">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
            All Workspace Tasks
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Consolidated Task assignment flow across all projects.
          </p>
        </div>
        <button
          onClick={() => setIsTaskModalOpen(true)}
          className="btn-unified flex items-center justify-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Create Task</span>
        </button>
      </div>

      <CreateTaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
      />

      <div className="space-y-20">
        {myTasks.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-md p-12 text-center text-slate-400 text-sm font-medium italic">
            No tasks found in the workspace.
          </div>
        ) : (
          (() => {
            const groupedTasks = myTasks.reduce(
              (acc: Record<string, any[]>, task: any) => {
                const projectId = task.project_id
                if (!acc[projectId]) acc[projectId] = []
                acc[projectId].push(task)
                return acc
              },
              {},
            )

            const projectIds = Object.keys(groupedTasks)

            return projectIds.map((projectId) => (
              <ProjectKanban
                key={projectId}
                project={{
                  id: projectId,
                  name:
                    groupedTasks[projectId][0]?.projects?.name ||
                    "Active Project",
                }}
                tasks={groupedTasks[projectId]}
                onTaskClick={setSelectedTask}
                role={role!}
                onDelete={handleDeleteTask}
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
