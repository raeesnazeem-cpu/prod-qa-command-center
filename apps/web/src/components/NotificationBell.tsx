import React, { useState, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Bell, Check, Trash2, Clock, Inbox } from "lucide-react"
import { useAuthAxios } from "@/lib/useAuthAxios"
import { formatDistanceToNow } from "date-fns"
import toast from "react-hot-toast"

interface Notification {
  id: string
  is_read: boolean
  created_at: string
  activity: {
    performer_name: string
    action_type: string
    entity_id: string
    entity_type: string
    details: any
  }
}

export const NotificationBell: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const api = useAuthAxios()
  const queryClient = useQueryClient()

  // 1. Fetch recent notifications
  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const response = await api.get("/api/me/notifications")
      return response.data
    },
    refetchInterval: 60000, // Regular poll fallback every minute
  })

  const unreadCount = notifications.filter((n) => !n.is_read).length

  // 2. Mark as read mutation
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/api/me/notifications/${id}/read`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
    },
  })

  // 3. Mark all as read mutation
  const markAllRead = useMutation({
    mutationFn: async () => {
      await api.patch("/api/me/notifications/read-all")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
      toast.success("All marked as read")
    },
  })

  const getNotificationUrl = (notif: Notification) => {
    const { entity_id, entity_type } = notif.activity

    if (!entity_id || !entity_type) return "#"

    switch (entity_type) {
      case "project":
        return `/projects/${entity_id}`
      case "task":
        return `/tasks?taskId=${entity_id}`
      case "run":
        // Project ID is usually needed for runs, fallback to dashboard if not available
        return `/dashboard`
      default:
        return "#"
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#1D2A31] rounded-full transition-all relative"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 bg-rose-500 text-slate-200 text-[9px] font-bold flex items-center justify-center rounded-full border-2 border-white dark:border-[#0B151B] shadow-sm animate-in zoom-in duration-300">
            {unreadCount > 99 ? "+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 bg-slate-50 dark:bg-[#0B151B] border border-slate-200 dark:border-slate-800 rounded-md shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-4 border-b border-slate-100 dark:border-[#1D2A31] flex items-center justify-between bg-slate-50/50 dark:bg-[#0B151B]/50">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-widest">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-[10px] font-bold text-accent hover:underline uppercase tracking-wider"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-50 dark:divide-[#1D2A31]">
            {notifications.length > 0 ? (
              notifications.map((notif) => (
                <Link
                  key={notif.id}
                  to={getNotificationUrl(notif)}
                  onClick={() => {
                    if (!notif.is_read) {
                      markRead.mutate(notif.id)
                    }
                    setIsOpen(false)
                  }}
                  className={`p-4 hover:bg-slate-50 dark:hover:bg-[#1D2A31] transition-colors flex gap-3 group text-left ${!notif.is_read ? "bg-indigo-50/30 dark:bg-[#1D2A31]/50" : ""}`}
                >
                  <div
                    className={`w-2 h-2 mt-1.5 rounded-full flex-shrink-0 ${!notif.is_read ? "bg-accent shadow-sm" : "bg-transparent"}`}
                  />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-tight">
                      <span className="font-bold text-slate-900 dark:text-slate-200">
                        {notif.activity?.performer_name}
                      </span>{" "}
                      {notif.activity?.details?.message ||
                        notif.activity?.action_type
                          .replace(/_/g, " ")
                          .toLowerCase()}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(notif.created_at), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                  {!notif.is_read && (
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        markRead.mutate(notif.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 bg-slate-50 dark:bg-[#0B151B] border border-slate-200 dark:border-[#1D2A31] text-slate-400 hover:text-accent hover:border-accent rounded-lg transition-all shadow-sm self-start"
                      title="Mark as read"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </Link>
              ))
            ) : (
              <div className="py-12 flex flex-col items-center justify-center text-center px-6">
                <div className="w-12 h-12 bg-slate-50 dark:bg-[#1D2A31] rounded-full flex items-center justify-center text-slate-200 dark:text-slate-600 mb-3">
                  <Inbox className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Your inbox is empty
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  When you receive a notification, it will appear here.
                </p>
              </div>
            )}
          </div>

          <div className="p-3 bg-slate-50/50 dark:bg-[#0B151B]/50 border-t border-slate-100 dark:border-[#1D2A31] text-center">
            <button
              onClick={() => setIsOpen(false)}
              className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
