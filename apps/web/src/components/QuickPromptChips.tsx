import React from "react"

const PROMPTS = [
  "What issues were found on the homepage?",
  "Summarize the last QA run",
  "Which pages have the most issues?",
  "What were the rebuttal outcomes?",
]

interface QuickPromptChipsProps {
  onSelect: (prompt: string) => void
  disabled?: boolean
}

export const QuickPromptChips: React.FC<QuickPromptChipsProps> = ({
  onSelect,
  disabled,
}) => {
  return (
    <div className="flex flex-wrap gap-2 p-3 bg-slate-50 dark:bg-[#131d22]">
      {PROMPTS.map((prompt, index) => (
        <button
          key={index}
          onClick={() => onSelect(prompt)}
          disabled={disabled}
          className="px-3 py-1.5 bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-full text-[11px] text-slate-600 dark:text-slate-300 font-medium hover:border-accent hover:text-accent hover:bg-slate-50 dark:hover:bg-[#1d2a31] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left shadow-sm"
        >
          {prompt}
        </button>
      ))}
    </div>
  )
}
