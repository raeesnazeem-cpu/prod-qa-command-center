import { useState } from "react"
import { useProjects } from "../hooks/useProjects"
import { ProjectCard } from "../components/ProjectCard"
import { CreateProjectModal } from "../components/CreateProjectModal"
import { CanDo } from "../components/CanDo"
import { Plus, FolderPlus, RefreshCcw, AlertCircle } from "lucide-react"

export const ProjectsPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { data: projects, isLoading, isError, error, refetch } = useProjects()

  const handleOpenModal = () => {
    setIsModalOpen(true)
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
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 bg-slate-50/60 dark:bg-[#1D2A31] backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-sm transition-all">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
            Projects
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Manage and monitor your QA tests
          </p>
        </div>

        <CanDo role="sub_admin">
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
        {!isLoading && !isError && projects?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CanDo role="sub_admin">
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
            <CanDo role="sub_admin">
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

        {/* Projects Grid */}
        {!isLoading && !isError && projects && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  )
}
