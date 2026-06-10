import React from "react"

interface MonthYearFilterProps {
  year: string
  month: string
  onYearChange: (year: string) => void
  onMonthChange: (month: string) => void
}

const MonthYearFilter: React.FC<MonthYearFilterProps> = ({
  year,
  month,
  onYearChange,
  onMonthChange,
}) => {
  const years = ["all", "2026", "2025", "2024"]
  const months = [
    { label: "ALL TIME", value: "all" },
    { label: "JANUARY", value: "1" },
    { label: "FEBRUARY", value: "2" },
    { label: "MARCH", value: "3" },
    { label: "APRIL", value: "4" },
    { label: "MAY", value: "5" },
    { label: "JUNE", value: "6" },
    { label: "JULY", value: "7" },
    { label: "AUGUST", value: "8" },
    { label: "SEPTEMBER", value: "9" },
    { label: "OCTOBER", value: "10" },
    { label: "NOVEMBER", value: "11" },
    { label: "DECEMBER", value: "12" },
  ]

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
          Year
        </label>
        <select
          value={year}
          onChange={(e) => onYearChange(e.target.value)}
          className="rounded-md border border-black dark:border-slate-700 bg-slate-50 dark:bg-[#131d22] dark:text-slate-200 px-3 py-1.5 text-xs font-bold uppercase tracking-tight focus:outline-none hover:bg-slate-50 dark:hover:bg-[#1d2a31] transition-colors cursor-pointer min-w-[120px]"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y === "all" ? "ALL TIME" : y}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
          Month
        </label>
        <select
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="rounded-md border border-black dark:border-slate-700 bg-slate-50 dark:bg-[#131d22] dark:text-slate-200 px-3 py-1.5 text-xs font-bold uppercase tracking-tight focus:outline-none hover:bg-slate-50 dark:hover:bg-[#1d2a31] transition-colors cursor-pointer min-w-[120px]"
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default MonthYearFilter
