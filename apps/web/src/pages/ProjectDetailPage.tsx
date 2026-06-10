import { useState, useEffect } from "react"
import { useParams, useSearchParams, Link, useLocation, useNavigate } from "react-router-dom"
import { useProject } from "../hooks/useProjects"
import { useBasecampPeople } from "../hooks/useBasecampPeople"
import {
  Globe,
  Calendar,
  ChevronLeft,
  LayoutDashboard,
  PlayCircle,
  CheckSquare,
  Users,
  Settings as SettingsIcon,
  Loader2,
  AlertCircle,
  ExternalLink,
  Zap,
} from "lucide-react"
import { ProjectOverviewTab } from "../components/ProjectOverviewTab"
import { RunsTab } from "../components/RunsTab"
import { TasksTab } from "../components/TasksTab"
import { TeamTab } from "../components/TeamTab"
import { SettingsTab } from "../components/SettingsTab"
import { CanDo } from "../components/CanDo"
import { useRole } from "../hooks/useRole"
import { StartRunModal } from "../components/StartRunModal"
import { Skeleton } from "../components/Skeleton"

export const ProjectDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get("tab") || "overview"
  const { canDo } = useRole()
  const [isRunModalOpen, setIsRunModalOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const { data: project, isLoading, isError, error } = useProject(id!)
  useBasecampPeople(id)

  const setTab = (tab: string) => {
    setSearchParams({ tab })
  }

  useEffect(() => {
    const taskId = searchParams.get("taskId")
    if (taskId && activeTab !== "tasks") {
      setTab("tasks")
    }
  }, [searchParams, activeTab])

  useEffect(() => {
    if (activeTab === "tasks" && !location.state?.runsFixApplied) {
      const taskId = searchParams.get("taskId")
      navigate(`/projects/${id}?tab=runs`, { 
        replace: true,
        state: { ...location.state, overviewFixApplied: true }
      })
      setTimeout(() => {
        navigate(`/projects/${id}?tab=tasks${taskId ? `&taskId=${taskId}` : ''}`, {
          state: { ...location.state, runsFixApplied: true }
        })
      }, 0)
    } else if (["runs", "team", "settings"].includes(activeTab) && !location.state?.overviewFixApplied) {
      navigate(`/projects/${id}?tab=overview`, { replace: true })
      setTimeout(() => {
        navigate(`/projects/${id}?tab=${activeTab}`, {
          state: { ...location.state, overviewFixApplied: true }
        })
      }, 0)
    }
  }, [activeTab, location.state, navigate, id, searchParams])

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center space-x-4">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>

        <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-100 dark:border-slate-700 rounded-md p-8 shadow-sm space-y-6">
          <div className="flex justify-between items-start">
            <div className="space-y-4">
              <Skeleton className="h-10 w-64" />
              <div className="flex gap-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
          <div className="flex gap-4 pt-4 border-t border-slate-50 dark:border-slate-600">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-6 w-24" />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Skeleton className="h-64 col-span-2 rounded-md" />
          <Skeleton className="h-64 rounded-md" />
        </div>
      </div>
    )
  }

  if (isError || !project) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-md p-12">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-200 mb-2">
            Project not found
          </h2>
          <p className="text-red-600 dark:text-red-400 mb-8">
            {error instanceof Error
              ? error.message
              : "The project you're looking for doesn't exist or you don't have access."}
          </p>
          <Link
            to="/projects"
            className="btn-unified-secondary flex items-center space-x-2"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back to Projects</span>
          </Link>
        </div>
      </div>
    )
  }

  const allTabs = [
    {
      id: "overview",
      label: "Overview",
      icon: LayoutDashboard,
      minRole: "developer",
    },
    { id: "runs", label: "QA Runs", icon: PlayCircle, minRole: "qa_engineer" },
    { id: "tasks", label: "Tasks", icon: CheckSquare, minRole: "developer" },
    { id: "team", label: "Team", icon: Users, minRole: "developer" },
    { id: "settings", label: "Settings", icon: SettingsIcon, minRole: "admin" },
  ]

  const tabs = allTabs.filter((tab) => canDo(tab.minRole as any))

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Breadcrumbs & Back */}
      <div className="flex items-center space-x-4">
        <Link
          to={
            activeTab === 'tasks' ? `/projects/${id}?tab=runs` : 
            ["runs", "team", "settings"].includes(activeTab) ? `/projects/${id}?tab=overview` : 
            "/projects"
          }
          className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700 shadow-none hover:shadow-sm"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
        </Link>
        <div className="flex items-center space-x-2 text-sm font-medium text-slate-400 dark:text-slate-500">
          <Link
            to="/projects"
            className="hover:text-accent dark:hover:text-accent transition-colors"
          >
            Projects
          </Link>
          <span>/</span>
          {activeTab === 'tasks' ? (
            <>
              <Link
                to={`/projects/${id}?tab=runs`}
                className="hover:text-accent dark:hover:text-accent transition-colors"
              >
                {project.name}
              </Link>
              <span>/</span>
              <span className="text-slate-900 dark:text-slate-200">
                Tasks
              </span>
            </>
          ) : ["runs", "team", "settings"].includes(activeTab) ? (
            <>
              <Link
                to={`/projects/${id}?tab=overview`}
                className="hover:text-accent dark:hover:text-accent transition-colors"
              >
                {project.name}
              </Link>
              <span>/</span>
              <span className="text-slate-900 dark:text-slate-200">
                {activeTab === "runs" ? "QA Runs" : activeTab === "team" ? "Team" : "Settings"}
              </span>
            </>
          ) : (
            <span className="text-slate-900 dark:text-slate-200">
              {project.name}
            </span>
          )}
        </div>
      </div>

      {/* Header Section */}
      <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-400/50 dark:border-slate-700 rounded-md p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                {project.name}
              </h1>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                  project.status === "active"
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                }`}
              >
                {project.status}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-sm">
              {project.client_name && (
                <div className="flex items-center text-slate-500 dark:text-slate-400">
                  <span className="font-bold uppercase tracking-widest text-[10px] mr-2">
                    Client
                  </span>
                  <span className="text-[11px] text-slate-900 dark:text-slate-200 font-semibold">
                    {project.client_name}
                  </span>
                </div>
              )}
              <div className="flex items-center text-slate-500 dark:text-slate-400">
                <Globe className="w-3 h-3 mr-2 text-accent" />
                <a
                  href={project.site_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-600 dark:text-sky-400 font-semibold hover:text-accent transition-colors flex items-center hover:text-sky-500"
                >
                  {project.site_url.replace(/^https?:\/\//, "")}
                  <ExternalLink className="w-3 h-3 ml-1 opacity-50" />
                </a>
              </div>
              <div className="flex items-center text-slate-500 dark:text-slate-400">
                <Calendar className="w-3 h-3 mr-2 text-accent" />
                <span className="font-bold uppercase tracking-widest text-[10px] mr-2">
                  Last Run
                </span>
                <span className="text-[11px] text-slate-900 dark:text-slate-200 font-semibold">
                  {project.last_run_date
                    ? new Date(project.last_run_date).toLocaleDateString()
                    : "Never"}
                </span>
              </div>
              {project.concurrent_scans !== undefined &&
                project.concurrent_scans > 0 && (
                  <div className="flex items-center text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                    <Zap className="w-3 h-3 mr-1.5 fill-indigo-500" />
                    <span className="font-bold uppercase tracking-widest text-[10px]">
                      {project.concurrent_scans} active scans
                    </span>
                  </div>
                )}
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <CanDo role="qa_engineer">
              <button
                onClick={() => setIsRunModalOpen(true)}
                className="btn-unified"
              >
                Run New Check
              </button>
            </CanDo>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center dark:bg-transparent space-x-1 mt-10 border-b border-slate-50 dark:border-slate-800 dark:rounded-md">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`flex items-center space-x-2 px-6 py-4 text-sm font-bold transition-all relative ${
                  isActive
                    ? "text-accent"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${isActive ? "text-accent" : "text-slate-400"}`}
                />
                <span>{tab.label}</span>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full animate-in fade-in slide-in-from-bottom-1 duration-300" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "overview" && (
          <ProjectOverviewTab
            project={project}
            onStartRun={() => setIsRunModalOpen(true)}
          />
        )}
        {activeTab === "runs" && <RunsTab project={project} />}
        {activeTab === "tasks" && <TasksTab project={project} />}
        {activeTab === "team" && <TeamTab project={project} />}
        {activeTab === "settings" && <SettingsTab project={project} />}
      </div>

      <StartRunModal
        project={project}
        isOpen={isRunModalOpen}
        onClose={() => setIsRunModalOpen(false)}
      />
    </div>
  )
}
