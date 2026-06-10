import React from "react"
import { useUpdateFinding } from "../hooks/useRuns"
import { FindingSeverity } from "@qacc/shared"
import { AlertCircle, AlertTriangle, Info, ShieldAlert } from "lucide-react"

interface FindingSeverityEditorProps {
  findingId: string
  pageId: string
  currentSeverity: FindingSeverity
  canEdit: boolean
  symbolOnly?: boolean
}

const SEVERITY_OPTIONS: {
  value: FindingSeverity
  label: string
  icon: React.ReactNode
  color: string
}[] = [
  {
    value: "critical",
    label: "Critical",
    icon: <ShieldAlert size={12} />,
    color: "text-red-600 bg-red-50",
  },
  {
    value: "high",
    label: "High",
    icon: <AlertTriangle size={12} />,
    color: "text-orange-600 bg-orange-50",
  },
  {
    value: "medium",
    label: "Medium",
    icon: <AlertCircle size={12} />,
    color: "text-yellow-600 bg-yellow-50",
  },
  {
    value: "low",
    label: "Low",
    icon: <Info size={12} />,
    color: "text-blue-600 bg-blue-50",
  },
]

export const FindingSeverityEditor: React.FC<FindingSeverityEditorProps> = ({
  findingId,
  pageId,
  currentSeverity,
  canEdit,
  symbolOnly,
}) => {
  const updateFinding = useUpdateFinding(pageId)

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSeverity = e.target.value as FindingSeverity
    if (newSeverity !== currentSeverity) {
      updateFinding.mutate({
        findingId,
        data: { severity: newSeverity },
      })
    }
  }

  if (!canEdit) {
    const option = SEVERITY_OPTIONS.find((opt) => opt.value === currentSeverity)
    return (
      <div
        title={currentSeverity}
        className={`flex items-center justify-center p-1.5 rounded-lg border transition-all ${option?.color || ""}`}
      >
        {option?.icon}
        {!symbolOnly && <span className="ml-1.5">{currentSeverity}</span>}
      </div>
    )
  }

  const currentOption = SEVERITY_OPTIONS.find(
    (opt) => opt.value === currentSeverity,
  )

  return (
    <div className="relative inline-block group/sev">
      <select
        value={currentSeverity}
        onChange={handleChange}
        disabled={updateFinding.isPending}
        title={currentSeverity}
        className={`appearance-none rounded-md border font-bold uppercase tracking-wider cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all ${
          symbolOnly
            ? "w-5 h-5 flex items-center justify-center p-0 text-center text-[0px]"
            : "pl-2 pr-6 py-0.5 text-[9px]"
        } ${currentOption?.color || ""}`}
      >
        {SEVERITY_OPTIONS.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            className="bg-slate-50 text-slate-900"
          >
            {opt.label}
          </option>
        ))}
      </select>
      {symbolOnly ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {currentOption?.icon}
        </div>
      ) : (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-current opacity-50">
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      )}
    </div>
  )
}
