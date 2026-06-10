import React, { useState } from "react"
import { useLeaderboardStats } from "../hooks/useStats"
import MonthYearFilter from "../components/Stats/MonthYearFilter"
import TopPerformerCard from "../components/Stats/TopPerformerCard"
import DeveloperLeaderboard from "../components/Stats/DeveloperLeaderboard"
import QALeaderboard from "../components/Stats/QALeaderboard"
import { Loader2, Award } from "lucide-react"

const StatsPage: React.FC = () => {
  const currentYear = new Date().getFullYear().toString()
  const currentMonth = (new Date().getMonth() + 1).toString()

  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)

  const { data, isLoading, isError } = useLeaderboardStats(year, month)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 animate-in fade-in duration-500 pb-20">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/50 dark:border-slate-800 rounded-lg p-6 shadow-md dark:shadow-xs transition-all">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight flex items-center gap-2">
            Performance Leaderboard
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Track and compare performance metrics.
          </p>
        </div>
        <MonthYearFilter
          year={year}
          month={month}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </div>

      {isLoading ? (
        <div className="space-y-8 animate-pulse font-sans">
          {/* Spotlight Section Skeleton */}
          <div className="space-y-4">
            <div className="h-3 w-40 bg-slate-200 dark:bg-slate-700 rounded-sm" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="h-36 bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 rounded-md p-6 flex flex-col justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                    <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
                  </div>
                </div>
                <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-full mt-4" />
              </div>
              <div className="h-36 bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 rounded-md p-6 flex flex-col justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                    <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
                  </div>
                </div>
                <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-full mt-4" />
              </div>
            </div>
          </div>

          {/* Rankings Section Skeleton */}
          <div className="space-y-8 pt-4">
            {/* Developer Rankings Table Skeleton */}
            <div className="space-y-3">
              <div className="h-3 w-32 bg-slate-200 dark:bg-slate-700 rounded-sm" />
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden p-4 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-12" />
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24" />
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16" />
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center py-1"
                    >
                      <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-8" />
                      <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-32" />
                      <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-12" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* QA Rankings Table Skeleton */}
            <div className="space-y-3">
              <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded-sm" />
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden p-4 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-12" />
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24" />
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16" />
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center py-1"
                    >
                      <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-8" />
                      <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-32" />
                      <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-12" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="h-64 flex items-center justify-center text-red-500 dark:text-red-400 font-bold uppercase text-xs tracking-widest border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50 dark:bg-slate-900 shadow-md dark:shadow-xs transition-all">
          Failed to load statistics. Please try again.
        </div>
      ) : (
        <>
          {/* Spotlight Section */}
          <div className="space-y-4">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Spotlight: Top Performers
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data?.topPerformers.developer ? (
                <TopPerformerCard
                  name={data.topPerformers.developer.name}
                  role="developer"
                  genuineCount={data.topPerformers.developer.count}
                />
              ) : (
                <div className="bg-slate-50 dark:bg-slate-800 border border-dashed border-slate-400/50 dark:border-slate-700 rounded-md p-10 flex items-center justify-center text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  No Top Developer Found
                </div>
              )}
              {data?.topPerformers.qa ? (
                <TopPerformerCard
                  name={data.topPerformers.qa.name}
                  role="qa_engineer"
                  genuineCount={data.topPerformers.qa.count}
                />
              ) : (
                <div className="bg-slate-50 dark:bg-slate-800 border border-dashed border-slate-400/50 dark:border-slate-700 rounded-md p-10 flex items-center justify-center text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  No Top QA Found
                </div>
              )}
            </div>
          </div>

          {/* Rankings Section */}
          <div className="space-y-8">
            <div className="space-y-3">
              <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Developer Rankings
              </h2>
              <DeveloperLeaderboard
                data={data?.leaderboards.developers || []}
              />
            </div>

            <div className="space-y-3">
              <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                QA Rankings
              </h2>
              <QALeaderboard data={data?.leaderboards.qas || []} />
            </div>
          </div>
        </>
      )}

      {/* Footer Info */}
      <div className="pt-6 flex flex-col md:flex-row justify-between items-center text-[9px] font-bold text-slate-400 uppercase tracking-widest gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Metrics updated in real-time based on resolved tasks</span>
        </div>
        <span>
          Filter: {year === "all" ? "All Years" : year} /{" "}
          {month === "all" ? "All Months" : `Month ${month}`}
        </span>
      </div>
    </div>
  )
}

export default StatsPage
