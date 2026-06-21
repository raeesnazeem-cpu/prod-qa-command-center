import React from "react"
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Plus,
  ExternalLink,
  Globe,
  Search,
  FileSearch,
  Layout,
  Eye,
  Monitor,
  Activity,
  User,
  Square,
  CheckSquare,
  ClipboardList,
  Clock,
  MonitorSmartphone,
  Unlink2,
} from "lucide-react"
import { useBulkDeleteTasks } from "../hooks/useTasks"
import { useRole } from "../hooks/useRole"
import { useProject } from "../hooks/useProjects"
import { useParams, Link } from "react-router-dom"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { FindingCardWithScreenshot } from "./FindingCardWithScreenshot"
import { QAFinding } from "../api/runs.api"
import { BrowserOverlay } from "./BrowserOverlay"
import { useGalleryStore } from "../store/galleryStore"
import { useAuthAxios } from "../lib/useAuthAxios"

interface FindingCardProps {
  finding: QAFinding
  pageScreenshots?: {
    desktop?: string | null
    tablet?: string | null
    mobile?: string | null
  }
  onConfirm?: (id: string) => void
  onFalsePositive?: (id: string) => void
  onCreateTask?: (finding: QAFinding) => void
  onAssign?: (id: string) => void
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  assignedTaskIds?: string[]
  assignedUsers?: any[]
  isAssigned?: boolean
}

const CHECK_FACTOR_ICONS: Record<string, React.ReactNode> = {
  broken_links: <Globe size={14} />,
  external_links: <ExternalLink size={14} />,
  meta_tags: <Search size={14} />,
  console_errors: <FileSearch size={14} />,
  dummy_content: <Layout size={14} />,
  visual_regression: <Eye size={14} />,
  accessibility: <Monitor size={14} />,
  performance: <Info size={14} />,
  seo: <Search size={14} />,
  image_compliance: <Monitor size={14} />,
  ai_content_audit: <FileSearch size={14} className="text-accent" />,
  project_plan: <ClipboardList size={14} className="text-accent" />,
  hero_media: <Monitor size={14} className="text-accent" />,
  dead_links: <Globe size={14} className="text-accent" />,
}

export const PrivacyPolicyFindingCard: React.FC<FindingCardProps> = ({
  finding,
  pageScreenshots,
  onConfirm,
  onFalsePositive,
  onCreateTask,
  onAssign,
  isSelected,
  onToggleSelect,
  assignedTaskIds = [],
  assignedUsers = [],
  isAssigned = false,
}) => {
  const api = useAuthAxios()
  const { id: projectId } = useParams<{ id: string }>()
  const { data: project } = useProject(projectId || "")
  const { canDo } = useRole()
  const canAction = canDo("qa_engineer")
  const { mutate: bulkDeleteTasks, isPending: isDeleting } =
    useBulkDeleteTasks()

  const [localTitle, setLocalTitle] = React.useState(finding.title)
  const [isContextModalOpen, setIsContextModalOpen] = React.useState(false)
  const [isBrowserOpen, setIsBrowserOpen] = React.useState(false)
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const isPrivacyPolicy = true
  const isFullWidth = false

  const [isPushing, setIsPushing] = React.useState(false)
  const [isPushed, setIsPushed] = React.useState(finding.status === "confirmed")
  const [isBasecampModalOpen, setIsBasecampModalOpen] = React.useState(false)
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = React.useState(false)
  const [
    isPrivacyPolicyScreenshotVerified,
    setIsPrivacyPolicyScreenshotVerified,
  ] = React.useState(false)
  const [isPageVerified, setIsPageVerified] = React.useState(false)
  const [isContentVerified, setIsContentVerified] = React.useState(false)

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  const [isExpanded, setIsExpanded] = React.useState(false)

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const currentAssignees =
        finding.tasks?.flatMap((t) =>
          (t as any).users ? [(t as any).users] : [],
        ) || []
      const allAssignees = [...currentAssignees, ...assignedUsers]
      const assigneeNames = Array.from(
        new Set(
          allAssignees
            .map((u: any) =>
              `${u.first_name || ""} ${u.last_name || ""}`.trim(),
            )
            .filter(Boolean),
        ),
      ).join(", ")

      const payload = {
        isScreenshotVerified: isPrivacyPolicyScreenshotVerified,
        isPageVerified: isPageVerified,
        isContentVerified,
        hasTask: hasTask || isAssigned,
        assigneeNames,
      }

      const response = await api.post(
        `/api/findings/${finding.id}/push-basecamp`,
        payload,
      )
      setIsPushed(true)

      if (onConfirm) {
        onConfirm(finding.id)
      }
    } catch (err: any) {
      console.error(err)
      const errorMsg =
        err.response?.data?.error ||
        "Failed to push finding to Basecamp. Please verify settings."
      alert(errorMsg)
    } finally {
      setIsPushing(false)
    }
  }

  React.useEffect(() => {
    setLocalTitle(finding.title)
  }, [finding.title])

  const assignees =
    finding.tasks?.flatMap((t) =>
      (t as any).users ? [(t as any).users] : [],
    ) || []

  if (!canAction) return null

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${
        isConfirmed || isAssigned
          ? "border-emerald-500 ring-1 ring-emerald-500/20"
          : isFalsePositive
            ? "opacity-60 border-slate-200 dark:border-slate-800"
            : "border-slate-200 dark:border-slate-800 hover:border-accent/40"
      }`}
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
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
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
          <FindingSeverityEditor
            findingId={finding.id}
            pageId={finding.page_id}
            currentSeverity={finding.severity}
            canEdit={!isFalsePositive}
            symbolOnly={true}
          />
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
            {CHECK_FACTOR_ICONS[finding.check_factor] || (
              <FileSearch size={14} />
            )}
            {finding.check_factor.replace(/_/g, " ")}
          </div>
        </div>
      </div>

      {/* Heading Input */}
      <div className="relative group/input">
        <input
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          className="w-full px-4 py-3.5 bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-600 rounded-md font-bold text-slate-900 dark:text-slate-200 focus:ring-2 focus:ring-accent/30 focus:border-accent/50 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-500"
          placeholder="Input for Heading to be entered by Admin / QA"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover/input:opacity-100 transition-opacity">
          <Plus size={14} className="text-slate-300" />
        </div>
      </div>

      {/* Middle Body Section */}
      <div className="space-y-4">
        {/* Evidence Screenshots below description as small thumbnails side by side */}
        {isPrivacyPolicy && finding.screenshot_url ? (
          <div className="space-y-2 pt-2">
            {isPrivacyPolicy &&
              (isContentVerified ||
                finding.context_text?.includes("Content Match: Yes")) && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-600 border border-emerald-100 uppercase tracking-tighter">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    Content Matches Template
                  </span>
                </div>
              )}
            {isPrivacyPolicy &&
              !isContentVerified &&
              finding.context_text?.includes("Content Match: No") && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 text-[10px] font-bold text-rose-600 border border-rose-100 uppercase tracking-tighter">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></div>
                    Content Mismatch
                  </span>
                  <button
                    onClick={() => setIsPrivacyModalOpen(true)}
                    className="text-[10px] font-bold text-slate-500 underline hover:text-slate-800 transition-colors uppercase"
                  >
                    Show Mismatch
                  </button>
                </div>
              )}

            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              Screenshots
            </p>
            <div className="flex items-center gap-6">
              <div className="flex gap-4">
                {finding.screenshot_url.split(",").map((url, idx) => (
                  <div key={url} className="space-y-1">
                    <div>
                      <FindingCardWithScreenshot
                        finding={{ ...finding, screenshot_url: url }}
                        pageScreenshots={{}}
                        hideTabs={true}
                      />
                    </div>
                    <p className="font-bold text-slate-400 uppercase tracking-widest text-center text-[8px]">
                      {idx === 0 ? "Footer" : "Full Page"}
                    </p>
                  </div>
                ))}
              </div>

              {/* Verification Checkboxes */}
              <div className="flex flex-col gap-3 pl-4 border-l border-slate-100 dark:border-slate-700/50">
                <label className="flex items-center gap-2 group/cb">
                  <input
                    type="checkbox"
                    disabled={isPushed}
                    checked={isPrivacyPolicyScreenshotVerified}
                    onChange={(e) =>
                      setIsPrivacyPolicyScreenshotVerified(e.target.checked)
                    }
                    className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 transition-all"
                  />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer">
                    {isPrivacyPolicyScreenshotVerified
                      ? "Screenshot Verified"
                      : "Verify Screenshot"}
                  </span>
                </label>
                <label className="flex items-center gap-2 group/cb">
                  <input
                    type="checkbox"
                    disabled={isPushed}
                    checked={isPageVerified}
                    onChange={(e) => setIsPageVerified(e.target.checked)}
                    className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 transition-all"
                  />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer">
                    {isPageVerified ? "Page Verified" : "Verify Page"}
                  </span>
                </label>
                {isPrivacyPolicy && (
                  <label className="flex items-center gap-2 group/cb">
                    <input
                      type="checkbox"
                      disabled={isPushed}
                      checked={isContentVerified}
                      onChange={(e) => setIsContentVerified(e.target.checked)}
                      className="w-3 h-3 text-accent border-slate-300 dark:border-slate-600 dark:bg-[#131d22] rounded focus:ring-accent accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 transition-all"
                    />
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest group-hover/cb:text-slate-900 dark:group-hover/cb:text-slate-200 transition-colors cursor-pointer">
                      {isContentVerified
                        ? "Content Verified"
                        : "Verify Content"}
                    </span>
                  </label>
                )}
              </div>
            </div>
          </div>
        ) : (
          (finding.screenshot_url || pageScreenshots?.desktop) && (
            <div className="space-y-2 pt-2">
              <FindingCardWithScreenshot
                finding={finding}
                pageScreenshots={pageScreenshots}
                hideTabs={true}
              />
            </div>
          )
        )}

        <div className="pt-2 flex items-center justify-start gap-3">
          <button
            onClick={() => setIsBrowserOpen(true)}
            className="btn-unified w-fit flex items-center gap-2"
          >
            <MonitorSmartphone
              size={14}
              className="text-white-400 group-hover/btn:text-black transition-colors"
            />
          </button>

          {isPrivacyPolicyScreenshotVerified &&
            isPageVerified &&
            isContentVerified && (
              <button
                onClick={handlePushToBasecamp}
                disabled={
                  isPushing ||
                  isPushed ||
                  (isPrivacyPolicy
                    ? !(
                        isPrivacyPolicyScreenshotVerified &&
                        isPageVerified &&
                        isContentVerified
                      )
                    : !(isPrivacyPolicyScreenshotVerified && isPageVerified))
                }
                title="Push to Basecamp"
                className={`btn-unified px-3 flex items-center justify-center transition-all active:scale-95 ${
                  isPushed
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default animate-fade-in"
                    : !(isPrivacyPolicyScreenshotVerified && isPageVerified)
                      ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60 hover:border-slate-200 hover:text-slate-400"
                      : "bg-[#0b1016] hover:bg-slate-800 text-white"
                }`}
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

          <div className="w-px h-6 bg-slate-200 mx-1"></div>

          <button
            onClick={() => {
              const missingParts = []
              if (!isPrivacyPolicyScreenshotVerified)
                missingParts.push("Privacy Policy Screenshot")
              if (!isPageVerified) missingParts.push("Full Page Screenshot")
              if (isPrivacyPolicy && !isContentVerified)
                missingParts.push("Content")

              const missingText =
                missingParts.length > 0
                  ? `\n\nMissing Verifications: ${missingParts.join(" and ")}`
                  : ""

              let combinedImages = [...galleryImages]
              if (finding.screenshot_url) {
                const existingUrls = finding.screenshot_url
                  .split(",")
                  .map((s: string) => s.trim())
                  .filter(Boolean)
                const urlSet = new Set(combinedImages)
                for (const url of existingUrls) {
                  if (!urlSet.has(url)) {
                    combinedImages.push(url)
                    urlSet.add(url)
                  }
                }
              }

              onCreateTask?.({
                ...finding,
                title: localTitle,
                description: (finding.description || "") + missingText,
                gallery_images: combinedImages,
              })
            }}
            disabled={
              hasTask ||
              isAssigned ||
              (isPrivacyPolicy
                ? isPrivacyPolicyScreenshotVerified &&
                  isPageVerified &&
                  isContentVerified
                : isPrivacyPolicyScreenshotVerified && isPageVerified)
            }
            className={`btn-unified ${
              hasTask ||
              isAssigned ||
              (isPrivacyPolicy
                ? isPrivacyPolicyScreenshotVerified &&
                  isPageVerified &&
                  isContentVerified
                : isPrivacyPolicyScreenshotVerified && isPageVerified)
                ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60 hover:border-slate-200 hover:text-slate-400"
                : ""
            }`}
          >
            {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
          </button>

          {(hasTask || isAssigned) &&
            assignedTaskIds &&
            assignedTaskIds.length > 0 &&
            assignedTaskIds[0] !== finding.id && (
              <div className="ml-1 flex items-center gap-1">
                <Link
                  to={`/projects/${projectId}?tab=tasks&taskId=${assignedTaskIds[0]}`}
                  target="_blank"
                  className="text-slate-400 hover:text-accent transition-colors"
                  title="View Task"
                >
                  <Eye size={14} />
                </Link>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    bulkDeleteTasks(assignedTaskIds)
                  }}
                  disabled={isDeleting}
                  className="ml-1 text-slate-400 hover:text-red-500 transition-colors"
                  title="Unlink Task"
                >
                  <Unlink2 size={16} />
                </button>
              </div>
            )}
        </div>
      </div>

      {/* Privacy Policy Mismatch Modal */}
      {isPrivacyModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsPrivacyModalOpen(false)
          }}
        >
          <div className="bg-slate-50 dark:bg-[#1D2A31] w-full max-w-6xl rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-[#1D2A31]">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-200 text-sm uppercase tracking-widest">
                    Privacy Policy Mismatch
                  </h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">
                    Missing or altered template sections are highlighted in red
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPrivacyModalOpen(false)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-[#1d2a31] rounded-xl transition-all active:scale-90"
              >
                <XCircle size={24} className="text-slate-400" />
              </button>
            </div>
            <div className="p-6 flex gap-6 overflow-hidden min-h-[500px]">
              <div className="flex-1 bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-lg flex flex-col overflow-hidden">
                <div className="bg-slate-100 dark:bg-[#131d22] px-4 py-2 border-b border-slate-200 dark:border-slate-700 font-bold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Expected Template
                </div>
                <div className="p-4 overflow-y-auto space-y-4 text-sm flex-1">
                  {(() => {
                    const template = `[Your Business Name] Privacy Policy

Effective Date: [Current Date]

Our Commitment to Your Privacy

At [Your Business Name], we are dedicated to respecting and protecting your privacy. This Privacy Policy outlines how we collect, use, and safeguard your personal information when you interact with our website, mobile app, or services.

1. Data We Collect. We collect various types of information:

   1.1. Non-Personally-Identifying Information. This includes details such as browser type, language preference, referring site, and the date and time of each visitor request. This information helps us understand how visitors use our website and improve our services.

   1.2. Potentially Personally-Identifying Information. For users who log in or leave comments on our website, we may collect Internet Protocol (IP) addresses.

   1.3. Personally-Identifying Information. When you engage with our services, we may collect personal details such as your name, contact information (email and phone number), and other information relevant to the services you request.

2. How We Use Your Information. Your data is used to:

   2.1. Operate and improve our website and services.

   2.2. Customize your experience with our offerings.

   2.3. Develop new services and products.

   2.4. Communicate with you regarding appointments, promotions, and updates.

   2.5. Process financial transactions.

   2.6. Send you notifications, with your consent.

   2.7. Ensure security and prevent fraudulent activities.

3. Sharing Your Information. We may share your information with:

   3.1. Third-Party Service Providers. These providers support our operations, such as customer support, payment processing, and technical services. These third parties are bound by confidentiality agreements and are only permitted to use your data for the purposes we specify.

   3.2. Legal Authorities. We may disclose your information if required by law or if we believe in good faith that it is necessary to protect the rights, property, or safety of [Your Business Name], our users, or the public.

   3.3. We do not rent or sell your personally-identifying information to third parties for marketing or advertising purposes.

4. Protection of Your Data.

   4.1. We implement a variety of security measures to protect your personal information from unauthorized access, alteration, or destruction. While we strive to use commercially acceptable means to protect your data, please note that no method of transmission over the Internet or electronic storage is 100% secure.

5. Your Data Rights. Depending on your location, you may have the following rights:

   5.1. Access. You can request access to the personal data we hold about you.

   5.2. Correction. You can request that we correct any inaccuracies in your personal data.

   5.3. Deletion. You can request that we delete your personal data, subject to certain legal obligations.

   5.4. Restriction. You can request limitations on how we process your personal data.

   5.5. To exercise any of these rights, please contact us using the information provided below.

6. Cookies

   6.1. We use cookies to enhance your experience on our website. Cookies help us track your preferences and understand how you interact with our site. If you prefer, you can set your browser to refuse cookies, but this may limit your ability to use certain features of our website.

7. Children’s Privacy

   7.1. We do not knowingly collect, solicit data from, or market to children under 18 years of age, nor do we knowingly sell such personal information. By using the Services, you represent that you are at least 18 or that you are the parent or guardian of such a minor and consent to such minor dependent's use of the Services. If we learn that personal information from users less than 18 years of age has been collected, we will deactivate the account and take reasonable measures to promptly delete such data from our records. If you become aware of any data we may have collected from children under age 18, please contact us at <<your email address>>.

8. CCPA (doing business in California)

   8.1. Information We Collect: We collect the following categories of personal information from California residents, depending on how you interact with our services:

      8.1.1. Identifiers: Such as your name, email address, IP address, and other contact information.

      8.1.2. Commercial Information: Such as records of products or services purchased.

      8.1.3. Internet or Other Electronic Network Activity: Such as browsing history, search history, and interactions with our website.

      8.1.4. Geolocation Data: Such as physical location from your device when using our website.

      8.1.5. Professional or Employment-Related Information: Such as job title and company name.

      8.1.6. Inferences: Derived from the information you provide to create a profile or analysis.

9. SMS Communications

   9.1. Use of SMS Communications: We may use your phone number to send SMS messages related to appointments, service updates, and promotional offers, where you have provided your consent to receive such communications.

   9.2. Your Choices and Rights: You may opt out at any time by replying “STOP.” For assistance, reply “HELP” or contact us through our website. SMS consent is not a condition of purchase. Mobile numbers will not be shared with third parties for marketing purposes.

10. Business Transfers

   10.1. In the event that [Your Business Name] or substantially all of its assets are acquired, or if we go out of business or enter bankruptcy, your information may be transferred to or acquired by a third party. You acknowledge that such transfers may occur, and that any acquirer of [Your Business Name] may continue to use your personal information as set forth in this policy.

11. Policy Updates

   11.1. We may update this Privacy Policy from time to time. When changes are made, we will revise the "Effective Date" at the top of this page. We encourage you to review this policy periodically to stay informed about how we are protecting your information.

12. Contact Information

   12.1. If you have any questions or concerns about our Privacy Policy or how your information is handled, please contact us.
   
   12.2. [Address]
   `

                    const actualPolicy =
                      finding.context_text?.split(
                        "===ACTUAL POLICY TEXT===\n",
                      )[1] || ""
                    const normalize = (s: string) =>
                      s.replace(/\s+/g, " ").trim().toLowerCase()
                    const actualNormalized = normalize(actualPolicy)

                    return template.split("\n\n").map((p, i) => {
                      if (!p.trim()) return null
                      const escaped = normalize(p).replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&",
                      )
                      const regexStr = escaped
                        .replace(/\\\[.*?\\\]/g, ".*?")
                        .replace(/<<.*?>>/g, ".*?")
                      let isMatch = false
                      try {
                        isMatch =
                          isContentVerified ||
                          new RegExp(regexStr, "i").test(actualNormalized)
                      } catch (e) {
                        isMatch = isContentVerified
                      }

                      return (
                        <p
                          key={i}
                          className={`whitespace-pre-wrap p-2 rounded transition-colors ${isMatch ? "text-slate-700 dark:text-slate-300" : "bg-rose-100 text-rose-900 font-medium border-l-2 border-rose-400"}`}
                        >
                          {p}
                        </p>
                      )
                    })
                  })()}
                </div>
              </div>
              <div className="flex-1 bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-lg flex flex-col overflow-hidden">
                <div className="bg-slate-100 dark:bg-[#131d22] px-4 py-2 border-b border-slate-200 dark:border-slate-700 font-bold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Actual Website Content
                </div>
                <div className="p-4 overflow-y-auto flex-1 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {finding.context_text?.split(
                    "===ACTUAL POLICY TEXT===\n",
                  )[1] ||
                    "No content fetched. Make sure to run the check again."}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <BrowserOverlay
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        url={
          project?.site_url
            ? project.site_url.endsWith("/")
              ? `${project.site_url}privacy-policy`
              : `${project.site_url}/privacy-policy`
            : finding.pages?.url || ""
        }
        onCapture={(img) => addImage(finding.id, img)}
        galleryCount={galleryImages.length}
        findingId={finding.id}
      />
    </div>
  )
}
