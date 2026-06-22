import React, { useState } from "react"
import { QAFinding } from "../api/runs.api"
import {
  FileSearch,
  X,
  CheckCircle2,
  AlertCircle,
  Plus,
  CheckSquare,
  Square,
  ClipboardList,
  Eye,
  Unlink2,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useBulkDeleteTasks } from "../hooks/useTasks"
import { useRole } from "../hooks/useRole"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { Link, useParams } from "react-router-dom"
import { useGalleryStore } from "../store/galleryStore"
import { useAuthAxios } from "../lib/useAuthAxios"

interface ContactFormFindingCardProps {
  finding: QAFinding
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

export const ContactFormFindingCard: React.FC<ContactFormFindingCardProps> = ({
  finding,
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
  const { canDo } = useRole()
  const canAction = canDo("qa_engineer")
  const { mutate: bulkDeleteTasks, isPending: isDeleting } =
    useBulkDeleteTasks()
  const queryClient = useQueryClient()
  const { id: projectId } = useParams<{ id: string }>()
  const api = useAuthAxios()

  const [localTitle, setLocalTitle] = useState(finding.title)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const initialIsPushed =
    finding.status === "confirmed" &&
    (!!(finding as any).basecamp_comment_url ||
      !!(finding as any).basecamp_comment_id)
  const [isPushed, setIsPushed] = useState(initialIsPushed)
  const [isDeletingPush, setIsDeletingPush] = useState(false)
  const [commentUrl, setCommentUrl] = useState<string | null>(
    finding.status === "confirmed"
      ? (finding as any).basecamp_comment_url || null
      : null,
  )
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

  const handleDeletePush = async () => {
    setIsDeletingPush(true)
    try {
      await api.delete(`/api/findings/${finding.id}/delete-basecamp-push`)
      setIsPushed(false)
      try {
        await api.patch(`/api/findings/${finding.id}`, {
          basecamp_comment_id: null,
          basecamp_comment_url: null,
          status: "pending",
        })
        if (onConfirm) {
           onConfirm(finding.id)
        }
      } catch (e) {
        console.error("Failed to clear state from DB", e)
      }
      return true
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to delete Basecamp push.")
      return false
    } finally {
      setIsDeletingPush(false)
    }
  }

  const handlePushToBasecamp = async () => {
    setIsPushing(true)
    try {
      const response = await api.post(`/api/findings/${finding.id}/push-basecamp`, {})
      if (response.data?.commentUrl) setCommentUrl(response.data.commentUrl)
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

  let pagesData: { url: string; hasForm: boolean }[] = []
  try {
    pagesData = JSON.parse(finding.context_text || "[]")
  } catch (e) {}

  const screenshots = finding.screenshot_url
    ? finding.screenshot_url.split(",")
    : []

  const hasTask = finding.tasks && finding.tasks.length > 0
  const isConfirmed = finding.status === "confirmed"
  const isFalsePositive = finding.status === "false_positive"
  const isLocked = hasTask || isAssigned || isPushed

  if (!canAction) return null

  const currentAssigneesForUI =
    finding.tasks?.flatMap((t: any) =>
      t.users ? (Array.isArray(t.users) ? t.users : [t.users]) : [],
    ) || []
  const allAssigneesListForUI = [...currentAssigneesForUI, ...assignedUsers]
    .flatMap((u: any) => (Array.isArray(u) ? u : [u]))
    .filter(
      (v, i, a) =>
        a.findIndex((t: any) => {
          const tId = String(t.userId || t.user_id || t.id || "t_" + i)
          const vId = String(v.userId || v.user_id || v.id || "v_" + i)
          if (tId !== "undefined" && vId !== "undefined" && tId === vId)
            return true
          if (t.email && v.email && t.email === v.email) return true
          const tName = (t.full_name || t.name || "").trim().toLowerCase()
          const vName = (v.full_name || v.name || "").trim().toLowerCase()
          if (tName && vName && tName === vName) return true
          return false
        }) === i,
    )

  return (
    <div
      className={`group p-6 bg-slate-200/10 dark:bg-[#1D2A31] rounded-md border transition-all duration-300 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] hover:shadow-md relative overflow-hidden flex flex-col gap-6 ${
        isLocked
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
            <FileSearch size={14} className="text-accent" />
            CONTACT FORM
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

      <div className="space-y-4">
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center text-accent hover:underline text-[10px] font-bold uppercase tracking-widest"
        >
          <FileSearch className="w-3 h-3 mr-2" />
          Show details
        </button>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
          Check the correct logo, Contact number, Address, Email address, and
          Social media links are added in the email notification for desktop,
          mobile, and Tablet view. Everything should match with the website
          details we have.
        </p>

        {screenshots.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            {screenshots.map((url, i) => (
              <div key={i} className="flex flex-col items-center group/img">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full border border-slate-200 dark:border-slate-700 rounded overflow-hidden relative"
                >
                  <img
                    src={url}
                    alt={`Screenshot ${i + 1}`}
                    className="w-full h-auto object-cover hover:opacity-80 transition-opacity"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <span className="text-white text-[10px] font-bold uppercase tracking-widest">
                      View
                    </span>
                  </div>
                </a>
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                  {i === 0
                    ? "Desktop"
                    : i === 1
                      ? "Tablet"
                      : i === 2
                        ? "Mobile"
                        : "Thank You Page"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50 mt-auto">
        <div className="flex items-center gap-2">
          {!(hasTask || isAssigned) && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (isPushed && commentUrl) {
                    window.open(commentUrl, "_blank")
                  } else {
                    handlePushToBasecamp()
                  }
                }}
                disabled={isPushing}
                title={isPushed ? "View in Basecamp" : "Push to Basecamp"}
                className={`btn-unified px-3 flex items-center justify-center transition-all active:scale-95 whitespace-nowrap ${
                  isPushed
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-pointer animate-fade-in"
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

            {isPushed && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeletePush()
                }}
                disabled={isDeletingPush}
                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                title="Delete from Basecamp"
              >
                {isDeletingPush ? (
                  <span className="text-[10px] uppercase font-bold animate-pulse">
                    ...
                  </span>
                ) : (
                  <div className="flex items-center justify-center gap-1 text-slate-600 dark:text-slate-200 hover:text-red-500 dark:hover:text-red-500 transition-colors">
                    <span className="text-[8px] font-semibold">
                      Remove from{""}
                    </span>
                    <span>
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 35 30"
                        fill="currentColor"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                      </svg>
                    </span>
                  </div>
                )}
              </button>
            )}
            </>
          )}
          {isFalsePositive ? (
            <button
              onClick={() => onConfirm?.(finding.id)}
              className="btn-unified"
            >
              Re-flag as genuine
            </button>
          ) : !isPushed ? (
            <>
              {!(hasTask || isAssigned) && (
                <button
                  onClick={() => onFalsePositive?.(finding.id)}
                  className="btn-unified"
                >
                  False Positive
                </button>
              )}
              <div className="flex items-center gap-2">
                {!isPushed && (
                  <button
                    onClick={() => {
                      const missingForms = pagesData.filter((d) => !d.hasForm)
                      const desc =
                        missingForms.length > 0
                          ? `Missing contact forms on the following URLs:\n\n${missingForms.map((d) => `- ${d.url}`).join("\n")}`
                          : finding.description || "All contact forms are present."

                      onCreateTask?.({
                        ...finding,
                        title: localTitle,
                        description: desc,
                        gallery_images: galleryImages,
                      })
                    }}
                    disabled={hasTask || isAssigned}
                    className={`btn-unified ${hasTask || isAssigned ? "bg-accent text-white border-accent cursor-not-allowed" : ""}`}
                  >
                    {hasTask || isAssigned ? "Task Linked" : "Add to Tasks"}
                  </button>
                )}

                {(hasTask || isAssigned) &&
                  (() => {
                    const activeTaskIds =
                      assignedTaskIds && assignedTaskIds.length > 0
                        ? assignedTaskIds
                        : finding.tasks?.map((t: any) => t.id) || []

                    if (
                      activeTaskIds.length === 0 ||
                      activeTaskIds[0] === finding.id
                    )
                      return null

                    return (
                      <div className="ml-1 flex items-center gap-1">
                        <Link
                          to={`/projects/${projectId}?tab=tasks&taskId=${activeTaskIds[0]}`}
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
                            bulkDeleteTasks(activeTaskIds, {
                              onSuccess: () => {
                                queryClient.invalidateQueries()
                              },
                            })
                          }}
                          disabled={isDeleting}
                          className="ml-1 text-slate-400 hover:text-red-500 transition-colors"
                          title="Unlink Task"
                        >
                          <Unlink2 size={16} />
                        </button>
                      </div>
                    )
                  })()}
              </div>
            </>
          ) : null}
        </div>

        {allAssigneesListForUI.length > 0 && (
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-[#131d22] border border-slate-100 dark:border-slate-700 p-1.5 rounded-full pl-3 pr-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">
              Assigned
            </span>
            <div className="flex -space-x-1.5 overflow-hidden">
              {allAssigneesListForUI.map((u, idx) => (
                <div
                  key={u.id || idx}
                  className="w-6 h-6 rounded-full bg-slate-200 dark:bg-[#1d2a31] border-2 border-white dark:border-[#1D2A31] flex items-center justify-center text-[8px] font-bold text-slate-500 dark:text-slate-300 relative group/avatar"
                >
                  {u.avatar_url ? (
                    <img
                      src={u.avatar_url}
                      alt={u.full_name || u.name || ""}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    (u.full_name || u.name)?.[0]?.toUpperCase() || "U"
                  )}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 group-hover/avatar:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    {u.full_name || u.name || "Assigned User"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 dark:bg-[#131d22]/80 backdrop-blur-sm transition-opacity duration-200">
          <div
            className="absolute inset-0 bg-transparent"
            onClick={() => setIsModalOpen(false)}
          />
          <div className="relative w-full max-w-3xl bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md shadow-2xl overflow-hidden transition-all duration-200 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1d2a31] flex-shrink-0">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-accent/10 dark:bg-accent/20 rounded-md text-accent">
                  <FileSearch className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Contact Form Pages
                </h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-0 overflow-y-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-100 dark:bg-[#131d22] sticky top-0 shadow-sm z-10">
                  <tr>
                    <th className="p-4 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700 w-12 text-center">
                      #
                    </th>
                    <th className="p-4 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700">
                      URL
                    </th>
                    <th className="p-4 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700 text-center w-32">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagesData.map((data, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50/50 dark:hover:bg-[#131d22] transition-colors"
                    >
                      <td className="p-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 text-center">
                        {idx + 1}
                      </td>
                      <td className="p-3 text-[11px] font-medium text-slate-800 dark:text-slate-300 break-all">
                        {data.url}
                      </td>
                      <td className="p-1.5 text-center">
                        {data.hasForm ? (
                          <div className="inline-flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-full text-[9px] uppercase tracking-widest font-bold">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Present</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center space-x-1 text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-[#131d22] px-2 py-1 rounded-full text-[9px] uppercase tracking-widest font-bold">
                            <AlertCircle className="w-3 h-3" />
                            <span>Missing</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
