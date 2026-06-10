import React from "react"
import { ClipboardList, CheckCircle2, XCircle, Globe } from "lucide-react"
import { QAFinding } from "../api/runs.api"

interface FormTestResultCardProps {
  finding: QAFinding
}

export const FormTestResultCard: React.FC<FormTestResultCardProps> = ({
  finding,
}) => {
  const isPassed =
    !finding.title.toLowerCase().includes("unconfirmed") &&
    finding.status !== "false_positive"

  // Extract Form ID and Action from context_text
  const formIdMatch = finding.context_text?.match(/Form ID: (.*)/)
  const actionMatch = finding.context_text?.match(/Action: (.*)/)
  const formId = formIdMatch ? formIdMatch[1] : "Unknown"
  const action = actionMatch ? actionMatch[1] : "N/A"
  const pageUrl = finding.pages?.url

  return (
    <div className="p-4 bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-50 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <div
            className={`p-1.5 rounded-lg ${isPassed ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"}`}
          >
            <ClipboardList size={14} />
          </div>
          <span className="text-[10px] font-bold text-slate-900 dark:text-white uppercase tracking-widest">
            Form Submission Test
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest ${
            isPassed
              ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
              : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
          }`}
        >
          {isPassed ? (
            <>
              <CheckCircle2 size={10} />
              Success
            </>
          ) : (
            <>
              <XCircle size={10} />
              Failed
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {pageUrl && (
          <div className="flex flex-col gap-1">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Location
            </span>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#131d22] px-2 py-1 rounded border border-slate-100 dark:border-slate-700 truncate">
              <Globe size={10} className="text-slate-400" />
              {pageUrl}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Form Identifier
            </span>
            <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-[#131d22] px-2 py-1 rounded border border-slate-100 dark:border-slate-700 truncate">
              {formId}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Target Action
            </span>
            <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 truncate bg-slate-50 dark:bg-[#131d22] px-2 py-1 rounded border border-slate-100 dark:border-slate-700 truncate">
              {action}
            </span>
          </div>
        </div>

        {finding.description && (
          <div className="flex flex-col gap-1">
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
              Submit Result
            </span>
            <p
              className={`text-[10px] font-medium leading-relaxed ${isPassed ? "text-slate-600 dark:text-slate-300" : "text-red-600 dark:text-red-400"}`}
            >
              {finding.description}
            </p>
          </div>
        )}

        {!isPassed && (
          <div className="mt-1 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/30">
            <p className="text-[9px] text-red-600 dark:text-red-400 font-bold uppercase tracking-tight mb-1">
              Root Cause
            </p>
            <p className="text-[10px] text-red-600 dark:text-red-400 font-medium leading-relaxed italic">
              No confirmation message or redirect detected within the 5s
              timeout.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
