import { useParams, Link, useLocation } from "react-router-dom"
import { useProject } from "../hooks/useProjects"
import { QAFinding, QAPage } from "../api/runs.api"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useGalleryStore } from "../store/galleryStore"
import { PagesTable } from "../components/PagesTable"
import { FindingReviewPanel } from "../components/FindingReviewPanel"
import { CreateTaskModal } from "../components/CreateTaskModal"
import { useRunProgress } from "../hooks/useRunProgress"
import {
  useFindings,
  useRunFindings,
  useUpdateRunStatus,
  useUpdateFinding,
  useRuns,
} from "../hooks/useRuns"
import { useCreateTask, useTasks } from "../hooks/useTasks"
import { AssignMemberModal } from "../components/AssignMemberModal"
import { WooCommerceSection } from "../components/WooCommerceSection"
import { SignOffButton } from "../components/SignOffButton"
import { TaskStagingOverlay } from "../components/TaskStagingOverlay"
import { ManualScanOverlay } from "../components/ManualScanOverlay"
import { useTaskStageStore } from "../store/taskStageStore"
import { useRole } from "../hooks/useRole"
import { startVisualDiff } from "../api/visualDiff.api"
import { Skeleton } from "../components/Skeleton"
import {
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Search,
  Activity,
  Pause,
  Play,
  Square,
  User,
  LayoutDashboard,
  ShoppingCart,
  FileSearch,
  Eye,
  ClipboardList,
  BarChart3,
  RefreshCw,
  ChevronRight,
  Download,
  Send,
  Camera,
  Video,
  PlayCircle,
  CheckSquare,
  Users,
  Settings,
} from "lucide-react"
import { useEffect, useState, useMemo, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { useAiResultsStore } from "../store/aiResultsStore"

export const RunDetailPage = () => {
  const { id: projectId, runId } = useParams<{ id: string; runId: string }>()
  const location = useLocation()
  const axios = useAuthAxios()
  const updateStatus = useUpdateRunStatus()
  const { canDo } = useRole()
  const aiResultsMap = useAiResultsStore((state) => state.aiResultsMap)
  const { clearAllGalleries, galleryImages: allGalleryImages } =
    useGalleryStore()

  // Clear galleries on mount or when switching runs
  useEffect(() => {
    clearAllGalleries()
  }, [runId, clearAllGalleries])
  const { addToStage, stagedFindings } = useTaskStageStore()

  const [isManualScanOpen, setIsManualScanOpen] = useState(false)
  const [selectedManualPageId, setSelectedManualPageId] = useState<
    string | null
  >(null)
  const canActionManual = canDo("qa_engineer")

  const {
    run,
    progress,
    isLive,
    pagesProcessed,
    pagesTotal,
    isLoading: isLoadingRun,
  } = useRunProgress(runId!)

  const { data: project, isLoading: isLoadingProject } = useProject(projectId!)
  const { data: projectRunsData } = useRuns(projectId!)

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const selectedPage = useMemo(
    () => run?.pages?.find((p) => p.id === selectedPageId) || null,
    [run?.pages, selectedPageId],
  )

  const [activeTab, setActiveTab] = useState<
    | "overview"
    | "pages"
    | "general"
    | "findings"
    | "visual_diff"
    | "woocommerce"
    | "report"
    | "recordings"
  >(() => {
    return (sessionStorage.getItem(`runTab_${runId}`) as any) || "overview"
  })

  useEffect(() => {
    if (activeTab) sessionStorage.setItem(`runTab_${runId}`, activeTab)
  }, [activeTab, runId])

  const [recordingsSubTab, setRecordingsSubTab] = useState<"full" | "history">(
    "full",
  )
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false)
  const [prefillFinding, setPrefillFinding] = useState<QAFinding | null>(null)

  // Reset view to overview or specific tab when navigating
  useEffect(() => {
    if (location.hash === "#recordings") {
      setActiveTab("recordings")
      setRecordingsSubTab("full")
    } else {
      const savedTab = sessionStorage.getItem(`runTab_${runId}`)
      setActiveTab((savedTab as any) || "overview")
      setRecordingsSubTab("full")
    }

    window.scrollTo(0, 0)
  }, [runId, location.hash])

  const [isCapturingScreenshots, setIsCapturingScreenshots] = useState(false)
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0)

  // Session-persisted timer for video recording
  useEffect(() => {
    let interval: any
    const runIdStr = run?.id
    const status = (run as any)?.recording_status

    if (status === "recording" && runIdStr) {
      const storedStart = sessionStorage.getItem(`rec_start_${runIdStr}`)
      if (!storedStart) {
        sessionStorage.setItem(`rec_start_${runIdStr}`, Date.now().toString())
      }

      interval = setInterval(() => {
        const start = parseInt(
          sessionStorage.getItem(`rec_start_${runIdStr}`) ||
            Date.now().toString(),
        )
        setRecordingElapsedSeconds(Math.floor((Date.now() - start) / 1000))
      }, 1000)
    } else if (runIdStr) {
      sessionStorage.removeItem(`rec_start_${runIdStr}`)
      setRecordingElapsedSeconds(0)
    }

    return () => clearInterval(interval)
  }, [(run as any)?.recording_status, run?.id])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }

  const [isRecordingVideo, setIsRecordingVideo] = useState(false)

  const {
    data: findings,
    isLoading: isLoadingFindings,
    isFetching: isFetchingFindings,
    refetch: refetchFindings,
  } = useFindings(selectedPageId)
  const {
    data: runFindings,
    isLoading: isLoadingRunFindings,
    isFetching: isFetchingRunFindings,
    refetch: refetchRunFindings,
  } = useRunFindings(runId!)

  const [findingsLoaded, setFindingsLoaded] = useState(false)
  const [hasRefetched, setHasRefetched] = useState(false)
  const initialStatusRef = useRef<string | undefined>(undefined)
  const hasAutoNavigatedGeneralRef = useRef(false)

  // Fast looping state for rapid UI feedback
  const [fakeIndex, setFakeIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setFakeIndex((prev) => prev + 1)
    }, 600) // Cycles through a new URL every 0.6 seconds
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Capture the FIRST known status of the run
    if (!initialStatusRef.current && run?.status) {
      initialStatusRef.current = run.status
    }

    // If the run was ALREADY completed when we opened the page, skip the 99% fake state
    if (initialStatusRef.current === "completed") {
      setFindingsLoaded(true)
      return
    }

    // If we watched it transition from running -> completed LIVE:
    if (run?.status === "completed" && !hasRefetched) {
      setHasRefetched(true)
      Promise.all([refetchFindings(), refetchRunFindings()]).then(() => {
        setFindingsLoaded(true)
      })
    }
  }, [run?.status, hasRefetched, refetchFindings, refetchRunFindings])

  const trueAverageProgress = useMemo(() => {
    if (!run?.enabled_checks || !run?.pages) return progress

    const SINGLE_PAGE_CHECKS = [
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
      "verify_plugin_updates",
      "social_share_heading",
      "logo_chatbot",
    ]

    const normalize = (u: string) =>
      u.replace(/^https?:\/\//, "").replace(/\/$/, "")
    const homepage = run.pages.find(
      (p) => normalize(p.url) === normalize(run.site_url),
    )
    const isRunCompleted = run.status === "completed"
    const totalPages = run.pages.length
    const completedPages = isRunCompleted
      ? totalPages
      : run.pages.filter(
          (p) =>
            p.status === "done" ||
            p.status === "checked" ||
            p.status === "failed",
        ).length
    const allPagesProgress = (() => {
      if (totalPages === 0) return 0

      const hasUrlTabCompare = run.enabled_checks?.includes("url_tab_compare")

      if (hasUrlTabCompare) {
        // Weight normal pages 50%, and homepage crawl 50%
        const completedWithoutHomepage = run.pages.filter(
          (p) =>
            (p.status === "done" ||
              p.status === "checked" ||
              p.status === "failed") &&
            p.id !== homepage?.id,
        ).length

        const basePagesToProcess = Math.max(1, totalPages - 1)
        const baseProgress =
          (completedWithoutHomepage / basePagesToProcess) * 50
        const homeProgress = homepage
          ? ((homepage.progress || 0) / 100) * 50
          : 0

        return baseProgress + homeProgress
      }

      return (completedPages / totalPages) * 100
    })()

    // Detect API only run for accurate progress calculation
    const isApiOnlyRun = !run.enabled_checks.some((c: string) =>
      [
        "visual_regression",
        "accessibility",
        "console_errors",
        "performance",
        "seo",
        "spelling",
        "broken_links",
        "dummy_content",
        "image_compliance",
        "ai_content_audit",
        "hero_media",
        "dead_links",
        "footer_logo",
        "single_script",
        "top_bar_sticky",
        "favicon",
        "url_matching",
        "contact_form",
        "chatbot_consultation",
        "text_share",
        "logo_chatbot",
      ].includes(c),
    )

    const homepageProgress = homepage
      ? isApiOnlyRun
        ? homepage.progress || 0
        : homepage.status === "done" || homepage.status === "checked"
          ? 100
          : homepage.progress || 0
      : 0

    let totalCheckProgress = 0

    run.enabled_checks.forEach((checkKey) => {
      if (SINGLE_PAGE_CHECKS.includes(checkKey)) {
        totalCheckProgress += homepageProgress
      } else {
        totalCheckProgress += allPagesProgress
      }
    })

    return run.enabled_checks.length > 0
      ? totalCheckProgress / run.enabled_checks.length
      : progress
  }, [run?.enabled_checks, run?.pages, run?.status, run?.site_url, progress])

  const computedAverageProgress = Math.min(
    100,
    Math.max(0, Math.round(trueAverageProgress)),
  )
  const isPartial =
    run?.status === "completed" &&
    findingsLoaded &&
    computedAverageProgress < 100

  const displayStatus =
    run?.status === "completed" && !findingsLoaded
      ? "running"
      : isPartial
        ? "partial"
        : run?.status

  const displayProgress =
    run?.status === "completed" && !findingsLoaded ? 99 : trueAverageProgress

  const safeDisplayProgress =
    run?.status === "completed" && findingsLoaded
      ? computedAverageProgress
      : Math.min(99, Math.max(1, Math.round(displayProgress)))

  const { data: tasksData } = useTasks({ projectId: projectId!, limit: 1000 })
  const updateFindingMutation = useUpdateFinding(selectedPageId)
  const { mutate: createTask } = useCreateTask()

  // Helper to consolidate all dead link findings into a single finding
  const consolidateDeadLinks = (findings: QAFinding[]): QAFinding[] => {
    const nonDeadLinks = findings.filter((f) => f.check_factor !== "dead_links")
    const deadLinks = findings.filter((f) => f.check_factor === "dead_links")

    if (deadLinks.length === 0) return nonDeadLinks

    const violations: string[] = []
    const uniqueLinks = new Set<string>()
    let totalDeadLinksCount = 0

    deadLinks.forEach((f) => {
      // Clean up and extract bullet points from descriptions
      const parts = f.description?.split("- **") || []
      parts.forEach((part, index) => {
        if (index === 0) return // Before the first "- **"
        const cleanPart = part.trim()
        if (cleanPart) {
          // Deduplicate by the URL (everything before the closing **)
          const urlMatch = cleanPart.split("**")[0]
          if (!uniqueLinks.has(urlMatch)) {
            uniqueLinks.add(urlMatch)
            violations.push(`- **${cleanPart}`)
            totalDeadLinksCount++
          }
        }
      })
    })

    if (violations.length === 0) {
      deadLinks.forEach((f) => {
        if (f.description) {
          violations.push(f.description)
          // Fallback to safely counting bullet points instead of URLs (which double-counted)
          const fallbackCount = (f.description.match(/- /g) || []).length
          totalDeadLinksCount += fallbackCount > 0 ? fallbackCount : 1
        }
      })
    }

    const mergedDescription =
      `The following dead or broken links were detected:\n\n` +
      violations.join("\n\n")

    let severity: "medium" | "high" | "critical" = "medium"
    if (totalDeadLinksCount >= 10) severity = "critical"
    else if (totalDeadLinksCount >= 5) severity = "high"

    const combinedId = deadLinks.map((f) => f.id).join(",")

    const consolidatedDeadLinks: QAFinding = {
      id: combinedId,
      check_factor: "dead_links",
      severity,
      title: `${totalDeadLinksCount} dead link${totalDeadLinksCount > 1 ? "s" : ""} found`,
      description: mergedDescription,
      context_text: deadLinks
        .map((f) => f.context_text)
        .filter(Boolean)
        .join("\n"),
      screenshot_url: null,
      status: deadLinks.every((f) => f.status === "confirmed")
        ? "confirmed"
        : deadLinks.every((f) => f.status === "false_positive")
          ? "false_positive"
          : "open",
      ai_generated: false,
      created_at: deadLinks[0]?.created_at,
      page_id: null,
      run_id: deadLinks[0]?.run_id,
    } as any

    return [...nonDeadLinks, consolidatedDeadLinks]
  }

  // Helper to consolidate all learn more buttons into a single finding
  const consolidateLearnMoreButtons = (findings: QAFinding[]): QAFinding[] => {
    const others = findings.filter(
      (f) => f.check_factor !== "learn_more_buttons",
    )
    const learns = findings.filter(
      (f) => f.check_factor === "learn_more_buttons",
    )

    if (learns.length === 0) return others

    const violations: string[] = []
    let totalButtonsCount = 0

    learns.forEach((f) => {
      if (f.title.includes("No generic CTA")) return // skip the 0-finding pages

      const parts = f.description?.split("- **") || []
      parts.forEach((part, index) => {
        if (index === 0) return // Before the first "- **"
        const cleanPart = part.trim()
        if (cleanPart) {
          violations.push(`- **${cleanPart}`)
          totalButtonsCount++
        }
      })
    })

    if (violations.length === 0) {
      return [
        ...others,
        {
          ...learns[0],
          description:
            "No buttons/links with text 'Learn More', 'Read More', 'Know More', or 'See More' were found on the entire website.",
        } as QAFinding,
      ]
    }

    const combinedId = learns.map((f) => f.id).join(",")

    const consolidated: QAFinding = {
      id: combinedId,
      check_factor: "learn_more_buttons",
      severity: "medium",
      title: `${totalButtonsCount} generic CTA button(s) found`,
      description: violations.join("\n"),
      context_text: "Consolidated from all pages.",
      screenshot_url: null,
      status: "open",
      ai_generated: false,
      created_at: learns[0]?.created_at,
      page_id: null,
      run_id: learns[0]?.run_id,
    } as any

    return [...others, consolidated]
  }

  // Helper to consolidate all contact form findings into a single finding
  const consolidateContactForms = (findings: QAFinding[]): QAFinding[] => {
    const others = findings.filter((f) => f.check_factor !== "contact_form")
    const forms = findings.filter((f) => f.check_factor === "contact_form")

    if (forms.length === 0) return others

    const allData: { url: string; hasForm: boolean }[] = []
    let screenshots = ""

    forms.forEach((f) => {
      try {
        const data = JSON.parse(f.context_text || "{}")
        if (data.url) allData.push(data)
      } catch (e) {}

      if (f.screenshot_url && !screenshots) {
        screenshots = f.screenshot_url
      }
    })

    const combinedId = forms.map((f) => f.id).join(",")

    const consolidated: QAFinding = {
      ...forms[0],
      id: combinedId,
      context_text: JSON.stringify(allData),
      screenshot_url: screenshots,
      page_id: "",
    }

    return [...others, consolidated]
  }

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
  ]

  // 1. Extract any general run-level findings (null page_id OR project plan factor OR hero_media matching selected page)
  const generalFindings = useMemo(() => {
    const baseGeneral =
      runFindings?.filter(
        (f) =>
          !f.page_id ||
          (GENERAL_CHECK_FACTORS.includes(f.check_factor) &&
            (f.check_factor !== "hero_media" || f.page_id === selectedPageId)),
      ) || []
    return consolidateContactForms(
      consolidateLearnMoreButtons(consolidateDeadLinks(baseGeneral)),
    )
  }, [runFindings, selectedPageId])

  // 2. Filter out general findings from page-specific findings to avoid duplicate rendering
  const pageFindings = useMemo(() => {
    return (
      findings?.filter(
        (f) => !GENERAL_CHECK_FACTORS.includes(f.check_factor),
      ) || []
    )
  }, [findings])

  const queryClient = useQueryClient()

  const runGeneralFindings = useMemo(() => {
    const baseGeneral =
      runFindings?.filter(
        (f) => !f.page_id || GENERAL_CHECK_FACTORS.includes(f.check_factor),
      ) || []

    return consolidateContactForms(
      consolidateLearnMoreButtons(consolidateDeadLinks(baseGeneral)),
    )
  }, [runFindings])

  useEffect(() => {
    if (
      !hasAutoNavigatedGeneralRef.current &&
      run?.status === "completed" &&
      runGeneralFindings &&
      runGeneralFindings.length > 0
    ) {
      setActiveTab("general")
      hasAutoNavigatedGeneralRef.current = true
    }
  }, [run?.status, runGeneralFindings])

  const findingToTaskMap = useMemo(() => {
    const map: Record<string, { taskIds: string[]; assignedUsers: any[] }> = {}
    if (!tasksData?.data) return map

    // 1. Map tasks to their exact finding_id
    tasksData.data.forEach((task) => {
      if (task.finding_id) {
        if (!map[task.finding_id]) {
          map[task.finding_id] = { taskIds: [], assignedUsers: [] }
        }
        map[task.finding_id].taskIds.push(task.id)
        if (
          task.users &&
          !map[task.finding_id].assignedUsers.some(
            (u) => u.email === task.users?.email,
          )
        ) {
          map[task.finding_id].assignedUsers.push(task.users)
        }
      }
    })

    // 2. Map the consolidated dead links combined ID to tasks associated with any individual finding ID
    const deadLinks =
      runFindings?.filter((f) => f.check_factor === "dead_links") || []
    if (deadLinks.length > 0) {
      const combinedId = deadLinks.map((f) => f.id).join(",")
      const combinedTaskIds: string[] = []
      const combinedAssignedUsers: any[] = []

      deadLinks.forEach((f) => {
        const taskInfo = map[f.id]
        if (taskInfo) {
          taskInfo.taskIds.forEach((tid) => {
            if (!combinedTaskIds.includes(tid)) {
              combinedTaskIds.push(tid)
            }
          })
          taskInfo.assignedUsers.forEach((user) => {
            if (!combinedAssignedUsers.some((u) => u.id === user.id)) {
              combinedAssignedUsers.push(user)
            }
          })
        }
      })

      if (combinedTaskIds.length > 0) {
        map[combinedId] = {
          taskIds: combinedTaskIds,
          assignedUsers: combinedAssignedUsers,
        }
      }
    }

    return map
  }, [tasksData, runFindings])

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [assignTarget, setAssignTarget] = useState<{
    type: "single" | "bulk"
    ids: string[]
  }>({ type: "single", ids: [] })

  useEffect(() => {
    if (!selectedPageId && run?.pages && run.pages.length > 0) {
      setSelectedPageId(run.pages[0].id)
    }
  }, [run?.pages, selectedPageId])

  const [eta, setEta] = useState<string | null>(null)

  useEffect(() => {
    if (
      run?.status === "running" &&
      run.started_at &&
      displayProgress > 0 &&
      displayProgress < 100
    ) {
      const startTime = new Date(run.started_at).getTime()
      const now = new Date().getTime()
      const elapsedMs = now - startTime

      // calculate how long it takes for 1% of progress
      const totalExpectedMs = elapsedMs / (displayProgress / 100)
      const remainingMs = totalExpectedMs - elapsedMs

      if (remainingMs > 0) {
        const remainingSecs = Math.ceil(remainingMs / 1000)
        if (remainingSecs < 60) {
          setEta(`${remainingSecs}s remaining`)
        } else {
          setEta(`${Math.ceil(remainingSecs / 60)}m remaining`)
        }
      }
    } else {
      setEta(null)
    }
  }, [displayProgress, run?.status, run?.started_at])
  const isLoading = isLoadingRun || isLoadingProject

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-64" />
                </div>
                <Skeleton className="h-4 w-96" />
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <div className="flex justify-between items-end">
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-8 w-16" />
          </div>
          <Skeleton className="h-4 w-full rounded-full" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Skeleton className="h-64 col-span-2 rounded-md" />
          <Skeleton className="h-64 rounded-md" />
        </div>
      </div>
    )
  }

  if (!run || !project) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold text-slate-900">Run not found</h2>
        <Link
          to={`/projects/${projectId}`}
          className="text-accent hover:underline mt-4 inline-block"
        >
          Back to Project
        </Link>
      </div>
    )
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />
      case "partial":
        return <AlertCircle className="w-4 h-4 text-yellow-500" />
      case "running":
        return (
          <div className="relative flex h-3 w-3 mr-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
          </div>
        )
      case "failed":
        return <AlertCircle className="w-4 h-4 text-red-500" />
      default:
        return <Clock className="w-4 h-4 text-slate-400" />
    }
  }

  // 1. Detect if this run is API-only (no web crawl)
  const isApiOnly =
    run?.enabled_checks &&
    !run.enabled_checks.some((c: string) =>
      [
        "visual_regression",
        "accessibility",
        "console_errors",
        "performance",
        "seo",
        "spelling",
        "broken_links",
        "dummy_content",
        "image_compliance",
        "ai_content_audit",
        "hero_media",
        "dead_links",
        "footer_logo",
        "single_script",
        "top_bar_sticky",
        "favicon",
        "url_matching",
        "contact_form",
        "chatbot_consultation",
        "text_share",
        "logo_chatbot",
      ].includes(c),
    )

  const isDiscovering = false

  const handlePause = () => {
    updateStatus.mutate({ runId: run.id, status: "paused" })
  }

  const handleResume = () => {
    updateStatus.mutate({ runId: run.id, status: "running" })
  }

  const handleStop = () => {
    if (
      confirm("Are you sure you want to stop this scan? It cannot be resumed.")
    ) {
      updateStatus.mutate({ runId: run.id, status: "cancelled" })
    }
  }

  const handleCaptureScreenshots = async () => {
    if (!selectedPage?.url) return
    setIsCapturingScreenshots(true)
    const toastId = toast.loading("Capturing multiview screenshots... ")
    try {
      const response = await axios.post(
        "/api/proxy-browser/capture-multiview",
        {
          url: selectedPage.url,
          type: "screenshots",
        },
      )

      const results = response.data // { desktop, laptop, tablet, mobile }
      const galleryImages = [
        results.desktop,
        results.laptop,
        results.tablet,
        results.mobile,
      ].filter(Boolean)

      const urlObj = new URL(selectedPage.url)
      const pageName = `${urlObj.hostname}${urlObj.pathname}`
      const dateStr = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      })
      const timeStr = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })

      const taskTitle = `Screenshots for ${pageName} on ${dateStr} at ${timeStr}`

      createTask({
        project_id: projectId!,
        title: taskTitle,
        description: `Automated multiview screenshots for ${selectedPage.url}`,
        severity: "medium",
        gallery_images: galleryImages,
      })

      toast.success("Screenshots captured and staged as a task", {
        id: toastId,
      })
    } catch (err) {
      console.error(err)
      toast.error("Failed to capture multiview screenshots", { id: toastId })
    } finally {
      setIsCapturingScreenshots(false)
    }
  }

  const handleCaptureVideo = async () => {
    setIsRecordingVideo(true)
    const toastId = toast.loading("Triggering full project video recording...")
    try {
      await axios.post("/api/recordings/start", { runId })
      toast.success("Full project video recording started!", { id: toastId })
    } catch (err) {
      console.error(err)
      toast.error("Failed to start video recording", { id: toastId })
    } finally {
      setIsRecordingVideo(false)
    }
  }

  const handleConfirmFinding = async (id: string) => {
    await updateFindingMutation.mutateAsync({
      findingId: id,
      data: { status: "confirmed" },
    })
    queryClient.invalidateQueries({ queryKey: ["run-findings", runId] })
    queryClient.invalidateQueries({ queryKey: ["findings"] })
  }

  const handleFalsePositiveFinding = async (id: string) => {
    await updateFindingMutation.mutateAsync({
      findingId: id,
      data: { status: "false_positive" },
    })
    queryClient.invalidateQueries({ queryKey: ["run-findings", runId] })
    queryClient.invalidateQueries({ queryKey: ["findings"] })
  }

  const handleCreateTaskForFinding = (finding: QAFinding) => {
    // Merge gallery images from store at the entry point
    const mergedFinding = {
      ...finding,
      gallery_images: Array.from(
        new Set([
          ...(finding.gallery_images || []),
          ...(allGalleryImages[finding.id] || []),
        ]),
      ),
    }
    setPrefillFinding(mergedFinding)
    setIsCreateTaskModalOpen(true)
  }

  const handleBulkConfirm = async (ids: string[]) => {
    const flatIds = ids.flatMap((id) => id.split(","))
    await Promise.all(
      flatIds.map((id) =>
        updateFindingMutation.mutateAsync({
          findingId: id,
          data: { status: "confirmed" },
        }),
      ),
    )
    queryClient.invalidateQueries({ queryKey: ["run-findings", runId] })
  }

  const handleBulkFalsePositive = async (ids: string[]) => {
    const flatIds = ids.flatMap((id) => id.split(","))
    await Promise.all(
      flatIds.map((id) =>
        updateFindingMutation.mutateAsync({
          findingId: id,
          data: { status: "false_positive" },
        }),
      ),
    )
    queryClient.invalidateQueries({ queryKey: ["run-findings", runId] })
  }

  const handleBulkAssign = (ids: string[]) => {
    setAssignTarget({ type: "bulk", ids })
    setIsAssignModalOpen(true)
  }

  const handleSingleAssign = (id: string) => {
    setAssignTarget({ type: "single", ids: [id] })
    setIsAssignModalOpen(true)
  }

  const handleAssignFinding = async (userId: string) => {
    try {
      const allPossibleFindings = [
        ...(findings || []),
        ...(runGeneralFindings || []),
      ]
      const targets = allPossibleFindings.filter((f) =>
        assignTarget.ids.includes(f.id),
      )
      for (const finding of targets) {
        const galleryImages =
          allGalleryImages[finding.id] ||
          allGalleryImages[finding.id.split(",")[0]] ||
          []

        createTask({
          project_id: projectId!,
          finding_id: finding.id.includes(",")
            ? finding.id.split(",")[0]
            : finding.id,
          title: finding.title,
          description:
            (finding.description || "") + (aiResultsMap[finding.id] || ""),

          severity: finding.severity,
          assigned_to: userId,
          gallery_images:
            galleryImages.length > 0 ? galleryImages : finding.gallery_images,
        })
      }
      setIsAssignModalOpen(false)
    } catch (error) {
      toast.error("Failed to assign findings")
    }
  }

  const handleBulkCreateTasks = (selectedFindings: QAFinding[]) => {
    selectedFindings.forEach((finding) => {
      const galleryImages =
        allGalleryImages[finding.id] ||
        allGalleryImages[finding.id.split(",")[0]] ||
        []

      createTask({
        project_id: projectId!,
        finding_id: finding.id.includes(",")
          ? finding.id.split(",")[0]
          : finding.id,
        title: finding.title,
        description:
          (finding.description || "") + (aiResultsMap[finding.id] || ""),
        severity: finding.severity,
        gallery_images:
          galleryImages.length > 0 ? galleryImages : finding.gallery_images,
      })
    })
  }

  const handleAddToStage = async (findingsToStage: QAFinding[]) => {
    try {
      const response = await axios.get(
        `/api/tasks/count/unique?project_id=${projectId}`,
      )
      const baseCount = response.data.count
      const currentStagedCount = stagedFindings.length
      let nextIssueNum = baseCount + currentStagedCount + 1

      const mergedFindings = findingsToStage.map((f) => {
        return {
          ...f,
          description: (f.description || "") + (aiResultsMap[f.id] || ""),
          issue_number: nextIssueNum++,
          title: f.title.replace(/^Issue #\d+:?\s*/, ""),

          gallery_images: Array.from(
            new Set([
              ...(f.gallery_images || []),
              ...(allGalleryImages[f.id] || []),
              ...(allGalleryImages[f.id.split(",")[0]] || []),
            ]),
          ),
        }
      })
      addToStage(mergedFindings as any)
    } catch (error) {
      console.error("Failed to fetch next issue number:", error)
      toast.error("Failed to calculate issue numbers")
    }
  }
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in duration-200">
      {/* Project Navigation Floating Widget */}
      <div className="fixed right-0 top-1/2 -translate-y-1/2 flex flex-col gap-6 bg-slate-50 dark:bg-[#1D2A31] border border-1 border-accent border-r-0 rounded-l-xl p-4 shadow-lg z-50">
        <Link
          to={`/projects/${projectId}?tab=overview`}
          className="text-slate-400 hover:text-accent transition-colors group relative flex items-center"
        >
          <LayoutDashboard size={25} />
          <span className="absolute right-full mr-4 px-2 py-1 bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider rounded opacity-0 translate-x-4 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300 ease-out pointer-events-none whitespace-nowrap z-50">
            Overview
          </span>
        </Link>
        <Link
          to={`/projects/${projectId}?tab=runs`}
          className="text-slate-400 hover:text-accent transition-colors group relative flex items-center"
        >
          <PlayCircle size={25} />
          <span className="absolute right-full mr-4 px-2 py-1 bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider rounded opacity-0 translate-x-4 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300 ease-out pointer-events-none whitespace-nowrap z-50">
            QA Runs
          </span>
        </Link>
        <Link
          to={`/projects/${projectId}?tab=tasks`}
          className="text-slate-400 hover:text-accent transition-colors group relative flex items-center"
        >
          <CheckSquare size={25} />
          <span className="absolute right-full mr-4 px-2 py-1 bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider rounded opacity-0 translate-x-4 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300 ease-out pointer-events-none whitespace-nowrap z-50">
            Tasks
          </span>
        </Link>
        <Link
          to={`/projects/${projectId}?tab=team`}
          className="text-slate-400 hover:text-accent transition-colors group relative flex items-center"
        >
          <Users size={25} />
          <span className="absolute right-full mr-4 px-2 py-1 bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider rounded opacity-0 translate-x-4 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300 ease-out pointer-events-none whitespace-nowrap z-50">
            Team
          </span>
        </Link>
        <Link
          to={`/projects/${projectId}?tab=settings`}
          className="text-slate-400 hover:text-accent transition-colors group relative flex items-center"
        >
          <Settings size={25} />
          <span className="absolute right-full mr-4 px-2 py-1 bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider rounded opacity-0 translate-x-4 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300 ease-out pointer-events-none whitespace-nowrap z-50">
            Settings
          </span>
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              to={`/projects/${projectId}`}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-slate-600" />
            </Link>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-200">
                  {project.name}
                </h1>
                {isLive && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-600 border border-emerald-100 uppercase tracking-tighter">
                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-3 mt-1">
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {run.run_type.replace("_", " ")}
                </span>
                <span className="text-slate-300 dark:text-slate-600">•</span>
                <div className="flex items-center space-x-1.5">
                  {getStatusIcon(displayStatus as any)}
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase">
                    {displayStatus}
                  </span>
                </div>
                {run.created_by_name && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">
                      •
                    </span>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                      <User
                        size={12}
                        className="text-slate-400 dark:text-slate-500"
                      />
                      <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">
                        {run.created_by_name}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {(run.status === "running" ||
              run.status === "pending" ||
              run.status === "paused") && (
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-[#1D2A31] p-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm mr-4">
                {run.status === "running" ? (
                  <button
                    onClick={handlePause}
                    disabled={updateStatus.isPending}
                    className="p-1 hover:bg-amber-50 text-amber-600 rounded transition-colors"
                    title="Pause Scan"
                  >
                    <Pause size={16} fill="currentColor" />
                  </button>
                ) : run.status === "paused" ? (
                  <button
                    onClick={handleResume}
                    disabled={updateStatus.isPending}
                    className="p-1 hover:bg-emerald-50 text-emerald-600 rounded transition-colors"
                    title="Resume Scan"
                  >
                    <Play size={16} fill="currentColor" />
                  </button>
                ) : null}
                <button
                  onClick={handleStop}
                  disabled={updateStatus.isPending}
                  className="p-1 hover:bg-red-50 text-red-600 rounded transition-colors"
                  title="Stop Scan"
                >
                  <Square size={16} fill="currentColor" />
                </button>
              </div>
            )}

            {/* <a
              href={`${import.meta.env.VITE_API_URL || "http://localhost:3001"}/admin/queues`}
              target="_blank"
              rel="noreferrer"
              className="btn-unified flex items-center gap-2"
              title="View BullMQ Dashboard"
            >
              <LayoutDashboard size={14} />
              <span>Queue Dashboard</span>
            </a> */}

            {run.status === "completed" && (
              <button
                onClick={handleCaptureVideo}
                disabled={isRecordingVideo}
                className="btn-unified flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white mr-4"
                title="Record Full Project Video"
              >
                {isRecordingVideo ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Video size={14} />
                )}
              </button>
            )}

            <a
              href={`${import.meta.env.VITE_API_URL || "http://localhost:3001"}/admin/queues`}
              target="_blank"
              rel="noreferrer"
              className="btn-unified flex items-center gap-2"
              title="View BullMQ Dashboard"
            >
              <LayoutDashboard size={14} />
              <span>Queue Dashboard</span>
            </a>

            {run.status === "running" && !isDiscovering && (
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-200 leading-none">
                  {safeDisplayProgress}%
                </p>
                {eta && (
                  <p className="text-xs font-bold text-blue-500 uppercase mt-1 tracking-widest">
                    {eta}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {activeTab === "overview" && (
          <div className="bg-slate-50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <div className="flex justify-between items-end">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  {isDiscovering
                    ? "Phase 1: Sitemap Discovery"
                    : "Phase 2: Scanning Pages"}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {isDiscovering
                    ? "Identifying all target URLs..."
                    : displayStatus === "completed"
                      ? "Scan complete. All pages verified."
                      : `Scanning: ${(run.pages || []).filter((p) => p.status === "processing" || p.status === "screenshotted").length} active | ${pagesProcessed} / ${pagesTotal} total`}
                </p>
              </div>

              <div className="text-right flex items-center gap-4">
                <p className="text-xl font-bold text-slate-900 dark:text-slate-200">
                  {isDiscovering
                    ? "..."
                    : displayStatus === "completed"
                      ? "100%"
                      : `${safeDisplayProgress}%`}
                </p>
              </div>
            </div>

            <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 p-1">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out shadow-sm ${
                  run.status === "failed" ? "bg-red-500" : "bg-accent"
                }`}
                style={{
                  width: isDiscovering
                    ? "40%"
                    : displayStatus === "completed"
                      ? "100%"
                      : `${Math.max(2, displayProgress)}%`,
                }}
              >
                {(run.status === "running" || isDiscovering) && (
                  <div className="w-full h-full opacity-30 bg-[linear-gradient(45deg,rgba(255,255,255,.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.15)_50%,rgba(255,255,255,.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[progress-bar-stripes_1s_linear_infinite]" />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100/50 dark:bg-slate-800/50 rounded-md border border-slate-200 dark:border-slate-700 w-full overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
            activeTab === "overview"
              ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-700"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 border border-transparent"
          }`}
        >
          <BarChart3 size={14} />
          Overview
        </button>
        <button
          onClick={() => setActiveTab("pages")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
            activeTab === "pages"
              ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-700"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 border border-transparent"
          }`}
        >
          <FileSearch size={14} />
          Pages
        </button>
        {findingsLoaded && (
          <>
            <button
              onClick={() => setActiveTab("general")}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
                activeTab === "general"
                  ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-700"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 border border-transparent"
              }`}
            >
              <ClipboardList size={14} />
              General Findings
            </button>
            {pageFindings && pageFindings.length > 0 && (
              <button
                onClick={() => setActiveTab("findings")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
                  activeTab === "findings"
                    ? "bg-slate-50 text-slate-900 shadow-sm border border-slate-200"
                    : "text-slate-500 hover:text-slate-700 border border-transparent"
                }`}
              >
                <Search size={14} />
                Functional Findings
              </button>
            )}
          </>
        )}

        {/* <button
          onClick={() => setActiveTab("visual_diff")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
            activeTab === "visual_diff"
              ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-700"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          }`}
        >
          <Eye size={14} />
          Visual Diff
        </button> */}
        {run.is_woocommerce && (
          <button
            onClick={() => setActiveTab("woocommerce")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
              activeTab === "woocommerce"
                ? "bg-slate-50 text-slate-900 shadow-sm border border-slate-200"
                : "text-slate-500 hover:text-slate-700 border border-transparent"
            }`}
          >
            <ShoppingCart size={14} />
            WooCommerce
          </button>
        )}
        <button
          onClick={() => setActiveTab("report")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
            activeTab === "report"
              ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-700"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 border border-transparent"
          }`}
        >
          <ClipboardList size={14} />
          Report
        </button>
        {(isRecordingVideo ||
          (run as any)?.recording_status === "recording" ||
          (run as any)?.recording_status === "completed" ||
          (run as any)?.recording_video_urls) && (
          <button
            onClick={() => setActiveTab("recordings")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${
              activeTab === "recordings"
                ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-700"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 border border-transparent"
            }`}
          >
            <Video size={14} />
            Recordings
          </button>
        )}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-8 animate-in fade-in duration-200">
          <div className="bg-slate-50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
            <div className="flex justify-between items-end">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-widest flex items-center gap-2">
                  {isApiOnly
                    ? "Executing API Checks"
                    : isDiscovering
                      ? "Phase 1: Sitemap Discovery"
                      : "Phase 2: Scanning Pages"}
                </h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">
                  {isApiOnly
                    ? run?.status === "completed"
                      ? "API checks complete."
                      : "Fetching and verifying data via API integrations..."
                    : isDiscovering
                      ? "Identifying all target URLs..."
                      : run?.status === "completed"
                        ? "Scan complete. All pages verified."
                        : `Scanning: ${(run?.pages || []).filter((p: any) => p.status === "processing" || p.status === "screenshotted").length} active | ${pagesProcessed} / ${pagesTotal} total`}
                </p>
              </div>

              <div className="text-right flex items-center gap-4"></div>
            </div>

            {/* Check-wise Progress Bars */}
            {isDiscovering ? (
              <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 p-1">
                <div className="h-full rounded-full transition-all duration-500 ease-out shadow-sm bg-accent w-[40%]">
                  <div className="w-full h-full opacity-30 bg-[linear-gradient(45deg,rgba(255,255,255,.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.15)_50%,rgba(255,255,255,.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[progress-bar-stripes_1s_linear_infinite]" />
                </div>
              </div>
            ) : (
              <div className="space-y-8 mt-4">
                {(run.enabled_checks || []).map((checkKey) => {
                  const checkNameMap: Record<string, string> = {
                    project_plan: "Project Plan Check",
                    dead_links: "Dead-Link Check",
                    privacy_policy: "Privacy Policy Check",
                    hero_media: "Hero Media Check",
                    paid_media: "Paid Media Check",
                    visual_regression: "Visual Regression Check",
                    accessibility: "Accessibility Check",
                    console_errors: "Console Errors Check",
                    woocommerce: "WooCommerce Check",
                    learn_more_buttons: "Learn More Buttons Check",
                    logo_chatbot: "Logo on Chatbot Check",
                  }
                  const checkName =
                    checkNameMap[checkKey] ||
                    checkKey
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (l) => l.toUpperCase())

                  // Targeted Checks limit progress bars to the main domain
                  let relevantPages = run.pages || []
                  if (
                    checkKey === "project_plan" ||
                    checkKey === "paid_media" ||
                    checkKey === "privacy_policy" ||
                    checkKey === "callnow_links" ||
                    checkKey === "hero_media" ||
                    checkKey === "footer_logo" ||
                    checkKey === "single_script" ||
                    checkKey === "top_bar_sticky" ||
                    checkKey === "favicon" ||
                    checkKey === "contact_form" ||
                    checkKey === "chatbot_consultation" ||
                    checkKey === "text_share" ||
                    checkKey === "verify_plugin_updates" ||
                    checkKey === "social_share_heading" ||
                    checkKey === "logo_chatbot"
                  ) {
                    relevantPages = relevantPages.filter((p) => {
                      const normalize = (u: string) =>
                        u
                          .replace(/^https?:\/\//, "")
                          .replace(/^www\./, "")
                          .replace(/\/$/, "")
                          .toLowerCase()
                      return normalize(p.url) === normalize(run.site_url)
                    })

                    if (
                      relevantPages.length === 0 &&
                      (run.pages || []).length > 0
                    )
                      relevantPages = [run.pages![0]]
                  }

                  return (
                    <details key={checkKey} className="group space-y-2" open>
                      <summary className="text-sm font-mono text-slate-800 dark:text-slate-200 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center outline-none group/summary hover:text-accent transition-colors">
                        <span className="mr-2.5 text-[10px] text-accent transition-all duration-300 -rotate-90 group-open:rotate-0 opacity-70 group-hover/summary:opacity-100 group-hover/summary:translate-x-0.5 animate-pulse group-open:animate-none">
                          ▼
                        </span>
                        <span className="font-semibold">{checkName}</span>
                      </summary>

                      <div className="space-y-3 mt-3">
                        {checkKey === "dead_links" ||
                        checkKey === "learn_more_buttons" ||
                        checkKey === "url_tab_compare"
                          ? (() => {
                              const isRunCompleted =
                                run.status === "completed" ||
                                run.status === "cancelled" ||
                                run.status === "failed"

                              const totalPages = relevantPages.length
                              const completedPages = isRunCompleted
                                ? totalPages
                                : relevantPages.filter(
                                    (p) =>
                                      p.status === "done" ||
                                      p.status === "checked" ||
                                      p.status === "failed",
                                  ).length
                              const deadLinksProgress = (() => {
                                if (totalPages === 0) return 0

                                const hasUrlTabCompare =
                                  run.enabled_checks?.includes(
                                    "url_tab_compare",
                                  )

                                if (hasUrlTabCompare) {
                                  // Safely find the homepage locally
                                  const localHomepage = run.pages?.find(
                                    (p) =>
                                      p.url
                                        .replace(/^https?:\/\//, "")
                                        .replace(/\/$/, "") ===
                                      run.site_url
                                        .replace(/^https?:\/\//, "")
                                        .replace(/\/$/, ""),
                                  )

                                  // Weight normal pages 50%, and homepage crawl 50%
                                  const completedWithoutHomepage =
                                    relevantPages.filter(
                                      (p) =>
                                        (p.status === "done" ||
                                          p.status === "checked" ||
                                          p.status === "failed") &&
                                        p.id !== localHomepage?.id,
                                    ).length

                                  const basePagesToProcess = Math.max(
                                    1,
                                    totalPages - 1,
                                  )
                                  const baseProgress =
                                    (completedWithoutHomepage /
                                      basePagesToProcess) *
                                    50
                                  const homeProgress = localHomepage
                                    ? ((localHomepage.progress || 0) / 100) * 50
                                    : 0

                                  return isRunCompleted
                                    ? 100
                                    : Math.round(baseProgress + homeProgress)
                                }

                                return Math.round(
                                  (completedPages / totalPages) * 100,
                                )
                              })()

                              const activePage =
                                relevantPages.find(
                                  (p) => p.status === "processing",
                                ) ||
                                relevantPages.find(
                                  (p) => p.status === "pending",
                                )

                              const checkFailedPage =
                                checkKey === "url_tab_compare"
                                  ? relevantPages.find(
                                      (p) =>
                                        p.status === "failed" &&
                                        p.url
                                          .replace(/^https?:\/\//, "")
                                          .replace(/\/$/, "") ===
                                          run.site_url
                                            .replace(/^https?:\/\//, "")
                                            .replace(/\/$/, ""),
                                    )
                                  : relevantPages.find(
                                      (p) => p.status === "failed",
                                    )

                              const checkProgress =
                                checkKey === "url_tab_compare"
                                  ? activePage?.progress || 0
                                  : deadLinksProgress

                              // Use the fast loop effect if we are not complete, so it feels realtime
                              const displayUrl = isRunCompleted
                                ? "All pages checked"
                                : relevantPages.length > 0
                                  ? relevantPages[
                                      fakeIndex % relevantPages.length
                                    ].url.replace(/https?:\/\//, "")
                                  : "Preparing..."

                              return (
                                <div className="border border-slate-400 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-[#1D2A31]">
                                  <div className="flex justify-between items-center mb-2 text-xs font-mono text-slate-800 dark:text-slate-200">
                                    <span>
                                      {checkFailedPage &&
                                      (!activePage || isRunCompleted) ? (
                                        <>
                                          <span className="text-red-500 font-bold">
                                            failed:{" "}
                                            {checkFailedPage.url.replace(
                                              /^https?:\/\//,
                                              "",
                                            )}
                                          </span>
                                          <span className="text-red-500 ml-2">
                                            -{" "}
                                            {checkFailedPage.current_step ||
                                              "Unknown error"}
                                          </span>
                                        </>
                                      ) : checkKey === "url_tab_compare" ? (
                                        <>
                                          {isRunCompleted
                                            ? "Finished URL & Tab Name Comparison"
                                            : activePage?.current_step ||
                                              "Preparing..."}
                                        </>
                                      ) : (
                                        <>
                                          {isRunCompleted
                                            ? "All pages checked"
                                            : `scanning: ${displayUrl}`}
                                          {!isRunCompleted &&
                                            activePage?.current_step && (
                                              <span className="text-slate-500 ml-2">
                                                -{" "}
                                                {activePage.current_step.toLowerCase()}
                                              </span>
                                            )}
                                        </>
                                      )}
                                    </span>
                                    <span className="font-bold">
                                      {run.status === "cancelled" ||
                                      run.status === "failed" ||
                                      (isRunCompleted && checkProgress < 100)
                                        ? `${checkProgress}% ${checkProgress < 100 ? "(Failed)" : ""}`
                                        : `${checkProgress}%`}
                                    </span>
                                  </div>
                                  <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 p-1 mb-1">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ease-out shadow-sm ${checkProgress < 100 && (run.status === "completed" || run.status === "failed") ? "bg-red-500" : "bg-accent"}`}
                                      style={{
                                        width: `${checkProgress}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              )
                            })()
                          : relevantPages.map((page) => {
                              const isCompleted =
                                run.status === "completed" ||
                                run.status === "cancelled" ||
                                run.status === "failed" ||
                                (!isApiOnly &&
                                  (page.status === "done" ||
                                    page.status === "checked"))
                              const specificCheck = (page as any)
                                .check_progress?.[checkKey]
                              const pageProgress = isCompleted
                                ? 100
                                : specificCheck?.progress || 0

                              return (
                                <div
                                  key={page.id}
                                  className="border border-slate-400 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-[#1D2A31]"
                                >
                                  <div className="flex justify-between items-center mb-2 text-xs font-mono text-slate-800 dark:text-slate-200">
                                    <span>
                                      scanning:{" "}
                                      {page.url.replace(/https?:\/\//, "")}
                                      {page.status === "failed" ? (
                                        <span className="text-red-500 font-bold ml-2">
                                          - {page.current_step || "Failed"}
                                        </span>
                                      ) : !isCompleted &&
                                        specificCheck?.step ? (
                                        <span className="text-slate-500 ml-2">
                                          - {specificCheck.step.toLowerCase()}
                                        </span>
                                      ) : null}
                                    </span>

                                    <span className="font-bold">
                                      {run.status === "cancelled" ||
                                      run.status === "failed" ||
                                      (isCompleted && pageProgress < 100)
                                        ? `${pageProgress}% ${pageProgress < 100 ? "(Failed)" : ""}`
                                        : `${pageProgress}%`}
                                    </span>
                                  </div>
                                  <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 p-1 mb-1">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ease-out shadow-sm ${pageProgress < 100 && (run.status === "completed" || run.status === "failed") ? "bg-red-500" : "bg-accent"}`}
                                      style={{
                                        width: `${pageProgress}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                      </div>
                    </details>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-slate-50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Total Pages
              </p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-200">
                {pagesTotal}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Processed
              </p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-200">
                {pagesProcessed}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Total Findings
              </p>
              <p className="text-2xl font-bold text-emerald-500">
                {Object.values(run.finding_counts || {}).reduce(
                  (a, b) => a + b,
                  0,
                )}
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-[#1D2A31] p-6 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Status
              </p>
              <div className="flex items-center gap-2">
                {getStatusIcon(run.status)}
                <p className="text-base font-bold text-slate-900 dark:text-slate-200 uppercase tracking-tighter">
                  {run.status}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "pages" && (
        <div className="animate-in fade-in duration-200">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-900">Scan Steps</h2>
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-widest bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-md border border-slate-100 dark:border-slate-700 shadow-sm">
              {pagesProcessed} / {pagesTotal} Completed
            </span>
          </div>
          <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-md border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <PagesTable
              pages={run.pages || []}
              onPageSelect={(page) => {
                setSelectedPageId(page.id)
                setActiveTab("findings")
              }}
              onManualScan={(page) => {
                setSelectedManualPageId(page.id)
                setIsManualScanOpen(true)
              }}
              showVisuals={
                run.enabled_checks?.includes("visual_regression") &&
                !!run.figma_url
              }
            />
          </div>
        </div>
      )}

      {activeTab === "general" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-200">
              General Findings
            </h2>
          </div>

          <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden shadow-sm w-full">
            <div className="bg-slate-50 dark:bg-[#1D2A31] border-b border-slate-200 dark:border-slate-600 p-6 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
              {(() => {
                const total = runGeneralFindings.length
                const confirmed = runGeneralFindings.filter((f) => {
                  const hasTask = f.tasks && f.tasks.length > 0
                  const isAssigned = !!findingToTaskMap[f.id]
                  const isConfirmed = f.status === "confirmed" || hasTask || isAssigned
                  console.log("Finding eval:", { id: f.id, factor: f.check_factor, status: f.status, hasTask, isAssigned, isConfirmed })
                  return isConfirmed
                }).length
                const falsePositives = runGeneralFindings.filter(
                  (f) => f.status === "false_positive",
                ).length
                const open = total - confirmed - falsePositives
                const resolved = confirmed + falsePositives
                const critical = runGeneralFindings.filter(
                  (f) => f.severity === "critical",
                ).length
                const high = runGeneralFindings.filter(
                  (f) => f.severity === "high",
                ).length
                const medium = runGeneralFindings.filter(
                  (f) => f.severity === "medium",
                ).length
                const low = runGeneralFindings.filter(
                  (f) => f.severity === "low",
                ).length
                const resolvedPercentage =
                  total > 0 ? Math.round((resolved / total) * 100) : 0

                const radius = 18
                const stroke = 3
                const normalizedRadius = radius - stroke / 2
                const circumference = normalizedRadius * 2 * Math.PI
                const strokeDashoffset =
                  circumference - (resolvedPercentage / 100) * circumference

                return (
                  <div className="flex flex-wrap items-center gap-8">
                    {/* Progress circle */}
                    <div className="pr-8 border-r border-slate-200 dark:border-slate-700">
                      <div className="relative flex items-center justify-center w-14 h-14">
                        <svg
                          className="w-full h-full transform -rotate-90"
                          viewBox="0 0 36 36"
                        >
                          <circle
                            stroke="#f1f5f9"
                            fill="transparent"
                            strokeWidth={stroke}
                            r={normalizedRadius}
                            cx="18"
                            cy="18"
                            className="dark:stroke-slate-700"
                          />
                          <circle
                            stroke="#86B0A3"
                            fill="transparent"
                            strokeWidth={stroke}
                            strokeDasharray={`${circumference} ${circumference}`}
                            style={{ strokeDashoffset }}
                            strokeLinecap="round"
                            r={normalizedRadius}
                            cx="18"
                            cy="18"
                            className="transition-all duration-1000 ease-out"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-200">
                            {resolvedPercentage}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Audit summary */}
                    <div>
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                        Audit Summary
                      </p>
                      <div className="flex items-center gap-x-3 text-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[18px] text-red-600">
                            {critical}
                          </span>
                          <span className="font-bold text-[13px] Capitalize text-slate-500 dark:text-slate-100">
                            Critical
                          </span>
                        </div>
                        <span className="text-slate-300 dark:text-slate-700">
                          |
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[18px] text-orange-600">
                            {high}
                          </span>
                          <span className="font-bold text-[13px] Capitalize text-slate-500 dark:text-slate-100">
                            High
                          </span>
                        </div>
                        <span className="text-slate-300 dark:text-slate-700">
                          |
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[18px] text-amber-600">
                            {medium}
                          </span>
                          <span className="font-bold text-[13px] Capitalize text-slate-500 dark:text-slate-100">
                            Medium
                          </span>
                        </div>
                        <span className="text-slate-300 dark:text-slate-700">
                          |
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[18px] text-sky-600">
                            {low}
                          </span>
                          <span className="font-bold text-[13px] Capitalize text-slate-500 dark:text-slate-100">
                            Low
                          </span>
                        </div>
                        <span className="font-medium text-[13px] text-slate-400 ml-1">
                          findings found
                        </span>
                      </div>
                    </div>

                    {/* Status overview */}
                    <div className="border-l border-slate-200 dark:border-slate-700 pl-8">
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                        Status Overview
                      </p>
                      <div className="flex items-center gap-x-4 text-sm">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span className="font-bold text-slate-900 dark:text-slate-200">
                            {confirmed}
                          </span>
                          <span className="font-semibold text-slate-500 uppercase">
                            Confirmed
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          <span className="font-bold text-slate-900 dark:text-slate-200">
                            {falsePositives}
                          </span>
                          <span className="font-semibold text-slate-500 uppercase">
                            False Positives
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                          <span className="font-bold text-slate-900 dark:text-slate-200">
                            {open}
                          </span>
                          <span className="font-semibold text-slate-500 uppercase">
                            Open for Review
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>

            <div className="p-8">
              {isLoadingRunFindings ? (
                <div className="py-20 text-center">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-accent" />
                </div>
              ) : runGeneralFindings.length > 0 ? (
                <FindingReviewPanel
                  findings={runGeneralFindings}
                  generalFindings={[]}
                  hideSummary={true}
                  onSingleConfirm={handleConfirmFinding}
                  onSingleFalsePositive={handleFalsePositiveFinding}
                  onSingleCreateTask={(finding) => handleAddToStage([finding])}
                  onConfirmBulk={handleBulkConfirm}
                  onFalsePositiveBulk={handleBulkFalsePositive}
                  onCreateTasksBulk={handleBulkCreateTasks}
                  onAddToStage={handleAddToStage}
                  onAssignBulk={handleBulkAssign}
                  onSingleAssign={handleSingleAssign}
                  findingToTaskMap={findingToTaskMap}
                />
              ) : (
                <div className="py-20 text-center bg-emerald-50/20 rounded-md border border-dashed border-emerald-100">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-4" />
                  <p className="text-slate-900 font-bold uppercase tracking-tight">
                    No General Issues
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-2">
                    All run-level audits passed successfully.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "findings" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <h2 className="text-xl font-bold text-slate-900">
              Findings Details
            </h2>
          </div>

          {selectedPage ? (
            <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden shadow-sm w-full">
              <div className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 p-6 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-200 truncate text-lg">
                    {selectedPage.url}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-1 tracking-widest">
                    {findings?.length || 0} Issues Detected on this page
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab("pages")}
                    className="btn-unified btn-small"
                  >
                    Change Page
                  </button>

                  {selectedPage?.url && (
                    <>
                      <button
                        onClick={handleCaptureScreenshots}
                        disabled={isCapturingScreenshots || isRecordingVideo}
                        className="flex items-center justify-center gap-2 btn-unified btn-small"
                      >
                        {isCapturingScreenshots ? (
                          <Loader2
                            size={14}
                            className="animate-spin text-[#fff]"
                          />
                        ) : (
                          <Camera size={18} className="text-[#fff]-500" />
                        )}
                      </button>

                      {/* <button
                        onClick={handleCaptureVideo}
                        disabled={isRecordingVideo || isCapturingScreenshots}
                        className="flex items-center justify-center gap-2 btn-unified btn-small"
                      >
                        {isRecordingVideo ? (
                          <Loader2
                            size={14}
                            className="animate-spin text-[#fff]"
                          />
                        ) : (
                          <Video size={18} className="text-[#fff]-500" />
                        )}
                      </button> */}
                    </>
                  )}
                </div>
              </div>

              <div className="p-8">
                {/* Findings List */}
                {isLoadingFindings ? (
                  <div className="py-20 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-accent" />
                  </div>
                ) : ((pageFindings && pageFindings.length > 0) ||
                    (generalFindings && generalFindings.length > 0)) &&
                  selectedPage ? (
                  <FindingReviewPanel
                    findings={pageFindings}
                    generalFindings={[]}
                    pageScreenshots={{
                      desktop: selectedPage.screenshot_url_desktop,
                      tablet: selectedPage.screenshot_url_tablet,
                      mobile: selectedPage.screenshot_url_mobile,
                    }}
                    onSingleConfirm={handleConfirmFinding}
                    onSingleFalsePositive={handleFalsePositiveFinding}
                    onSingleCreateTask={(finding) =>
                      handleAddToStage([finding])
                    }
                    onConfirmBulk={handleBulkConfirm}
                    onFalsePositiveBulk={handleBulkFalsePositive}
                    onCreateTasksBulk={handleBulkCreateTasks}
                    onAddToStage={handleAddToStage}
                    onAssignBulk={handleBulkAssign}
                    onSingleAssign={handleSingleAssign}
                    findingToTaskMap={findingToTaskMap}
                  />
                ) : (
                  <div className="py-20 text-center bg-emerald-50/20 rounded-md border border-dashed border-emerald-100">
                    <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-4" />
                    <p className="text-slate-900 font-bold uppercase tracking-tight">
                      Audit Cleared
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-md p-24 text-center">
              <Search className="w-10 h-10 text-slate-200 dark:text-slate-600 mx-auto mb-4" />
              <p className="text-slate-900 dark:text-slate-200 font-bold uppercase tracking-tight">
                Intelligence Ready
              </p>
              <button
                onClick={() => setActiveTab("pages")}
                className="mt-4 text-[10px] font-bold text-accent uppercase tracking-widest hover:text-black transition-colors"
              >
                Select a page to view findings
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "visual_diff" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <h2 className="text-xl font-bold text-slate-900 uppercase tracking-tight">
              Visual Diff Analysis
            </h2>
            {run.status === "completed" && (
              <button
                onClick={async () => {
                  try {
                    await startVisualDiff(axios, runId!)
                    toast.success("Visual diff analysis started")
                  } catch (err) {
                    toast.error("Failed to start visual diff")
                  }
                }}
                className="btn-unified"
              >
                Re-run Analysis
              </button>
            )}
          </div>

          <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden shadow-sm">
            <div className="p-12 text-center max-w-2xl mx-auto">
              <div className="w-8 h-8 bg-[#93C0B1] rounded-full flex items-center justify-center mx-auto mb-6 border border-[#93C0B1]">
                <Eye size={20} className="text-[#fff]" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 uppercase tracking-tight mb-2">
                Compare Design vs. Implementation
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-8">
                The Visual Diff engine uses AI to compare your Figma designs
                against the live site screenshots across desktop, tablet, and
                mobile breakpoints.
              </p>

              <Link
                to={`/projects/${projectId}/runs/${runId}/diff`}
                className="btn-unified inline-flex items-center gap-2 px-4 py-2 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-#93c0b1-800 transition-all shadow-sm active:scale-95"
              >
                Open Diff Workspace
                <ChevronRight size={16} />
              </Link>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 p-6 border-t border-slate-100 dark:border-slate-700 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-50 dark:bg-[#1D2A31] p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Total Frames
                </p>
                <p className="text-xl font-bold text-slate-900">
                  {run.pages_total || 0}
                </p>
              </div>
              <div className="bg-slate-50 dark:bg-[#1D2A31] p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Visual Issues
                </p>
                <p className="text-xl font-bold text-red-600">
                  {runFindings?.filter((f) => f.check_factor === "visual_diff")
                    .length || 0}
                </p>
              </div>
              <div className="bg-slate-50 dark:bg-[#1D2A31] p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Figma Baseline
                </p>
                <p className="text-xs font-bold text-slate-600 truncate max-w-[200px]">
                  {run.figma_url
                    ? run.figma_url.split("/").pop()
                    : "No baseline set"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "woocommerce" && (
        <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded-md p-8 shadow-sm animate-in fade-in duration-200">
          {isLoadingRunFindings ? (
            <div className="py-20 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-accent" />
              <p className="text-[10px] text-slate-400 font-bold uppercase mt-4 tracking-widest">
                Loading commerce reports...
              </p>
            </div>
          ) : (
            <WooCommerceSection findings={runFindings || []} />
          )}
        </div>
      )}

      {activeTab === "report" && (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* Report Header */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 uppercase tracking-tight">
                Executive QA Report
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Summary and official sign-off for Run #{runId?.substring(0, 8)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-900 text-[10px] font-bold uppercase tracking-widest rounded-md hover:bg-slate-200 transition-all border border-slate-200"
                onClick={() => toast.success("PDF Generation started")}
              >
                <Download size={14} />
                Export PDF
              </button>
              {run.status === "completed" && <SignOffButton runId={runId!} />}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Stats & Summary */}
            <div className="lg:col-span-2 space-y-8">
              <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-md border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="p-8 border-b border-slate-50 dark:border-slate-700">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-6">
                    Quality Score
                  </h3>
                  <div className="flex items-end gap-4">
                    <p className="text-6xl font-bold text-slate-900 leading-none">
                      {Math.max(
                        0,
                        100 -
                          Object.values(run.finding_counts || {}).reduce(
                            (a, b) => a + b,
                            0,
                          ) *
                            2,
                      )}
                      %
                    </p>
                    <div className="pb-1">
                      <p className="text-xs font-bold text-emerald-600 uppercase">
                        Healthy
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Based on issue density
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-8 grid grid-cols-2 sm:grid-cols-4 gap-8">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                      Critical
                    </p>
                    <p className="text-2xl font-bold text-red-600">
                      {run.finding_counts?.critical || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                      High
                    </p>
                    <p className="text-2xl font-bold text-orange-500">
                      {run.finding_counts?.high || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                      Medium
                    </p>
                    <p className="text-2xl font-bold text-amber-500">
                      {run.finding_counts?.medium || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                      Low
                    </p>
                    <p className="text-2xl font-bold text-blue-500">
                      {run.finding_counts?.low || 0}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-md border border-slate-200 dark:border-slate-700 shadow-sm p-8">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-6">
                  Finding Categories
                </h3>
                <div className="space-y-4">
                  {[
                    {
                      label: "Visual Consistency",
                      count:
                        runFindings?.filter(
                          (f) => f.check_factor === "visual_diff",
                        ).length || 0,
                      color: "bg-blue-500",
                    },
                    {
                      label: "Performance",
                      count:
                        runFindings?.filter(
                          (f) => f.check_factor === "performance",
                        ).length || 0,
                      color: "bg-emerald-500",
                    },
                    {
                      label: "Accessibility",
                      count:
                        runFindings?.filter(
                          (f) => f.check_factor === "accessibility",
                        ).length || 0,
                      color: "bg-purple-500",
                    },
                    {
                      label: "Console Errors",
                      count:
                        runFindings?.filter(
                          (f) => f.check_factor === "console_error",
                        ).length || 0,
                      color: "bg-red-500",
                    },
                  ].map((cat, i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight">
                        <span className="text-slate-600">{cat.label}</span>
                        <span className="text-slate-900">
                          {cat.count} Issues
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${cat.color} rounded-full`}
                          style={{
                            width: `${Math.min(100, (cat.count / (runFindings?.length || 1)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Run Info & Actions */}
            <div className="space-y-8">
              <div className="bg-slate-900 rounded-md p-8 text-white">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-6">
                  Run Details
                </h3>
                <div className="space-y-6">
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase">
                      Started At
                    </p>
                    <p className="text-sm font-bold mt-1">
                      {run.started_at
                        ? new Date(run.started_at).toLocaleString()
                        : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase">
                      Completed At
                    </p>
                    <p className="text-sm font-bold mt-1">
                      {run.completed_at
                        ? new Date(run.completed_at).toLocaleString()
                        : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase">
                      Run Type
                    </p>
                    <p className="text-sm font-bold mt-1 uppercase">
                      {run.run_type.replace("_", " ")}
                    </p>
                  </div>
                  <div className="pt-4 border-t border-white/10">
                    <button
                      className="w-full py-3 bg-slate-50/10 hover:bg-slate-50/20 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all border border-white/5 flex items-center justify-center gap-2"
                      onClick={() => toast.success("Report shared with team")}
                    >
                      <Send size={14} />
                      Share Report
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "recordings" && (
        <div className="space-y-8 animate-in fade-in duration-200">
          <div className="min-h-[100vh] pt-4">
            <div className="flex items-center gap-4 border-b border-slate-200 dark:border-slate-700 pb-4 mb-6">
              <button
                onClick={() => setRecordingsSubTab("full")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap border ${
                  recordingsSubTab === "full"
                    ? "bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-200 shadow-sm border-slate-300 dark:border-slate-600"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                }`}
              >
                <Video size={14} />
                Full Project Recordings
              </button>
              <button
                onClick={() => setRecordingsSubTab("history")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap border ${
                  recordingsSubTab === "history"
                    ? "bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-200 shadow-sm border-slate-300 dark:border-slate-600"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                }`}
              >
                <Activity size={14} />
                Record Run History
              </button>
            </div>

            {recordingsSubTab === "full" && (
              <>
                {(run as any)?.recording_status === "recording" && (
                  <div className="space-y-4 mb-8 bg-accent/5 dark:bg-transparent p-4 rounded-lg border border-accent/40 dark:border-indigo-800/30">
                    <div className="flex justify-between items-center text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                      <span>Recording in Progress...</span>
                      <span className="bg-indigo-100 dark:bg-indigo-900/50 px-2 py-1 rounded text-[10px] flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                        {formatTime(recordingElapsedSeconds)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      {["desktop", "tablet", "mobile"].map((viewport) => {
                        const progress =
                          (run as any)?.recording_progress?.[viewport] || 0
                        return (
                          <div key={viewport} className="space-y-2">
                            <div className="flex justify-between items-end text-[10px] font-bold uppercase tracking-widest text-indigo-500/80 dark:text-indigo-400/80">
                              <span>{viewport}</span>
                              {progress === -1 ? (
                                <span className="text-red-500 flex items-center gap-1.5">
                                  Incomplete
                                  <button
                                    onClick={() =>
                                      toast.error(
                                        `The ${viewport} recording worker encountered a fatal error or timed out. Please check your GCP logs for exact details.`,
                                      )
                                    }
                                    className="text-[9px] underline text-red-400 hover:text-red-300 cursor-pointer"
                                  >
                                    See why
                                  </button>
                                </span>
                              ) : progress === 0 ? (
                                <span className="text-indigo-400/60 animate-pulse lowercase text-[9px] tracking-normal font-medium">
                                  Waking up cloud worker...
                                </span>
                              ) : (
                                <span>{Math.round(progress)}%</span>
                              )}
                            </div>
                            <div
                              className={`h-1.5 w-full rounded-full overflow-hidden ${
                                progress === -1
                                  ? "bg-red-100 dark:bg-red-950/30"
                                  : "bg-indigo-200/60 dark:bg-indigo-950"
                              }`}
                            >
                              {progress === -1 ? (
                                <div className="h-full bg-red-500 w-full opacity-50" />
                              ) : progress === 0 ? (
                                <div className="h-full bg-indigo-400/30 w-full animate-pulse" />
                              ) : (
                                <div
                                  className="h-full bg-indigo-500 transition-all duration-1000 ease-out relative"
                                  style={{
                                    width: `${Math.round(progress)}%`,
                                  }}
                                >
                                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {Object.keys((run as any)?.recording_video_urls || {}).length >
                  0 && (
                  <div className="flex justify-end mb-4">
                    <button
                      onClick={() => {
                        const urls = (run as any)?.recording_video_urls || {}
                        const entries = Object.entries(urls)
                        if (entries.length > 0) {
                          toast.success("Starting downloads...", {
                            id: "download-videos",
                          })
                          entries.forEach(([viewport, url], index) => {
                            if (typeof url === "string") {
                              setTimeout(() => {
                                const apiUrl =
                                  import.meta.env.VITE_API_URL ||
                                  "http://localhost:3001"
                                const downloadUrl = `${apiUrl}/api/recordings/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(`recording_${viewport}.webm`)}`
                                const iframe = document.createElement("iframe")
                                iframe.style.display = "none"
                                iframe.src = downloadUrl
                                document.body.appendChild(iframe)
                                setTimeout(
                                  () => document.body.removeChild(iframe),
                                  30000,
                                )
                              }, index * 1500)
                            }
                          })
                        }
                      }}
                      className="btn-unified bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 flex items-center gap-2 px-5 py-2 text-sm font-bold shadow-sm rounded-md transition-all"
                    >
                      <Download size={16} />
                      Download All
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {["desktop", "tablet", "mobile"].map((viewport) => {
                    // Get the video URL directly from the run object
                    const videoUrl = (run as any)?.recording_video_urls?.[
                      viewport
                    ]

                    return (
                      <div
                        key={viewport}
                        className="p-6 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 flex flex-col gap-4 items-center justify-center text-center shadow-sm"
                      >
                        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                          <Video size={24} />
                        </div>
                        <h4 className="text-lg font-bold capitalize text-slate-800 dark:text-slate-200">
                          {viewport} View
                        </h4>
                        {videoUrl ? (
                          <div className="inline-flex items-center gap-2 mt-2 px-4 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-100 dark:border-emerald-800/30 text-[11px] font-bold uppercase tracking-wider shadow-sm">
                            <CheckCircle2 size={14} />
                            Recording Successful
                          </div>
                        ) : (
                          <p className="text-sm text-slate-500 mt-2 italic">
                            Recording not available
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {recordingsSubTab === "history" && (
              <div className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden shadow-sm mt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 dark:bg-[#1d2a31] border-b border-slate-100 dark:border-slate-700">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                          Run Date
                        </th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                          Total Time Taken
                        </th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                          Successful
                        </th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                          Run By
                        </th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">
                          Results
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {projectRunsData?.data &&
                      projectRunsData.data.length > 0 ? (
                        [...projectRunsData.data]
                          .sort((a, b) => {
                            const aDate = new Date(
                              (a as any).recording_updated_at || a.created_at,
                            ).getTime()
                            const bDate = new Date(
                              (b as any).recording_updated_at || b.created_at,
                            ).getTime()
                            return bDate - aDate
                          })
                          .map((historyRun) => {
                            const duration =
                              historyRun.started_at && historyRun.completed_at
                                ? Math.floor(
                                    (new Date(
                                      historyRun.completed_at,
                                    ).getTime() -
                                      new Date(
                                        historyRun.started_at,
                                      ).getTime()) /
                                      1000,
                                  )
                                : 0
                            return (
                              <tr
                                key={historyRun.id}
                                className="hover:bg-slate-50 dark:hover:bg-[#1d2a31] group transition-colors"
                              >
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900 dark:text-slate-200 tracking-tight">
                                  {new Date(
                                    (historyRun as any).recording_updated_at ||
                                      historyRun.created_at,
                                  ).toLocaleString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                                  {duration > 0 ? formatTime(duration) : "N/A"}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                      !(historyRun as any).recording_updated_at
                                        ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                                        : historyRun.status === "completed"
                                          ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800"
                                          : historyRun.status === "failed"
                                            ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-800"
                                            : "bg-slate-100 dark:bg-[#131d22] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                                    }`}
                                  >
                                    {!(historyRun as any).recording_updated_at
                                      ? "Incomplete"
                                      : historyRun.status === "completed"
                                        ? "Completed"
                                        : historyRun.status === "failed"
                                          ? "Failed"
                                          : historyRun.status}
                                  </span>
                                </td>
                                <td className="px-6 py-4 capitalize whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                                  <div className="flex items-center gap-1.5">
                                    <User
                                      size={12}
                                      className="text-slate-400"
                                    />
                                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                      {historyRun.created_by_name || "System"}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                  <div className="flex items-center justify-end space-x-3">
                                    {!(historyRun as any)
                                      .recording_updated_at ? (
                                      <span className="text-slate-400 dark:text-slate-500 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1">
                                        No Results
                                      </span>
                                    ) : (
                                      <>
                                        <Link
                                          to={`/projects/${projectId}/runs/${historyRun.id}#recordings`}
                                          className="text-sky-600 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-500 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1 transition-colors"
                                        >
                                          Check Results
                                        </Link>
                                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                      ) : (
                        <tr className="border-b dark:border-slate-700">
                          <td className="px-6 py-12 text-center" colSpan={5}>
                            <div className="flex flex-col items-center">
                              <div className="p-3 bg-slate-100 dark:bg-[#131d22] rounded-full mb-3">
                                <Activity className="w-6 h-6 text-slate-400" />
                              </div>
                              <p className="text-sm font-medium text-slate-900 dark:text-slate-200">
                                No history data available.
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <CreateTaskModal
        isOpen={isCreateTaskModalOpen}
        onClose={() => {
          setIsCreateTaskModalOpen(false)
          setPrefillFinding(null)
        }}
        projectId={projectId}
        prefillData={
          prefillFinding
            ? {
                finding_id: prefillFinding.id.includes(",")
                  ? prefillFinding.id.split(",")[0]
                  : prefillFinding.id,
                title: prefillFinding.title,
                description: prefillFinding.description || "",
                severity: prefillFinding.severity,
                gallery_images: prefillFinding.gallery_images,
              }
            : undefined
        }
      />

      <AssignMemberModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        projectId={projectId!}
        onAssign={handleAssignFinding}
        title={
          assignTarget.type === "bulk"
            ? `Assign ${assignTarget.ids.length} Findings`
            : "Assign Finding"
        }
      />

      <ManualScanOverlay
        run={run}
        isOpen={isManualScanOpen}
        initialPageId={selectedManualPageId}
        onClose={() => {
          setIsManualScanOpen(false)
          setSelectedManualPageId(null)
        }}
      />

      <TaskStagingOverlay projectId={projectId!} />
    </div>
  )
}
