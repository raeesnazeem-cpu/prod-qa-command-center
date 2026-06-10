import React from "react"
import { AlertCircle, CheckCircle2, ArrowRight } from "lucide-react"

export interface RebuttalVerdict {
  verdict: "resolved" | "disputed"
  confidence: number
  reasoning: string
}

export interface RebuttalVerdictCardProps {
  verdictData: RebuttalVerdict
  onMarkResolved?: () => void
  onViewFinding?: () => void
}

export const RebuttalVerdictCard: React.FC<RebuttalVerdictCardProps> = ({
  verdictData,
  onMarkResolved,
  onViewFinding,
}) => {
  const isResolved = verdictData.verdict === "resolved"

  return (
    <div
      className={`p-6 rounded-md border transition-all ${isResolved ? "bg-emerald-50/50 border-emerald-200" : "bg-orange-50/50 border-orange-200"}`}
    >
      <div className="flex items-start gap-4 mb-4">
        <div
          className={`p-3 rounded-xl shrink-0 ${isResolved ? "bg-emerald-100 text-emerald-600" : "bg-orange-100 text-orange-600"}`}
        >
          {isResolved ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className={`font-bold text-lg ${isResolved ? "text-emerald-900" : "text-orange-900"} uppercase tracking-wider`}
          >
            {isResolved ? "Resolved" : "Disputed"}
          </h3>
          <p className="mt-2 text-sm text-slate-700 leading-relaxed font-medium">
            {verdictData.reasoning}
          </p>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            AI Confidence
          </span>
          <span
            className={`text-[10px] font-bold ${isResolved ? "text-emerald-600" : "text-orange-600"}`}
          >
            {verdictData.confidence}%
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${isResolved ? "bg-emerald-500" : "bg-orange-500"}`}
            style={{
              width: `${Math.max(0, Math.min(100, verdictData.confidence))}%`,
            }}
          />
        </div>
      </div>

      <div className="pt-4 border-t border-slate-200/60 flex items-center justify-end flex-wrap gap-2">
        {isResolved ? (
          <button
            onClick={onMarkResolved}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <CheckCircle2 size={14} />
            This rebuttal has been accepted. Mark task as resolved?
          </button>
        ) : (
          <button
            onClick={onViewFinding}
            className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-orange-200 text-orange-600 text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-orange-50 transition-colors"
          >
            Issue remains. View original finding
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
