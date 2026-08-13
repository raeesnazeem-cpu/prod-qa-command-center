import React, { useState } from "react"
import {
  CheckCircle2,
  X,
  Loader2,
  ClipboardList,
  ChevronDown,
  Bell,
} from "lucide-react"
import { useProject, useTransitionReleaseState } from "../hooks/useProjects"
import { CanDo } from "./CanDo"
import { useSignOff, useRevokeSignOff } from "../hooks/useRuns"

interface SignOffButtonProps {
  runId: string
  projectId?: string
  label?: string
  isSignedOff?: boolean
  signOffDetails?: any
  onSuccess?: () => void
}

export const SignOffButton: React.FC<SignOffButtonProps> = ({
  runId,
  projectId,
  label,
  isSignedOff,
  signOffDetails,
  onSuccess,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>([])
  const { mutate: signOff, isPending: isSigningOff } = useSignOff()
  const { mutate: revokeSignOff, isPending: isRevoking } = useRevokeSignOff()
  const isPending = isSigningOff || isRevoking
  const { data: project } = useProject(projectId || "")

  const handleSignOff = () => {
    signOff(
      { runId, notes, notifyUserIds },
      {
        onSuccess: () => {
          setIsOpen(false)
          setNotes("")
          setNotifyUserIds([])
          onSuccess?.()
        },
      },
    )
  }

  const handleRevoke = () => {
    revokeSignOff(
      { runId },
      {
        onSuccess: () => {
          onSuccess?.()
        },
      },
    )
  }

  const { mutate: transitionReleaseState, isPending: isTransitioning } = useTransitionReleaseState(projectId || "")
  const [showPreReleaseWarning, setShowPreReleaseWarning] = useState(false)

  if (isSignedOff) {
    return (
      <CanDo role="project_manager">
        <div className="flex items-center space-x-2">
          {project && (
            <div className="flex items-center space-x-2 bg-slate-100 dark:bg-slate-800/50 rounded-md p-1 border border-slate-200 dark:border-slate-700 mr-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 pl-2">
                State:
              </span>
              <button
                onClick={() => {
                  if (project.is_pre_release) {
                    // Switch to post-release directly
                    transitionReleaseState(false)
                  } else {
                    // Show warning before switching to pre-release
                    setShowPreReleaseWarning(true)
                  }
                }}
                disabled={isTransitioning}
                className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded transition-all ${
                  project.is_pre_release
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                }`}
              >
                {isTransitioning ? (
                  <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                ) : null}
                {project.is_internal_qa
                  ? "Internal QA"
                  : project.is_pre_release
                    ? "Pre-Release"
                    : "Post-Release"}
              </button>
            </div>
          )}

          {signOffDetails?.basecamp_url && (
            <a
              href={signOffDetails.basecamp_url}
              target="_blank"
              rel="noreferrer"
              className="btn flex items-center space-x-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 border border-blue-200 dark:border-blue-500/20"
            >
              <span>View in Basecamp</span>
            </a>
          )}
          <button
            onClick={handleRevoke}
            disabled={isPending}
            className="btn flex items-center space-x-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/20"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4 ml-1" />
            )}
            <span className="text-[12px] py-1.5 pr-2">Revoke Sign-off</span>
          </button>
        </div>

        {/* Warning Modal for Pre-Release Toggle */}
        {showPreReleaseWarning && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200">
            <div
              className="absolute inset-0 bg-transparent"
              onClick={() => !isTransitioning && setShowPreReleaseWarning(false)}
            />
            <div className="relative w-full max-w-md bg-slate-50 dark:bg-[#131d22] border border-amber-200 dark:border-amber-900/50 rounded-lg shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-amber-50/50 dark:bg-amber-900/10">
                <div className="flex items-center space-x-2 text-amber-600">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Warning: Switch to Pre-Release
                  </h2>
                </div>
                <button
                  onClick={() => setShowPreReleaseWarning(false)}
                  disabled={isTransitioning}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  Are you sure you want to switch the project state to Pre-Release? 
                  <strong> All unpinned QA runs in this project's pre-release state will be permanently deleted.</strong>
                </p>
                <div className="flex space-x-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowPreReleaseWarning(false)}
                    disabled={isTransitioning}
                    className="btn-unified-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      transitionReleaseState(true, {
                        onSuccess: () => setShowPreReleaseWarning(false)
                      });
                    }}
                    disabled={isTransitioning}
                    className="flex-[2] flex items-center justify-center space-x-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded transition-all disabled:opacity-50"
                  >
                    {isTransitioning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <span>Confirm & Switch</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CanDo>
    )
  }

  return (
    <>
      <CanDo role="project_manager">
        <button
          onClick={() => setIsOpen(true)}
          className="btn-unified flex items-center space-x-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{label || "Sign Off Run"}</span>
        </button>
      </CanDo>

      {/* Confirmation Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200">
          <div
            className="absolute inset-0 bg-transparent"
            onClick={() => !isPending && setIsOpen(false)}
          />

          <div className="relative w-full max-w-md bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#1d2a31]">
              <div className="flex items-center space-x-2 text-emerald-600">
                <CheckCircle2 className="w-5 h-5" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Sign Off QA Run
                </h2>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                disabled={isPending}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 p-4 rounded-md">
                <p className="text-sm text-emerald-800 dark:text-emerald-300/90 font-medium leading-relaxed">
                  By signing off, you confirm that this QA run has been reviewed
                  and meets the release standards. This action will be recorded.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center">
                  <ClipboardList className="w-4 h-4 mr-2 text-slate-400" />
                  Sign-off Notes{" "}
                  <span className="text-slate-400 text-[10px] uppercase ml-1">
                    (Optional)
                  </span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any final comments or context..."
                  className="w-full h-32 bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md p-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none hover:border-accent focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all resize-none"
                  disabled={isPending}
                />
              </div>

              {/* Notify Users Section */}
              <div className="space-y-2 pt-2">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center">
                  <Bell className="w-4 h-4 mr-2 text-slate-400" />
                  Notify in Basecamp
                </label>
                <div className="flex flex-wrap gap-2 items-center min-h-[40px] p-2 bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-md">
                  {notifyUserIds.map((userId) => {
                    const member = project?.project_members.find(
                      (m: any) => m.user_id === userId,
                    )
                    if (!member) return null
                    return (
                      <div
                        key={userId}
                        className="flex items-center bg-white dark:bg-[#131d22] border border-slate-200 dark:border-slate-600 rounded px-2 py-1 space-x-2 shadow-sm"
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                          {member.users.full_name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setNotifyUserIds((prev) =>
                              prev.filter((id) => id !== userId),
                            )
                          }
                          className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          disabled={isPending}
                        >
                          <X size={10} strokeWidth={3} />
                        </button>
                      </div>
                    )
                  })}

                  <div className="relative">
                    <select
                      value=""
                      onChange={(e) => {
                        const userId = e.target.value
                        if (!userId) return
                        if (!notifyUserIds.includes(userId)) {
                          setNotifyUserIds([...notifyUserIds, userId])
                        }
                      }}
                      disabled={isPending}
                      className="appearance-none bg-white dark:bg-[#1d2a31] border-2 border-dashed border-slate-200 dark:border-slate-600 hover:border-accent hover:text-accent dark:hover:text-accent text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest rounded-lg px-3 py-1 pr-8 cursor-pointer transition-all focus:outline-none disabled:opacity-50"
                    >
                      <option value="">+ Add Person</option>
                      {project?.project_members
                        .filter((m: any) => !notifyUserIds.includes(m.user_id))
                        .map((m: any) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.users.full_name}
                          </option>
                        ))}
                    </select>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                      <ChevronDown size={12} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex space-x-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isPending}
                  className="btn-unified-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSignOff}
                  disabled={isPending}
                  className="btn-unified flex-[2] flex items-center justify-center space-x-2"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirm Sign-off</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
