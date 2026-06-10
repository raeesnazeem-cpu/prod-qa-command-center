import { useState, useMemo } from "react"
import { X, Loader2, Users, Bell, ChevronDown } from "lucide-react"
import { Task, pushPendingReminder } from "../api/tasks.api"
import { ProjectWithMembers } from "../api/projects.api"
import { useAuthAxios } from "../lib/useAuthAxios"
import toast from "react-hot-toast"

interface PendingReminderModalProps {
  tasks: Task[]
  project?: ProjectWithMembers
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export const PendingReminderModal = ({
  tasks,
  project,
  isOpen,
  onClose,
  onSuccess,
}: PendingReminderModalProps) => {
  const axios = useAuthAxios()
  const [isPushing, setIsPushing] = useState(false)
  const [comment, setComment] = useState("")
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([])

  // Deduplicate tasks by title for the UI list
  const uniqueTasks = useMemo(() => {
    const seen = new Set<string>()
    return tasks.filter((task) => {
      if (seen.has(task.title)) return false
      seen.add(task.title)
      return true
    })
  }, [tasks])

  if (!isOpen) return null

  const handleAddAssignee = (userId: string) => {
    if (!userId || selectedAssigneeIds.includes(userId)) return
    setSelectedAssigneeIds([...selectedAssigneeIds, userId])
  }

  const handleRemoveAssignee = (userId: string) => {
    setSelectedAssigneeIds(selectedAssigneeIds.filter((id) => id !== userId))
  }

  const handlePush = async () => {
    if (!project) return
    setIsPushing(true)
    try {
      await pushPendingReminder(axios, {
        taskIds: tasks.map((t) => t.id),
        assigneeIds: selectedAssigneeIds,
        comment,
        projectId: project.id,
      })
      toast.success("Pending reminder pushed to Basecamp")
      onSuccess?.()
      onClose()
    } catch (error: any) {
      console.error("Failed to push reminder:", error)
      toast.error(error.response?.data?.error || "Failed to push reminder")
    } finally {
      setIsPushing(false)
    }
  }

  const getAssigneeName = (userId: string) => {
    return (
      project?.project_members?.find((m) => m.user_id === userId)?.users
        .full_name || "Unknown"
    )
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="absolute inset-0"
        onClick={() => !isPushing && onClose()}
      />

      <div className="relative w-full max-w-xl bg-slate-50 border border-slate-200 rounded-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-slate-900 text-xl tracking-tight flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-500" />
              Pending Reminder
            </h3>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-1">
              Consolidated Basecamp Notification
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isPushing}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto min-h-0">
          {/* Selected Tasks List */}
          <div className="space-y-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
              Tasks to Include ({uniqueTasks.length})
            </span>
            <div className="bg-slate-50 border border-slate-100 rounded-md p-4 space-y-2">
              {uniqueTasks.map((task) => (
                <div key={task.id} className="flex items-start gap-3 text-sm">
                  {(() => {
                    const match = task.title.match(/^(Issue #\d+):?\s*(.*)$/)
                    if (match) {
                      return (
                        <>
                          <span className="text-accent font-bold whitespace-nowrap">
                            {match[1]}
                          </span>
                          <span className="text-slate-700 font-medium truncate">
                            {match[2]}
                          </span>
                        </>
                      )
                    }
                    return (
                      <span className="text-slate-700 font-medium">
                        {task.title}
                      </span>
                    )
                  })()}
                </div>
              ))}
            </div>
          </div>

          {/* Assignees Selection */}
          <div className="space-y-4">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
              Mention Developers
            </span>
            <div className="flex flex-wrap gap-2 items-center">
              {selectedAssigneeIds.map((id) => (
                <div
                  key={id}
                  className="flex items-center bg-accent/10 border border-accent/20 text-accent rounded-lg px-3 py-1.5 space-x-2"
                >
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {getAssigneeName(id)}
                  </span>
                  <button
                    onClick={() => handleRemoveAssignee(id)}
                    className="p-0.5 hover:bg-accent/10 rounded-full transition-colors"
                  >
                    <X size={12} strokeWidth={3} />
                  </button>
                </div>
              ))}

              <div className="relative">
                <select
                  value=""
                  onChange={(e) => handleAddAssignee(e.target.value)}
                  className="appearance-none bg-slate-50 border-2 border-dashed border-slate-200 hover:border-accent hover:text-accent text-slate-400 text-[10px] font-bold uppercase tracking-widest rounded-xl px-4 py-2 pr-10 cursor-pointer transition-all focus:outline-none"
                >
                  <option value="">+ Add Person</option>
                  {project?.project_members
                    ?.filter((m) => !selectedAssigneeIds.includes(m.user_id))
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

          {/* Additional Comment */}
          <div className="space-y-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
              Additional Note (Optional)
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add any specific instructions or context for this reminder..."
              className="w-full bg-slate-50 border border-slate-100 rounded-md px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-accent/5 transition-all resize-none h-24"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-6 bg-slate-50/50 border-t border-slate-100 flex gap-3">
          <button
            onClick={onClose}
            disabled={isPushing}
            className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePush}
            disabled={isPushing}
            className="flex-[2] btn-unified flex items-center justify-center gap-2 py-3 shadow-lg shadow-accent/20"
          >
            {isPushing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Pushing Reminder...</span>
              </>
            ) : (
              <>
                <span>Push to </span>
                <svg width="18" height="18" viewBox="0 0 35 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="pl-1"><path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path></svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
