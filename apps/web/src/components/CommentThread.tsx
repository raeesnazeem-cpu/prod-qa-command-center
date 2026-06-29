import { useState, useEffect, useRef } from "react"
import {
  Send,
  Bot,
  MessageSquare,
  Clock,
  Paperclip,
  Image as ImageIcon,
  X,
} from "lucide-react"
import { format } from "date-fns"
import { TaskComment, TaskRebuttal } from "../api/tasks.api"
import { useAddComment } from "../hooks/useTasks"
import { supabase } from "../lib/supabase"
import { toast } from "react-hot-toast"
import { useAuthAxios } from "../lib/useAuthAxios"

interface CommentThreadProps {
  taskId: string
  comments: TaskComment[]
  rebuttals?: TaskRebuttal[]
}

type ThreadItem =
  | (TaskComment & { itemType: "comment" })
  | (TaskRebuttal & { itemType: "rebuttal" })

export const CommentThread = ({
  taskId,
  comments,
  rebuttals = [],
}: CommentThreadProps) => {
  const [newComment, setNewComment] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [attachedImages, setAttachedImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const axios = useAuthAxios()
  const scrollRef = useRef<HTMLDivElement>(null)
  const { mutate: addComment, isPending: isSubmitting } = useAddComment()
  useAddComment()
  // Compress image to WebP format
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
  // Upload compressed file to Supabase storage via backend API proxy
  const handleUpload = async (files: FileList | File[]) => {
    setIsUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error("Only image files are allowed")
          continue
        }
        const jpegBlob = await compressToWebP(file)
        const fileName = `${taskId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`

        // Convert Blob to base64
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
        setAttachedImages((prev) => [...prev, publicUrl])
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

  // Merge and sort in chronological order
  const threadItems: ThreadItem[] = [
    ...comments.map((c) => ({ ...c, itemType: "comment" as const })),
    ...rebuttals.map((r) => ({ ...r, itemType: "rebuttal" as const })),
  ].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  // Auto-scroll to bottom on new items
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [threadItems])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (
      (!newComment.trim() && attachedImages.length === 0) ||
      isSubmitting ||
      isUploading
    )
      return

    let finalContent = newComment.trim()
    if (attachedImages.length > 0) {
      finalContent +=
        "\n" +
        attachedImages.map((url) => `[Image Attachment: ${url}]`).join("\n")
    }

    addComment(
      { taskId, content: finalContent },
      {
        onSuccess: () => {
          setNewComment("")
          setAttachedImages([])
        },
      },
    )
  }

  const getInitials = (name?: string) => {
    if (!name) return "?"
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
  }

  return (
    <div className="flex flex-col h-full max-h-[600px]">
      <div className="flex items-center space-x-2 mb-4">
        <MessageSquare className="w-4 h-4 text-slate-400" />
        <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-widest text-xs">
          Discussion
        </h3>
      </div>

      {/* Comment List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar mb-4"
      >
        {threadItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center opacity-40">
            <MessageSquare className="w-8 h-8 mb-2" />
            <p className="text-xs font-medium dark:text-slate-300">
              No comments yet. Start the conversation.
            </p>
          </div>
        ) : (
          threadItems.map((item) => {
            const isRebuttal = item.itemType === "rebuttal"
            const isAI = item.itemType === "comment" && item.is_ai_generated

            const rawContent = isRebuttal ? item.text : item.content

            // Extract attached images using regex
            const imgRegex = /\[Image Attachment:\s*(https?:\/\/[^\]]+)\]/g
            const commentImages: string[] = []
            let match
            while ((match = imgRegex.exec(rawContent)) !== null) {
              commentImages.push(match[1])
            }
            const content = rawContent.replace(imgRegex, "").trim()

            return (
              <div
                key={item.id}
                className="flex space-x-3 group animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-[#1d2a31] flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shrink-0">
                  {isAI ? (
                    <Bot className="w-4 h-4 text-blue-900" />
                  ) : (
                    getInitials(item.users?.full_name)
                  )}
                </div>

                <div className="flex-1 space-y-1 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {isAI
                          ? "AI Agent"
                          : item.users?.full_name || "Unknown User"}
                      </span>
                      {isAI && (
                        <span className="inline-flex items-center bg-blue-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">
                          <Bot className="w-3 h-3 mr-1" />
                          AI Analysis
                        </span>
                      )}
                      {isRebuttal && (
                        <span className="inline-flex items-center bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter border border-blue-200">
                          Rebuttal
                        </span>
                      )}
                    </div>
                    <div className="flex items-center text-[10px] text-slate-400">
                      <Clock className="w-2.5 h-2.5 mr-1" />
                      {format(new Date(item.created_at), "MMM d, HH:mm")}
                    </div>
                  </div>

                  <div
                    className={`text-sm text-slate-600 dark:text-slate-300 p-3 rounded-xl rounded-tl-none border break-words ${
                      isAI
                        ? "bg-blue-50/30 dark:bg-blue-900/30 border-blue-900 dark:border-blue-800 italic" // Navy border equivalent
                        : isRebuttal
                          ? "bg-blue-50/50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-700 shadow-sm" // Blue border
                          : "bg-slate-50 dark:bg-[#1D2A31] border-slate-100 dark:border-slate-800"
                    }`}
                  >
                    {content}

                    {commentImages.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2 max-w-sm">
                        {commentImages.map((imgUrl, idx) => (
                          <a
                            key={idx}
                            href={imgUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="relative aspect-video rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black/5"
                          >
                            <img
                              src={imgUrl}
                              alt="Attached evidence"
                              className="w-full h-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    )}

                    {isRebuttal && item.screenshot_url && (
                      <div className="mt-3">
                        <img
                          src={item.screenshot_url}
                          alt="Rebuttal evidence"
                          className="max-h-48 rounded-lg border border-slate-200 object-contain shadow-sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Input Area */}
      {attachedImages.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 border border-slate-100 dark:border-slate-800 rounded-lg mb-2 bg-slate-50/50 dark:bg-slate-900/50">
          {attachedImages.map((imgUrl, idx) => (
            <div
              key={idx}
              className="relative w-16 h-16 rounded border border-slate-200 dark:border-slate-700 overflow-hidden bg-black/5"
            >
              <img
                src={imgUrl}
                alt="Preview"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() =>
                  setAttachedImages((prev) => prev.filter((_, i) => i !== idx))
                }
                className="absolute top-0.5 right-0.5 p-0.5 bg-red-600 text-white rounded-full hover:bg-red-700"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative group">
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
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
          placeholder="Add a comment... (Enter to send, drop or paste images)"
          className="w-full bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm dark:text-white focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/5 min-h-[80px] pr-20 transition-all resize-none shadow-sm group-hover:border-slate-300 dark:group-hover:border-slate-600"
          disabled={isSubmitting || isUploading}
        />
        <div className="absolute right-3 bottom-3 flex items-center space-x-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSubmitting || isUploading}
            className="p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1d2a31]"
          >
            {isUploading ? (
              <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin inline-block" />
            ) : (
              <Paperclip className="w-4 h-4" />
            )}
          </button>
          <button
            type="submit"
            className={`p-2 rounded-lg transition-all active:scale-95 ${
              (newComment.trim() || attachedImages.length > 0) &&
              !isSubmitting &&
              !isUploading
                ? "bg-[#000000] dark:bg-white text-white dark:text-black hover:bg-[#93C0B1]"
                : "bg-slate-100 dark:bg-[#1d2a31] text-slate-400 dark:text-slate-500 cursor-not-allowed"
            }`}
            disabled={
              (!newComment.trim() && attachedImages.length === 0) ||
              isSubmitting ||
              isUploading
            }
          >
            <Send
              className={`w-4 h-4 ${isSubmitting ? "animate-pulse" : ""}`}
            />
          </button>
        </div>
      </form>
    </div>
  )
}
