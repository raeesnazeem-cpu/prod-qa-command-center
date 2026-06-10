import React, { useState, useEffect, useRef } from "react"
import {
  X,
  Send,
  CheckCircle2,
  ImageIcon,
  MessageSquare,
  Loader2,
  FileText,
} from "lucide-react"
import { Task } from "../api/tasks.api"
import { useResolveTask } from "../hooks/useTasks"
import { TaskCommentsModal } from "./TaskCommentsModal"
import { useAuthAxios } from "../lib/useAuthAxios"
import { createPortal } from "react-dom"

interface ResolveTaskModalProps {
  task: Task | null
  isOpen: boolean
  onClose: () => void
}

export const ResolveTaskModal = ({
  task,
  isOpen,
  onClose,
}: ResolveTaskModalProps) => {
  const [comment, setComment] = useState("")
  const [screenshotUrl, setScreenshotUrl] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [isCommentsModalOpen, setIsCommentsModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const axios = useAuthAxios()
  const { mutate: resolve, isPending } = useResolveTask()

  useEffect(() => {
    if (task && isOpen) {
      setComment("")
      setScreenshotUrl("")
    }
  }, [task, isOpen])

  if (!isOpen || !task) return null

  const issueMatch = task.title.match(/Issue #(\d+)/)
  const issueNumber = issueMatch ? issueMatch[1] : null

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

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
          setScreenshotUrl(data.url)
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

  const handleConfirm = () => {
    if (!comment.trim()) return

    resolve(
      {
        taskId: task.id,
        data: {
          comment,
          screenshot_url: screenshotUrl || undefined,
        },
      },
      {
        onSuccess: () => onClose(),
      },
    )
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-slate-50 w-full max-w-lg rounded-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm uppercase tracking-widest">
                  {issueNumber ? `Issue #${issueNumber}` : "Task"} - Mark as
                  Resolved
                </h3>
                <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-tight">
                  Finalizing task for QA review
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-200 rounded-xl transition-all active:scale-90"
            >
              <X size={20} className="text-slate-400" />
            </button>
          </div>

          <div className="p-8 overflow-y-auto space-y-6">
            {/* Task Context */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Initial Description
                </span>
                <button
                  onClick={() => setIsCommentsModalOpen(true)}
                  className="flex items-center gap-1 text-[10px] font-bold text-accent hover:underline uppercase tracking-widest"
                >
                  <MessageSquare className="w-3 h-3" /> View Comments
                </button>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-md p-4 text-xs text-slate-600 italic leading-relaxed max-h-24 overflow-y-auto">
                {task.description || "No description provided."}
              </div>
            </div>

            {/* Feedback Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Resolution Comment (Required)
                </span>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Describe what was fixed or how to verify..."
                className="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none min-h-[120px] transition-all"
              />
            </div>

            {/* Screenshot Section */}
            <div className="space-y-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <ImageIcon className="w-3 h-3 mr-1" /> Confirmation Screenshot
                (Optional)
              </span>

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`relative group cursor-pointer border-2 border-dashed rounded-md p-8 transition-all flex flex-col items-center justify-center gap-2 ${
                  screenshotUrl
                    ? "border-emerald-200 bg-emerald-50/30"
                    : "border-slate-200 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/10"
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
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      Uploading...
                    </span>
                  </div>
                ) : screenshotUrl ? (
                  <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-emerald-200 shadow-sm">
                    <img
                      src={screenshotUrl}
                      className="w-full h-full object-cover"
                      alt="Preview"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold uppercase tracking-widest">
                        Change Image
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-slate-50 shadow-sm border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-emerald-500 transition-colors">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-bold text-slate-600 uppercase tracking-tight">
                        Click to upload screenshot
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        PNG, JPG or JPEG (Max 5MB)
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest hover:text-slate-900 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!comment.trim() || isPending || isUploading}
              className="btn-unified px-4 py-2 justify-center flex items-center gap-2 disabled:opacity-50"
            >
              {isPending ? (
                <span className="animate-pulse">Syncing...</span>
              ) : (
                <>
                  <span>Resolve & Sync</span>
                  <Send size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <TaskCommentsModal
        task={task}
        isOpen={isCommentsModalOpen}
        onClose={() => setIsCommentsModalOpen(false)}
      />
    </>,
    document.body,
  )
}
