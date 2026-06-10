import React, { useState, useEffect } from "react"
import {
  Database,
  X,
  Activity,
  HardDrive,
  Cpu,
  RefreshCcw,
  Users,
  ShieldAlert,
  Zap,
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { useAuthAxios } from "../lib/useAuthAxios"

interface RunStat {
  id: string
  site_url: string
  pages: number
  commands: number
  cost: number
}

interface RedisStats {
  total_commands: number
  commands_24h: number
  commands_month: number
  estimated_cost: number
  month_cost: number
  day_cost: number
  idle_24h: number
  idle_month: number
  ops_per_sec: string
  connected_clients: string
  recent_runs: RunStat[]
}

export const AdminRedisWidget: React.FC = () => {
  const { isAdmin } = useRole()
  const axios = useAuthAxios()
  const [isOpen, setIsOpen] = useState(false)
  const [stats, setStats] = useState<RedisStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get("/api/admin/redis-info")
      setStats(data)
      setError(null)
    } catch (err: any) {
      setError("Failed to fetch stats")
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchStats()
      const interval = setInterval(fetchStats, 30000)
      return () => clearInterval(interval)
    }
  }, [isOpen])

  if (!isAdmin) return null

  return (
    <>
      {/* Floating Button - High Z-index to stay on top of Sidebar */}
      <button
        onClick={() => setIsOpen(true)}
        className="relative pointer-events-auto w-12 h-12 bg-[#93C0B1] dark:bg-[#1d2a31] text-white dark:text-[#93C0B1] rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-[60] group border-2 border-white dark:border-slate-300"
        title="Redis Monitor"
      >
        <Database className="w-6 h-6" />
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white dark:border-[#131d22] rounded-full animate-pulse"></span>
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/10 dark:bg-[#131d22]/60 backdrop-blur-sm flex items-center justify-center z-[10000] p-4">
          <div className="bg-slate-50 dark:bg-[#131d22] rounded-md shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] w-full max-w-lg overflow-hidden border border-slate-100 dark:border-slate-800">
            {/* Header - Simple Style */}
            <div className="p-8 pb-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                    Redis Monitor
                  </h3>
                  <div className="flex items-center space-x-2 mt-0.5">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      System Operational
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="bg-slate-50 dark:bg-[#1d2a31] hover:bg-slate-100 dark:hover:bg-[#1d2a31] p-2 rounded-full transition-colors text-slate-400 dark:text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 pt-4 space-y-8 max-h-[75vh] overflow-y-auto">
              {loading && !stats ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                  <RefreshCcw className="w-8 h-8 text-[#93C0B1] animate-spin" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Connecting...
                  </p>
                </div>
              ) : error ? (
                <div className="p-6 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md text-sm font-bold border border-red-100 dark:border-red-900/50 text-center">
                  {error}
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Primary Financial Overview */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Month to Date Card */}
                    <div className="bg-slate-50 dark:bg-[#131d22] p-6 rounded-md border border-slate-100 dark:border-slate-800 shadow-sm group hover:border-[#93C0B1]/30 transition-all">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">
                        Monthly Spend
                      </span>
                      <div className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tighter">
                        ${stats?.month_cost.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 font-bold uppercase tracking-tight">
                        {stats?.commands_month.toLocaleString()} CMDS
                      </div>
                    </div>

                    {/* 24h Spend Card */}
                    <div className="bg-slate-50 dark:bg-[#131d22] p-6 rounded-md border border-slate-100 dark:border-slate-800 shadow-sm group hover:border-[#93C0B1]/30 transition-all">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                          24h Spend
                        </span>
                      </div>
                      <div className="text-3xl font-bold text-[#93C0B1] tracking-tighter">
                        ${stats?.day_cost.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 font-bold uppercase tracking-tight">
                        {stats?.commands_24h.toLocaleString()} CMDS
                      </div>
                    </div>
                  </div>

                  {/* Primary Stats Grid */}
                  <div className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-50 dark:bg-[#131d22] p-5 rounded-md border border-slate-100 dark:border-slate-800 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">
                          Throughput
                        </span>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-200 tracking-tighter flex items-baseline">
                          {stats?.ops_per_sec}{" "}
                          <span className="ml-1 text-xs font-bold text-slate-400">
                            ops/s
                          </span>
                        </div>
                      </div>
                      <div className="bg-slate-50 dark:bg-[#131d22] p-5 rounded-md border border-slate-100 dark:border-slate-800 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">
                          Active Clients
                        </span>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-200 tracking-tighter">
                          {stats?.connected_clients}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Idle Maintenance Section */}
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <ShieldAlert className="w-4 h-4 text-slate-400" />
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Idle Maintenance Costs
                      </h4>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-50/50 dark:bg-[#1d2a31]/50 p-5 rounded-md border border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">
                          24h Idle Tax
                        </span>
                        <div className="text-xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                          ${stats?.idle_24h.toFixed(4)}
                        </div>
                      </div>
                      <div className="bg-slate-50/50 dark:bg-[#1d2a31]/50 p-5 rounded-md border border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">
                          Monthly Idle Tax
                        </span>
                        <div className="text-xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                          ${stats?.idle_month.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed italic">
                      "Idle Tax" represents background command consumption while
                      no scans are active.
                    </p>
                  </div>

                  {/* Detailed Analysis Section (Cumulative Stats) */}
                  <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Lifetime Usage
                        </span>
                        <p className="text-lg font-bold text-slate-900 dark:text-slate-200">
                          {stats?.total_commands.toLocaleString()}
                        </p>
                      </div>
                      <div className="space-y-1 text-right">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          24h Volume
                        </span>
                        <p className="text-lg font-bold text-slate-900 dark:text-slate-200">
                          {stats?.commands_24h.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Recent Activity Table */}
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Recent Run Efficiency
                      </h4>
                    </div>
                    <div className="bg-slate-50 dark:bg-[#131d22] rounded-md border border-slate-100 dark:border-slate-800 overflow-hidden shadow-sm">
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="bg-slate-50/50 dark:bg-[#1d2a31]/50 text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
                            <th className="px-5 py-3 font-bold">Project</th>
                            <th className="px-3 py-3 text-center font-bold">
                              Pages
                            </th>
                            <th className="px-5 py-3 text-right font-bold">
                              Cost
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                          {stats?.recent_runs.map((run) => (
                            <tr
                              key={run.id}
                              className="hover:bg-slate-50/30 dark:hover:bg-[#1d2a31]/30 transition-colors"
                            >
                              <td className="px-5 py-3.5 font-bold text-slate-900 dark:text-slate-200 truncate max-w-[150px]">
                                {run.site_url.replace(/^https?:\/\//, "")}
                              </td>
                              <td className="px-3 py-3.5 text-center text-slate-600 dark:text-slate-400 font-bold">
                                {run.pages}
                              </td>
                              <td className="px-5 py-3.5 text-right font-bold text-[#93C0B1]">
                                ${run.cost.toFixed(5)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-50/50 dark:bg-[#1d2a31]/50 p-6 border-t border-slate-100 dark:border-slate-800 text-center">
              <button
                onClick={() => setIsOpen(false)}
                className="text-[11px] font-bold text-[#93C0B1] uppercase tracking-widest hover:tracking-[0.2em] transition-all"
              >
                Close Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
