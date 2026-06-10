import React from "react"
import { X, MessageSquare, ShieldAlert } from "lucide-react"
import { format } from "date-fns"
import { Task } from "../api/tasks.api"

interface TaskCommentsModalProps {
  task: Task
  isOpen: boolean
  onClose: () => void
}

export const TaskCommentsModal = ({
  task,
  isOpen,
  onClose,
}: TaskCommentsModalProps) => {
  if (!isOpen) return null

  const comments = task.comments || []
  const rebuttals = task.rebuttals || []

  // Combine and sort by date
  const history = [
    ...comments.map((c) => ({ ...c, type: "comment" })),
    ...rebuttals.map((r) => ({ ...r, type: "rebuttal" })),
  ].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-50 w-full max-w-md rounded-md shadow-xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-slate-400" />
            <h4 className="font-bold text-slate-900 text-xs uppercase tracking-widest">
              Task History
            </h4>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-md transition-all"
          >
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4">
          {history.length === 0 ? (
            <div className="text-center py-8 text-slate-400 italic text-xs">
              No comments yet.
            </div>
          ) : (
            history.map((item: any, i) => (
              <div
                key={i}
                className={`p-3 rounded-md border ${
                  item.type === "rebuttal"
                    ? "bg-red-50 border-red-100"
                    : "bg-slate-50 border-slate-100"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-[10px] font-bold uppercase ${
                      item.type === "rebuttal"
                        ? "text-red-600"
                        : "text-slate-500"
                    }`}
                  >
                    {item.users?.full_name || "System"}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {format(new Date(item.created_at), "MMM d, HH:mm")}
                  </span>
                </div>
                {item.type === "rebuttal" && (
                  <div className="flex items-center gap-1 text-[9px] font-bold text-red-400 uppercase mb-1">
                    <ShieldAlert size={10} />
                    <span>Rebuttal</span>
                  </div>
                )}
                <p className="text-xs text-slate-700 whitespace-pre-wrap">
                  {item.content || item.text}
                </p>
                {item.screenshot_url && (
                  <div className="mt-2 rounded-md overflow-hidden border border-slate-200">
                    <img
                      src={item.screenshot_url}
                      className="w-full h-auto"
                      alt="Screenshot"
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-slate-900 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
