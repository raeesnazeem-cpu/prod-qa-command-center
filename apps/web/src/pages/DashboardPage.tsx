import { useUser, useAuth } from "@clerk/react"
import {
  AlertCircle,
  PlayCircle,
  CheckSquare,
  Layers,
  ChevronRight,
  Clock,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Search,
  ExternalLink,
  Zap,
  Settings2,
  Edit,
  Eye,
  FolderOpen,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useDashboardStats } from "../hooks/useDashboard"
import { useRole } from "../hooks/useRole"
import { format } from "date-fns"
import { useState, useMemo } from "react"
import { EditProjectModal } from "../components/EditProjectModal"
import { Project } from "../api/projects.api"
import { Skeleton } from "../components/Skeleton"

export const DashboardPage = () => {
  const { user } = useUser()
  const { data, isLoading: isDashboardLoading, error } = useDashboardStats()
  const { role, isLoading: isRoleLoading } = useRole()
  const isLoading = isDashboardLoading || isRoleLoading
  const [projectSearch, setProjectSearch] = useState("")
  const [editingProject, setEditingProject] = useState<Project | null>(null)

  const isQA = role === "qa_engineer"
  const isDeveloper = role === "developer"

  const filteredProjects = useMemo(() => {
    if (!data?.all_projects) return []
    if (!projectSearch) return data.all_projects
    return data.all_projects.filter(
      (p) =>
        p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
        p.client_name?.toLowerCase().includes(projectSearch.toLowerCase()),
    )
  }, [data?.all_projects, projectSearch])

  if (isLoading) {
    return (
      <div className="relative w-full h-full min-h-screen">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] hidden dark:block bg-emerald-400/5 dark:bg-teal-500/5 rounded-full blur-3xl animate-gemini-glow"></div>
        </div>
        <main className="relative z-10 max-w-7xl mx-auto space-y-10 animate-in fade-in duration-700 pb-12 px-4">
          <header className="space-y-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-48" />
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>

          <section className="space-y-6">
            <Skeleton className="h-4 w-32" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-48 w-full rounded-lg" />
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <Skeleton className="h-4 w-32" />
            <div className="bg-[#e2e8f0] dark:bg-slate-700 border border-slate-300 dark:border-slate-800 rounded-lg h-64 overflow-hidden relative">
              <Skeleton className="absolute inset-0" />
            </div>
          </section>
        </main>
      </div>
    )
  }

  const getTimeGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
  }

  // ---------------------------------------------------------------------------
  // DEVELOPER VIEW
  // ---------------------------------------------------------------------------
  if (isDeveloper) {
    return (
      <div className="relative w-full h-full min-h-screen">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] hidden dark:block bg-emerald-400/5 dark:bg-teal-500/5 rounded-full blur-3xl animate-gemini-glow"></div>
        </div>
        <main className="relative z-10 max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12 px-4">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-lg p-6 shadow-sm mb-2">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                {getTimeGreeting()}, {user?.firstName || "Developer"}
              </h1>
              <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">
                You have{" "}
                <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                  {data?.my_open_tasks ?? 0}
                </span>{" "}
                tasks assigned to you across projects.
              </p>
            </div>
            <Link
              to="/tasks"
              className="btn-unified-primary flex items-center gap-2 group"
            >
              <CheckSquare
                size={18}
                className="group-hover:scale-110 transition-transform"
              />
              View All Tasks
            </Link>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-3 space-y-10">
              {/* 1. Pre-release Projects */}
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                    <Zap className="w-4 h-4 text-slate-500" />
                    Pre-release Audits
                  </h3>
                </div>

                {data?.pre_release_projects?.length === 0 ? (
                  <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                    No pending pre-release projects.
                  </div>
                ) : (
                  <div className="flex overflow-x-auto pb-6 gap-5 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                    {data?.pre_release_projects?.map((project) => (
                      <Link
                        key={project.id}
                        to={`/projects/${project.id}`}
                        className="bg-slate-50 dark:bg-[#1D2A31] border-2 border-slate-300 dark:border-slate-800 rounded-lg p-4 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md hover:border-accent dark:hover:border-accent transition-all group relative overflow-hidden min-w-[240px] flex-shrink-0 flex flex-col"
                      >
                        <div
                          className="hidden dark:block absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
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
                        <h4 className="font-bold text-slate-900 text-base mb-0.5 group-hover:text-accent transition-colors leading-tight truncate">
                          {project.name}
                        </h4>
                        <p className="text-[10px] text-sky-500 group-hover:text-sky-600 dark:text-sky-400 dark:group-hover:text-sky-300 transition-colors font-medium mb-4 uppercase tracking-wider">
                          {project.client_name || "Internal"}
                        </p>

                        <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-50 dark:border-slate-800">
                          <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                              Open Issues
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-200">
                              {project.open_issues_count || 0}
                            </span>
                          </div>
                          <div className="bg-[#fff] dark:bg-slate-800 text-[#000] dark:text-slate-200 p-1.5 rounded-lg group-hover:bg-[#fff] group-hover:text-[#933] dark:group-hover:text-red-400 transition-colors">
                            <ArrowUpRight size={14} />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              {/* 2. Post-release Projects */}
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                    <Layers className="w-4 h-4 text-slate-400" />
                    Post-release Projects
                  </h3>
                </div>

                {data?.post_release_projects?.length === 0 ? (
                  <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                    No post-release projects found.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {data?.post_release_projects?.map((project) => (
                      <Link
                        key={project.id}
                        to={`/projects/${project.id}`}
                        className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-6 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md hover:border-accent/20 transition-all group relative overflow-hidden"
                      >
                        <div
                          className="hidden dark:block absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
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
                        <h4 className="font-bold text-slate-900 dark:text-slate-200 text-xl mb-1 group-hover:text-accent transition-colors leading-tight">
                          {project.name}
                        </h4>
                        <p className="text-xs text-sky-500 group-hover:text-sky-600 dark:text-sky-400 dark:group-hover:text-sky-300 transition-colors font-medium mb-6 uppercase tracking-wider">
                          {project.client_name || "Internal"}
                        </p>

                        <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-50 dark:border-slate-800">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                              Open Issues
                            </span>
                            <span className="text-sm font-bold text-slate-900 dark:text-slate-200">
                              {project.open_issues_count || 0}
                            </span>
                          </div>
                          <div className="bg-[#fff] dark:bg-slate-800 text-[#000] dark:text-slate-200 p-1.5 rounded-lg group-hover:bg-[#fff] group-hover:text-[#933] dark:group-hover:text-red-400 transition-colors">
                            <ArrowUpRight size={18} />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              {/* 3. Your Active Tasks */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                    <Zap className="w-4 h-4 text-slate-500" />
                    Your Active Tasks
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {data?.my_tasks.length === 0 ? (
                    <div className="md:col-span-2 bg-slate-50 dark:bg-[#1D2A31] border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg p-12 text-center">
                      <div className="bg-slate-50 dark:bg-slate-800 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="w-8 h-8 text-slate-300" />
                      </div>
                      <h4 className="font-bold text-slate-900 dark:text-slate-200">
                        All caught up!
                      </h4>
                      <p className="text-slate-500 text-sm mt-1">
                        No open tasks currently assigned to you.
                      </p>
                    </div>
                  ) : (
                    data?.my_tasks.map((task) => (
                      <Link
                        key={task.id}
                        to={`/tasks/${task.id}`}
                        className="bg-slate-50 border border-slate-300 rounded-lg p-6 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md hover:border-accent/20 transition-all group flex flex-col h-full relative overflow-hidden"
                      >
                        <div
                          className="hidden dark:block absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
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
                        <div className="flex justify-between items-start mb-4 relative z-10">
                          <span
                            className={`text-[9px] font-bold uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border ${
                              task.severity === "critical"
                                ? "bg-red-50 text-red-600 border-red-100"
                                : task.severity === "high"
                                  ? "bg-orange-50 text-orange-600 border-orange-100"
                                  : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-100 dark:border-slate-700"
                            }`}
                          >
                            {task.severity}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                            <Clock size={12} />
                            {format(new Date(task.created_at), "MMM d")}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-900 dark:text-slate-200 text-lg mb-2 group-hover:text-accent transition-colors line-clamp-2 leading-tight">
                          {task.title}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-6 line-clamp-2">
                          {(task as any).projects?.name}
                        </p>
                        <div className="mt-auto pt-4 border-t border-slate-50 dark:border-slate-800 flex items-center justify-between text-accent font-bold text-[10px] uppercase tracking-widest">
                          <span>View Details</span>
                          <ChevronRight
                            size={14}
                            className="group-hover:translate-x-1 transition-transform"
                          />
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                <Clock className="w-4 h-4 text-slate-400" />
                Quick Stats
              </h3>
              <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-lg p-6 text-slate-900 dark:text-slate-200 space-y-6 shadow-xl">
                <div>
                  <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">
                    Total Assigned
                  </p>
                  <p className="text-3xl font-bold">
                    {data?.my_tasks.length ?? 0}
                  </p>
                </div>
                <div className="pt-6 border-t border-white/10">
                  <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">
                    Open Issues Count
                  </p>
                  <p className="text-3xl font-bold text-amber-400">
                    {data?.open_issues ?? 0}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // QA ENGINEER VIEW
  // ---------------------------------------------------------------------------
  if (isQA) {
    return (
      <div className="relative w-full h-full min-h-screen">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] hidden dark:block bg-emerald-400/5 dark:bg-teal-500/5 rounded-full blur-3xl animate-gemini-glow"></div>
        </div>
        <main className="relative z-10 max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12 px-4">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-lg p-6 shadow-sm mb-2">
            <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
              QA Command Center
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium italic">
              Welcome back. Prioritize pre-release audits or search for specific
              projects.
            </p>
          </header>

          {/* 1. Pre-release Projects */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                <Zap className="w-4 h-4 text-slate-500" />
                Pre-release Audits
              </h3>
            </div>

            {data?.pre_release_projects?.length === 0 ? (
              <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                No pending pre-release projects.
              </div>
            ) : (
              <div className="flex overflow-x-auto pb-4 gap-6 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                {data?.pre_release_projects?.map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="bg-slate-50 dark:bg-[#1D2A31] border-2 border-slate-300 dark:border-slate-800 rounded-lg p-6 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md hover:border-accent/20 transition-all group relative overflow-hidden min-w-[300px] flex-shrink-0"
                  >
                    <div
                      className="hidden dark:block absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
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
                    <h4 className="text-xl font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors truncate pr-2">
                      {project.name}
                    </h4>
                    <p className="text-xs text-sky-500 group-hover:text-sky-600 dark:text-sky-400 dark:group-hover:text-sky-300 transition-colors font-medium mb-6 uppercase tracking-wider">
                      {project.client_name || "Internal"}
                    </p>

                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-50 dark:border-slate-800">
                      <div className="flex items-center gap-6">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                            Active Runs
                          </span>
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-200">
                            {project.qa_runs?.filter(
                              (r: any) => r.status === "running",
                            ).length || 0}
                          </span>
                        </div>
                        <div className="flex flex-col border-l border-slate-200 dark:border-slate-700 pl-6">
                          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                            Open Issues
                          </span>
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-200">
                            {project.open_issues_count || 0}
                          </span>
                        </div>
                      </div>
                      <div className="bg-[#fff] dark:bg-slate-800 text-accent p-1.5 rounded-lg group-hover:bg-[#fff] dark:group-hover:bg-slate-700 group-hover:text-black dark:group-hover:text-white transition-colors">
                        <ArrowUpRight size={18} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* 2. Post-release Projects */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                <Layers className="w-4 h-4 text-slate-500" />
                Post-release Projects
              </h3>
            </div>

            {data?.post_release_projects?.length === 0 ? (
              <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                No post-release projects found.
              </div>
            ) : (
              <div className="flex overflow-x-auto pb-4 gap-6 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                {data?.post_release_projects?.map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-6 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md hover:border-accent/20 transition-all group relative overflow-hidden min-w-[300px] flex-shrink-0"
                  >
                    <div
                      className="hidden dark:block absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
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
                    <h4 className="text-xl font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors truncate pr-2">
                      {project.name}
                    </h4>
                    <p className="text-xs text-sky-500 group-hover:text-sky-600 dark:text-sky-400 dark:group-hover:text-sky-300 transition-colors font-medium mb-6 uppercase tracking-wider">
                      {project.client_name || "Internal"}
                    </p>

                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-50 dark:border-slate-800">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                          Open Issues
                        </span>
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-200">
                          {project.open_issues_count || 0}
                        </span>
                      </div>
                      <div className="bg-[#fff] dark:bg-slate-800 text-accent p-1.5 rounded-lg group-hover:bg-[#fff] dark:group-hover:bg-slate-700 group-hover:text-black dark:group-hover:text-white transition-colors">
                        <ArrowUpRight size={18} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* 3. Project Explorer */}
          <section className="space-y-6 pt-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                <Search className="w-4 h-4 text-slate-400" />
                Project Explorer
              </h3>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  placeholder="Search database..."
                  className="w-full bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 dark:text-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/5 transition-all shadow-sm"
                />
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm overflow-x-auto">
              <div className="min-w-[800px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 dark:bg-[#1D2A31]/50 border-b border-slate-100 dark:border-slate-800">
                      <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Project Database
                      </th>
                      <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Client
                      </th>
                      <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Last Activity
                      </th>
                      <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {filteredProjects.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-8 py-12 text-center text-sm text-slate-400 font-medium italic"
                        >
                          No projects found matching "{projectSearch}"
                        </td>
                      </tr>
                    ) : (
                      filteredProjects.map((project) => (
                        <tr
                          key={project.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
                        >
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-2 h-2 rounded-full ${project.is_pre_release ? "bg-amber-400" : "bg-slate-300"}`}
                              />
                              <Link
                                to={`/projects/${project.id}`}
                                className="text-sm font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors truncate pr-2 group-hover:text-accent transition-colors"
                              >
                                {project.name}
                              </Link>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
                              {project.client_name || "Internal"}
                            </span>
                          </td>
                          <td className="px-8 py-5 text-xs text-slate-400 font-medium">
                            {project.qa_runs?.[0]
                              ? format(
                                  new Date(project.qa_runs[0].created_at),
                                  "MMM d, yyyy",
                                )
                              : "No runs yet"}
                          </td>
                          <td className="px-8 py-5">
                            <Link
                              to={`/projects/${project.id}`}
                              className="text-accent hover:text-black dark:hover:text-white transition-colors"
                            >
                              <ExternalLink size={18} />
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </main>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // SUPERADMIN / ADMIN VIEW (MANAGEMENT)
  // ---------------------------------------------------------------------------
  const stats = [
    {
      label: "Open Issues",
      value: data?.open_issues ?? 0,
      icon: AlertCircle,
      color: (data?.open_issues ?? 0) > 0 ? "text-red-600" : "text-slate-600",
      bg: (data?.open_issues ?? 0) > 0 ? "bg-red-50" : "bg-slate-50",
    },
    {
      label: "Runs (Week)",
      value: data?.runs_this_week ?? 0,
      icon: PlayCircle,
      color: "text-accent",
      bg: "bg-accent/10",
    },
    {
      label: "My Tasks",
      value: data?.my_open_tasks ?? 0,
      icon: CheckSquare,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
    {
      label: "Projects",
      value: data?.projects_count ?? 0,
      icon: Layers,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
  ]

  return (
    <div className="relative w-full h-full min-h-screen bg-bg-main dark:bg-[#131D22]">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] hidden dark:block bg-emerald-400/5 dark:bg-teal-500/5 rounded-full blur-3xl animate-gemini-glow"></div>
      </div>
      <main className="relative z-10 p-6 lg:p-10 space-y-10">
        <header className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-lg dark:shadow-sm transition-all">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
              Global Overview
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Monitoring across all projects.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={"/projects"}
              className="btn-unified flex items-center gap-2 py-[16px]"
            >
              <FolderOpen size={16} />
              Browse Projects
            </Link>
          </div>
        </header>

        {/* 1. Stats Grid */}
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-6 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md transition-all group relative overflow-hidden"
            >
              <div
                className="hidden dark:block absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
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
              <div className="flex items-center justify-between mb-4 relative z-10"></div>
              <div
                className={`text-4xl font-bold ${stat.label === "Open Issues" && (data?.open_issues ?? 0) > 0 ? "text-red-600" : "text-slate-900 dark:text-slate-200"}`}
              >
                {stat.value}
              </div>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-2">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2 space-y-10">
            {/* 2. Pre-release Projects (Admin) */}
            <section className="space-y-6">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                Pre-release Projects
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {data?.pre_release_projects?.map((project) => (
                  <div
                    key={project.id}
                    className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-6 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md transition-all group relative flex flex-col overflow-hidden"
                  >
                    <div
                      className="hidden dark:block absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
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
                    <div className="absolute top-4 right-4 flex gap-2 z-10">
                      <button
                        onClick={() => setEditingProject(project)}
                        className="p-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-accent transition-all"
                      >
                        <Edit size={18} />
                      </button>
                    </div>
                    <Link to={`/projects/${project.id}`} className="flex-1">
                      <h4 className="font-bold text-slate-900 dark:text-slate-200 text-lg mb-1 group-hover:text-accent transition-colors">
                        {project.name}
                      </h4>
                      <p className="text-xs text-sky-500 group-hover:text-sky-600 dark:text-sky-400 dark:group-hover:text-sky-300 transition-colors font-medium mb-6">
                        {project.client_name || "Internal"}
                      </p>
                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-50 dark:border-slate-800">
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            Active Runs:{" "}
                            {project.qa_runs?.filter(
                              (r: any) => r.status === "running",
                            ).length || 0}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-l border-slate-200 dark:border-slate-700 pl-4">
                            Open Issues: {project.open_issues_count || 0}
                          </span>
                        </div>
                        <ArrowUpRight size={18} className="text-accent" />
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. Post-release Projects (Admin) */}
            <section className="space-y-6">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                <Layers className="w-4 h-4 text-slate-400" />
                Post-release Projects
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {data?.post_release_projects?.map((project) => (
                  <div
                    key={project.id}
                    className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg p-6 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md transition-all group relative flex flex-col overflow-hidden"
                  >
                    <div
                      className="hidden dark:block absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
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
                    <div className="absolute top-4 right-4 z-10">
                      <button
                        onClick={() => setEditingProject(project)}
                        className="p-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-accent transition-all"
                      >
                        <Edit size={16} />
                      </button>
                    </div>
                    <Link to={`/projects/${project.id}`} className="flex-1">
                      <h4 className="font-bold text-slate-900 dark:text-slate-200 text-lg mb-1 group-hover:text-accent transition-colors">
                        {project.name}
                      </h4>
                      <p className="text-xs text-sky-500 group-hover:text-sky-600 dark:text-sky-400 dark:group-hover:text-sky-300 transition-colors font-medium mb-6">
                        {project.client_name || "Internal"}
                      </p>
                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-50 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Open Issues: {project.open_issues_count || 0}
                        </span>
                        <ArrowUpRight size={18} className="text-emerald-500" />
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Management Side Column */}
          <div className="space-y-10">
            <div className="space-y-6">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                <CheckSquare className="w-4 h-4 text-slate-400" />
                Critical Assignments
              </h3>
              <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg shadow-sm divide-y divide-slate-50 dark:divide-slate-800 overflow-hidden">
                {data?.my_tasks.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-xs text-slate-400 font-medium italic">
                      No urgent tasks for you
                    </p>
                  </div>
                ) : (
                  data?.my_tasks.map((task) => (
                    <Link
                      key={task.id}
                      to={`/tasks?taskId=${task.id}`}
                      className="p-6 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors block group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors leading-tight line-clamp-2">
                            {task.title}
                          </p>
                          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                            {(task as any).projects?.name}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-accent transform group-hover:translate-x-1 transition-all shrink-0" />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            {/* Pending Sign-offs */}
            <div className="space-y-6">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                <CheckCircle2 className="w-4 h-4 text-slate-400" />
                Pending Global Sign-offs
              </h3>
              <div className="bg-accent/5 dark:bg-[#1D2A31] border border-accent dark:border-accent/40 rounded-lg p-6 space-y-4">
                {data?.pending_signoffs.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-xs text-emerald-600 font-bold uppercase tracking-widest">
                      All runs verified
                    </p>
                  </div>
                ) : (
                  Array.from(
                    new Map(
                      data?.pending_signoffs.map((run) => [
                        run.project_id,
                        run,
                      ]),
                    ).values(),
                  ).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between bg-slate-50 dark:bg-[#1D2A31] p-4 rounded-lg border border-accent/10 dark:border-accent/30 shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md transition-all group"
                    >
                      <div className="flex-1 min-w-0 mr-4">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-200 truncate uppercase tracking-tight">
                          {(run as any).projects?.name}
                        </p>
                        <p className="text-[9px] text-slate-400 font-bold mt-1">
                          Ready for review •{" "}
                          {format(new Date(run.completed_at!), "MMM d")}
                        </p>
                      </div>
                      <Link
                        to={`/projects/${run.project_id}/runs/${run.id}`}
                        className="w-8 h-8 flex items-center justify-center bg-transparent border-2 border-accent/50 dark:bg-accent/30 dark:border-transparent text-accent/50 hover:text-accent dark:text-accent/50 dark:hover:text-accent rounded-md hover:bg-accent/80 hover:text-white transition-all"
                      >
                        <ChevronRight size={16} />
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Real-time QA Activity */}
            <div className="space-y-6">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 flex items-center gap-2 uppercase tracking-widest text-xs">
                <PlayCircle className="w-4 h-4 text-slate-400" />
                Real-time QA Activity
              </h3>
              <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-300 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm">
                {data?.recent_runs.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-400 font-medium italic">
                    No recent runs initiated
                  </div>
                ) : (
                  (() => {
                    let lastProjectName = ""
                    return data?.recent_runs.slice(0, 5).map((run, index) => {
                      const projectName = (run as any).projects?.name || ""
                      const isDuplicate = projectName === lastProjectName
                      if (!isDuplicate) {
                        lastProjectName = projectName
                      }
                      const runnerName =
                        (run as any).users?.full_name ||
                        (run as any).creator?.full_name ||
                        "System"
                      return (
                        <div
                          key={run.id}
                          className="even:bg-white odd:bg-slate-50 dark:even:bg-transparent dark:odd:bg-[#131D22] hover:bg-slate-100 dark:hover:bg-[#0B151B] transition-colors group p-5 flex flex-col gap-2 border-b border-slate-200 dark:border-slate-800 last:border-b-0"
                        >
                          <Link
                            to={`/projects/${run.project_id}/runs/${run.id}`}
                            className="text-sm font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors leading-tight"
                          >
                            {projectName}
                          </Link>

                          <div className="flex items-center mt-1">
                            <div
                              className={`rounded-full w-2 h-2 mr-2 ${
                                run.status === "completed"
                                  ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                                  : run.status === "running"
                                    ? "bg-accent animate-pulse shadow-[0_0_8px_rgba(var(--accent-rgb),0.4)]"
                                    : run.status === "failed"
                                      ? "bg-red-500"
                                      : "bg-slate-300"
                              }`}
                            />
                            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-tight">
                              {run.status}
                            </span>
                            <span className="text-slate-300 dark:text-slate-600 mx-2">
                              •
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                              {run.run_type.replace("_", " ")}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium mt-1">
                            <span>
                              {format(new Date(run.created_at), "MMM d, HH:mm")}
                            </span>
                            <span className="text-slate-300 dark:text-slate-600">
                              •
                            </span>
                            <span className="text-slate-500 dark:text-slate-400 font-semibold">
                              {runnerName}
                            </span>
                          </div>
                        </div>
                      )
                    })
                  })()
                )}
              </div>
            </div>
          </div>
        </div>

        <EditProjectModal
          project={editingProject}
          isOpen={!!editingProject}
          onClose={() => setEditingProject(null)}
        />
      </main>
    </div>
  )
}
