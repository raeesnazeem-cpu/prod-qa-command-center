import { useState, useEffect } from "react"
import {
  CheckSquare,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  ArrowUpRight,
  Zap,
  Layers,
  Clock,
  ExternalLink,
  MessageSquare,
  CheckCircle2,
  Trash2,
} from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { useDashboardStats } from "../hooks/useDashboard"
import { useRole } from "../hooks/useRole"
import { CreateTaskModal } from "../components/CreateTaskModal"
import { TasksTab } from "../components/TasksTab"
import { Skeleton } from "../components/Skeleton"
import { TaskDetailPanel } from "../components/TaskDetailPanel"
import { useUpdateTask, useTasks, useDeleteTask } from "../hooks/useTasks"
import { TaskStatus, getTask } from "../api/tasks.api"
import { useAuthAxios } from "../lib/useAuthAxios"

const ProjectCard = ({ project }: { project: any }) => (
  <Link
    to={`/projects/${project.id}`}
    className="flex-shrink-0 w-80 bg-slate-50 border border-slate-100 rounded-md p-6 shadow-md dark:shadow-sm hover:border-accent/20 transition-all group flex flex-col h-full"
  >
    <div className="flex justify-between items-start mb-4">
      <span
        className={`text-[9px] font-bold uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border ${
          project.is_pre_release
            ? "bg-amber-50 text-amber-600 border-amber-100"
            : "bg-emerald-50 text-emerald-600 border-emerald-100"
        }`}
      >
        {project.is_pre_release ? "Pre-release" : "Post-release"}
      </span>
      {project.open_issues_count > 0 && (
        <span className="text-[10px] text-red-500 font-bold flex items-center gap-1">
          <Zap size={12} className="fill-red-500" />
          {project.open_issues_count} Issues
        </span>
      )}
    </div>
    <h4 className="font-bold text-slate-900 text-lg mb-1 group-hover:text-accent transition-colors line-clamp-1 leading-tight">
      {project.name}
    </h4>
    <p className="text-xs text-slate-400 font-medium mb-6 uppercase tracking-wider">
      {project.client_name || "Internal"}
    </p>

    <div className="mt-auto pt-4 border-t border-slate-50 flex items-center justify-between text-accent font-bold text-[10px] uppercase tracking-widest">
      <span>View Dashboard</span>
      <ArrowUpRight
        size={14}
        className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
      />
    </div>
  </Link>
)

const HorizontalScroll = ({
  title,
  icon: Icon,
  projects,
  iconColor = "text-slate-400",
}: any) => {
  if (!projects || projects.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <h3 className="font-bold text-slate-900 flex items-center gap-2 uppercase tracking-widest text-xs">
          <Icon className={`w-4 h-4 ${iconColor}`} />
          {title}
        </h3>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {projects.length} Total
        </span>
      </div>
      <div className="flex overflow-x-auto pb-6 gap-6 no-scrollbar -mx-2 px-2 mask-fade-right">
        {projects.map((project: any) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  )
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
      // Combine comments from duplicates to show total count
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
      className="bg-[#fbfbfd] dark:bg-[#1B2A30] dark:hover:bg-transparent p-4 rounded-xl border border-transparent dark:border-slate-700 shadow-md dark:shadow-sm transition-all cursor-pointer group relative dark:hover:border-accent/50"
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
        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
        {title}
      </h3>
      <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
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

export const TasksPage = () => {
  const { data, isLoading: isStatsLoading } = useDashboardStats()
  const { role, profile, isLoading: isRoleLoading } = useRole()
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<any>(null)
  const [searchParams] = useSearchParams()
  const taskIdParam = searchParams.get("taskId")
  const axios = useAuthAxios()

  useEffect(() => {
    if (taskIdParam) {
      getTask(axios, taskIdParam)
        .then((task) => {
          setSelectedTask(task)
        })
        .catch((err) => {
          console.error("[TasksPage] Failed to fetch deep-linked task:", err)
        })
    }
  }, [taskIdParam, axios])

  const [showAllOther, setShowAllOther] = useState(false)
  const [qaExpanded, setQaExpanded] = useState(true)
  const [devExpanded, setDevExpanded] = useState(true)
  const { mutate: updateTask } = useUpdateTask()
  const { mutate: deleteTask } = useDeleteTask()

  const isAdmin = role === "super_admin" || role === "admin"
  const isSubAdmin = role === "sub_admin"
  const isQA = role === "qa_engineer"
  const isDev = role === "developer"

  // Direct fetch for developer tasks to ensure database synchronization
  const { data: directTasks, isLoading: isTasksLoading } = useTasks({
    assignedTo: isDev ? profile?.id : undefined,
    createdBy: isQA ? profile?.id : undefined,
  })

  const handleDeleteTask = (taskId: string) => {
    if (window.confirm("Are you sure you want to delete this task?")) {
      deleteTask(taskId)
    }
  }

  if (isStatsLoading || isRoleLoading || ((isDev || isQA) && isTasksLoading)) {
    return (
      <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-8">
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

        <div className="space-y-8">
          <Skeleton className="h-6 w-48" />
          <div className="flex gap-6 overflow-hidden">
            {[1, 2, 3].map((i) => (
              <Skeleton
                key={i}
                className="h-48 w-80 rounded-md flex-shrink-0"
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const getQAName = (project: any) => {
    const qaMember = project.project_members?.find(
      (m: any) => m.role === "qa_engineer",
    )

    return qaMember?.users?.full_name ? (
      <span className="text-xs font-semibold text-slate-600 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-[10px] font-bold text-[#93c0b1] bg-[#93c0b1]/10 px-2.5 py-1 rounded-lg border border-[#93c0b1]/10 uppercase tracking-wider">
          {qaMember.users.full_name}
        </span>
      </span>
    ) : (
      <span className="text-xs font-semibold text-slate-600 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-slate-400/15" />
        <span className="text-[10px] font-bold text-[#718096] bg-[#718096]/10 border border-[#718096]/10 dark:text-[#c26e2d] dark:bg-[#c26e2d]/10 dark:border-[#c26e2d]/10 px-2.5 py-1 rounded-lg uppercase tracking-wider">
          Unassigned
        </span>
      </span>
    )
  }

  const getDevNames = (project: any) => {
    // Identify developer names from project members to exclude QA engineers
    const devNames = new Set(
      project.project_members
        ?.filter((m: any) => m.role === "developer")
        .map((m: any) => m.users?.full_name),
    )

    // Filter only those tasks assigned to project developers
    const activeDevNames =
      project.tasks
        ?.filter((t: any) => devNames.has(t.users?.full_name))
        .map((t: any) => t.users?.full_name)
        .filter(Boolean) || []

    const uniqueDevs = Array.from(new Set(activeDevNames))

    if (uniqueDevs.length === 0) return "none"
    return uniqueDevs.join(", ")
  }

  return (
    <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-xs transition-all">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
            {isDev ? "Developer Task Flow" : "Real-time Tasks Monitor"}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {isDev
              ? "Consolidated view of all my current tasks"
              : "Check currently active workflows across all projects"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-accent dark:text-slate-300 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
            Real-time Tracking
          </span>
        </div>
      </div>

      <CreateTaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
      />

      <div className="space-y-16">
        {/* ADMIN & SUB-ADMIN VIEW */}
        {(isAdmin || isSubAdmin) && (
          <div className="flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-700">
            {/* QA Section */}
            <div className="bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-[8px] overflow-hidden shadow-md dark:shadow-xs flex flex-col">
              <div
                className="bg-slate-50/50 dark:bg-[#1D2A31]/60 backdrop-blur-md cursor-pointer hover:bg-slate-100/80 dark:hover:bg-[#1D2A31]/80 transition-all group select-none flex items-center gap-4 px-8 py-4 border-b border-slate-100 dark:border-slate-800"
                onClick={() => setQaExpanded(!qaExpanded)}
              >
                <div
                  className={`transition-all duration-300 flex items-center justify-center ${qaExpanded ? "p-1 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-bold uppercase tracking-widest border border-accent rotate-0" : "p-1 rounded-md bg-slate-200 text-slate-500 -rotate-90"}`}
                >
                  <ChevronDown className="w-3 h-3" />
                </div>
                <div className="flex items-center gap-2.5">
                  <span
                    className={`${qaExpanded ? "text-slate dark:text-slate-200" : "text-slate-400"} py-1 bg-transparent font-semibold text-[15px]`}
                  >
                    Current QA Tasks
                  </span>
                </div>
                <div className="ml-auto">
                  <span className="text-[10px] font-bold text-accent dark:text-slate-300 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    {data?.qa_projects?.length || 0} Total
                  </span>
                </div>
              </div>

              {qaExpanded && (
                <div className="relative overflow-y-auto max-h-[280px] bg-slate-50/60 dark:bg-[#1D2A31]/60 custom-scrollbar">
                  <table className="w-full text-sm text-left rtl:text-right text-slate-500 dark:text-slate-400 relative">
                    <thead className="sticky top-0 z-10 shadow-sm">
                      <tr className="dark:bg-[#24343D] bg-accent text-sm text-white dark:text-slate-200 border-b border-slate-200 dark:border-slate-800">
                        <th scope="col" className="px-6 py-3 font-medium">
                          Project Name
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 font-medium text-center"
                        >
                          Status
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 font-medium text-center"
                        >
                          Issues
                        </th>
                        <th scope="col" className="px-6 py-3 font-medium">
                          Assigned QA
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.qa_projects?.map((project: any) => (
                        <tr
                          key={project.id}
                          className="border-b border-slate-200 dark:border-slate-800 group"
                        >
                          <th
                            scope="row"
                            className="px-6 py-4 font-medium text-slate-900 dark:text-slate-200 whitespace-nowrap bg-slate-50 dark:bg-[#1D2A31]/50"
                          >
                            <Link
                              to={`/projects/${project.id}`}
                              className="hover:text-[#93c0b1] transition-colors flex items-center gap-1 group-hover:translate-x-0.25"
                            >
                              {project.name}
                              <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-all text-emerald-500" />
                            </Link>
                          </th>
                          <td className="px-6 py-4 bg-white dark:bg-transparent text-center">
                            <span className="text-[10px] font-bold text-[#93c0b1] bg-[#93c0b1]/10 px-2.5 py-1 rounded-lg border border-[#93c0b1]/10 uppercase tracking-wider">
                              {project.is_pre_release
                                ? "Pre-Release"
                                : "Post-Release"}
                            </span>
                          </td>
                          <td className="px-6 py-4 bg-slate-50 dark:bg-[#1D2A31]/50 text-center">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 px-3 py-1 rounded-full border border-slate-200/50 dark:border-slate-600">
                              {project.open_issues_count || 0}
                            </span>
                          </td>
                          <td className="px-6 py-4 bg-white dark:bg-transparent">
                            {getQAName(project)}
                          </td>
                        </tr>
                      ))}
                      {(!data?.qa_projects ||
                        data.qa_projects.length === 0) && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-8 py-16 text-center text-slate-400 text-xs font-medium italic"
                          >
                            No active QA tasks at the moment.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Developer Section */}
            <div className="bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-[8px] overflow-hidden shadow-md dark:shadow-xs flex flex-col">
              <div
                className="bg-slate-50/50 dark:bg-[#1D2A31]/60 backdrop-blur-md cursor-pointer hover:bg-slate-100/80 dark:hover:bg-[#1D2A31]/80 transition-all group select-none flex items-center gap-4 px-8 py-4 border-b border-slate-100 dark:border-slate-800"
                onClick={() => setDevExpanded(!devExpanded)}
              >
                <div
                  className={`transition-all duration-300 flex items-center justify-center ${devExpanded ? "p-1 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-bold uppercase tracking-widest border border-accent rotate-0" : "p-1 rounded-md bg-slate-200 text-slate-500 -rotate-90"}`}
                >
                  <ChevronDown className="w-3 h-3" />
                </div>
                <div className="flex items-center gap-2.5">
                  <span
                    className={`${devExpanded ? "text-slate dark:text-slate-200" : "text-slate-400"} py-1 font-semibold text-[18px]`}
                  >
                    Current Developer Tasks
                  </span>
                </div>
                <div className="ml-auto">
                  <span className="text-[10px] font-bold text-accent dark:text-slate-300 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    {data?.dev_projects?.length || 0} Total
                  </span>
                </div>
              </div>

              {devExpanded && (
                <div className="relative overflow-y-auto max-h-[280px] bg-slate-50/60 dark:bg-[#1D2A31]/60 custom-scrollbar">
                  <table className="w-full text-sm text-left rtl:text-right text-slate-500 dark:text-slate-400 relative">
                    <thead className="sticky top-0 z-10 shadow-sm">
                      <tr className="dark:bg-[#24343D] bg-accent text-sm text-white dark:text-slate-200 border-b border-slate-200 dark:border-slate-800">
                        <th scope="col" className="px-6 py-3 font-medium">
                          Project Name
                        </th>
                        <th
                          scope="col"
                          colSpan={3}
                          className="px-6 py-3 font-medium"
                        >
                          Assigned Developers (Active on Tasks)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.dev_projects?.map((project: any) => (
                        <tr
                          key={project.id}
                          className="border-b border-slate-200 dark:border-slate-800 group"
                        >
                          <th
                            scope="row"
                            className="px-6 py-4 font-medium text-slate-900 dark:text-slate-200 whitespace-nowrap bg-slate-50 dark:bg-[#1D2A31]/50"
                          >
                            <Link
                              to={`/projects/${project.id}`}
                              className="hover:text-[#93c0b1] transition-colors flex items-center gap-1 group-hover:translate-x-0.25"
                            >
                              {project.name}
                              <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-all text-[#93c0b1]" />
                            </Link>
                          </th>
                          <td
                            colSpan={3}
                            className="px-6 py-4 bg-white dark:bg-transparent"
                          >
                            <div className="flex flex-wrap gap-2">
                              {getDevNames(project)
                                .split(", ")
                                .map((name: string, i: number) => (
                                  <span
                                    key={i}
                                    className={
                                      name === "none"
                                        ? "text-[10px] font-bold text-[#718096] bg-[#718096]/10 border border-[#718096]/10 dark:text-[#c26e2d] dark:bg-[#c26e2d]/10 dark:border-[#c26e2d]/10 px-2.5 py-1 rounded-lg uppercase tracking-wider"
                                        : "text-[10px] font-bold text-[#93c0b1] bg-[#93c0b1]/10 px-2.5 py-1 rounded-lg border border-[#93c0b1]/10 uppercase tracking-wider"
                                    }
                                  >
                                    {name}
                                  </span>
                                ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(!data?.dev_projects ||
                        data.dev_projects.length === 0) && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-8 py-16 text-center text-slate-400 text-xs font-medium italic"
                          >
                            No active developer tasks at the moment.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* QA VIEW */}
        {isQA && (
          <div className="space-y-20">
            {(() => {
              const myTasks = directTasks?.data || []

              if (myTasks.length === 0) {
                return (
                  <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-md p-12 text-center text-slate-400 text-sm font-medium italic">
                    No active QA projects at the moment.
                  </div>
                )
              }

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
            })()}
          </div>
        )}

        {/* DEVELOPER VIEW */}
        {isDev && (
          <div className="space-y-20">
            {(() => {
              const myTasks = directTasks?.data || []

              if (myTasks.length === 0) {
                return (
                  <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-[40px] p-24 text-center space-y-6 shadow-md dark:shadow-xs animate-in zoom-in-95 duration-700">
                    <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-900/30 rounded-[28px] flex items-center justify-center mx-auto border border-emerald-100 dark:border-emerald-800">
                      <CheckSquare className="w-10 h-10 text-emerald-500" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                        All Caught Up!
                      </h3>
                      <p className="text-slate-500 dark:text-slate-400 font-medium max-w-sm mx-auto">
                        You don't have any active tasks assigned to you right
                        now. Take a moment to breathe or check other projects.
                      </p>
                    </div>
                    <div className="pt-4">
                      <button
                        onClick={() => (window.location.href = "/projects")}
                        className="btn-unified"
                      >
                        Browse Projects
                      </button>
                    </div>
                  </div>
                )
              }

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
            })()}
          </div>
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
