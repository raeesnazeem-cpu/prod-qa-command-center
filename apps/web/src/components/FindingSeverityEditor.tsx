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
    icon: <ShieldAlert size={16} />,
    color: "text-red-500 bg-transparent border border-red-500",
  },
  {
    value: "high",
    label: "High",
    icon: <AlertTriangle size={16} />,
    color: "text-orange-500 bg-transparent border border-orange-500",
  },
  {
    value: "medium",
    label: "Medium",
    icon: <AlertCircle size={16} />,
    color: "text-yellow-500 bg-transparent border border-yellow-500",
  },
  {
    value: "low",
    label: "Low",
    icon: <Info size={16} />,
    color: "text-blue-500 bg-transparent border border-blue-500",
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
  const [localSeverity, setLocalSeverity] = React.useState<FindingSeverity>(currentSeverity)

  React.useEffect(() => {
    setLocalSeverity(currentSeverity)
  }, [currentSeverity])

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSeverity = e.target.value as FindingSeverity
    if (newSeverity !== localSeverity) {
      setLocalSeverity(newSeverity)
      updateFinding.mutate({
        findingId,
        data: { severity: newSeverity },
      })
    }
  }

  if (!canEdit) {
    const option = SEVERITY_OPTIONS.find((opt) => opt.value === localSeverity)
    return (
      <div
        title={localSeverity}
        className={`absolute top-4 right-4 z-10 flex items-center justify-center p-1.5 rounded-lg transition-all ${option?.color || ""}`}
      >
        {option?.icon}
        {!symbolOnly && <span className="ml-1.5">{localSeverity}</span>}
      </div>
    )
  }

  const currentOption = SEVERITY_OPTIONS.find(
    (opt) => opt.value === localSeverity,
  )

  return (
    <div className="absolute top-4 right-4 z-10 inline-block group/sev">
      <select
        value={localSeverity}
        onChange={handleChange}
        disabled={updateFinding.isPending}
        title={localSeverity}
        className={`appearance-none rounded-md font-bold uppercase tracking-wider cursor-pointer focus:outline-none transition-all ${
          symbolOnly
            ? "w-6 h-6 flex items-center justify-center p-0 text-center text-[0px]"
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
