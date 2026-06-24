import { useState } from "react"
import { ChevronDown, ChevronRight, ExternalLink, CheckCircle2, XCircle, Hourglass, RefreshCw } from "lucide-react"

// Same check labels mapping as RunDetailPage.tsx
const CHECK_LABELS: Record<string, string> = {
  visual_regression: "Visual Check",
  accessibility: "Accessibility Check",
  console_errors: "Console Errors",
  performance: "Performance Check",
  seo: "SEO Check",
  spelling: "Spelling Check",
  broken_links: "Broken Links",
  dummy_content: "Dummy Content Check",
  image_compliance: "Image Compliance Check",
  ai_content_audit: "AI Content Audit",
  hero_media: "Hero Media Check",
  dead_links: "Dead-Link Check",
  project_plan: "Project Plan Check",
  paid_media: "Paid Media Check",
  privacy_policy: "Privacy Policy Check",
  callnow_links: "Callnow Links",
  footer_logo: "Footer Logo",
  single_script: "Single Script",
  url_tab_compare: "Url Tab Compare",
  top_bar_sticky: "Top Bar Sticky",
  favicon: "Favicon",
  contact_form: "Contact Form",
  chatbot_consultation: "Chatbot Consultation",
  text_share: "Text Share",
  verify_plugin_updates: "Plugin Updates Verification",
  social_share_heading: "Social Share Heading",
  logo_chatbot: "Logo on Chatbot Check",
}

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

type CheckStatus = "complete" | "failed" | "stuck" | "processing"

interface CheckHealthPanelProps {
  run: any
  displayStatus?: string
  onCheckClick: (checkKey: string) => void
}

export const CheckHealthPanel = ({
  run,
  displayStatus,
  onCheckClick,
}: CheckHealthPanelProps) => {
  const [expanded, setExpanded] = useState(
    run.status === "failed" ||
      displayStatus === "partial" ||
      run.status === "paused",
  )

  const normalizeUrl = (u: string) =>
    u.replace(/^https?:\/\//, "").replace(/\/$/, "")

  const isHomepage = (pageUrl: string) =>
    normalizeUrl(pageUrl) === normalizeUrl(run.site_url)

  const getCheckStatusForPage = (checkKey: string, page: any): CheckStatus => {
    const isSinglePageCheck = SINGLE_PAGE_CHECKS.includes(checkKey)
    if (isSinglePageCheck && !isHomepage(page.url)) {
      return "complete" // Doesn't apply, so it's not failing
    }

    const checkProg = page.check_progress?.[checkKey]

    if (checkProg?.status === "processing" || checkProg?.status === "pending") return "processing"
    if (checkProg?.status === "failed") return "failed"
    if (checkProg?.status === "done") return "complete"

    const isDone =
      checkProg?.progress === 100 ||
      page.status === "done" ||
      page.status === "checked"

    if (isDone) return "complete"

    const runIsFinished = ["completed", "failed", "paused"].includes(run.status)

    if (runIsFinished) {
      if (page.status === "failed") return "failed"
      return "stuck"
    }

    return "processing"
  }

  const checkSummaries = (run.enabled_checks || []).map((checkKey: string) => {
    let done = 0
    let failed = 0
    let stuck = 0
    let processing = 0
    let applicablePages = 0

    const isSinglePageCheck = SINGLE_PAGE_CHECKS.includes(checkKey)

    for (const page of run.pages || []) {
      if (isSinglePageCheck && !isHomepage(page.url)) continue
      applicablePages++

      const status = getCheckStatusForPage(checkKey, page)
      if (status === "complete") done++
      if (status === "failed") failed++
      if (status === "stuck") stuck++
      if (status === "processing") processing++
    }

    let overallStatus: CheckStatus = "complete"
    if (failed > 0) overallStatus = "failed"
    else if (stuck > 0) overallStatus = "stuck"
    else if (processing > 0) overallStatus = "processing"

    return {
      checkKey,
      label: CHECK_LABELS[checkKey] || checkKey,
      applicablePages,
      done,
      failed,
      stuck,
      processing,
      overallStatus,
    }
  })

  // Sort: Failed -> Stuck -> Processing -> Complete
  checkSummaries.sort((a: any, b: any) => {
    const rank = { failed: 0, stuck: 1, processing: 2, complete: 3 }
    if (
      rank[a.overallStatus as keyof typeof rank] !==
      rank[b.overallStatus as keyof typeof rank]
    ) {
      return (
        rank[a.overallStatus as keyof typeof rank] -
        rank[b.overallStatus as keyof typeof rank]
      )
    }
    return a.label.localeCompare(b.label)
  })

  return (
    <div className="bg-slate-50 dark:bg-[#1D2A31] rounded-md border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500 mt-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-[#131D22]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-400" />
          )}
          <h3 className="font-semibold text-slate-900 dark:text-slate-200 Captalize">
            Check Health Summary
          </h3>
        </div>
        <div className="text-xs font-bold text-slate-500 bg-white dark:bg-[#131D22] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">
          {
            checkSummaries.filter((s: any) => s.overallStatus !== "complete")
              .length
          }{" "}
          issues
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-100 dark:bg-[#131D22]">
                <tr>
                  <th className="px-6 py-3">Check Name</th>
                  <th className="px-6 py-3 text-center">Pages</th>
                  <th className="px-6 py-3 text-center">Done</th>
                  <th className="px-6 py-3 text-center">Failed (Crashed)</th>
                  <th className="px-6 py-3 text-center">Stuck / Timeout</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {checkSummaries.map((summary: any) => (
                  <tr
                    key={summary.checkKey}
                    className="hover:bg-slate-100/50 dark:hover:bg-[#131D22]/30 transition-colors group"
                  >
                    <td className="px-6 py-3 font-medium text-slate-900 dark:text-slate-200 flex items-center gap-2">
                      {summary.overallStatus === "complete" && (
                        <span title="Complete"><CheckCircle2 className="w-4 h-4 text-emerald-500" /></span>
                      )}
                      {summary.overallStatus === "failed" && (
                        <span title="Failed"><XCircle className="w-4 h-4 text-red-500" /></span>
                      )}
                      {summary.overallStatus === "stuck" && (
                        <span title="Stuck"><Hourglass className="w-4 h-4 text-amber-500" /></span>
                      )}
                      {summary.overallStatus === "processing" && (
                        <span title="Processing"><RefreshCw className="w-4 h-4 text-blue-500 animate-spin" /></span>
                      )}
                      {summary.label}
                    </td>
                    <td className="px-6 py-3 text-center text-slate-500">
                      {summary.applicablePages}
                    </td>
                    <td className="px-6 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        {summary.done}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-center">
                      <span
                        className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
                          summary.failed > 0
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {summary.failed}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-center">
                      <span
                        className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
                          summary.stuck > 0
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {summary.stuck}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      {summary.overallStatus !== "complete" && (
                        <button
                          onClick={() => onCheckClick(summary.checkKey)}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-accent hover:text-accent/80 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>View Failing Pages</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
