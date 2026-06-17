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
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { FindingSeverityEditor } from "./FindingSeverityEditor"
import { Link, useParams } from "react-router-dom"
import { useGalleryStore } from "../store/galleryStore"

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
  const { id: projectId } = useParams<{ id: string }>()

  const [localTitle, setLocalTitle] = useState(finding.title)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { galleryImages: allGalleryImages, addImage } = useGalleryStore()
  const galleryImages = allGalleryImages[finding.id] || []

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
          {isFalsePositive ? (
            <button
              onClick={() => onConfirm?.(finding.id)}
              className="btn-unified"
            >
              Re-flag as genuine
            </button>
          ) : (
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
                <button
                  onClick={() =>
                    onCreateTask?.({
                      ...finding,
                      title: localTitle,
                      gallery_images: galleryImages,
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
            </>
          )}
        </div>
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
