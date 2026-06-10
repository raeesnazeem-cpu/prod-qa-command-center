import React, { useState } from "react"
import { QAFinding } from "../api/runs.api"
import {
  AlertCircle,
  ShieldAlert,
  AlertTriangle,
  Info,
  ExternalLink,
  Plus,
  Filter,
  CheckCircle2,
} from "lucide-react"

interface AIVisualSummaryPanelProps {
  findings: QAFinding[]
  onConfirmFinding: (findingId: string) => void
  onCreateTask: (finding: QAFinding) => void
}

const SeverityBadge = ({ severity }: { severity: string }) => {
  const styles = {
    critical: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    high: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
    medium: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
    low: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  }

  const Icon =
    severity === "critical"
      ? ShieldAlert
      : severity === "high"
        ? AlertCircle
        : severity === "medium"
          ? AlertTriangle
          : Info

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-tight ${styles[severity as keyof typeof styles] || styles.low}`}
    >
      <Icon size={10} />
      {severity}
    </div>
  )
}

export const AIVisualSummaryPanel: React.FC<AIVisualSummaryPanelProps> = ({
  findings,
  onConfirmFinding,
  onCreateTask,
}) => {
  const [filter, setFilter] = useState<"all" | "confirmed">("all")

  const filteredFindings =
    filter === "all"
      ? findings
      : findings.filter((f) => f.status === "confirmed")

  return (
    <div className="bg-slate-50 dark:bg-[#131d22] border-t border-slate-200 dark:border-slate-800 flex flex-col h-full">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
            AI Visual Analysis
            <span className="px-2 py-0.5 bg-slate-100 dark:bg-[#1d2a31] text-slate-500 dark:text-slate-400 rounded-full text-[10px]">
              {findings.length} Issues Found
            </span>
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 dark:bg-[#1d2a31] p-1 rounded-md">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-tight rounded-md transition-all ${
                filter === "all"
                  ? "bg-slate-50 dark:bg-[#1d2a31] text-black dark:text-white shadow-sm"
                  : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
            >
              All Issues
            </button>
            <button
              onClick={() => setFilter("confirmed")}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-tight rounded-md transition-all ${
                filter === "confirmed"
                  ? "bg-slate-50 dark:bg-[#1d2a31] text-black dark:text-white shadow-sm"
                  : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
            >
              Confirmed
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {filteredFindings.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-12">
            <div className="w-12 h-12 bg-slate-50 dark:bg-[#1d2a31]/50 rounded-full flex items-center justify-center mb-4">
              <Filter className="w-6 h-6 text-slate-200 dark:text-slate-700" />
            </div>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-200">No issues found</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">
              {filter === "confirmed"
                ? "No confirmed issues yet"
                : "Designs match perfectly"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredFindings.map((finding) => (
              <div
                key={finding.id}
                className={`p-4 bg-slate-50 dark:bg-[#1d2a31]/50 border rounded-md shadow-sm hover:shadow-md transition-all group relative overflow-hidden ${
                  finding.status === "confirmed"
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/10 dark:bg-emerald-900/20"
                    : "border-slate-100 dark:border-slate-700/50"
                }`}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="space-y-1">
                    <SeverityBadge severity={finding.severity} />
                    <span className="block text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] pt-1">
                      {finding.title.replace("[VISUAL DIFF] ", "")}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onCreateTask(finding)}
                      className="p-1.5 bg-black dark:bg-white text-white dark:text-black rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
                      title="Convert to Task"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 leading-relaxed mb-4">
                  {finding.description}
                </p>

                <div className="flex items-center justify-between pt-3 border-t border-slate-50 dark:border-slate-700/50">
                  {finding.status === "confirmed" ? (
                    <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-widest">
                      <CheckCircle2 size={10} />
                      Confirmed
                    </div>
                  ) : (
                    <button
                      onClick={() => onConfirmFinding(finding.id)}
                      className="text-[9px] font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-widest hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
                    >
                      Confirm Issue
                    </button>
                  )}
                  <button className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1">
                    View Details
                    <ExternalLink size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
