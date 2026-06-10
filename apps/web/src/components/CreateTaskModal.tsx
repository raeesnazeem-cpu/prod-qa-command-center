import React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CreateTaskSchema, CreateTaskInput } from "@qacc/shared"
import { useCreateTask } from "../hooks/useTasks"
import { useProjects, useWorkspaceUsers } from "../hooks/useProjects"
import {
  X,
  Loader2,
  CheckCircle2,
  ShieldAlert,
  User,
  ImageIcon,
} from "lucide-react"
import { createPortal } from "react-dom"
import { useAuthAxios } from "../lib/useAuthAxios"

interface CreateTaskModalProps {
  projectId?: string
  isOpen: boolean
  onClose: () => void
  prefillData?: Partial<CreateTaskInput>
}

export const CreateTaskModal = ({
  projectId,
  isOpen,
  onClose,
  prefillData,
}: CreateTaskModalProps) => {
  const { mutate: createTask, isPending } = useCreateTask()
  const { data: projects } = useProjects()
  const { data: members } = useWorkspaceUsers()
  const axios = useAuthAxios()
  const [uploadedImages, setUploadedImages] = React.useState<string[]>([])
  const [isUploading, setIsUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const uploadFile = async (file: File) => {
    if (uploadedImages.length >= 3) return
    setIsUploading(true)
    try {
      const reader = new FileReader()
      reader.onloadend = async () => {
        const base64 = reader.result as string
        try {
          const { data } = await axios.post("/api/storage/upload", {
            base64,
            fileName: file.name,
          })
          setUploadedImages((prev) => [...prev, data.url].slice(0, 3))
        } catch (error) {
          console.error("Upload failed", error)
        } finally {
          setIsUploading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error("File reading failed", error)
      setIsUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith("image/")) uploadFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          uploadFile(file)
          break
        }
      }
    }
  }

  const removeImage = (index: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index))
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTaskInput>({
    resolver: zodResolver(CreateTaskSchema),
    defaultValues: {
      project_id: projectId || "",
      severity: "medium",
      ...prefillData,
    },
  })

  React.useEffect(() => {
    if (isOpen) {
      const images = prefillData?.gallery_images || []
      setUploadedImages(images)
      if (prefillData) {
        reset({
          project_id: projectId || "",
          severity: "medium",
          ...prefillData,
          gallery_images: images,
        } as CreateTaskInput)
      }
    }
  }, [isOpen, prefillData, reset, projectId])

  const onSubmit = (data: CreateTaskInput) => {
    createTask(
      {
        ...data,
        project_id: projectId || "",
        gallery_images: uploadedImages,
      },
      {
        onSuccess: () => {
          reset()
          setUploadedImages([])
          onClose()
        },
      },
    )
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm transition-opacity duration-200">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-[#1d2a31] rounded-[10px] shadow-sm overflow-hidden transition-all duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-[#1d2a31] bg-slate-50/50 dark:bg-[#1d2a31]/50">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Create New Task
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
          onPaste={handlePaste}
          className="p-6 space-y-6"
        >
          <div className="space-y-4">
            {/* Project Selection (if not provided) */}
            {!projectId && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Project <span className="text-accent">*</span>
                </label>
                <select
                  {...register("project_id")}
                  className={`w-full bg-slate-50 dark:bg-[#1d2a31] border ${
                    errors.project_id
                      ? "border-red-400/50 dark:border-red-400/50"
                      : "border-slate-200 dark:border-slate-700"
                  } rounded-md px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all`}
                >
                  <option value="">Select a project</option>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {errors.project_id && (
                  <p className="mt-1.5 text-xs text-red-500 font-medium">
                    {errors.project_id.message}
                  </p>
                )}
              </div>
            )}

            {/* Title */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Task Title <span className="text-accent">*</span>
              </label>
              <input
                {...register("title")}
                placeholder="e.g. Fix mobile menu overlap"
                className={`w-full bg-slate-50 dark:bg-[#1d2a31] border ${
                  errors.title
                    ? "border-red-400/50 dark:border-red-400/50"
                    : "border-slate-200 dark:border-slate-700 hover:border-accent dark:hover:border-accent"
                } rounded-md px-4 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent active:border-accent transition-all`}
              />
              {errors.title && (
                <p className="mt-1.5 text-xs text-red-500 font-medium">
                  {errors.title.message}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Description{" "}
                <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase ml-1">
                  (Optional)
                </span>
              </label>
              <textarea
                {...register("description")}
                placeholder="Provide more context about the issue..."
                rows={3}
                className="w-full bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md px-4 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all resize-none"
              />
            </div>

            {/* Severity */}
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Severity
                </label>
                <div className="relative">
                  <ShieldAlert className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                  <select
                    {...register("severity")}
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md pl-10 pr-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all appearance-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Image Upload */}
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Attachments{" "}
                <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase ml-1">
                  (Optional - Up to 3 images)
                </span>
              </label>

              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() =>
                  uploadedImages.length < 3 && fileInputRef.current?.click()
                }
                className={`relative group border-2 border-dashed rounded-md p-6 transition-all flex flex-col items-center justify-center gap-2 ${
                  uploadedImages.length >= 3
                    ? "border-slate-200 bg-slate-50/50 cursor-not-allowed opacity-60 dark:border-slate-700 dark:bg-[#1d2a31]/50"
                    : "border-slate-200 bg-slate-50 hover:border-accent hover:bg-accent/5 cursor-pointer dark:border-slate-700 dark:bg-[#1d2a31] dark:hover:border-accent dark:focus:border-accent dark:focus:ring-1 dark:focus:ring-accent"
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept="image/*"
                />

                {isUploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 text-accent animate-spin" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      Uploading...
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-full bg-slate-50 shadow-sm border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-accent transition-colors dark:bg-[#131d22] dark:border-slate-800 dark:focus:border-accent dark:focus:ring-1 dark:focus:ring-accent">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">
                        Click, drag, or paste image
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {uploadedImages.length} of 3 uploaded
                      </p>
                    </div>
                  </>
                )}
              </div>

              {uploadedImages.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mt-3">
                  {uploadedImages.map((url, idx) => (
                    <div
                      key={idx}
                      className="relative w-full aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm group"
                    >
                      <img
                        src={url}
                        className="w-full h-full object-cover"
                        alt="Upload"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeImage(idx)
                        }}
                        className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-red-500/80 rounded-md text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Assignee Selection */}
            {members && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Assign To{" "}
                  <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase ml-1">
                    (Optional)
                  </span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                  <select
                    {...register("assigned_to")}
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md pl-10 pr-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all appearance-none"
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.full_name} ({member.role.replace("_", " ")})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
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
                <span>Create Task</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
