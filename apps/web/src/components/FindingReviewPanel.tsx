import React, { useState, useMemo } from "react"
import {
  XCircle,
  Plus,
  UserPlus,
  CheckSquare,
  Square,
  BarChart3,
  Filter,
  CheckCircle,
  ShieldAlert,
  Activity,
  ListChecks,
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { QAFinding } from "../api/runs.api"
import { FindingCard } from "./FindingCard"
import { CheckFactorFilter, FILTER_TABS, FilterTab } from "./CheckFactorFilter"

interface FindingReviewPanelProps {
  findings: QAFinding[]
  generalFindings?: QAFinding[]
  pageScreenshots?: {
    desktop?: string | null
    tablet?: string | null
    mobile?: string | null
  }
  onConfirmBulk?: (ids: string[]) => void
  onFalsePositiveBulk?: (ids: string[]) => void
  onCreateTasksBulk?: (findings: QAFinding[]) => void
  onAssignBulk?: (ids: string[]) => void
  onSingleAssign?: (id: string) => void
  onSingleConfirm?: (id: string) => void
  onSingleFalsePositive?: (id: string) => void
  onSingleCreateTask?: (finding: QAFinding) => void
  onAddToStage?: (findings: QAFinding[]) => void
  findingToTaskMap?: Record<string, { taskIds: string[]; assignedUsers: any[] }>
  hideSummary?: boolean
  canAction?: boolean
  runId?: string
}

const DonutChart = ({
  percentage,
  size = 120,
}: {
  percentage: number
  size?: number
}) => {
  const radius = 35
  const stroke = 8
  const normalizedRadius = radius - stroke / 2
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        height={size}
        width={size}
        viewBox="0 0 80 80"
        className="transform -rotate-90"
      >
        <circle
          stroke="#f1f5f9"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx="40"
          cy="40"
        />
        <circle
          stroke="#86B0A3"
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx="40"
          cy="40"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-slate-900 dark:text-slate-200 leading-none">
          {percentage}%
        </span>
        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-1">
          Resolved
        </span>
      </div>
    </div>
  )
}

export const FindingReviewPanel: React.FC<FindingReviewPanelProps> = ({
  findings,
  generalFindings,
  pageScreenshots,
  onConfirmBulk,
  onFalsePositiveBulk,
  onCreateTasksBulk,
  onAssignBulk,
  onSingleConfirm,
  onSingleFalsePositive,
  onSingleCreateTask,
  onSingleAssign,
  onAddToStage,
  findingToTaskMap = {},
  hideSummary,
  canAction: canActionProp,
  runId,
}) => {
  const { canDo } = useRole()
  const canAction =
    canActionProp !== undefined ? canActionProp : canDo("qa_engineer")
  const [selectedFactor, setSelectedFactor] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [iconLeft, setIconLeft] = useState<number | null>(null)
  const [showIcon, setShowIcon] = useState(false)

  React.useEffect(() => {
    const updatePosition = () => {
      if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect()
        const triggerPoint = window.innerHeight * 0.3
        // Only show the icon when the finding cards section is actively passing the 30vh mark
        setShowIcon(rect.top <= triggerPoint && rect.bottom >= triggerPoint)

        // Find the sidebar's right edge dynamically to handle collapsed/expanded state
        const sidebarEl = document.querySelector("aside")
        const sidebarRight = sidebarEl
          ? sidebarEl.getBoundingClientRect().right
          : 256

        // The enclosing box has 32px padding (p-8), so its actual border is 32px left of the panel content
        const boxLeft = rect.left - 32

        // Calculate exact center of the gap
        const iconWidth = 38 // 18px icon + 10px padding on each side
        const centerOfGap = (sidebarRight + boxLeft) / 2

        // On desktop, place it perfectly in the center of the gap
        if (window.innerWidth >= 768) {
          setIconLeft(centerOfGap - iconWidth / 2)
        } else {
          setIconLeft(null)
        }
      }
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition)
    }
  }, [findings, generalFindings])

  // Reset filter and selection when findings change (indicating a page switch)
  React.useEffect(() => {
    setSelectedFactor(null)
    setSelectedIds(new Set())
  }, [findings])

  // Summary Stats
  const stats = useMemo(() => {
    const allUniqueFindings = [...findings]
    if (generalFindings) {
      generalFindings.forEach((gf) => {
        if (!allUniqueFindings.some((f) => f.id === gf.id)) {
          allUniqueFindings.push(gf)
        }
      })
    }
    const total = allUniqueFindings.length

    // Group findings by check_factor to apply status to all members of a group
    const checkFactorGroups: Record<string, typeof allUniqueFindings> = {}
    allUniqueFindings.forEach((f) => {
      if (!checkFactorGroups[f.check_factor]) {
        checkFactorGroups[f.check_factor] = []
      }
      checkFactorGroups[f.check_factor].push(f)
    })

    const GENERAL_CHECK_FACTORS = [
      "project_plan",
      "paid_media",
      "privacy_policy",
      "callnow_links",
      "hero_media",
      "footer_logo",
      "single_script",
      "top_bar_sticky",
      "favicon",
      "contact_form",
      "chatbot_consultation",
      "text_share",
      "dead_links",
      "learn_more_buttons",
      "url_tab_compare",
      "verify_plugin_updates",
      "social_share_heading",
      "logo_chatbot",
      "gsr_check",
      "accessibility_ada_check",
      "two_way_text_setup",
      "grammarly_check",
      "live_site_link_check",
      "beta_url_check",
      "backup_size_check",
      "plugin_number_check",
      "plugin_update_check",
    ]

    const confirmed = allUniqueFindings.filter((f) => {
      const isGeneral = GENERAL_CHECK_FACTORS.includes(f.check_factor)
      if (isGeneral) {
        const group = checkFactorGroups[f.check_factor]
        return group.some((g) => {
          const hasTask = g.tasks && g.tasks.length > 0
          const isAssigned = !!findingToTaskMap[g.id]
          return g.status === "confirmed" || hasTask || isAssigned
        })
      }

      const hasTask = f.tasks && f.tasks.length > 0
      const isAssigned = !!findingToTaskMap[f.id]
      return f.status === "confirmed" || hasTask || isAssigned
    }).length

    const falsePositives = allUniqueFindings.filter((f) => {
      const isGeneral = GENERAL_CHECK_FACTORS.includes(f.check_factor)
      if (isGeneral) {
        const group = checkFactorGroups[f.check_factor]
        return group.some((g) => g.status === "false_positive")
      }
      return f.status === "false_positive"
    }).length

    const open = total - confirmed - falsePositives
    const resolved = confirmed + falsePositives
    return {
      open,
      confirmed,
      falsePositives,
      critical: allUniqueFindings.filter((f) => f.severity === "critical")
        .length,
      high: allUniqueFindings.filter((f) => f.severity === "high").length,
      medium: allUniqueFindings.filter((f) => f.severity === "medium").length,
      low: allUniqueFindings.filter((f) => f.severity === "low").length,
      total,
      resolvedPercentage: total > 0 ? Math.round((resolved / total) * 100) : 0,
    }
  }, [findings, generalFindings, findingToTaskMap])

  // Filtered Findings
  const filteredFindings = useMemo(() => {
    if (!selectedFactor) return findings

    const tab = FILTER_TABS.find((t: FilterTab) => t.id === selectedFactor)
    if (!tab || tab.factors.length === 0)
      return findings.filter((f) => f.check_factor === selectedFactor)

    return findings.filter((f) => tab.factors.includes(f.check_factor))
  }, [findings, selectedFactor])

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredFindings.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredFindings.map((f) => f.id)))
    }
  }

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleBulkConfirm = () => {
    onConfirmBulk?.(Array.from(selectedIds))
    setSelectedIds(new Set())
  }

  const handleBulkFalsePositive = () => {
    onFalsePositiveBulk?.(Array.from(selectedIds))
    setSelectedIds(new Set())
  }

  const handleBulkCreateTasks = () => {
    const selectedFindings = findings.filter((f) => selectedIds.has(f.id))
    if (onAddToStage) {
      onAddToStage(selectedFindings)
    } else {
      onCreateTasksBulk?.(selectedFindings)
    }
    setSelectedIds(new Set())
  }

  return (
    <div ref={panelRef} className="flex flex-col w-full space-y-8">
      {/* Summary Dashboard */}
      {!hideSummary && (
        <div className="bg-slate-200/10 dark:bg-[#1d2a31]/30 rounded-md p-8 border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden relative group">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none group-hover:scale-110 transition-transform duration-700">
            <BarChart3 size={160} />
          </div>

          <div className="flex flex-col lg:flex-row items-center gap-10 relative z-10">
            {/* Resolved Progress Donut */}
            <div className="shrink-0 bg-slate-50 dark:bg-[#1d2a31]/50 p-4 rounded-md border border-slate-100 dark:border-slate-700 shadow-inner">
              <DonutChart percentage={stats.resolvedPercentage} />
            </div>

            <div className="flex-1 space-y-8 w-full">
              {/* Severity Breakdown Text */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-400">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.2em]">
                    Audit Summary
                  </h4>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xl font-bold text-red-600">
                      {stats.critical}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                      Critical
                    </span>
                  </div>
                  <div className="h-4 w-px bg-slate-200 dark:bg-[#1d2a31]" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xl font-bold text-orange-500">
                      {stats.high}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                      High
                    </span>
                  </div>
                  <div className="h-4 w-px bg-slate-200 dark:bg-[#1d2a31]" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xl font-bold text-amber-500">
                      {stats.medium}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                      Medium
                    </span>
                  </div>
                  <div className="h-4 w-px bg-slate-200 dark:bg-[#1d2a31]" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xl font-bold text-blue-500">
                      {stats.low}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                      Low
                    </span>
                  </div>
                  <span className="text-[10px] font-medium text-slate-400 italic ml-2">
                    findings found
                  </span>
                </div>
              </div>

              {/* Status Breakdown Text */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-400">
                  <h4 className="text-[10px] font-bold uppercase">
                    Status Overview
                  </h4>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-200">
                      {stats.confirmed}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                      Confirmed
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-slate-400" />
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-200">
                      {stats.falsePositives}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                      False Positives
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-200">
                      {stats.open}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                      Open for Review
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* General Run Findings Section */}
      {generalFindings && generalFindings.length > 0 && (
        <div className="space-y-4 bg-slate-50/50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 border-b border-slate-200/60 dark:border-slate-700 pb-3">
            <ShieldAlert className="w-5 h-5 text-slate-800 dark:text-slate-200" />
            <h3 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-wider">
              General Run Findings
            </h3>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-[#1d2a31] px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm ml-1">
              {generalFindings.length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 findings-grid gap-6">
            {generalFindings.map((finding) => (
              <div
                id={`finding-card-${finding.id}`}
                key={finding.id}
                className="relative group/wrapper"
              >
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  pageScreenshots={pageScreenshots}
                  onConfirm={onSingleConfirm}
                  onFalsePositive={onSingleFalsePositive}
                  onCreateTask={onSingleCreateTask}
                  onAssign={onSingleAssign}
                  isSelected={selectedIds.has(finding.id)}
                  onToggleSelect={() => toggleSelect(finding.id)}
                  assignedTaskIds={findingToTaskMap[finding.id]?.taskIds}
                  assignedUsers={findingToTaskMap[finding.id]?.assignedUsers}
                  isAssigned={!!findingToTaskMap[finding.id]}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-100 dark:border-slate-700 p-2 rounded-md shadow-sm">
        <CheckFactorFilter
          findings={findings}
          selectedFactor={selectedFactor}
          onSelectFactor={(factor) => {
            setSelectedFactor(factor)
            setSelectedIds(new Set())
          }}
        />
      </div>

      {/* Bulk Action Toolbar */}
      {canAction && (
        <div
          className={`sticky top-4 z-20 bg-black rounded-md p-4 border border-slate-800 shadow-2xl transition-all duration-300 ${
            selectedIds.size > 0
              ? "translate-y-0 opacity-100 visible"
              : "-translate-y-4 opacity-0 invisible h-0 overflow-hidden !p-0 !m-0"
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={toggleSelectAll}
                className="btn-unified hover:bg-black hover:text-accent flex items-center space-x-2 text-white"
              >
                {selectedIds.size === filteredFindings.length ? (
                  <CheckSquare className="text-accent" />
                ) : (
                  <Square />
                )}
              </button>
              <div>
                <p className="text-white font-bold text-sm leading-none">
                  {selectedIds.size} Selected
                </p>
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">
                  Bulk action ready
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkFalsePositive}
                className="flex items-center gap-2 px-4 py-2 bg-slate-50/10 text-white text-[10px] font-bold uppercase tracking-widest rounded-sm hover:bg-slate-50/20 border border-white/10 transition-all active:scale-95"
              >
                Mark False Positives
              </button>
              <button
                onClick={handleBulkCreateTasks}
                className="flex items-center gap-2 px-4 py-2 bg-accent text-black text-[10px] font-bold uppercase tracking-widest rounded-sm hover:bg-accent/90 border border-accent transition-all active:scale-95"
              >
                Create Tasks
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Findings List */}

      {/* Jump to Check Dropdown */}
      {[...(generalFindings || []), ...filteredFindings].length > 0 && (
        <div className="w-full">
          <div
            className={`fixed top-[30vh] max-md:right-6 max-md:bottom-24 max-md:top-auto max-md:left-auto group z-[50] transition-all duration-300 ${showIcon ? "opacity-100 pointer-events-auto scale-100" : "opacity-0 pointer-events-none scale-90"}`}
            style={{ left: iconLeft !== null ? `${iconLeft}px` : undefined }}
          >
            <div className="relative p-2.5 bg-slate-800 dark:bg-slate-800 rounded-full border-2 border-accent hover:border-accent active:border-accent shadow-2xl cursor-pointer hover:bg-slate-700 dark:hover:bg-slate-700 text-white transition-all flex items-center justify-center">
              <ListChecks size={18} className="text-accent" />
              <select
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer outline-none focus:outline-none focus:ring-0 border-none hover:border-none active:border-none bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                title="Jump to Check"
                onChange={(e) => {
                  if (!e.target.value) return
                  const allDisplayed = [
                    ...(generalFindings || []),
                    ...filteredFindings,
                  ]
                  const firstFinding = allDisplayed.find(
                    (f) => f.check_factor === e.target.value,
                  )
                  if (firstFinding) {
                    document
                      .getElementById(`finding-card-${firstFinding.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                  e.target.value = "" // reset so they can select again
                }}
              >
                <option value="" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">Jump to a check...</option>
                {Array.from(
                  new Set(
                    [...(generalFindings || []), ...filteredFindings].map(
                      (f) => f.check_factor,
                    ),
                  ),
                )
                  .sort((a, b) => a.localeCompare(b))
                  .map((factor) => (
                    <option key={factor} value={factor} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                      {factor
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
              </select>
            </div>
            {/* Curved Arrow Pointing to Cards */}
            <div className="absolute top-[80%] left-[45%] pointer-events-none opacity-80 hidden md:block">
              <svg
                width="50"
                height="70"
                viewBox="0 0 50 70"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-emerald-500 drop-shadow-md"
              >
                <path
                  d="M 0 0 C 0 40, 15 60, 42 65"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                />
                <path d="M 36 57 L 48 66 L 36 68 Z" fill="currentColor" />
              </svg>
            </div>
            <div className="absolute left-full max-md:right-full max-md:left-auto top-1/2 -translate-y-1/2 max-md:mr-3 lg:ml-3 px-2 py-1 bg-black text-white text-[10px] uppercase tracking-widest font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-slate-800 shadow-xl">
              Jump to Check
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 findings-grid gap-6 pb-20">
        {filteredFindings.map((finding) => (
          <div
            id={`finding-card-${finding.id}`}
            key={finding.id}
            className="relative group/wrapper"
          >
            <FindingCard
              key={finding.id}
              finding={finding}
              pageScreenshots={pageScreenshots}
              onConfirm={onSingleConfirm}
              onFalsePositive={onSingleFalsePositive}
              onCreateTask={onSingleCreateTask}
              onAssign={onSingleAssign}
              isSelected={selectedIds.has(finding.id)}
              onToggleSelect={() => toggleSelect(finding.id)}
              assignedTaskIds={findingToTaskMap[finding.id]?.taskIds}
              assignedUsers={findingToTaskMap[finding.id]?.assignedUsers}
              isAssigned={!!findingToTaskMap[finding.id]}
            />
          </div>
        ))}

        {filteredFindings.length === 0 && (
          <div className="col-span-full py-20 bg-slate-50 dark:bg-[#1D2A31] border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-md text-center">
            <div className="w-16 h-16 bg-slate-50 dark:bg-[#1d2a31] rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 dark:border-slate-700">
              <Filter className="w-8 h-8 text-slate-200 dark:text-slate-600" />
            </div>
            <p className="text-slate-900 dark:text-slate-200 font-bold text-base uppercase tracking-tight">
              No findings match filter
            </p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-2">
              Try selecting a different check factor
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
