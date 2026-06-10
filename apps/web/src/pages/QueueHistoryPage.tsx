import React, { useState, useEffect } from "react"
import { useAuthAxios } from "../lib/useAuthAxios"
import {
  Database,
  Search,
  Filter,
  ArrowUpDown,
  ExternalLink,
  Calendar,
} from "lucide-react"

interface RunHistoryItem {
  id: string
  site_url: string
  pages_total: number
  created_at: string
  status: string
  estimated_commands: number
  estimated_cost: number
}

const QueueHistoryPage: React.FC = () => {
  const axios = useAuthAxios()
  const [history, setHistory] = useState<RunHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { data } = await axios.get("/api/admin/run-history")
        setHistory(data)
      } catch (err) {
        console.error("Failed to fetch history:", err)
      } finally {
        setLoading(false)
      }
    }
    fetchHistory()
  }, [])

  const filteredHistory = history.filter((item) =>
    item.site_url.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-xs transition-all">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-[#93C0B1]">
            <Database className="w-5 h-5" />
            <h2 className="text-[10px] font-bold uppercase tracking-widest">
              Admin Control
            </h2>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tighter">
            Queue History
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
            Historical Redis resource consumption per scan
          </p>
        </div>

        <div className="flex items-center space-x-4 bg-slate-50 dark:bg-[#131d22] p-2 rounded-md border border-slate-400/50 dark:border-slate-800 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search site..."
              className="pl-10 pr-4 py-2 bg-slate-50 dark:bg-transparent dark:text-slate-200 border-none rounded-lg text-sm focus:ring-2 focus:ring-[#93C0B1]/20 w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-50 dark:bg-[#131d22] p-6 rounded-md border border-slate-400/50 dark:border-slate-800 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
            Total Scans
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-200 tracking-tighter">
            {history.length}
          </p>
        </div>
        <div className="bg-slate-50 dark:bg-[#131d22] p-6 rounded-md border border-slate-400/50 dark:border-slate-800 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
            Avg. Cost / Run
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-200 tracking-tighter">
            $
            {(
              history.reduce((acc, curr) => acc + curr.estimated_cost, 0) /
              (history.length || 1)
            ).toFixed(4)}
          </p>
        </div>
        <div className="bg-slate-50 dark:bg-slate-900 p-6 rounded-md border border-accent dark:border-[#93C0B1]/30 shadow-sm bg-[#93C0B1]/5 dark:bg-[#93C0B1]/10">
          <p className="text-[10px] font-bold text-[#93C0B1] uppercase tracking-widest mb-1">
            All Time Redis Spend
          </p>
          <p className="text-2xl font-bold text-[#93C0B1] tracking-tighter">
            $
            {history
              .reduce((acc, curr) => acc + curr.estimated_cost, 0)
              .toFixed(2)}
          </p>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-slate-50 dark:bg-[#131d22] rounded-md border border-slate-400/50 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#1d2a31]/50 border-b border-slate-400/50 dark:border-slate-800">
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Run Details
                </th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Status
                </th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">
                  Pages
                </th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">
                  Commands
                </th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">
                  Redis Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-slate-400 font-normal"
                  >
                    Loading history...
                  </td>
                </tr>
              ) : (
                filteredHistory.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-[#1d2a31]/50 transition-colors group"
                  >
                    <td className="px-6 py-2">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-500 dark:text-slate-400 flex items-center group-hover:text-[#93C0B1] transition-colors text-[12px]">
                          {item.site_url.replace(/^https?:\/\//, "")}
                          <ExternalLink className="w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center mt-1">
                          <Calendar className="w-3 h-3 mr-1" />
                          {new Date(item.created_at).toLocaleString()}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest ${
                          item.status === "completed"
                            ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-transparent dark:border-green-500/20"
                            : item.status === "failed"
                              ? "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-transparent dark:border-red-500/20"
                              : "bg-slate-100 dark:bg-[#1d2a31] text-slate-600 dark:text-slate-400 border border-transparent dark:border-slate-700"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-slate-500 dark:text-slate-300 text-[11px]">
                      {item.pages_total || 0}
                    </td>
                    <td className="px-6 py-4 text-center font-medium text-slate-500 dark:text-slate-300 text-[11px]">
                      {item.estimated_commands.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right text-[12px]">
                      <span className="font-bold text-[#93C0B1]">
                        ${item.estimated_cost.toFixed(5)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
              {filteredHistory.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-slate-400 italic"
                  >
                    No run history found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default QueueHistoryPage
