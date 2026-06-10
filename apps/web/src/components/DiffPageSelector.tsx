import React from "react"
import { QAPage } from "../api/runs.api"
import { CheckCircle2, Circle, Clock, AlertCircle, Play } from "lucide-react"

interface DiffPageSelectorProps {
  pages: QAPage[]
  selectedPageId: string | null
  onSelectPage: (pageId: string) => void
  onRunDiff: (runId: string) => void
  runId: string
}

export const DiffPageSelector: React.FC<DiffPageSelectorProps> = ({
  pages,
  selectedPageId,
  onSelectPage,
  onRunDiff,
  runId,
}) => {
  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200 w-80">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
          Pages
        </h3>
        <button
          onClick={() => onRunDiff(runId)}
          className="btn-unified flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-#93c0b1-800 transition-all active:scale-95"
        >
          <Play size={12} fill="currentColor" />
          <span>Run All</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {pages.map((page) => {
          const isSelected = selectedPageId === page.id
          const issueCount = Object.values(page.finding_counts || {}).reduce(
            (a, b) => a + b,
            0,
          )

          return (
            <button
              key={page.id}
              onClick={() => onSelectPage(page.id)}
              className={`w-full text-left p-4 border-b border-slate-100 transition-all group hover:bg-slate-50 ${
                isSelected
                  ? "bg-slate-50 border-l-4 border-l-black"
                  : "border-l-4 border-l-transparent"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs font-bold truncate ${isSelected ? "text-black" : "text-slate-600"}`}
                  >
                    {page.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate mt-0.5">
                    {page.title || "Untitled Page"}
                  </p>
                </div>
                <div className="shrink-0 pt-0.5">
                  {page.status === "done" ? (
                    <CheckCircle2 size={14} className="text-emerald-500" />
                  ) : page.status === "processing" ? (
                    <Clock size={14} className="text-amber-500 animate-pulse" />
                  ) : (
                    <Circle size={14} className="text-slate-300" />
                  )}
                </div>
              </div>

              {issueCount > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[9px] font-bold uppercase tracking-tight flex items-center gap-1">
                    <AlertCircle size={10} />
                    {issueCount} Issues
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
