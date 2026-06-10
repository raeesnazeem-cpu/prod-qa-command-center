import React from "react"
import { useQuery } from "@tanstack/react-query"
import { useAuthAxios } from "@/lib/useAuthAxios"
import { Clock, User, Activity, Loader2 } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface TaskActivityFeedProps {
  taskId: string
}

export const TaskActivityFeed: React.FC<TaskActivityFeedProps> = ({
  taskId,
}) => {
  const api = useAuthAxios()

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["task-activity", taskId],
    queryFn: async () => {
      const response = await api.get(`/tasks/${taskId}/activity`)
      return response.data
    },
    enabled: !!taskId,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-2 flex items-center gap-2">
        <Activity className="w-3 h-3" />
        Activity History
      </h3>

      <div className="space-y-3">
        {logs.map((log: any) => (
          <div
            key={log.id}
            className="flex gap-3 p-3 bg-slate-50 dark:bg-[#1D2A31] border border-slate-100 dark:border-slate-800 rounded-xl shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-8 h-8 rounded-full bg-slate-50 dark:bg-[#1d2a31] border border-slate-100 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <span className="font-bold text-slate-900 dark:text-white">
                  {log.performer_name}
                </span>{" "}
                <span className="text-slate-600 dark:text-slate-400">
                  {log.details?.message ||
                    log.action_type.replace(/_/g, " ").toLowerCase()}
                </span>
              </p>
              <div className="flex items-center gap-1.5 mt-1 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(log.created_at), {
                  addSuffix: true,
                })}
              </div>
            </div>
          </div>
        ))}

        {logs.length === 0 && (
          <div className="text-center py-12 px-6 bg-slate-50/50 dark:bg-[#1d2a31]/50 rounded-md border border-dashed border-slate-200 dark:border-slate-700">
            <div className="w-10 h-10 bg-slate-50 dark:bg-[#1d2a31] rounded-full flex items-center justify-center text-slate-200 dark:text-slate-600 mx-auto mb-3 shadow-sm">
              <Activity className="w-5 h-5" />
            </div>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              No activity yet
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
