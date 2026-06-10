import React from "react"
import { LucideIcon, ArrowUpRight } from "lucide-react"

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  color: string
  trend?: string
  bg?: string
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon: Icon,
  color,
  trend,
  bg = "bg-slate-50",
}) => {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 ${bg} rounded-lg`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        {trend && (
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center">
            <ArrowUpRight className="w-3 h-3 mr-1" /> {trend}
          </span>
        )}
      </div>
      <div
        className={`text-3xl font-bold ${title === "Open Issues" && Number(value) > 0 ? "text-red-600" : "text-slate-900"}`}
      >
        {value}
      </div>
      <div className="text-sm text-slate-500 font-medium mt-1">{title}</div>
    </div>
  )
}
