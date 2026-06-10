import React, { useState, useEffect, useCallback, useRef } from "react"
import { useAuthAxios } from "@/lib/useAuthAxios"
import { supabase } from "@/lib/supabase"
import { formatDistanceToNow, format } from "date-fns"
import {
  Search,
  Filter,
  RefreshCcw,
  Eye,
  Trash2,
  FileDown,
  ChevronDown,
  ChevronUp,
  Clock,
  User,
  Activity,
  FileJson,
  X,
  Calendar,
  Check,
} from "lucide-react"
import { RoleGuardRoute } from "@/components/RoleGuardRoute"
import { useRole } from "@/hooks/useRole"
import toast from "react-hot-toast"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

interface ActivityLog {
  id: string
  performer_id: string
  performer_name: string
  action_type: string
  entity_id: string
  entity_type: string
  details: any
  created_at: string
}

interface UserOption {
  id: string
  full_name: string
}

interface ProjectOption {
  id: string
  name: string
}

// Sub-component for searchable dropdown
const SearchableDropdown: React.FC<{
  label: string
  placeholder: string
  value: string
  options: string[]
  onChange: (value: string) => void
  icon: React.ReactNode
}> = ({ label, placeholder, value, options, onChange, icon }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState(value)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
        {icon} {label}
      </label>
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={search}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value)
            onChange(e.target.value)
            setIsOpen(true)
          }}
          className="w-full px-3 py-2 bg-slate-50 dark:bg-[#24343D] border border-slate-400/50 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
        />
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>

      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute z-[60] w-full mt-1 bg-slate-50 dark:bg-[#1D2A31] border border-slate-400/50 dark:border-slate-700 rounded-md shadow-xl max-h-40 overflow-y-auto">
          {filteredOptions.map((opt, i) => (
            <button
              key={i}
              onClick={() => {
                setSearch(opt)
                onChange(opt)
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between group transition-colors"
            >
              <span className="text-slate-700 dark:text-slate-300">{opt}</span>
              {value === opt && <Check className="w-3.5 h-3.5 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const ActivityLogPage: React.FC = () => {
  const api = useAuthAxios()
  const { role } = useRole()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [entityType, setEntityType] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Options for dropdowns
  const [availableUsers, setAvailableUsers] = useState<string[]>([])
  const [availableProjects, setAvailableProjects] = useState<string[]>([])

  // Export Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportFilters, setExportFilters] = useState({
    startDate: "",
    endDate: "",
    userName: "",
    projectName: "",
  })

  const isSuperAdmin = role === "super_admin"

  const fetchOptions = useCallback(async () => {
    try {
      const [usersRes, projectsRes] = await Promise.all([
        api.get("/api/users"),
        api.get("/api/projects"),
      ])
      setAvailableUsers(usersRes.data.map((u: any) => u.full_name))
      setAvailableProjects(projectsRes.data.map((p: any) => p.name))
    } catch (error) {
      console.error("Failed to fetch options:", error)
    }
  }, [api])

  const fetchLogs = useCallback(
    async (pageNum: number, isInitial = false) => {
      try {
        setLoading(true)
        const response = await api.get("/api/admin/activity-logs", {
          params: {
            page: pageNum,
            limit: 20,
            search,
            entityType,
          },
        })

        if (isInitial) {
          setLogs(response.data.data)
        } else {
          setLogs((prev) => [...prev, ...response.data.data])
        }
        setTotal(response.data.total)
      } catch (error) {
        console.error("Failed to fetch logs:", error)
        toast.error("Failed to load activity logs")
      } finally {
        setLoading(false)
      }
    },
    [api, search, entityType],
  )

  useEffect(() => {
    setPage(1)
    fetchLogs(1, true)
    fetchOptions()

    // Subscribe to new activity logs
    const channel = supabase
      .channel("activity_logs_realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_logs",
        },
        () => {
          // Re-fetch the first page of logs when a new one is added
          fetchLogs(1, true)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [search, entityType, fetchLogs, fetchOptions])

  const handleClearLogs = async () => {
    if (
      !window.confirm(
        "Are you sure you want to PERMANENTLY clear all activity logs?",
      )
    )
      return

    try {
      await api.delete("/api/admin/activity-logs")
      setLogs([])
      setTotal(0)
      toast.success("All logs cleared")
    } catch (error) {
      toast.error("Failed to clear logs")
    }
  }

  const handleExportPDF = async () => {
    try {
      setExportLoading(true)

      // Fetch data based on modal filters
      const response = await api.get("/api/admin/activity-logs", {
        params: {
          page: 1,
          limit: 100,
          search: exportFilters.userName,
          startDate: exportFilters.startDate,
          endDate: exportFilters.endDate,
          projectName: exportFilters.projectName,
        },
      })

      const exportData: ActivityLog[] = response.data.data

      if (exportData.length === 0) {
        toast.error("No logs found for the selected criteria")
        return
      }

      const doc = new jsPDF()

      // Add Title
      doc.setFontSize(18)
      doc.setTextColor(15, 23, 42) // slate-900
      doc.text("System Activity Report", 14, 20)

      // Add Subtitle/Meta
      doc.setFontSize(10)
      doc.setTextColor(100, 116, 139) // slate-500
      doc.text(`Generated on: ${format(new Date(), "PPPP p")}`, 14, 28)

      let filterText = "Filters: "
      if (exportFilters.startDate)
        filterText += `From ${exportFilters.startDate} `
      if (exportFilters.endDate) filterText += `To ${exportFilters.endDate} `
      if (exportFilters.userName)
        filterText += `User: ${exportFilters.userName} `
      if (exportFilters.projectName)
        filterText += `Project: ${exportFilters.projectName} `
      if (filterText === "Filters: ") filterText += "None"

      doc.text(filterText, 14, 34)
      doc.text(`Total Records Exported: ${exportData.length} (Max 100)`, 14, 40)

      // Generate Table
      const tableData = exportData.map((log) => [
        format(new Date(log.created_at), "MMM d, h:mm a"),
        log.performer_name,
        log.action_type.replace(/_/g, " "),
        log.details?.message ||
          log.details?.taskTitle ||
          log.details?.projectName ||
          "No summary",
      ])

      autoTable(doc, {
        startY: 46,
        head: [["Time", "User", "Action", "Summary"]],
        body: tableData,
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: "bold",
        },
        bodyStyles: {
          fontSize: 9,
          textColor: [51, 65, 85],
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 35 },
          2: { cellWidth: 40 },
          3: { cellWidth: "auto" },
        },
      })

      doc.save(`activity-report-${format(new Date(), "yyyy-MM-dd")}.pdf`)
      toast.success("PDF report generated successfully")
      setIsExportModalOpen(false)
    } catch (error) {
      console.error("Export failed:", error)
      toast.error("Failed to generate PDF report")
    } finally {
      setExportLoading(false)
    }
  }

  const getActionColor = (type: string) => {
    if (type.includes("CREATED"))
      return "bg-emerald-100 text-emerald-700 border-emerald-200"
    if (type.includes("DELETED"))
      return "bg-rose-100 text-rose-700 border-rose-200"
    if (type.includes("UPDATED") || type.includes("ASSIGNED"))
      return "bg-amber-100 text-amber-700 border-amber-200"
    if (type.includes("RUN"))
      return "bg-indigo-100 text-indigo-700 border-indigo-200"
    return "bg-slate-100 text-slate-700 border-slate-200"
  }

  return (
    <RoleGuardRoute minRole="admin">
      <div className="max-w-7xl mx-auto p-6 space-y-6 pb-20 animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-sm dark:shadow-sm transition-all">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
              System Activity Logs
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
              Monitor all actions across the platform in real-time.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="flex items-center gap-2 px-2 py-1 btn-unified bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 transition-all shadow-sm"
            >
              <FileDown className="w-3.5 h-3.5" />
              Export PDF
            </button>

            {isSuperAdmin && (
              <button
                onClick={handleClearLogs}
                className="flex items-center gap-2 px-2 py-1 btn-unified  hover:bg-rose-700 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 dark:bg-[#1D2A31] p-4 rounded-md border border-slate-400/50 dark:border-slate-800 shadow-sm hover:shadow-xl dark:shadow-sm dark:hover:shadow-md transition-all">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by user name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-[#24343D] border border-slate-400/50 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-[#24343D] border border-slate-400/50 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent appearance-none transition-all"
            >
              <option value="">All Entities</option>
              <option value="project">Projects</option>
              <option value="task">Tasks</option>
              <option value="run">QA Runs</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>

          <div className="flex items-center justify-end">
            <button
              onClick={() => {
                setSearch("")
                setEntityType("")
              }}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
            >
              <RefreshCcw className="w-3 h-3" />
              Reset Filters
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-md border border-slate-400/50 dark:border-slate-800 shadow-sm hover:shadow-xl dark:shadow-sm dark:hover:shadow-md transition-all overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse border border-slate-300 dark:border-slate-800">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-400/50 dark:border-slate-700">
                  <th className="px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Time
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    User
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Action
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Summary
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80 dark:divide-y dark:divide-slate-100/10">
                {logs.map((log, index) => (
                  <React.Fragment key={log.id}>
                    <tr
                      className={`border-b border-slate-300 dark:border-slate-800 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 transition-colors ${index % 2 === 0 ? "bg-white dark:bg-[#131D22]/30" : "bg-slate-50/50 dark:bg-transparent"} ${expandedId === log.id ? "bg-slate-100/80 dark:bg-slate-800/80" : ""}`}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-xs font-medium">
                            {formatDistanceToNow(new Date(log.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          {format(new Date(log.created_at), "MMM d, h:mm a")}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400">
                            <User className="w-3 h-3" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-900 dark:text-slate-200">
                              {log.performer_name}
                            </div>
                            <div className="text-[9px] text-slate-400 font-mono tracking-tighter">
                              ID: {log.performer_id.slice(0, 8)}...
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border ${getActionColor(log.action_type)}`}
                        >
                          {log.action_type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate font-medium">
                          {log.details?.message ||
                            log.details?.taskTitle ||
                            log.details?.projectName ||
                            "No summary"}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() =>
                            setExpandedId(expandedId === log.id ? null : log.id)
                          }
                          className="p-1 text-slate-400 hover:text-accent hover:bg-accent/5 rounded-md transition-all"
                        >
                          {expandedId === log.id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Detail View */}
                    {expandedId === log.id && (
                      <tr className="bg-slate-50/80 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-800">
                        <td colSpan={5} className="px-6 py-4">
                          <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-md border border-slate-400/50 dark:border-slate-700 p-6 shadow-inner space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-4">
                              <div className="flex items-center gap-3">
                                <div>
                                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-widest">
                                    Raw Log Details
                                  </h3>
                                  <p className="text-xs text-slate-400">
                                    Activity ID: {log.id}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-widest text-slate-400">
                                <span>Entity: {log.entity_type}</span>
                                <span>Entity ID: {log.entity_id}</span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div className="space-y-3">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                  Action Payload
                                </h4>
                                <pre className="p-4 bg-slate-900 text-indigo-300 rounded-md text-xs overflow-x-auto border border-slate-800 shadow-xl font-mono leading-relaxed">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              </div>

                              <div className="space-y-3">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                  <User className="w-3 h-3" />
                                  Identity Context
                                </h4>
                                <div className="grid grid-cols-1 gap-2">
                                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-400/50 dark:border-slate-700 flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                                      Performer Name
                                    </span>
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                      {log.performer_name}
                                    </span>
                                  </div>
                                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-400/50 dark:border-slate-700 flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                                      Entity Type
                                    </span>
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                                      {log.entity_type}
                                    </span>
                                  </div>
                                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-400/50 dark:border-slate-700 flex justify-between items-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                                      Created At
                                    </span>
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                      {format(
                                        new Date(log.created_at),
                                        "PPPPpppp",
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}

                {logs.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-200">
                          <Activity className="w-8 h-8" />
                        </div>
                        <h3 className="text-slate-900 dark:text-slate-200 font-bold">
                          No logs found
                        </h3>
                        <p className="text-slate-400 text-sm max-w-xs mx-auto">
                          No activity logs match your current search criteria or
                          there are no logs yet.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {logs.length < total && (
            <div className="p-6 bg-slate-50/50 dark:bg-[#1D2A31]/50 border-t border-slate-400/50 dark:border-slate-800 text-center">
              <button
                onClick={() => {
                  const nextPage = page + 1
                  setPage(nextPage)
                  fetchLogs(nextPage)
                }}
                disabled={loading}
                className="inline-flex items-center gap-2 px-8 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-400/50 dark:border-slate-700 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:border-accent hover:text-accent transition-all disabled:opacity-50 shadow-sm"
              >
                {loading ? (
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                Load More Activity
              </button>
            </div>
          )}
        </div>

        {/* Export Modal */}
        {isExportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-md shadow-2xl border border-slate-400/50 dark:border-slate-700 w-full max-w-md overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
                <div className="flex items-center gap-2 text-slate-900 dark:text-slate-200">
                  <FileDown className="w-5 h-5 text-accent" />
                  <h2 className="text-lg font-bold">Export Activity Report</h2>
                </div>
                <button
                  onClick={() => setIsExportModalOpen(false)}
                  className="p-1 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-slate-500 mb-4">
                  Configure filters below to generate a custom PDF report. (Max
                  100 entries)
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Start Date
                    </label>
                    <input
                      type="date"
                      value={exportFilters.startDate}
                      onChange={(e) =>
                        setExportFilters({
                          ...exportFilters,
                          startDate: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-[#24343D] border border-slate-400/50 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> End Date
                    </label>
                    <input
                      type="date"
                      value={exportFilters.endDate}
                      onChange={(e) =>
                        setExportFilters({
                          ...exportFilters,
                          endDate: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-[#24343D] border border-slate-400/50 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                    />
                  </div>
                </div>

                <SearchableDropdown
                  label="Filter by User"
                  placeholder="Type to search users..."
                  value={exportFilters.userName}
                  options={availableUsers}
                  onChange={(val) =>
                    setExportFilters({ ...exportFilters, userName: val })
                  }
                  icon={<User className="w-3 h-3" />}
                />

                <SearchableDropdown
                  label="Filter by Project"
                  placeholder="Type to search projects..."
                  value={exportFilters.projectName}
                  options={availableProjects}
                  onChange={(val) =>
                    setExportFilters({ ...exportFilters, projectName: val })
                  }
                  icon={<Activity className="w-3 h-3" />}
                />
              </div>

              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
                <button
                  onClick={() => setIsExportModalOpen(false)}
                  className="flex items-center gap-2 px-2 py-1 btn-unified hover:bg-rose-600 transition-all shadow-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={exportLoading}
                  className="flex items-center gap-2 px-2 py-1 btn-unified bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200 transition-all shadow-sm"
                >
                  {exportLoading ? (
                    <RefreshCcw className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4" />
                  )}
                  {exportLoading ? "Generating..." : "Download PDF"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGuardRoute>
  )
}

export default ActivityLogPage
