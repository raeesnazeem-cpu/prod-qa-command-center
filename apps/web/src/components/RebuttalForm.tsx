import React, { useState, useCallback } from "react"
import { Upload, X, Loader2, Send } from "lucide-react"
import { useAddRebuttal } from "../hooks/useTasks"
import { supabase } from "../lib/supabase"
import toast from "react-hot-toast"

interface RebuttalFormProps {
  taskId: string
  onCancel: () => void
  onSuccess: () => void
}

export const RebuttalForm: React.FC<RebuttalFormProps> = ({
  taskId,
  onCancel,
  onSuccess,
}) => {
  const [text, setText] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false)

  const { mutate: submitRebuttal, isPending: isSubmitting } = useAddRebuttal()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (selectedFile.size > 5 * 1024 * 1024) {
        toast.error("File size must be less than 5MB")
        return
      }
      if (!selectedFile.type.startsWith("image/")) {
        toast.error("Only image files are allowed")
        return
      }
      setFile(selectedFile)
      setPreviewUrl(URL.createObjectURL(selectedFile))
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer.files?.[0]
    if (droppedFile) {
      if (droppedFile.size > 5 * 1024 * 1024) {
        toast.error("File size must be less than 5MB")
        return
      }
      if (!droppedFile.type.startsWith("image/")) {
        toast.error("Only image files are allowed")
        return
      }
      setFile(droppedFile)
      setPreviewUrl(URL.createObjectURL(droppedFile))
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (text.length < 20) {
      toast.error("Explanation must be at least 20 characters")
      return
    }

    let uploadedUrl = ""
    if (file) {
      setIsUploading(true)
      try {
        const fileExt = file.name.split(".").pop()
        const fileName = `${taskId}-${Date.now()}.${fileExt}`
        const filePath = `rebuttals/${fileName}`

        const { error: uploadError } = await supabase.storage
          .from("screenshots")
          .upload(filePath, file)

        if (uploadError) throw uploadError

        const { data } = supabase.storage
          .from("screenshots")
          .getPublicUrl(filePath)

        uploadedUrl = data.publicUrl
      } catch (error: any) {
        toast.error("Failed to upload screenshot: " + error.message)
        setIsUploading(false)
        return
      } finally {
        setIsUploading(false)
      }
    }

    setIsAiAnalyzing(true)
    submitRebuttal(
      {
        taskId,
        data: {
          text,
          screenshot_url: uploadedUrl || undefined,
        },
      },
      {
        onSuccess: () => {
          setIsAiAnalyzing(false)
          onSuccess()
        },
        onError: () => {
          setIsAiAnalyzing(false)
        },
      },
    )
  }

  if (isAiAnalyzing) {
    return (
      <div className="bg-slate-50 dark:bg-[#1d2a31] border border-red-200 dark:border-red-900/50 rounded-md p-8 shadow-xl flex flex-col items-center justify-center space-y-4 animate-in zoom-in duration-300">
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-full relative">
          <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
          <div className="absolute inset-0 bg-red-500/10 rounded-full animate-ping" />
        </div>
        <div className="text-center">
          <h4 className="font-bold text-slate-900 dark:text-white uppercase tracking-widest text-sm">
            Rebuttal submitted
          </h4>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-tighter mt-1">
            AI is analyzing your evidence...
          </p>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-slate-50 dark:bg-[#1d2a31] border border-red-200 dark:border-red-900/50 rounded-md p-6 shadow-xl space-y-6 ring-4 ring-red-500/5 animate-in slide-in-from-top-4 duration-300"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-red-600 dark:text-red-400">
          New Rebuttal Submission
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#131d22] rounded-lg text-slate-400 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
            Explanation (Min 20 characters)
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Explain why this is fixed or not an issue..."
            className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 font-medium focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500/40 focus:bg-slate-50 dark:focus:bg-[#131d22] transition-all resize-none min-h-[120px]"
            required
            minLength={20}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
            Evidence Screenshot (Optional, Max 5MB)
          </label>
          {previewUrl ? (
            <div className="relative group rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 aspect-video bg-slate-100 dark:bg-[#131d22]">
              <img
                src={previewUrl}
                alt="Preview"
                className="w-full h-full object-contain"
              />
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  setPreviewUrl(null)
                }}
                className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm transition-all shadow-lg"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDrop(e)
              }}
              className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center gap-3 hover:border-red-300 dark:hover:border-red-400/50 hover:bg-red-50/30 dark:hover:bg-red-900/10 transition-all cursor-pointer group"
              onClick={() =>
                document.getElementById("screenshot-upload")?.click()
              }
            >
              <div className="p-3 bg-slate-100 dark:bg-[#1d2a31] rounded-xl group-hover:bg-red-100 dark:group-hover:bg-red-900/30 transition-colors">
                <Upload
                  size={20}
                  className="text-slate-400 group-hover:text-red-600"
                />
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                  Drag & drop or click to upload
                </p>
                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-1">
                  Image files only up to 5MB
                </p>
              </div>
              <input
                id="screenshot-upload"
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleFileChange}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={text.length < 20 || isUploading || isSubmitting}
          className="flex items-center gap-2 bg-red-600 text-white px-8 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg shadow-red-500/20 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
        >
          {isSubmitting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send size={12} />
              Submit Rebuttal
            </>
          )}
        </button>
      </div>
    </form>
  )
}
