import { useMemo, useState } from "react"
import { useProjects, useDeleteProjects } from "../hooks/useProjects"
import { useDashboardStats } from "../hooks/useDashboard"
import { useRole } from "../hooks/useRole"
import { ProjectCard } from "../components/ProjectCard"
import { CreateProjectModal } from "../components/CreateProjectModal"
import { CanDo } from "../components/CanDo"
import {
  Plus,
  FolderPlus,
  RefreshCcw,
  AlertCircle,
  Search,
  X,
  CheckSquare,
  Trash2,
  Loader2,
} from "lucide-react"
export const ProjectsPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false)
  const { isDeveloper, role } = useRole()
  const canManage = ["super_admin", "admin", "sub_admin"].includes(role || "")
  const { data: dashboardData, isLoading: isDashboardLoading } =
    useDashboardStats()
  const {
    data: allProjects,
    isLoading: isProjectsLoading,
    isError,
    error,
    refetch,
  } = useProjects()
  const deleteProjects = useDeleteProjects()
  const isLoading = isProjectsLoading || (isDeveloper && isDashboardLoading)
  const projects = isDeveloper
    ? allProjects?.filter((project) =>
        dashboardData?.my_tasks?.some((task) => task.project_id === project.id),
      )
    : allProjects

  const totalCount = projects?.length ?? 0

  const filteredProjects = useMemo(() => {
    if (!projects) return []
    const q = search.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) =>
      [p.name, p.client_name, p.site_url]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    )
  }, [projects, search])

  const handleOpenModal = () => {
    setIsModalOpen(true)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const allVisibleSelected =
    filteredProjects.length > 0 &&
    filteredProjects.every((p) => selectedIds.has(p.id))

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        filteredProjects.forEach((p) => next.delete(p.id))
      } else {
        filteredProjects.forEach((p) => next.add(p.id))
      }
      return next
    })
  }

  const handleBulkDelete = () => {
    deleteProjects.mutate(Array.from(selectedIds), {
      onSuccess: () => {
        setIsBulkDeleteOpen(false)
        exitSelectionMode()
      },
    })
  }

  const SkeletonCard = () => (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg p-6 h-48 animate-pulse shadow-sm">
      <div className="flex justify-between mb-4">
        <div className="h-6 w-32 bg-slate-100 dark:bg-slate-800 rounded" />
        <div className="h-5 w-16 bg-slate-100 dark:bg-slate-800 rounded-full" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-48 bg-slate-50 dark:bg-slate-800 rounded" />
        <div className="h-4 w-40 bg-slate-50 dark:bg-slate-800 rounded" />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-bg-main dark:bg-[#131D22] p-6 lg:p-10">
      {/* Header */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-slate-50/60 dark:bg-[#1D2A31] backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-sm transition-all">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight flex items-center gap-3">
            Projects
            <span className="text-sm font-semibold text-accent bg-accent/10 border border-accent/20 rounded-full px-2.5 py-0.5">
              {totalCount}
            </span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Manage and monitor your QA tests
          </p>
        </div>

        <CanDo role="qa_engineer">
          <button
            type="button"
            onClick={handleOpenModal}
            className="btn-unified flex items-center justify-center space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        </CanDo>
      </div>

      {/* Toolbar: search + selection controls */}
      {!isLoading && !isError && totalCount > 0 && (
        <div className="max-w-7xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects by name, client, or URL..."
              className="w-full bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 dark:text-slate-200 rounded-md pl-9 pr-9 py-2 text-sm focus:outline-none hover:border-accent focus:border-accent transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                title="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {canManage && (
            <div className="flex items-center gap-2 shrink-0">
              {!selectionMode ? (
                <button
                  type="button"
                  onClick={() => setSelectionMode(true)}
                  className="btn-unified-secondary flex items-center gap-2"
                >
                  <CheckSquare className="w-4 h-4" />
                  <span>Select</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleSelectAllVisible}
                    className="btn-unified-secondary flex items-center gap-2"
                  >
                    <CheckSquare className="w-4 h-4" />
                    <span>{allVisibleSelected ? "Clear all" : "Select all"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsBulkDeleteOpen(true)}
                    disabled={selectedIds.size === 0}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete ({selectedIds.size})</span>
                  </button>
                  <button
                    type="button"
                    onClick={exitSelectionMode}
                    className="btn-unified-secondary flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    <span>Cancel</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        {/* Loading State */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-xl p-8 text-center max-w-md mx-auto">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-red-900 dark:text-red-400 mb-2">
              Failed to load projects
            </h3>
            <p className="text-red-600 text-sm mb-6">
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred"}
            </p>
            <button
              onClick={() => refetch()}
              className="btn-unified-secondary flex items-center justify-center space-x-2"
            >
              <RefreshCcw className="w-4 h-4" />
              <span>Try Again</span>
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !isError && totalCount === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CanDo role="qa_engineer">
              <button
                type="button"
                onClick={handleOpenModal}
                className="w-24 h-24 bg-slate-50 dark:bg-slate-900 rounded-md flex items-center justify-center mb-6 border border-slate-200 dark:border-slate-800 shadow-sm cursor-pointer hover:border-accent hover:bg-slate-50 dark:hover:bg-slate-800 transition-all group appearance-none outline-none"
              >
                <FolderPlus className="w-12 h-12 text-slate-300 dark:text-slate-700 group-hover:text-accent transition-colors" />
              </button>
            </CanDo>

            <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-200 mb-2">
              No projects yet
            </h3>
            <p className="text-slate-500 dark:text-slate-400 max-w-sm mb-8">
              Get started by creating your first project to monitor and run QA
              checks.
            </p>
            <CanDo role="qa_engineer">
              <button
                type="button"
                onClick={handleOpenModal}
                className="btn-unified px-8"
              >
                Create Your First Project
              </button>
            </CanDo>
          </div>
        )}

        {/* No search matches */}
        {!isLoading &&
          !isError &&
          totalCount > 0 &&
          filteredProjects.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Search className="w-10 h-10 text-slate-300 dark:text-slate-700 mb-4" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-200 mb-1">
                No projects match "{search}"
              </h3>
              <button
                onClick={() => setSearch("")}
                className="text-sm text-accent hover:underline mt-2"
              >
                Clear search
              </button>
            </div>
          )}

        {/* Projects Grid */}
        {!isLoading && !isError && filteredProjects.length > 0 && (
          <>
            {search && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                Showing {filteredProjects.length} of {totalCount}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(project.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />

      {/* Bulk delete confirmation */}
      {isBulkDeleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => !deleteProjects.isPending && setIsBulkDeleteOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#131d22] rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 border border-slate-200 dark:border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-500 rounded-lg">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  Delete {selectedIds.size} project
                  {selectedIds.size === 1 ? "" : "s"}
                </h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                Warning: all data for the selected projects — QA runs, comments,
                recordings, and everything else — will be permanently erased and
                cannot be recovered.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsBulkDeleteOpen(false)}
                  disabled={deleteProjects.isPending}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={deleteProjects.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {deleteProjects.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
