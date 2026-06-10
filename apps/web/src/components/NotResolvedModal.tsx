import React, { useState, useEffect } from "react"
import { X, UserPlus, ChevronDown, Send, Info } from "lucide-react"
import { Task } from "../api/tasks.api"
import { useNotResolvedTask } from "../hooks/useTasks"
import { useProject } from "../hooks/useProjects"

interface NotResolvedModalProps {
  task: Task | null
  isOpen: boolean
  onClose: () => void
}

export const NotResolvedModal = ({
  task,
  isOpen,
  onClose,
}: NotResolvedModalProps) => {
  const [comment, setComment] = useState("")
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const { data: project } = useProject(task?.project_id || "")
  const { mutate: notResolved, isPending } = useNotResolvedTask()

  useEffect(() => {
    if (task && isOpen) {
      // Initialize with current assignees (from sibling tasks if available, or just the task's assigned_to)
      const currentAssignees =
        task.assignees?.map((a: any) => a.userId || a.id).filter(Boolean) ||
        (task.assigned_to ? [task.assigned_to] : [])
      setAssigneeIds(Array.from(new Set(currentAssignees)))
      setComment("")
    }
  }, [task, isOpen])

  if (!isOpen || !task) return null

  const issueMatch = task.title.match(/Issue #(\d+)/)
  const issueNumber = issueMatch ? issueMatch[1] : null

  const handleConfirm = () => {
    if (!comment.trim()) return

    notResolved(
      {
        taskId: task.id,
        data: {
          comment,
          assignees: assigneeIds,
        },
      },
      {
        onSuccess: () => onClose(),
      },
    )
  }

  const toggleAssignee = (userId: string) => {
    setAssigneeIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-50 w-full max-w-lg rounded-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-red-50 flex items-center justify-center">
              <Info className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm uppercase tracking-widest">
                {issueNumber ? `Issue #${issueNumber}` : "Task"} - Not Resolved
              </h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">
                Send back for further review
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

        <div className="p-8 overflow-y-auto space-y-8">
          {/* Assignees Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Assignees
              </span>
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                {assigneeIds.length} Developer(s)
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {assigneeIds.map((userId) => {
                const member = project?.project_members.find(
                  (m) => m.user_id === userId,
                )
                const taskAssignee = task.assignees?.find(
                  (a: any) => (a.userId || a.id) === userId,
                )
                const displayName =
                  member?.users.full_name ||
                  (taskAssignee as any)?.name ||
                  (taskAssignee as any)?.full_name ||
                  "Unknown"

                return (
                  <div
                    key={userId}
                    className="flex items-center gap-2 bg-accent/5 border border-accent/20 text-accent px-3 py-1.5 rounded-lg"
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wider">
                      {displayName}
                    </span>
                    <button
                      onClick={() => toggleAssignee(userId)}
                      className="p-0.5 hover:bg-accent/10 rounded-full transition-colors"
                    >
                      <X size={12} strokeWidth={3} />
                    </button>
                  </div>
                )
              })}

              <div className="relative">
                <select
                  value=""
                  onChange={(e) => toggleAssignee(e.target.value)}
                  className="appearance-none bg-slate-50 border-2 border-dashed border-slate-200 hover:border-accent hover:text-accent text-slate-400 text-[10px] font-bold uppercase tracking-widest rounded-xl px-4 py-1.5 pr-10 cursor-pointer transition-all focus:outline-none"
                >
                  <option value="">+ Tag Someone</option>
                  {project?.project_members
                    .filter((m) => !assigneeIds.includes(m.user_id))
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.users.full_name}
                      </option>
                    ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                  <ChevronDown size={14} />
                </div>
              </div>
            </div>
          </div>

          {/* Feedback Section */}
          <div className="space-y-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Re-opening Reason
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Explain why this task is not resolved..."
              className="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none min-h-[120px] transition-all"
            />
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
            disabled={!comment.trim() || isPending}
            className="btn-unified flex items-center gap-2 disabled:opacity-50"
          >
            {isPending ? (
              <span className="animate-pulse">Processing...</span>
            ) : (
              <>
                <span>Confirm & Push</span>
                <Send size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
