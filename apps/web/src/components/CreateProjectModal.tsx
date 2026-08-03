import { useForm } from "react-hook-form"
import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CreateProjectSchema, CreateProjectInput } from "@qacc/shared"
import { useCreateProject } from "../hooks/useProjects"
import { useBasecampProjects, useFetchBasecampOrderDetails } from "../hooks/useBasecamp"
import { X, Loader2, Globe, Building, CheckCircle2, Zap, Server } from "lucide-react"

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export const CreateProjectModal = ({
  isOpen,
  onClose,
}: CreateProjectModalProps) => {
  const { mutate: createProject, isPending } = useCreateProject()
  const [showPreReleaseWarning, setShowPreReleaseWarning] = useState(false)
  const [creationMode, setCreationMode] = useState<"manual" | "basecamp">("manual")
  const [selectedBasecampProjectId, setSelectedBasecampProjectId] = useState<string>("")

  const { data: basecampProjects, isLoading: isLoadingBasecampProjects, error: basecampError } = useBasecampProjects()
  const { mutate: fetchOrderDetails, isPending: isFetchingDetails } = useFetchBasecampOrderDetails()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(CreateProjectSchema),
    defaultValues: {
      is_woocommerce: false,
      is_pre_release: true,
    },
  })

  const toPascalCase = (str: string) => {
    return str
      .split(" ")
      .map((word) => {
        if (!word) return word
        return word.toLowerCase().replace(/[a-z]/, (char) => char.toUpperCase())
      })
      .join(" ")
  }

  const onSubmit = (data: CreateProjectInput) => {
    const formattedData = {
      ...data,
      name: toPascalCase(data.name),
    }

    createProject(formattedData, {
      onSuccess: () => {
        reset()
        onClose()
      },
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm transition-opacity duration-200">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-[#1d2a31] rounded-md shadow-sm overflow-hidden transition-all duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-[#1d2a31] bg-slate-50/50 dark:bg-[#1d2a31]/50">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Create New Project
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          <div className="flex p-1 bg-slate-100 dark:bg-[#1d2a31] rounded-lg">
            <button
              type="button"
              onClick={() => setCreationMode("manual")}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                creationMode === "manual"
                  ? "bg-white dark:bg-[#131d22] text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-700/50"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              Add Manually
            </button>
            <button
              type="button"
              onClick={() => setCreationMode("basecamp")}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                creationMode === "basecamp"
                  ? "bg-white dark:bg-[#131d22] text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-700/50"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              Select from Basecamp
            </button>
          </div>

          <div className="space-y-4">
            {creationMode === "basecamp" && (
              <div className="p-4 bg-slate-50 dark:bg-[#1d2a31] rounded-md border border-slate-200 dark:border-slate-700">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Select Basecamp Project <span className="text-accent">*</span>
                </label>
                {basecampError ? (
                  <div className="text-sm text-red-500 p-2 bg-red-50 dark:bg-red-900/20 rounded">
                    {(basecampError as any).response?.data?.error || "Failed to load Basecamp projects."}
                  </div>
                ) : (
                  <div className="relative">
                    <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                    <select
                      value={selectedBasecampProjectId}
                      onChange={(e) => {
                        const pid = e.target.value
                        setSelectedBasecampProjectId(pid)
                        if (pid) {
                          fetchOrderDetails(pid, {
                            onSuccess: (data) => {
                              setValue("name", data.projectName)
                              if (data.clientName) {
                                setValue("client_name", data.clientName)
                              }
                            }
                          })
                        }
                      }}
                      disabled={isLoadingBasecampProjects || isFetchingDetails}
                      className="w-full bg-white dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 rounded-md pl-10 pr-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 appearance-none disabled:opacity-50"
                    >
                      <option value="">Select a project...</option>
                      {basecampProjects?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {isLoadingBasecampProjects && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
                    )}
                  </div>
                )}
                {isFetchingDetails && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center">
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Fetching project order details...
                  </p>
                )}
              </div>
            )}

            {/* Project Name */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Project Name <span className="text-accent">*</span>
              </label>
              <div className="relative">
                <input
                  {...register("name")}
                  placeholder="e.g. My Awesome Shop"
                  className={`w-full bg-slate-50 dark:bg-[#1d2a31] border ${
                    errors.name
                      ? "border-red-400/50 dark:border-red-400/50"
                      : "border-slate-200 dark:border-slate-700"
                  } rounded-md px-4 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all`}
                />
              </div>
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
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                <input
                  {...register("site_url")}
                  placeholder="https://example.com"
                  className={`w-full bg-slate-50 dark:bg-[#1d2a31] border ${
                    errors.site_url
                      ? "border-red-400/50 dark:border-red-400/50"
                      : "border-slate-200 dark:border-slate-700"
                  } rounded-md pl-10 pr-4 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all`}
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
                <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase ml-1">
                  (Optional)
                </span>
              </label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                <input
                  {...register("client_name")}
                  placeholder="ACME Corp"
                  className="w-full bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md pl-10 pr-4 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all"
                />
              </div>
            </div>

            {/* WooCommerce Toggle - Hidden for now */}
            {/* <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-[#1d2a31] rounded-md border border-slate-100 dark:border-slate-700/50">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-accent/10 rounded-md">
                  <CheckCircle2 className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    WooCommerce
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Enable e-commerce specific QA checks
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  {...register("is_woocommerce")}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 dark:bg-[#1d2a31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-50 dark:after:bg-slate-300 after:border-slate-300 dark:after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
              </label>
            </div> */}

            {/* Pre-release Toggle */}
            <div className="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-100 dark:border-amber-800/50">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-md">
                  <Zap className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-50">
                    Pre-release Project
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-200/70">
                    Prioritize this project on the QA dashboard
                  </p>
                </div>
              </div>
              <label 
                className="relative inline-flex items-center cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  setShowPreReleaseWarning(true)
                }}
              >
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={true}
                  readOnly
                />
                <div className="w-11 h-6 bg-amber-200 dark:bg-amber-700/50 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-50 dark:after:bg-slate-300 after:border-amber-300 dark:after:border-amber-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>
          </div>

          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-unified-secondary flex-1"
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
                  <span>Creating...</span>
                </>
              ) : (
                <span>Create Project</span>
              )}
            </button>
          </div>
        </form>
      </div>

      {showPreReleaseWarning && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm transition-opacity duration-200">
          <div className="absolute inset-0 bg-transparent" onClick={() => setShowPreReleaseWarning(false)} />
          <div className="relative w-full max-w-sm bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-[#1d2a31] rounded-md shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Cannot Enable Post-release</h3>
              <button
                onClick={() => setShowPreReleaseWarning(false)}
                className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
              This cannot be toggled unless a signed off QA run is available.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowPreReleaseWarning(false)}
                className="btn-unified"
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
