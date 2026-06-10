import React, { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Image as ImageIcon,
  AlertTriangle,
  ExternalLink,
} from "lucide-react"
import { QAPage } from "../api/runs.api"

interface PagesTableProps {
  pages: QAPage[]
  onPageSelect: (page: QAPage) => void
  onManualScan?: (page: QAPage) => void
  showVisuals?: boolean
}

export const PagesTable: React.FC<PagesTableProps> = ({
  pages,
  onPageSelect,
  onManualScan,
  showVisuals,
}) => {
  const parentRef = useRef<HTMLDivElement>(null)

  // Use actual pages from the database only - no placeholders
  const displayPages = pages

  const rowVirtualizer = useVirtualizer({
    count: displayPages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Increased estimate for rows with progress bars
    overscan: 10,
  })

  const getStatusIcon = (
    status: QAPage["status"],
    findingCounts?: Record<string, number>,
  ) => {
    const totalIssues = findingCounts
      ? Object.values(findingCounts).reduce((a, b) => a + b, 0)
      : 0

    switch (status) {
      case "processing":
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
      case "screenshotted":
      case "done":
      case "checked":
        if (totalIssues > 0) {
          return <XCircle className="w-5 h-5 text-red-500" />
        }
        return <CheckCircle2 className="w-5 h-5 text-emerald-500" />
      case "failed":
        return <AlertTriangle className="w-5 h-5 text-amber-500" />
      default:
        return <Clock className="w-5 h-5 text-slate-300" />
    }
  }

  return (
    <div className="bg-slate-50 dark:bg-[#131d22] rounded-md border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-full min-h-[400px]">
      {/* Table Header */}
      <div className="bg-slate-50 dark:bg-[#1d2a31] border-b border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        <div className="w-16">Step</div>
        <div className="flex-1">Page URL</div>
        <div className="w-24 text-center">Status</div>
        <div className="w-32 text-center">Issues</div>
        {showVisuals && <div className="w-20 text-center">Visual</div>}
        {onManualScan && <div className="w-24 text-center">Actions</div>}
      </div>

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto bg-slate-50 dark:bg-[#131d22]"
        style={{ height: "500px" }} // Fixed height for virtualization container
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const page = displayPages[virtualRow.index]
            const totalIssues = page.finding_counts
              ? Object.values(page.finding_counts).reduce((a, b) => a + b, 0)
              : 0

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                onClick={() => onPageSelect(page)}
                className="absolute top-0 left-0 w-full border-b border-slate-100 dark:border-slate-700 transition-colors group flex items-start px-6 py-4 hover:bg-slate-50 dark:hover:bg-[#1d2a31] cursor-pointer"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="w-16 pt-1">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-[#1d2a31] px-1.5 py-0.5 rounded">
                    {(virtualRow.index + 1).toString().padStart(2, "0")}
                  </span>
                </div>

                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-200 truncate">
                      {page.url.replace(/https?:\/\/[^\/]+/, "") || "/"}
                    </p>
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-500 transition-all"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate font-mono">
                    {page.url}
                  </p>

                  {/* Progress Section - Only shown for active processing pages */}
                  {page.status === "processing" && (
                    <div className="mt-4 space-y-3 max-w-[320px] bg-slate-50/50 dark:bg-[#1d2a31] p-2.5 rounded-lg border border-slate-100 dark:border-slate-700 shadow-sm">
                      {/* 1. Progress Bar - High visibility track */}
                      <div className="w-full h-2 bg-slate-200 dark:bg-[#131d22] rounded-full overflow-hidden relative shadow-inner">
                        <div
                          className={`h-full transition-all duration-1000 ease-in-out ${
                            page.status === "processing"
                              ? "bg-accent shadow-[0_0_8px_rgba(147,192,177,0.4)]"
                              : "bg-slate-300 dark:bg-slate-600"
                          }`}
                          style={{
                            width: `${page.status === "processing" ? Math.max(5, page.progress || 0) : 2}%`,
                          }}
                        />
                        {page.status === "processing" && (
                          <div className="absolute inset-0 w-full h-full opacity-20 bg-[linear-gradient(45deg,rgba(255,255,255,.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.15)_50%,rgba(255,255,255,.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[progress-bar-stripes_1s_linear_infinite]" />
                        )}
                      </div>

                      {/* 2. Description Section strictly BELOW the bar */}
                      <div className="flex flex-col gap-1.5 px-0.5">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2 min-w-0">
                            {page.status === "processing" ? (
                              <div className="flex space-x-0.5 shrink-0">
                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
                              </div>
                            ) : (
                              <Clock
                                size={12}
                                className="text-slate-400 shrink-0"
                              />
                            )}
                            <span
                              className={`text-[10px] font-bold uppercase tracking-tight truncate ${
                                page.status === "processing"
                                  ? "text-blue-700 animate-pulse"
                                  : "text-slate-500 dark:text-slate-400"
                              }`}
                            >
                              {page.status === "processing"
                                ? page.current_step || "Initializing Check..."
                                : "Waiting for worker..."}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 shrink-0">
                            {page.status === "processing"
                              ? page.progress || 0
                              : 0}
                            %
                          </span>
                        </div>

                        {page.status === "processing" && (
                          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest pl-5">
                            Real-time status tracking active
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-24 flex justify-center pt-1">
                  {getStatusIcon(page.status, page.finding_counts)}
                </div>

                <div className="w-32 flex justify-center pt-1">
                  {totalIssues > 0 ? (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 rounded-sm border border-red-100 dark:border-red-500/20">
                      <span className="text-xs font-bold">{totalIssues}</span>
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Issues
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      Clean
                    </span>
                  )}
                </div>
                {showVisuals && (
                  <div className="w-20 flex justify-center pt-1">
                    {page.screenshot_url_desktop ? (
                      <div className="w-10 h-6 bg-slate-100 dark:bg-[#131d22] rounded border border-slate-200 dark:border-slate-700 overflow-hidden relative group/img">
                        <img
                          src={page.screenshot_url_desktop}
                          alt="Preview"
                          className="w-full h-full object-cover grayscale group-hover/img:grayscale-0 transition-all"
                        />
                      </div>
                    ) : (
                      <div className="w-10 h-6 bg-slate-50 dark:bg-[#131d22] rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                        <ImageIcon
                          size={12}
                          className="text-slate-300 dark:text-slate-600"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {displayPages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Loader2 className="w-8 h-8 text-slate-200 dark:text-slate-700 animate-spin mb-4" />
            <p className="text-sm text-slate-400 dark:text-slate-500 font-medium italic">
              Discovering pages via sitemap...
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
