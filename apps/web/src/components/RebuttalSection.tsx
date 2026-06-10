import React, { useState } from "react"
import {
  ShieldAlert,
  Image as ImageIcon,
  Plus,
  X,
  Send,
  AlertCircle,
} from "lucide-react"
import { format } from "date-fns"
import { Task } from "../api/tasks.api"
import { useAddRebuttal } from "../hooks/useTasks"
import { CanDo } from "./CanDo"

interface RebuttalSectionProps {
  task: Task
}

export const RebuttalSection: React.FC<RebuttalSectionProps> = ({ task }) => {
  const [showForm, setShowForm] = useState(false)

  const canSubmit = task.status === "open" || task.status === "in_progress"

  return (
    <CanDo role="developer">
      <div className="space-y-4 pt-8 border-t border-slate-100 dark:border-slate-800/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-red-600 dark:text-red-400">
            <ShieldAlert className="w-4 h-4" />
            <h3 className="font-bold uppercase tracking-widest text-xs">
              Developer Rebuttals
            </h3>
          </div>
          {canSubmit && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 dark:hover:bg-red-900/40 transition-all active:scale-95 border border-red-100 dark:border-red-800/50 shadow-sm"
            >
              <Plus size={12} />
              <span>Submit Rebuttal</span>
            </button>
          )}
        </div>

        <div className="bg-red-50/30 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-md p-4 space-y-4">
          <p className="text-[11px] text-red-600/80 dark:text-red-400/80 font-medium leading-relaxed bg-red-50/50 dark:bg-red-900/10 p-3 rounded-xl border border-red-100/50 dark:border-red-900/20">
            If you disagree with this finding, provide a detailed rebuttal and
            optional screenshot. The QA team will review your submission and
            issue a final verdict.
          </p>

          {/* Rebuttal List */}
          {task.rebuttals && task.rebuttals.length > 0 ? (
            <div className="space-y-4">
              {task.rebuttals.map((r) => (
                <div
                  key={r.id}
                  className="bg-slate-50 dark:bg-[#1d2a31] border border-red-100 dark:border-red-900/30 p-4 rounded-xl shadow-sm space-y-3 group hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-red-400">
                    <span className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      {r.users?.full_name || "Developer"}
                    </span>
                    <span>
                      {format(new Date(r.created_at), "MMM d, HH:mm")}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed italic bg-slate-50/50 dark:bg-[#131d22]/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700/50">
                    "{r.text}"
                  </p>
                  {r.screenshot_url && (
                    <a
                      href={r.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-widest text-accent hover:underline pt-1 group-hover:translate-x-1 transition-transform"
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>Evidence Screenshot</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            !showForm && (
              <div className="flex flex-col items-center justify-center py-6 text-red-300 gap-2">
                <AlertCircle size={20} className="opacity-40" />
                <p className="text-[10px] font-bold uppercase tracking-widest">
                  No rebuttals submitted yet
                </p>
              </div>
            )
          )}

          {/* Rebuttal Form */}
          {showForm && (
            <div className="pt-2 animate-in fade-in slide-in-from-top-4 duration-300">
              <RebuttalForm
                taskId={task.id}
                onCancel={() => setShowForm(false)}
                onSuccess={() => setShowForm(false)}
              />
            </div>
          )}
        </div>
      </div>
    </CanDo>
  )
}

interface RebuttalFormProps {
  taskId: string
  onCancel: () => void
  onSuccess: () => void
}

const RebuttalForm: React.FC<RebuttalFormProps> = ({
  taskId,
  onCancel,
  onSuccess,
}) => {
  const [text, setText] = useState("")
  const [screenshotUrl, setScreenshotUrl] = useState("")
  const { mutate: addRebuttal, isPending } = useAddRebuttal()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return

    addRebuttal(
      {
        taskId,
        data: {
          text: text.trim(),
          screenshot_url: screenshotUrl.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          setText("")
          setScreenshotUrl("")
          onSuccess()
        },
      },
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-slate-50 dark:bg-[#1d2a31] border border-red-200 dark:border-red-900/50 rounded-md p-4 shadow-xl space-y-4 ring-4 ring-red-500/5"
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-red-600 dark:text-red-400">
          New Rebuttal Submission
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#131d22] rounded-lg text-slate-400 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Detailed explanation of why this finding is incorrect..."
            className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 font-medium focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500/40 focus:bg-slate-50 dark:focus:bg-[#131d22] transition-all resize-none min-h-[120px]"
            required
          />
        </div>

        <div className="relative">
          <ImageIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <input
            type="url"
            value={screenshotUrl}
            onChange={(e) => setScreenshotUrl(e.target.value)}
            placeholder="Evidence Screenshot URL (optional)"
            className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 rounded-xl pl-11 pr-4 py-3 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 font-bold focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500/40 focus:bg-slate-50 dark:focus:bg-[#131d22] transition-all"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!text.trim() || isPending}
          className="flex items-center gap-2 bg-red-600 text-white px-6 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg shadow-red-500/20 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
        >
          {isPending ? (
            "Submitting..."
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
