import React, { useState, useEffect, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useRun, useFindings, useUpdateFinding } from "../hooks/useRuns"
import { QAFinding } from "../api/runs.api"
import { useAuthAxios } from "../lib/useAuthAxios"
import {
  getVisualDiff,
  startVisualDiff,
  VisualDiff,
} from "../api/visualDiff.api"
import { DiffPageSelector } from "../components/DiffPageSelector"
import { SideBySideViewer } from "../components/SideBySideViewer"
import { DiffOverlay } from "../components/DiffOverlay"
import { AIVisualSummaryPanel } from "../components/AIVisualSummaryPanel"
import { createTask } from "../api/tasks.api"
import {
  ChevronLeft,
  Layout,
  Box,
  Layers,
  Loader2,
  RefreshCw,
} from "lucide-react"
import toast from "react-hot-toast"
import { useGalleryStore } from "../store/galleryStore"

export const VisualDiffPage: React.FC = () => {
  const { id: projectId, runId } = useParams<{ id: string; runId: string }>()
  const navigate = useNavigate()
  const axios = useAuthAxios()
  const { clearAllGalleries } = useGalleryStore()

  // Clear galleries on mount or when switching pages/runs
  useEffect(() => {
    clearAllGalleries()
  }, [runId, clearAllGalleries])

  const { data: run, isLoading: runLoading } = useRun(runId!)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"side-by-side" | "overlay">(
    "side-by-side",
  )
  const [diffData, setDiffResult] = useState<VisualDiff | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  // Fetch findings for the selected page
  const { data: allFindings } = useFindings(selectedPageId)
  const { mutate: updateFindingStatus } = useUpdateFinding(selectedPageId)

  // Filter only visual diff findings
  const visualDiffFindings = useMemo(() => {
    return allFindings?.filter((f) => f.check_factor === "visual_diff") || []
  }, [allFindings])

  // Fetch diff results when selected page changes
  useEffect(() => {
    if (selectedPageId) {
      fetchDiff(selectedPageId)
    }
  }, [selectedPageId])

  // Select first page by default once run data is loaded
  useEffect(() => {
    if (run?.pages && run.pages.length > 0 && !selectedPageId) {
      setSelectedPageId(run.pages[0].id)
    }
  }, [run, selectedPageId])

  const fetchDiff = async (pageId: string) => {
    setLoadingDiff(true)
    try {
      const data = await getVisualDiff(axios, pageId)
      setDiffResult(data)
    } catch (err) {
      console.error("Failed to fetch visual diff:", err)
      toast.error("Failed to load visual diff results")
    } finally {
      setLoadingDiff(false)
    }
  }

  const handleRunDiff = async (rid: string) => {
    try {
      const res = await startVisualDiff(axios, rid)
      toast.success(res.message)
    } catch (err) {
      toast.error("Failed to start visual diff process")
    }
  }

  const handleConfirmFinding = (findingId: string) => {
    updateFindingStatus({
      findingId,
      data: { status: "confirmed" },
    })
    toast.success("Issue confirmed")
  }

  const handleCreateTask = async (
    finding: QAFinding & { gallery_images?: string[] },
  ) => {
    try {
      await createTask(axios, {
        project_id: projectId!,
        title: finding.title,
        description: finding.description || "",
        severity: finding.severity,
        finding_id: finding.id,
        gallery_images: finding.gallery_images,
      })
      toast.success("Task created successfully")
    } catch (err) {
      toast.error("Failed to create task")
    }
  }

  const selectedPage = run?.pages?.find((p) => p.id === selectedPageId)

  if (runLoading) {
    const isDark = typeof window !== "undefined" && (localStorage.getItem("theme") === "dark" || (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches));
    return (
      <div className={isDark ? "dark w-full h-full" : "w-full h-full"}>
        <div className="relative h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 font-sans overflow-hidden">
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-emerald-200/5 dark:bg-teal-500/5 rounded-full blur-3xl animate-gemini-glow"></div>
          </div>
          <div className="relative z-10 flex flex-col items-center space-y-4 animate-pulse">
            <img
              src="https://growth99.com/storage/2024/09/LOGO.svg"
              alt="QACC Logo"
              className="h-48 w-48 dark:hidden block"
              style={{ objectFit: "contain" }}
            />
            <img
              src="https://aspire-cc.com/storage/2026/03/G99-Logo.svg"
              alt="QACC Logo"
              className="h-48 w-48 hidden dark:block"
              style={{ objectFit: "contain" }}
            />
            <p className="text-slate-500 text-sm font-medium uppercase tracking-widest">
              Loading Visual Diff...
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-slate-50 border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/projects/${projectId}/runs/${runId}`)}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400 hover:text-slate-900"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="h-8 w-px bg-slate-200" />
          <div className="flex flex-col">
            <h1 className="text-sm font-bold text-slate-900 uppercase tracking-widest flex items-center gap-2">
              Visual Diff
              <span className="text-slate-300">•</span>
              <span className="text-slate-500 font-bold normal-case tracking-normal">
                {run?.site_url.replace(/^https?:\/\//, "")}
              </span>
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
              Run ID: {runId?.substring(0, 8)}...
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-100 p-1 rounded-md">
            <button
              onClick={() => setViewMode("side-by-side")}
              className={`flex items-center gap-2 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all ${
                viewMode === "side-by-side"
                  ? "bg-slate-50 text-black shadow-sm"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Box size={14} />
              Side-by-Side
            </button>
            <button
              onClick={() => setViewMode("overlay")}
              className={`flex items-center gap-2 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all ${
                viewMode === "overlay"
                  ? "bg-slate-50 text-black shadow-sm"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Layers size={14} />
              Overlay
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <DiffPageSelector
          pages={run?.pages || []}
          selectedPageId={selectedPageId}
          onSelectPage={setSelectedPageId}
          onRunDiff={handleRunDiff}
          runId={runId!}
        />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col relative overflow-hidden">
          {selectedPage ? (
            <>
              {/* Diff Viewer */}
              <div className="flex-1 relative bg-slate-950 min-h-0">
                {loadingDiff ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm z-10">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 text-white animate-spin" />
                      <p className="text-[10px] font-bold text-white uppercase tracking-widest">
                        Loading Diff Data...
                      </p>
                    </div>
                  </div>
                ) : diffData ? (
                  viewMode === "side-by-side" ? (
                    <SideBySideViewer
                      figmaUrl={diffData.figma_screenshot_url}
                      siteUrl={diffData.site_screenshot_url}
                    />
                  ) : (
                    <DiffOverlay
                      figmaUrl={diffData.figma_screenshot_url}
                      siteUrl={diffData.site_screenshot_url}
                      viewMode="overlay"
                      onToggleMode={() => setViewMode("side-by-side")}
                    />
                  )
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-slate-900">
                    <div className="w-16 h-16 bg-slate-800 rounded-md flex items-center justify-center mb-6 border border-slate-700">
                      <RefreshCw className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white uppercase tracking-tight mb-2">
                      No Visual Diff Found
                    </h3>
                    <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed mb-8">
                      This page hasn't been processed for visual diff analysis
                      yet. Run the analysis to see discrepancies between design
                      and code.
                    </p>
                    <button
                      onClick={() => handleRunDiff(runId!)}
                      className="px-8 py-3 bg-slate-50 text-black text-xs font-bold uppercase tracking-[0.2em] rounded-md hover:bg-slate-100 transition-all active:scale-95 shadow-2xl"
                    >
                      Process Visual Diff
                    </button>
                  </div>
                )}
              </div>

              {/* AI Summary Panel */}
              <div className="h-1/3 min-h-[300px] shrink-0 overflow-hidden">
                <AIVisualSummaryPanel
                  findings={visualDiffFindings}
                  onConfirmFinding={handleConfirmFinding}
                  onCreateTask={handleCreateTask}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-slate-50">
              <div className="w-16 h-16 bg-slate-50 rounded-md shadow-xl flex items-center justify-center mb-6 border border-slate-100">
                <Layout className="w-8 h-8 text-slate-200" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 uppercase tracking-tight mb-2">
                Select a page
              </h3>
              <p className="text-sm text-slate-400 max-w-xs mx-auto leading-relaxed">
                Choose a page from the left panel to compare live implementation
                with designs.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
