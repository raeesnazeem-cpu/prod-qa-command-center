import React, { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { QAFinding } from "../api/runs.api"

interface CheckFactorFilterProps {
  findings: QAFinding[]
  selectedFactor: string | null
  onSelectFactor: (factor: string | null) => void
}

export interface FilterTab {
  id: string | null
  label: string
  factors: string[]
}

export const FILTER_TABS: FilterTab[] = [
  { id: null, label: "All", factors: [] },
  { id: "spelling", label: "Spelling", factors: ["spelling"] },
  {
    id: "broken_links",
    label: "Links",
    factors: ["broken_links", "external_links"],
  },
  { id: "meta_tags", label: "Meta", factors: ["meta_tags"] },
  { id: "console_errors", label: "Console", factors: ["console_errors"] },
  { id: "dummy_content", label: "Dummy", factors: ["dummy_content"] },
  { id: "image_compliance", label: "Images", factors: ["image_compliance"] },
  { id: "ai_content_audit", label: "AI", factors: ["ai_content_audit"] },
  { id: "forms", label: "Forms", factors: ["forms"] },
  { id: "woocommerce", label: "WooCommerce", factors: ["woocommerce"] },
  {
    id: "visual_regression",
    label: "Responsive",
    factors: ["visual_regression"],
  },
  { id: "hero_media", label: "Hero Media", factors: ["hero_media"] },
]

export const CheckFactorFilter: React.FC<CheckFactorFilterProps> = ({
  findings,
  selectedFactor,
  onSelectFactor,
}) => {
  const [startIndex, setStartIndex] = useState(0)
  const VISIBLE_COUNT = 8

  const getOpenCount = (factors: string[]) => {
    if (factors.length === 0) {
      return findings.filter((f) => f.status === "open").length
    }
    return findings.filter(
      (f) => factors.includes(f.check_factor) && f.status === "open",
    ).length
  }

  const handlePrev = () => {
    setStartIndex((prev) => Math.max(0, prev - 1))
  }

  const handleNext = () => {
    setStartIndex((prev) =>
      Math.min(FILTER_TABS.length - VISIBLE_COUNT, prev + 1),
    )
  }

  const visibleTabs = FILTER_TABS.slice(startIndex, startIndex + VISIBLE_COUNT)
  const canGoPrev = startIndex > 0
  const canGoNext = startIndex + VISIBLE_COUNT < FILTER_TABS.length

  return (
    <div className="w-full flex items-center gap-2 py-1">
      <button
        onClick={handlePrev}
        disabled={!canGoPrev}
        className={`p-1.5 rounded-full transition-all ${
          canGoPrev
            ? "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1d2a31] cursor-pointer"
            : "text-slate-200 dark:text-slate-700 cursor-not-allowed opacity-50"
        }`}
      >
        <ChevronLeft size={18} strokeWidth={3} />
      </button>

      <div className="flex items-center gap-2 flex-1 justify-center">
        {visibleTabs.map((tab) => {
          const count = getOpenCount(tab.factors)
          const isActive = selectedFactor === tab.id

          return (
            <button
              key={tab.label}
              onClick={() => onSelectFactor(tab.id)}
              className={`flex items-center gap-2 btn-unified ${
                isActive 
                  ? "" 
                  : "before:hidden after:hidden opacity-60 hover:opacity-100"
              }`}
            >
              <span
                className="text-[11px] font-bold uppercase tracking-wider text-white"
              >
                {tab.label}
              </span>
              {count > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-15px text-[9px] font-bold ${
                    isActive
                      ? "bg-accent text-black"
                      : "bg-white/20 text-white"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <button
        onClick={handleNext}
        disabled={!canGoNext}
        className={`p-1.5 rounded-full transition-all ${
          canGoNext
            ? "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1d2a31] cursor-pointer"
            : "text-slate-200 dark:text-slate-700 cursor-not-allowed opacity-50"
        }`}
      >
        <ChevronRight size={18} strokeWidth={3} />
      </button>
    </div>
  )
}
