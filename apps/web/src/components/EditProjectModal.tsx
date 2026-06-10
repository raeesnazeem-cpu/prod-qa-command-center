import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { UpdateProjectSchema, UpdateProjectInput } from "@qacc/shared"
import { useUpdateProject } from "../hooks/useProjects"
import { Project } from "../api/projects.api"
import {
  X,
  Loader2,
  Globe,
  Building,
  CheckCircle2,
  Zap,
  Settings2,
} from "lucide-react"
import { useEffect } from "react"

interface EditProjectModalProps {
  project: Project | null
  isOpen: boolean
  onClose: () => void
}

export const EditProjectModal = ({
  project,
  isOpen,
  onClose,
}: EditProjectModalProps) => {
  const { mutate: updateProject, isPending } = useUpdateProject(
    project?.id || "",
  )

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<UpdateProjectInput>({
    resolver: zodResolver(UpdateProjectSchema),
  })

  const isPreRelease = watch("is_pre_release")

  useEffect(() => {
    if (project) {
      reset({
        name: project.name,
        site_url: project.site_url,
        client_name: project.client_name || "",
        is_woocommerce: project.is_woocommerce,
        is_pre_release: project.is_pre_release,
        status: project.status as "active" | "archived",
      })
    }
  }, [project, reset])

  const onSubmit = (data: UpdateProjectInput) => {
    if (!project) return
    updateProject(data, {
      onSuccess: () => {
        onClose()
      },
    })
  }

  if (!isOpen || !project) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-slate-50 dark:bg-[#0B151B] border border-slate-200 dark:border-slate-800 rounded-md shadow-sm overflow-hidden transition-all duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131d22]/50">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-slate-400" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Edit Project Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-300 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          <div className="space-y-4">
            {/* Project Name */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Project Name <span className="text-accent">*</span>
              </label>
              <input
                {...register("name")}
                placeholder="e.g. My Awesome Shop"
                className={`w-full bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] border ${
                  errors.name
                    ? "border-red-400/50"
                    : "border-slate-300 dark:border-slate-700 hover:border-accent dark:hover:border-accent"
                } rounded-md px-4 py-2.5 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:bg-[#fcfcfc] dark:focus:bg-[#131d22] focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all`}
              />

              {errors.name && (
                <p className="mt-1.5 text-xs text-red-500 font-medium">
                  {errors.name.message}
                </p>
              )}
            </div>

            {/* Site URL */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Site URL <span className="text-accent">*</span>
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  {...register("site_url")}
                  placeholder="https://example.com"
                  className={`w-full bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] border ${
                    errors.site_url
                      ? "border-red-400/50"
                      : "border-slate-300 dark:border-slate-700 hover:border-accent dark:hover:border-accent"
                  } rounded-md pl-10 pr-4 py-2.5 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:bg-[#fcfcfc] dark:focus:bg-[#131d22] focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all`}
                />
              </div>
              {errors.site_url && (
                <p className="mt-1.5 text-xs text-red-500 font-medium">
                  {errors.site_url.message}
                </p>
              )}
            </div>

            {/* Client Name */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Client Name{" "}
                <span className="text-slate-400 text-[10px] uppercase ml-1">
                  (Optional)
                </span>
              </label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  {...register("client_name")}
                  placeholder="ACME Corp"
                  className="w-full bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] border border-slate-300 dark:border-slate-700 hover:border-accent dark:hover:border-accent rounded-md pl-10 pr-4 py-2.5 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:bg-[#fcfcfc] dark:focus:bg-[#131d22] focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all"
                />
              </div>
            </div>

            {/* Status Selection */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Project Status
              </label>
              <select
                {...register("status")}
                className="w-full bg-[#F2F6FC] dark:bg-[#131d22] hover:bg-[#fcfcfc] dark:hover:bg-[#131d22] border border-slate-300 dark:border-slate-700 hover:border-accent dark:hover:border-accent rounded-md px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:bg-[#fcfcfc] dark:focus:bg-[#131d22] focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all"
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="paused">Paused</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* WooCommerce Toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-[#1D2A31] rounded-md border border-slate-300 dark:border-slate-800">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Woo
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    {...register("is_woocommerce")}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 dark:bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-50 dark:after:bg-slate-300 after:border-slate-300 dark:after:border-slate-500 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                </label>
              </div>
              {/* Pre-release Toggle */}
              <div className="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-200 dark:border-amber-900/50">
                <div className="flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-900 dark:text-amber-500">
                    {isPreRelease ? "Pre" : "Post"}
                  </span>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    {...register("is_pre_release")}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-amber-200 dark:bg-amber-900/50 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-50 dark:after:bg-slate-300 after:border-amber-300 dark:after:border-amber-700 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
            </div>
          </div>

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-unified-secondary flex-1 dark:bg-[#1D2A31] dark:border-slate-800 dark:hover:bg-[#1d2a31] dark:text-slate-200"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isPending}
              className="btn-unified flex-[2] flex items-center justify-center space-x-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
