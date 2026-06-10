import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CreateRunSchema, CreateRunInput } from "@qacc/shared"
import { useCreateRun } from "../hooks/useRuns"
import { Project } from "../api/projects.api"
import {
  X,
  Loader2,
  Globe,
  PlayCircle,
  Layout,
  Monitor,
  Tablet,
  Smartphone,
  Type,
  Link,
  Link2,
  Search,
  AlertCircle,
  FileText,
  Image as ImageIcon,
  Bot,
  Eye,
  CheckSquare,
  ShoppingCart,
  Layers,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

interface CreateRunModalProps {
  project: Project
  isOpen: boolean
  onClose: () => void
}

const CHECK_FACTORS = [
  { id: "spelling", label: "Spelling", icon: Type },
  { id: "broken_links", label: "Broken Links", icon: Link },
  { id: "external_links", label: "External Links", icon: Link2 },
  { id: "seo", label: "Meta/SEO", icon: Search },
  { id: "console_errors", label: "Console Errors", icon: AlertCircle },
  { id: "dummy_content", label: "Dummy Content", icon: FileText },
  { id: "image_compliance", label: "Image Compliance", icon: ImageIcon },
  { id: "ai_content_audit", label: "AI Content Audit", icon: Bot },
  { id: "ai_vision_check", label: "AI Vision Check", icon: Eye },
  { id: "form_testing", label: "Form Testing", icon: CheckSquare },
  {
    id: "woocommerce",
    label: "WooCommerce",
    icon: ShoppingCart,
    isWooOnly: true,
  },
  { id: "responsive_visual", label: "Responsive Visual", icon: Layers },
  { id: "hero_media", label: "Hero Video & Image Load", icon: Monitor },
]

export const CreateRunModal = ({
  project,
  isOpen,
  onClose,
}: CreateRunModalProps) => {
  const navigate = useNavigate()
  const { mutate: createRun, isPending } = useCreateRun()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateRunInput>({
    resolver: zodResolver(CreateRunSchema),
    defaultValues: {
      project_id: project.id,
      run_type: "pre_release",
      site_url: project.site_url,
      figma_url: "",
      enabled_checks: [],
      is_woocommerce: project.is_woocommerce,
      device_matrix: ["desktop", "tablet", "mobile"],
    },
  })

  const enabledChecks = watch("enabled_checks")
  const deviceMatrix = watch("device_matrix")

  const onSubmit = (data: CreateRunInput) => {
    createRun(data, {
      onSuccess: (run) => {
        onClose()
        navigate(`/projects/${project.id}/runs/${run.id}`)
      },
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-[#131d22]/80 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-[#1d2a31] rounded-md shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-[#1d2a31] bg-slate-50/50 dark:bg-[#1d2a31]/50">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
              <PlayCircle className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Configure QA Run
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="overflow-y-auto p-6 space-y-8"
        >
          {/* Run Type & Site URL */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                Run Type
              </label>
              <div className="flex bg-slate-100 dark:bg-[#1d2a31] p-1 rounded-md">
                <label className="flex-1 cursor-pointer">
                  <input
                    type="radio"
                    {...register("run_type")}
                    value="pre_release"
                    className="sr-only peer"
                  />
                  <div className="py-2 text-center text-sm font-bold rounded-md transition-all peer-checked:bg-slate-50 dark:peer-checked:bg-[#131d22] peer-checked:shadow-sm text-slate-500 dark:text-slate-400 peer-checked:text-accent dark:peer-checked:text-accent">
                    Pre-Release
                  </div>
                </label>
                <label className="flex-1 cursor-pointer">
                  <input
                    type="radio"
                    {...register("run_type")}
                    value="post_release"
                    className="sr-only peer"
                  />
                  <div className="py-2 text-center text-sm font-bold rounded-md transition-all peer-checked:bg-slate-50 dark:peer-checked:bg-[#131d22] peer-checked:shadow-sm text-slate-500 dark:text-slate-400 peer-checked:text-accent dark:peer-checked:text-accent">
                    Post-Release
                  </div>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                Target URL
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                <input
                  {...register("site_url")}
                  className="w-full bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent transition-all"
                />
              </div>
              {errors.site_url && (
                <p className="mt-1 text-xs text-red-500">
                  {errors.site_url.message}
                </p>
              )}
            </div>
          </div>

          {/* Figma URL */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
              Figma Design URL (Optional)
            </label>
            <div className="relative">
              <Layout className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
              <input
                {...register("figma_url")}
                placeholder="https://figma.com/file/..."
                className="w-full bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-accent transition-all"
              />
            </div>
          </div>

          {/* Device Matrix */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
              Device Matrix
            </label>
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  id: "desktop",
                  label: "Desktop",
                  sub: "1440px",
                  icon: Monitor,
                },
                { id: "tablet", label: "Tablet", sub: "768px", icon: Tablet },
                {
                  id: "mobile",
                  label: "Mobile",
                  sub: "375px",
                  icon: Smartphone,
                },
              ].map((device) => (
                <label key={device.id} className="cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={deviceMatrix.includes(device.id as any)}
                    onChange={(e) => {
                      const current = [...deviceMatrix]
                      if (e.target.checked) {
                        setValue("device_matrix", [
                          ...current,
                          device.id as any,
                        ])
                      } else {
                        setValue(
                          "device_matrix",
                          current.filter((d) => d !== device.id),
                        )
                      }
                    }}
                    className="sr-only"
                  />
                  <div
                    className={`p-4 border rounded-md text-center transition-all group-hover:border-slate-300 dark:group-hover:border-slate-600 ${deviceMatrix.includes(device.id as any) ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1d2a31]"}`}
                  >
                    <device.icon
                      className={`w-6 h-6 mx-auto mb-2 ${deviceMatrix.includes(device.id as any) ? "text-accent" : "text-slate-400 dark:text-slate-500"}`}
                    />
                    <div
                      className={`text-xs font-bold uppercase ${deviceMatrix.includes(device.id as any) ? "text-accent" : "text-slate-600 dark:text-slate-400"}`}
                    >
                      {device.label}
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                      {device.sub}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Check Factors */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 space-y-3 sm:space-y-0">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                Check Factors
              </label>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() =>
                      setValue(
                        "enabled_checks",
                        CHECK_FACTORS.filter(
                          (f) => !f.isWooOnly || project.is_woocommerce,
                        ).map((f) => f.id),
                      )
                    }
                    className="text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-accent uppercase transition-colors"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <button
                    type="button"
                    onClick={() => setValue("enabled_checks", [])}
                    className="text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-accent uppercase transition-colors"
                  >
                    Deselect All
                  </button>
                </div>

                {project.is_woocommerce && (
                  <div className="flex items-center space-x-2 border-l border-slate-200 dark:border-slate-700 pl-4">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                      WooCommerce Mode
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setValue("is_woocommerce", !watch("is_woocommerce"))
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${watch("is_woocommerce") ? "bg-accent" : "bg-slate-200 dark:bg-[#1d2a31]"}`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-slate-50 dark:bg-slate-300 transition-transform ${watch("is_woocommerce") ? "translate-x-5" : "translate-x-1"}`}
                      />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {CHECK_FACTORS.filter(
                (f) => !f.isWooOnly || project.is_woocommerce,
              ).map((factor) => (
                <label
                  key={factor.id}
                  className="flex items-center p-3 border border-slate-100 dark:border-slate-700/50 rounded-md bg-slate-50/50 dark:bg-[#1d2a31]/50 hover:bg-slate-50 dark:hover:bg-[#1d2a31] cursor-pointer transition-colors group"
                >
                  <div className="flex items-center h-5 mr-3">
                    <input
                      type="checkbox"
                      checked={enabledChecks.includes(factor.id)}
                      onChange={(e) => {
                        const current = [...enabledChecks]
                        if (e.target.checked) {
                          setValue("enabled_checks", [...current, factor.id])
                        } else {
                          setValue(
                            "enabled_checks",
                            current.filter((id) => id !== factor.id),
                          )
                        }
                      }}
                      className="w-4 h-4 text-accent border-slate-300 dark:border-slate-600 rounded focus:ring-accent accent-accent"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <factor.icon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-accent transition-colors" />
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">
                      {factor.label}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </form>

        <div className="p-6 border-t border-slate-100 dark:border-[#1d2a31] bg-slate-50/50 dark:bg-[#1d2a31]/50 flex space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-6 py-2.5 rounded-md text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 transition-all shadow-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit(onSubmit)}
            disabled={isPending}
            className="flex-[2] px-6 py-2.5 rounded-md text-sm font-bold text-white bg-black dark:hover:bg-[#1d2a31] hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-2 shadow-lg"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Initializing Run...</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4" />
                <span>Start QA Run</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
