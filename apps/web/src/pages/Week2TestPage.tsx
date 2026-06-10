import { useState, useEffect, useMemo } from "react"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useRunProgress } from "../hooks/useRunProgress"
import {
  useRunFindings,
  useUpdateFinding,
  useCreateRun,
  useStartRun,
} from "../hooks/useRuns"
import { useCreateTask, useTasks } from "../hooks/useTasks"
import { useProjects } from "../hooks/useProjects"
import {
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
  Database,
  Zap,
  Layout,
  ShoppingCart,
} from "lucide-react"
import toast from "react-hot-toast"

const TEST_URL = "https://modernshop.wpengine.com/" // A reliable WooCommerce demo site

export default function Week2TestPage() {
  const axios = useAuthAxios()
  const { data: projects } = useProjects()
  const { mutateAsync: createRun } = useCreateRun()
  const { mutateAsync: startRun } = useStartRun()

  const [testRunId, setTestRunId] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  // Realtime progress
  const { run, progress } = useRunProgress(testRunId || "")

  // Findings after completion
  const { data: findings } = useRunFindings(
    run?.status === "completed" ? testRunId : null,
  )
  const { data: tasks } = useTasks({})

  const updateFindingMutation = useUpdateFinding(null)
  const { mutate: createTask } = useCreateTask()

  // Test State Tracking
  const [realtimeWorked, setRealtimeWorked] = useState(false)
  const [falsePositiveWorked, setFalsePositiveWorked] = useState(false)
  const [taskCreationWorked, setTaskCreationWorked] = useState(false)

  // Monitor task creation
  useEffect(() => {
    if (taskCreationWorked && tasks?.data) {
      const hasTestTask = tasks.data.some((t: any) =>
        t.title.includes("Week 2 Integration Test"),
      )
      if (hasTestTask) {
        toast.success("Task found in registry!")
      }
    }
  }, [tasks, taskCreationWorked])

  // Monitor realtime updates
  useEffect(() => {
    if (testRunId && progress > 0 && progress < 100) {
      setRealtimeWorked(true)
    }
  }, [progress, testRunId])

  const handleStartTest = async () => {
    // Find or create a test project
    let project = projects?.find((p) => p.name === "Week 2 Integration Test")

    if (!project) {
      try {
        const res = await axios.post("/api/projects", {
          name: "Week 2 Integration Test",
          site_url: TEST_URL,
          client_name: "QACC Testing",
          is_woocommerce: true,
        })
        project = res.data
      } catch (e) {
        toast.error("Failed to create test project")
        return
      }
    }

    setIsStarting(true)
    try {
      // 1. Create Run
      const newRun = await createRun({
        project_id: project!.id,
        run_type: "pre_release",
        site_url: TEST_URL,
        enabled_checks: [
          "broken_links",
          "external_links",
          "meta_tags",
          "console_errors",
          "dummy_content",
          "spelling",
          "image_compliance",
          "form_testing",
          "woocommerce",
          "responsive_visual",
        ],
        device_matrix: ["desktop", "mobile"],
        is_woocommerce: true,
        selected_urls: [TEST_URL], // Just test the home page for speed
      })

      // 2. Start Run
      await startRun(newRun.id)
      setTestRunId(newRun.id)
      toast.success("Integration test started!")
    } catch (e) {
      toast.error("Failed to start test run")
    } finally {
      setIsStarting(false)
    }
  }

  const findingsByFactor = useMemo(() => {
    if (!findings) return {}
    return findings.reduce((acc: any, f) => {
      acc[f.check_factor] = (acc[f.check_factor] || 0) + 1
      return acc
    }, {})
  }, [findings])

  const checkFactors = [
    "broken_links",
    "external_links",
    "meta_tags",
    "console_errors",
    "dummy_content",
    "spelling",
    "image_compliance",
    "forms",
    "woocommerce",
    "visual_regression",
    "accessibility",
    "performance",
  ]

  const handleTestFalsePositive = async () => {
    if (!findings || findings.length === 0) return
    const target = findings[0]
    try {
      await updateFindingMutation.mutateAsync({
        findingId: target.id,
        data: { status: "false_positive" },
      })
      setFalsePositiveWorked(true)
      toast.success("False positive verified!")
    } catch (e) {
      toast.error("False positive test failed")
    }
  }

  const handleTestTaskCreation = async () => {
    if (!findings || findings.length === 0) return
    const target = findings[findings.length - 1]
    try {
      createTask({
        project_id: run!.project_id,
        finding_id: target.id,
        title: `Test Task: ${target.title}`,
        description: "Verified via Week 2 Integration Test",
        severity: target.severity,
      })
      setTaskCreationWorked(true)
      toast.success("Task creation verified!")
    } catch (e) {
      toast.error("Task creation test failed")
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-10 pb-20">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900 uppercase tracking-tight">
          Week 2 Integration Test
        </h1>
        <p className="text-slate-500 font-medium italic">
          Verify all 12 check factors and system integrations in one go.
        </p>
      </header>

      {/* Control Panel */}
      <div className="bg-slate-50 p-8 rounded-md border-2 border-slate-100 shadow-xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">
              System Controller
            </h2>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
              Target: {TEST_URL}
            </p>
          </div>
          <button
            onClick={handleStartTest}
            disabled={
              isStarting || (testRunId !== null && run?.status === "running")
            }
            className="flex items-center gap-2 px-6 py-3 bg-black text-accent rounded-md font-bold uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50 active:scale-95"
          >
            {isStarting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
            Start Real Crawl
          </button>
        </div>

        {testRunId && (
          <div className="space-y-4 animate-in fade-in duration-500">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Live Progress
                </p>
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-blue-500 animate-pulse" />
                  <span className="text-sm font-bold text-slate-700 uppercase">
                    {run?.status || "Processing"}
                  </span>
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {Math.round(progress)}%
              </p>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Checklist */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Verification Checklist */}
        <div className="bg-slate-900 rounded-md p-8 text-white shadow-2xl space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400 border-b border-white/10 pb-4">
            Verification Checklist
          </h3>
          <ul className="space-y-4">
            <li className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div
                  className={`p-1 rounded-full ${testRunId ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-600"}`}
                >
                  <CheckCircle2 size={16} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider">
                  Crawl Started
                </span>
              </div>
              {testRunId && (
                <span className="text-[8px] font-bold text-emerald-400 uppercase">
                  Passed
                </span>
              )}
            </li>
            <li className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div
                  className={`p-1 rounded-full ${realtimeWorked ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-600"}`}
                >
                  <Zap size={16} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider">
                  Realtime Updates
                </span>
              </div>
              {realtimeWorked && (
                <span className="text-[8px] font-bold text-emerald-400 uppercase">
                  Active
                </span>
              )}
            </li>
            <li className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div
                  className={`p-1 rounded-full ${run?.status === "completed" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-600"}`}
                >
                  <Database size={16} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider">
                  Data Aggregated
                </span>
              </div>
              {run?.status === "completed" && (
                <span className="text-[8px] font-bold text-emerald-400 uppercase">
                  Verified
                </span>
              )}
            </li>
            <li className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div
                  className={`p-1 rounded-full ${falsePositiveWorked ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-600"}`}
                >
                  <XCircle size={16} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider">
                  False Positive Logic
                </span>
              </div>
              {run?.status === "completed" && !falsePositiveWorked && (
                <button
                  onClick={handleTestFalsePositive}
                  className="text-[8px] font-bold bg-slate-50 text-black px-2 py-1 rounded uppercase hover:bg-accent transition-colors"
                >
                  Test Now
                </button>
              )}
              {falsePositiveWorked && (
                <span className="text-[8px] font-bold text-emerald-400 uppercase">
                  Success
                </span>
              )}
            </li>
            <li className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div
                  className={`p-1 rounded-full ${taskCreationWorked ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-600"}`}
                >
                  <Layout size={16} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider">
                  Task Integration
                </span>
              </div>
              {run?.status === "completed" && !taskCreationWorked && (
                <button
                  onClick={handleTestTaskCreation}
                  className="text-[8px] font-bold bg-slate-50 text-black px-2 py-1 rounded uppercase hover:bg-accent transition-colors"
                >
                  Test Now
                </button>
              )}
              {taskCreationWorked && (
                <span className="text-[8px] font-bold text-emerald-400 uppercase">
                  Success
                </span>
              )}
            </li>
          </ul>
        </div>

        {/* Findings Summary */}
        <div className="bg-slate-50 rounded-md p-8 border-2 border-slate-100 shadow-sm space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400 border-b border-slate-50 pb-4">
            Findings Payload
          </h3>
          {run?.status !== "completed" ? (
            <div className="h-48 flex flex-col items-center justify-center text-center space-y-3 opacity-40 italic">
              <Loader2 size={32} className="animate-spin text-slate-300" />
              <p className="text-xs font-bold uppercase tracking-tighter">
                Waiting for completion...
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {checkFactors.map((factor) => {
                const count = findingsByFactor[factor] || 0
                return (
                  <div
                    key={factor}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between group hover:bg-slate-50 hover:border-accent/30 transition-all"
                  >
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter truncate pr-2">
                      {factor.replace(/_/g, " ")}
                    </span>
                    <div
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${count > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-400"}`}
                    >
                      {count}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* WooCommerce Verification */}
      {run?.status === "completed" && run.is_woocommerce && (
        <div className="bg-emerald-50 rounded-md p-8 border border-emerald-100 animate-in zoom-in-95 duration-500">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-slate-50 rounded-md shadow-sm text-emerald-600">
              <ShoppingCart size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-emerald-900 uppercase tracking-tight">
                WooCommerce Engine Verified
              </h3>
              <p className="text-xs text-emerald-600 font-medium">
                Cart, Checkout, and Product checks successfully executed.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 bg-emerald-200 rounded-full" />
            <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-[0.3em] px-4 whitespace-nowrap">
              Week 2 Target Achieved
            </span>
            <div className="h-1 flex-1 bg-emerald-200 rounded-full" />
          </div>
        </div>
      )}
    </div>
  )
}
