import { useState, useRef } from "react"
import { toast } from "react-hot-toast"
import {
  X,
  Layers,
  Calendar,
  ShieldAlert,
  CheckCircle2,
  Image as ImageIcon,
  Clock,
  ExternalLink,
  ChevronDown,
} from "lucide-react"
import { format } from "date-fns"
import { Task, TaskStatus } from "../api/tasks.api"
import {
  useTask,
  useUpdateTask,
  useAddRebuttal,
  useAssignTask,
  usePushToBasecamp,
  useCreateTask,
  useDeleteTask,
} from "../hooks/useTasks"
import { useProject } from "../hooks/useProjects"
import { useRole } from "../hooks/useRole"
import { CanDo } from "./CanDo"
import { BasecampPushButton, BasecampTaskLink } from "./BasecampPushButton"
import { CommentThread } from "./CommentThread"
import { ResolveTaskModal } from "./ResolveTaskModal"
import { TaskActivityFeed } from "./TaskActivityFeed"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "../lib/supabase"
import { useEffect } from "react"
import { useAuthAxios } from "../lib/useAuthAxios"

interface TaskDetailPanelProps {
  task: Task | null
  isOpen: boolean
  onClose: () => void
  isFeedbackMode?: boolean
}

export const TaskDetailPanel = ({
  task: initialTask,
  isOpen,
  onClose,
  isFeedbackMode,
}: TaskDetailPanelProps) => {
  const [rebuttalText, setRebuttalText] = useState("")
  const [rebuttalUrl, setRebuttalUrl] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const axios = useAuthAxios()

  const compressToWebP = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (event) => {
        const img = new Image()
        img.src = event.target?.result as string
        img.onload = () => {
          const canvas = document.createElement("canvas")
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext("2d")
          if (!ctx) {
            reject(new Error("Canvas context not available"))
            return
          }
          ctx.drawImage(img, 0, 0)
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob)
              else reject(new Error("Canvas toBlob failed"))
            },
            "image/jpeg",
            0.8,
          )
        }
        img.onerror = (err) => reject(err)
      }
      reader.onerror = (err) => reject(err)
    })
  }

  const handleUpload = async (files: FileList | File[]) => {
    if (!task?.id) return
    setIsUploading(true)
    try {
      const file = files[0]
      if (file) {
        if (!file.type.startsWith("image/")) {
          toast.error("Only image files are allowed")
          return
        }
        const jpegBlob = await compressToWebP(file)
        const fileName = `${task.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`

        const reader = new FileReader()
        const uploadPromise = new Promise<string>((resolve, reject) => {
          reader.onloadend = async () => {
            const base64 = reader.result as string
            try {
              const { data } = await axios.post("/api/storage/upload", {
                base64,
                fileName,
              })
              resolve(data.url)
            } catch (err) {
              reject(err)
            }
          }
          reader.onerror = (err) => reject(err)
        })

        reader.readAsDataURL(jpegBlob)
        const publicUrl = await uploadPromise
        setRebuttalUrl(publicUrl)
        toast.success("Screenshot uploaded successfully")
      }
    } catch (error: any) {
      toast.error("Failed to upload image: " + error.message)
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUpload(e.target.files)
    }
  }
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false)
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [descriptionValue, setDescriptionValue] = useState("")

  // Ensure we only fetch if we have a valid task and the panel is open
  const isValidTask = initialTask && (initialTask as any).project_id
  const { data: latestTask } = useTask(
    isValidTask && isOpen ? initialTask.id : "",
  )
  const task = latestTask || initialTask
  const { isDeveloper } = useRole()

  const fullRebuttals = task?.rebuttals?.filter((r: any) => r.created_at) || []
  const fullComments = task?.comments?.filter((c: any) => c.created_at) || []
  const hasRebuttals = fullRebuttals.length > 0

  const { mutate: updateTask } = useUpdateTask()
  const { mutate: addRebuttal } = useAddRebuttal()
  const { mutate: assignTask } = useAssignTask()
  const { mutate: createTask } = useCreateTask()
  const { mutate: deleteTask } = useDeleteTask()
  const {
    mutate: pushToBasecamp,
    isPending: isPushing,
    isSuccess: pushSuccess,
  } = usePushToBasecamp()

  const queryClient = useQueryClient()

  // Real-time listener for THIS specific task
  useEffect(() => {
    if (!task?.id || !isOpen) return

    const channel = supabase
      .channel(`task-detail-${task.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `id=eq.${task.id}`,
        },
        () => {
          console.log("[Realtime] Task updated in DB...")
          queryClient.invalidateQueries({ queryKey: ["tasks", task.id] })
          queryClient.invalidateQueries({ queryKey: ["tasks"] })
          queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] })
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comments",
          filter: `task_id=eq.${task.id}`,
        },
        () => {
          console.log("[Realtime] New comment in DB...")
          queryClient.invalidateQueries({ queryKey: ["tasks", task.id] })
          queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] })
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rebuttals",
          filter: `task_id=eq.${task.id}`,
        },
        () => {
          console.log("[Realtime] New rebuttal in DB...")
          queryClient.invalidateQueries({ queryKey: ["tasks", task.id] })
          queryClient.invalidateQueries({ queryKey: ["task-activity", task.id] })
        }
      )
      .subscribe()


    return () => {
      supabase.removeChannel(channel)
    }
  }, [task?.id, isOpen, queryClient])

  useEffect(() => {
    setDescriptionValue(task?.description || "")
  }, [task?.description])

  const { data: project } = useProject(task?.project_id || "")

  if (!task) return null

  const isFeedbackTask = isFeedbackMode || task.title?.startsWith("[Feedback]")

  const handlePush = () => {
    const checkFactor =
      task.findings?.check_factor || (task as any).check_factor

    const checkNames: Record<string, string> = {
      project_plan: "Project Plan Check",
      hero_media: "Hero Video Check",
      dead_links: "Deadlink Check",
      learn_more_buttons: "Learn more buttons check",
      paid_media: "Paid Media Check",
      privacy_policy: "Privacy Policy check",
      footer_logo: "Footer Logo check",
      single_script: "SingleScript Features",
      url_tab_compare: "Urltab comparison",
      top_bar_sticky: "Top bar sticky header check",
      favicon_check: "Favicon check",
      favicon: "Favicon check",
      contact_form: "Contactform check",
      logo_chatbot: "Logo on chatbot check",
      callnow_links: "Callnow button check",
      verify_plugin_updates: "Callnow button check (Plugin updates)",
    }

    if (checkFactor && checkNames[checkFactor]) {
      console.log(
        `Pushing ${checkNames[checkFactor]} task to specific checklist item...`,
        {
          taskId: task.id,
        },
      )
    } else {
      console.log("Pushing task...", { taskId: task.id })
    }

    if (checkFactor === "project_plan") {
      pushToBasecamp({
        taskId: task.id,
        options: {
          todoName: "QA-Check if reviews are added for Accelerator plan",
          todoListName: "15-Quality Assurance - Prerelease 2026",
        },
      })
    } else {
      pushToBasecamp(task.id)
    }
  }

  const handleStatusChange = (status: TaskStatus) => {
    if (isDeveloper && status === "resolved") {
      setIsResolveModalOpen(true)
      return
    }
    updateTask({ id: task.id, data: { status } })
  }

  const handleAssigneeChange = (userId: string) => {
    assignTask({ id: task.id, userId })
  }

  const handleAddRebuttal = (e: React.FormEvent) => {
    e.preventDefault()
    if (!rebuttalText.trim()) return
    addRebuttal(
      {
        taskId: task.id,
        data: { text: rebuttalText, screenshot_url: rebuttalUrl || undefined },
      },
      {
        onSuccess: () => {
          setRebuttalText("")
          setRebuttalUrl("")
        },
      },
    )
  }

  const handleSaveDescription = () => {
    updateTask(
      { id: task.id, data: { description: descriptionValue } },
      {
        onSuccess: () => {
          setIsEditingDescription(false)
          toast.success("Description updated")
        },
        onError: () => {
          toast.error("Failed to update description")
        },
      },
    )
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity !mt-0"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 bottom-10 right-0 w-full max-w-xl bg-slate-50 dark:bg-[#131D22] shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col overflow-hidden !mt-0 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-[#131D22]">
          <div className="flex items-center space-x-3">
            <h2 className="font-bold text-slate-900 dark:text-white">
              Task Details
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 dark:hover:bg-[#1d2a31] rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Main Content */}
          <div className="p-6 space-y-8">
            {/* Title & Status */}
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">
                {(() => {
                  const match = task.title.match(/^(Issue #\d+):?\s*(.*)$/)
                  if (match) {
                    return (
                      <div className="flex flex-col space-y-1">
                        <span className="text-accent text-sm font-bold uppercase tracking-[0.2em]">
                          {match[1]}
                        </span>
                        <span>{match[2]}</span>
                      </div>
                    )
                  }
                  return task.title
                })()}
              </h1>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                    Current Status
                  </span>
                  <select
                    value={task.status}
                    onChange={(e) =>
                      handleStatusChange(e.target.value as TaskStatus)
                    }
                    className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border focus:outline-none focus:ring-2 focus:ring-accent/20 ${getStatusStyles(task.status)}`}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    {!isDeveloper && <option value="closed">Closed</option>}
                  </select>
                </div>

                {!isFeedbackTask && (
                  <CanDo role="qa_engineer">
                    <div className="flex flex-col space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                        Assignees
                      </span>
                      <div className="flex flex-wrap gap-2 items-center">
                        {task.assignees?.map((a) => (
                          <div
                            key={a.taskId}
                            className={`flex items-center border rounded px-2.5 py-1 space-x-2 transition-all ${
                              a.taskId === task.id
                                ? "bg-accent/10 border-accent/20 text-accent"
                                : "bg-slate-50 dark:bg-[#1D2A31] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <span className="text-[11px] font-bold uppercase tracking-wider">
                              {a.name}
                            </span>
                            <button
                              onClick={() => {
                                if (
                                  task.assignees &&
                                  task.assignees.length <= 1
                                ) {
                                  toast.error("Cannot remove the last assignee")
                                  return
                                }
                                deleteTask(a.taskId, {
                                  onSuccess: () => {
                                    if (a.taskId === task.id) onClose()
                                  },
                                })
                              }}
                              className="p-0.5 hover:bg-slate-200/50 dark:hover:bg-[#1d2a31]/50 rounded-full transition-colors"
                            >
                              <X size={10} strokeWidth={3} />
                            </button>
                          </div>
                        ))}

                        <div className="relative">
                          <select
                            value=""
                            onChange={(e) => {
                              const userId = e.target.value
                              if (!userId) return
                              createTask({
                                project_id: task.project_id,
                                finding_id: task.finding_id,
                                title: task.title,
                                description: task.description,
                                assigned_to: userId,
                                status: task.status,
                                gallery_images: task.gallery_images,
                              } as any)
                            }}
                            className="appearance-none bg-slate-50 dark:bg-[#1D2A31] border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-accent hover:text-accent text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-widest rounded-lg px-3 py-1 pr-8 cursor-pointer transition-all focus:outline-none"
                          >
                            <option value="">+ Add Dev</option>
                            {project?.project_members
                              .filter(
                                (m) =>
                                  !task.assignees?.some(
                                    (a) => a.userId === m.user_id,
                                  ),
                              )
                              .map((m) => (
                                <option key={m.user_id} value={m.user_id}>
                                  {m.users.full_name}
                                </option>
                              ))}
                          </select>
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                            <ChevronDown size={12} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </CanDo>
                )}

                {!isFeedbackTask &&
                  project?.basecamp_account_id &&
                  project?.basecamp_project_id &&
                  (project?.basecamp_todo_list_id ||
                    project?.basecamp_post_todo_list_id) && (
                    <BasecampPushButton
                      task={task}
                      onPush={handlePush}
                      isPending={isPushing}
                      isSuccess={pushSuccess}
                    />
                  )}
              </div>
            </div>

            {/* Meta Grid */}
            <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-50 dark:border-slate-800">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center">
                  <Layers className="w-3 h-3 mr-1" /> Project
                </span>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {task.projects?.name || "N/A"}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center">
                  <Calendar className="w-3 h-3 mr-1" /> Created
                </span>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {format(new Date(task.created_at), "MMM d, yyyy")}
                </p>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                  Description
                </span>
                {!isEditingDescription && (
                  <button
                    onClick={() => setIsEditingDescription(true)}
                    className="text-[10px] font-bold text-accent uppercase tracking-widest hover:text-accent/80 transition-colors"
                  >
                    Edit
                  </button>
                )}
              </div>
              {isEditingDescription ? (
                <div className="space-y-2">
                  <textarea
                    value={descriptionValue}
                    onChange={(e) => setDescriptionValue(e.target.value)}
                    className="w-full text-sm text-slate-700 dark:text-slate-200 leading-relaxed bg-white dark:bg-[#1D2A31] p-4 rounded-xl border border-slate-200 dark:border-slate-700 min-h-[120px] focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all resize-y"
                    placeholder="Enter task description..."
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveDescription}
                      className="px-3 py-1.5 bg-accent text-white hover:bg-accent/90 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setDescriptionValue(task.description || "")
                        setIsEditingDescription(false)
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-50 dark:bg-[#1D2A31] p-4 rounded-xl border border-slate-100 dark:border-slate-700 min-h-[100px]">
                  {task.description || "No description provided."}
                </div>
              )}
            </div>

            {/* Evidence Gallery */}
            {task.gallery_images && task.gallery_images.length > 0 && (
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center">
                  <ImageIcon className="w-3 h-3 mr-1" /> Evidence Gallery
                </span>
                <div className="grid grid-cols-3 gap-3">
                  {task.gallery_images.map((img, i) => (
                    <a
                      key={i}
                      href={img}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aspect-square bg-slate-100 dark:bg-[#1D2A31] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 group/img relative"
                    >
                      <img
                        src={img}
                        className="w-full h-full object-cover transition-transform group-hover/img:scale-110"
                        alt={`Evidence ${i + 1}`}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
                        <ExternalLink
                          size={16}
                          className="text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
                        />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Comment Thread */}
            <div className="pt-8 border-t border-slate-100 dark:border-slate-800">
              <CommentThread
                taskId={task.id}
                comments={fullComments}
                rebuttals={fullRebuttals}
                taskDescription={task.description}
                taskCreatedAt={task.created_at}
                taskCreatorName={task.creator?.full_name}
                isEditingDescription={isEditingDescription}
                setIsEditingDescription={setIsEditingDescription}
                descriptionValue={descriptionValue}
                setDescriptionValue={setDescriptionValue}
                onSaveDescription={handleSaveDescription}
                basecampElement={
                  !isFeedbackTask &&
                  project?.basecamp_account_id &&
                  project?.basecamp_project_id &&
                  (project?.basecamp_todo_list_id ||
                    project?.basecamp_post_todo_list_id) ? (
                    <BasecampPushButton
                      task={task}
                      onPush={handlePush}
                      isPending={isPushing}
                      isSuccess={pushSuccess}
                    />
                  ) : undefined
                }
              />
            </div>

            {/* Rebuttal Section */}
            {(hasRebuttals || isDeveloper) && (
              <div className="space-y-4 pt-8 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center space-x-2 text-amber-600">
                  <ShieldAlert className="w-4 h-4" />
                  <h3 className="font-bold uppercase tracking-widest text-xs">
                    Developer Rebuttal
                  </h3>
                </div>

                <div className="bg-red-50/50 dark:bg-[#131D22] border border-red-100 dark:border-[#1D2A31] rounded-xl p-4 space-y-4">
                  {isDeveloper && (
                    <p className="text-xs text-amber-600 font-medium leading-relaxed">
                      If you disagree with this finding, provide a detailed
                      rebuttal and optional screenshot. QA will review it.
                    </p>
                  )}

                  {hasRebuttals && (
                    <div className="space-y-4">
                      {fullRebuttals.map((r: any) => (
                        <div
                          key={r.id}
                          className="bg-slate-50 dark:bg-[#1D2A31] border border-red-100 dark:border-[#131D22] p-3 rounded-lg space-y-2"
                        >
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase text-red-400">
                            <span>{r.users?.full_name}</span>
                            <span>
                              {format(new Date(r.created_at), "MMM d, HH:mm")}
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300 italic">
                            {r.text}
                          </p>
                          {r.screenshot_url && (
                            <a
                              href={r.screenshot_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-[10px] font-bold text-accent hover:underline"
                            >
                              <ImageIcon className="w-3 h-3" />
                              <span>View Screenshot</span>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <CanDo role="developer">
                    <form onSubmit={handleAddRebuttal} className="space-y-3">
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <textarea
                        value={rebuttalText}
                        onChange={(e) => setRebuttalText(e.target.value)}
                        onPaste={async (e) => {
                          if (e.clipboardData.files.length > 0) {
                            e.preventDefault()
                            await handleUpload(e.clipboardData.files)
                          }
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={async (e) => {
                          e.preventDefault()
                          if (e.dataTransfer.files.length > 0) {
                            await handleUpload(e.dataTransfer.files)
                          }
                        }}
                        placeholder="Explain why this finding is incorrect... (Paste or drag screenshot here)"
                        className="w-full bg-slate-50 dark:bg-[#1D2A31] border border-red-100 dark:border-[#1D2A31] rounded-lg px-3 py-2 text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/20 resize-none min-h-[80px]"
                      />
                      {rebuttalUrl && (
                        <div className="relative w-20 h-20 rounded border border-slate-200 dark:border-[#1D2A31] overflow-hidden bg-black/5">
                          <img
                            src={rebuttalUrl}
                            alt="Screenshot Preview"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => setRebuttalUrl("")}
                            className="absolute top-0.5 right-0.5 p-0.5 bg-red-600 text-white rounded-full hover:bg-red-700"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center justify-between w-full">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploading}
                          className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                          title="Upload screenshot"
                        >
                          <ImageIcon className="w-4 h-4" />
                          {isUploading
                            ? "Uploading..."
                            : "Upload Screenshot (optional)"}
                        </button>
                        <button
                          type="submit"
                          disabled={!rebuttalText.trim() || isUploading}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-red-700 transition-all active:scale-95 disabled:opacity-50"
                        >
                          Submit
                        </button>
                      </div>
                    </form>
                  </CanDo>
                </div>
              </div>
            )}

            {/* Activity Feed Sidebar/Section */}
            <div className="pt-8 border-t border-slate-100 dark:border-slate-800">
              <TaskActivityFeed taskId={task.id} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131D22] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              Last update:
              <br /> {format(new Date(task.updated_at), "MMM d, HH:mm")}
            </span>
          </div>
          <div className="flex items-center space-x-4">
            {task.basecamp_url && (
              <div className="animate-in fade-in zoom-in duration-300">
                <BasecampTaskLink url={task.basecamp_url} />
              </div>
            )}
            <button
              disabled
              className="inline-flex items-center space-x-2 text-slate-400 font-bold text-xs cursor-not-allowed opacity-60"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Mark as Resolved</span>
            </button>
          </div>
        </div>
      </div>

      <ResolveTaskModal
        task={task}
        isOpen={isResolveModalOpen}
        onClose={() => setIsResolveModalOpen(false)}
      />
    </>
  )
}

const getStatusStyles = (status: TaskStatus) => {
  switch (status) {
    case "open":
      return "bg-blue-50 text-blue-600 border-blue-100 dark:bg-[#1D2A31] dark:border-blue-900/50 dark:text-blue-400"
    case "in_progress":
      return "bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-[#1D2A31] dark:border-indigo-900/50 dark:text-indigo-400"
    case "resolved":
      return "bg-green-50 text-green-600 border-green-100 dark:bg-[#1D2A31] dark:border-green-900/50 dark:text-green-400"
    case "closed":
      return "bg-slate-50 text-slate-600 border-slate-100 dark:bg-[#1D2A31] dark:border-slate-700 dark:text-slate-400"
    default:
      return "bg-slate-50 text-slate-600 border-slate-100 dark:bg-[#1D2A31] dark:border-slate-700 dark:text-slate-400"
  }
}
