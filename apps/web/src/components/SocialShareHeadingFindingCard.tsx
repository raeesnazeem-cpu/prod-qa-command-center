import React from "react"
import {
  MonitorSmartphone,
  Square,
  CheckSquare,
  Check,
  ClipboardList,
  Eye,
  Sparkles,
  Sparkle,
} from "lucide-react"
import { useParams, Link } from "react-router-dom"
import { useRole } from "../hooks/useRole"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { QAFinding } from "../api/runs.api"
import { useGalleryStore } from "../store/galleryStore"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useAiResultsStore } from "../store/aiResultsStore"

interface FindingCardProps {
  finding: QAFinding
  onConfirm?: (id: string) => void
  onFalsePositive?: (id: string) => void
  onCreateTask?: (finding: QAFinding) => void
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  assignedTaskIds?: string[]
  assignedUsers?: any[]
  isAssigned?: boolean
}

export const SocialShareHeadingFindingCard: React.FC<FindingCardProps> = ({
  finding,
  onConfirm,
  onFalsePositive,
  onCreateTask,
  isSelected,
  onToggleSelect,
  assignedTaskIds = [],
  assignedUsers = [],
  isAssigned = false,
}) => {
  const { id: projectId } = useParams<{ id: string }>()
  const { canDo } = useRole()
  const setAiResult = useAiResultsStore((state) => state.setAiResult)

  const canAction = canDo("qa_engineer")
  const { galleryImages: allGalleryImages } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isManuallyVerified, setIsManuallyVerified] = React.useState(false)

  // AI states
  const [isAiModalOpen, setIsAiModalOpen] = React.useState(false)
  const [isAiLoading, setIsAiLoading] = React.useState(false)
  const [aiResultData, setAiResultData] = React.useState<any>(null)

  const api = useAuthAxios()
  const [isPushing, setIsPushing] = React.useState(false)
  const [isPushed, setIsPushed] = React.useState(finding.status === "confirmed")

  const getAiResultsText = (data: any) => {
    if (!data || data.status === "error") return ""
    const formatStatus = (s?: string) =>
      s === "verified" ? "Verified ✓" : "Not verified ✗"

    let text = "\n\n🤖 AI Verification Results:\n"
    if (data.socialShareHeadings) {
      text += "\nSocial Share Headings:\n"
      text += `- Facebook: ${formatStatus(data.socialShareHeadings.facebook)}\n`
      text += `- Google: ${formatStatus(data.socialShareHeadings.google)}\n`
      text += `- X(Twitter): ${formatStatus(data.socialShareHeadings.twitter)}\n`
      text += `- LinkedIn: ${formatStatus(data.socialShareHeadings.linkedin)}\n`
    }
    if (data.socialShareImages) {
      text += "\nSocial Share Images:\n"
      text += `- Facebook: ${formatStatus(data.socialShareImages.facebook)}\n`
      text += `- Google: ${formatStatus(data.socialShareImages.google)}\n`
      text += `- X(Twitter): ${formatStatus(data.socialShareImages.twitter)}\n`
      text += `- LinkedIn: ${formatStatus(data.socialShareImages.linkedin)}\n`
    }
    if (data.socialMediaTags) {
      text += "\nSocial Media Tags:\n"
      text += `- Facebook: ${formatStatus(data.socialMediaTags.facebook)}\n`
      text += `- Google: ${formatStatus(data.socialMediaTags.google)}\n`
      text += `- X(Twitter): ${formatStatus(data.socialMediaTags.twitter)}\n`
      text += `- LinkedIn: ${formatStatus(data.socialMediaTags.linkedin)}\n`
    }
    return text
  }

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      await api.post(`/api/findings/${finding.id}/push-basecamp`, {
        aiResultsText: getAiResultsText(aiResultData),
      })

      setIsPushed(true)
      if (onConfirm) onConfirm(finding.id)
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to push finding to Basecamp.")
    } finally {
      setIsPushing(false)
    }
  }
  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"

  const cardBorder =
    isConfirmed || isAssigned
      ? "border-emerald-500 ring-1 ring-emerald-500/20"
      : isFalsePositive
        ? "opacity-60 border-slate-200 dark:border-slate-800"
        : "border-slate-200 dark:border-slate-800 hover:border-accent/40"

  const screenshotUrls = finding.screenshot_url
    ? finding.screenshot_url
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean)
    : []

  const handleRunAiCheck = async () => {
    setIsAiModalOpen(true)
    if (aiResultData) return
    setIsAiLoading(true)

    try {
      const response = await api.post("/api/runs/verify-social-share-ai", {
        screenshotUrls: screenshotUrls,
      })
      setAiResultData(response.data)
      setAiResult(finding.id, getAiResultsText(response.data))
    } catch (error) {
      console.error("AI check failed:", error)
      setAiResultData({
        status: "error",
        message: "Failed to connect to AI server. Please try again.",
      })
    } finally {
      setIsAiLoading(false)
    }
  }

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${cardBorder}`}
    >
      <div
        className="hidden dark:block absolute inset-0 rounded-md pointer-events-none p-[1px] drop-shadow-sm opacity-50 group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
        style={{
          WebkitMask:
            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white via-accent/30 to-white/30 group-hover:opacity-50 transition-opacity duration-700" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300%] aspect-square bg-[conic-gradient(from_0deg,transparent_0_45deg,theme(colors.accent)_135deg,transparent_180deg_225deg,#a3d4c7_315deg,transparent_360deg)] opacity-0 group-hover:opacity-100 group-hover:animate-[spin_4s_linear_infinite]" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {canAction && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelect?.(finding.id)
              }}
              className={`p-1 rounded transition-all ${isSelected ? "text-black scale-110" : "text-slate-300 hover:text-slate-400"}`}
            >
              {isSelected ? (
                <div className="flex items-center h-5 mr-3">
                  <input
                    type="checkbox"
                    name="enabled_checks"
                    className="w-4 h-4 text-accent border-slate-300 rounded focus:ring-accent accent-accent"
                    value="accessibility"
                    autoComplete="new-password"
                    data-form-type="other"
                    checked
                    readOnly
                  />
                </div>
              ) : (
                <Square size={20} strokeWidth={2} />
              )}
            </button>
          )}
          <FindingSeverityEditor
            findingId={finding.id}
            pageId={finding.page_id}
            currentSeverity={finding.severity}
            canEdit={canAction && !isFalsePositive}
            symbolOnly={true}
          />
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
            <MonitorSmartphone size={14} className="text-accent" />
            Social Share Heading Check
          </div>
        </div>
      </div>

      {canAction && (
        <div className="relative group/input">
          <input
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            className="w-full px-4 py-3.5 bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-600 rounded-md font-bold text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500"
            placeholder="Social Share Heading Check Title"
          />
        </div>
      )}

      <div className="space-y-3">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed break-words">
          {finding.description}
        </p>
      </div>

      {screenshotUrls.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-start justify-between w-full">
            <div className="w-[50%] flex">
              {screenshotUrls.slice(0, 4).map((url, idx) => (
                <div key={url} className="space-y-1 w-1/16 gap-1 flex-shrink-0">
                  <div className="w-full">
                    <FindingCardWithScreenshot
                      finding={{ ...finding, screenshot_url: url }}
                      pageScreenshots={{}}
                      hideTabs={true}
                    />
                  </div>
                  <p
                    className="font-bold text-slate-400 uppercase tracking-widest text-center text-[8px] truncate px-1"
                    title={
                      idx === 0
                        ? "Facebook"
                        : idx === 1
                          ? "X"
                          : idx === 2
                            ? "LinkedIn"
                            : "Meta Tags"
                    }
                  >
                    {idx === 0
                      ? "Facebook"
                      : idx === 1
                        ? "X"
                        : idx === 2
                          ? "LinkedIn"
                          : "Meta Tags"}
                  </p>
                </div>
              ))}
            </div>

            <div className="w-[25%] flex flex-col gap-2 pl-4 border-l border-slate-100 dark:border-slate-700/50 ml-5">
              <label className="flex items-center gap-2 group/cb">
                <input
                  type="checkbox"
                  checked={isManuallyVerified}
                  onChange={(e) => setIsManuallyVerified(e.target.checked)}
                  className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer transition-all"
                />
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer truncate">
                  {isManuallyVerified ? "Title Verified" : "Verify Title"}
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {canAction && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-auto">
          <div className="flex items-center gap-2">
            {isFalsePositive ? (
              <button
                onClick={() => onConfirm?.(finding.id)}
                className="btn-unified"
              >
                Re-flag as genuine
              </button>
            ) : (
              <>
                {isManuallyVerified && (
                  <button
                    onClick={handlePushToBasecamp}
                    disabled={isPushing || isPushed}
                    className={`btn-unified px-3 flex items-center justify-center transition-all active:scale-95 ${isPushed ? "bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default" : "bg-[#0b1016] hover:bg-slate-800 text-white"}`}
                  >
                    {isPushing ? (
                      <span className="text-[11px] font-bold px-1">...</span>
                    ) : isPushed ? (
                      <>
                        <span className="text-slate">Success </span>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 35 30"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                          className="pl-1"
                        >
                          <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                        </svg>
                      </>
                    ) : (
                      <>
                        <span className="text-white">Push to </span>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 35 30"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                          className="pl-1"
                        >
                          <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                        </svg>
                      </>
                    )}
                  </button>
                )}
                {!isManuallyVerified && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        onCreateTask?.({
                          ...finding,
                          title: localTitle,
                          description: finding.description,
                          gallery_images: Array.from(
                            new Set([...galleryImages, ...screenshotUrls]),
                          ),
                        })
                      }
                      disabled={hasTask || isAssigned}
                      className={`btn-unified ${hasTask || isAssigned ? "bg-accent text-white cursor-not-allowed" : ""}`}
                    >
                      {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
                    </button>

                    {(hasTask || isAssigned) &&
                      assignedTaskIds &&
                      assignedTaskIds.length > 0 &&
                      assignedTaskIds[0] !== finding.id && (
                        <Link
                          to={`/projects/${projectId}?tab=tasks&taskId=${assignedTaskIds[0]}`}
                          target="_blank"
                          className="p-2 text-slate-400 hover:text-accent transition-colors"
                          title="View Task"
                        >
                          <Eye size={16} />
                        </Link>
                      )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!aiResultData && (
              <button
                onClick={handleRunAiCheck}
                title="Run AI Check on Social Share Screenshots"
                className="p-1.5 rounded-md bg-transparent text-white hover:text-blue-500 transition-all flex items-center justify-center shadow-sm"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-sparkles"
                >
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>
                  <path d="M5 3v4"></path>
                  <path d="M19 17v4"></path>
                  <path d="M3 5h4"></path>
                  <path d="M17 19h4"></path>
                </svg>
              </button>
            )}

            {aiResultData && (
              <button
                onClick={() => setIsAiModalOpen(true)}
                className="text-xs font-semibold text-sky-400 hover:text-sky-500 tracking-wide"
              >
                <span className="flex items-center gap-1">
                  <Sparkle size={14} />
                  <span>AI RESULTS</span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* AI Smart Results Modal */}
      {isAiModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAiModalOpen(false)
          }}
        >
          <div className="bg-slate-50 dark:bg-[#1D2A31] w-full max-w-xl rounded-md shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-widest flex items-center gap-2">
                <Sparkles size={16} className="text-purple-500" /> AI Social
                Share Verification
              </h3>
              <button
                onClick={() => setIsAiModalOpen(false)}
                className="text-[10px] font-bold px-3 py-1.5 text-slate-500 uppercase bg-white border rounded"
              >
                Close
              </button>
            </div>
            <div className="p-6">
              {isAiLoading ? (
                <div className="flex flex-col items-center py-12 space-y-4">
                  <Sparkles
                    size={32}
                    className="text-purple-500 animate-pulse"
                  />
                  <p className="text-sm text-slate-500">
                    AI is reviewing the screenshots...
                  </p>
                </div>
              ) : (
                aiResultData && (
                  <div className="space-y-6">
                    {aiResultData.status === "error" ? (
                      <div className="bg-red-50 p-4 rounded border border-red-100">
                        <p className="text-sm font-bold text-red-600">
                          {aiResultData.message}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded border border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">
                            Social share headings
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <p className="text-slate-600 dark:text-slate-400">
                              Facebook:{" "}
                              <span
                                className={
                                  aiResultData.socialShareHeadings?.facebook ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareHeadings?.facebook ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              google:{" "}
                              <span
                                className={
                                  aiResultData.socialShareHeadings?.google ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareHeadings?.google ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              X(Twitter):{" "}
                              <span
                                className={
                                  aiResultData.socialShareHeadings?.twitter ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareHeadings?.twitter ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              Linkedin:{" "}
                              <span
                                className={
                                  aiResultData.socialShareHeadings?.linkedin ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareHeadings?.linkedin ||
                                  "not verified"}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded border border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">
                            Social share Images
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <p className="text-slate-600 dark:text-slate-400">
                              Facebook:{" "}
                              <span
                                className={
                                  aiResultData.socialShareImages?.facebook ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareImages?.facebook ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              google:{" "}
                              <span
                                className={
                                  aiResultData.socialShareImages?.google ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareImages?.google ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              X(Twitter):{" "}
                              <span
                                className={
                                  aiResultData.socialShareImages?.twitter ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareImages?.twitter ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              Linkedin:{" "}
                              <span
                                className={
                                  aiResultData.socialShareImages?.linkedin ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialShareImages?.linkedin ||
                                  "not verified"}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded border border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">
                            Social media tags in page source
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <p className="text-slate-600 dark:text-slate-400">
                              Facebook:{" "}
                              <span
                                className={
                                  aiResultData.socialMediaTags?.facebook ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialMediaTags?.facebook ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              google:{" "}
                              <span
                                className={
                                  aiResultData.socialMediaTags?.google ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialMediaTags?.google ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              X(Twitter):{" "}
                              <span
                                className={
                                  aiResultData.socialMediaTags?.twitter ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialMediaTags?.twitter ||
                                  "not verified"}
                              </span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                              Linkedin:{" "}
                              <span
                                className={
                                  aiResultData.socialMediaTags?.linkedin ===
                                  "verified"
                                    ? "text-emerald-600 font-semibold"
                                    : "text-red-600 font-semibold"
                                }
                              >
                                {aiResultData.socialMediaTags?.linkedin ||
                                  "not verified"}
                              </span>
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
