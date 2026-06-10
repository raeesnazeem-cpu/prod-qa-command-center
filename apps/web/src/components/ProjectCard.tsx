import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { Project, addProjectMember } from "../api/projects.api"
import {
  Globe,
  Package,
  AlertCircle,
  Calendar,
  ChevronRight,
  Users,
  Plus,
  X,
  Loader2,
  Check,
  Edit,
} from "lucide-react"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useRole } from "../hooks/useRole"
import toast from "react-hot-toast"
import { EditProjectModal } from "./EditProjectModal"

interface ProjectCardProps {
  project: Project
}

export const ProjectCard = ({ project }: ProjectCardProps) => {
  const navigate = useNavigate()
  const axios = useAuthAxios()
  const { role: userRole } = useRole()
  const [isManageOpen, setIsManageOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [memberRole, setMemberRole] = useState<"qa_engineer" | "developer">(
    "qa_engineer",
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  const canManage = ["super_admin", "admin", "sub_admin"].includes(
    userRole || "",
  )

  const canEdit = ["super_admin", "admin", "sub_admin"].includes(userRole || "")

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never"
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setIsSubmitting(true)
    try {
      await addProjectMember(axios, project.id, { email, role: memberRole })
      toast.success("Member added successfully")
      setEmail("")
      setIsManageOpen(false)
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to add member")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative group/card flex flex-col h-full">
      <div
        onClick={() => !isManageOpen && navigate(`/projects/${project.id}`)}
        className="bg-slate-50/60 dark:bg-[#1D2A31] backdrop-blur-md border border-transparent dark:border-slate-800 rounded-lg p-6 cursor-pointer transition-all group flex flex-col h-full shadow-lg hover:shadow-xl dark:shadow-sm dark:hover:shadow-md relative"
      >
        <div
          className="absolute inset-0 rounded-lg pointer-events-none p-[1px] drop-shadow-sm opacity-100 dark:opacity-50 dark:group-hover:opacity-100 transition-opacity duration-500 overflow-hidden"
          style={{
            WebkitMask:
              "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
          }}
        >
          {/* Base Ambient Border (Stays partially visible to anchor the card) */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-200 via-accent/30 to-slate-200/30 group-hover:opacity-50 transition-opacity duration-700" />

          {/* Conical border: static in light mode, animated on hover in both modes */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300%] aspect-square bg-[conic-gradient(from_0deg,transparent_0_45deg,theme(colors.accent)_135deg,transparent_180deg_225deg,#a3d4c7_315deg,transparent_360deg)] opacity-100 dark:opacity-0 group-hover:opacity-100 group-hover:animate-[spin_4s_linear_infinite]" />
        </div>

        <div className="mb-3 relative z-10">
          <h3 className="text-xl font-bold text-slate-900 dark:text-slate-200 group-hover:text-accent transition-colors truncate">
            {project.name}
          </h3>
        </div>

        <div className="flex items-start justify-between flex-grow gap-2">
          <div className="space-y-1 min-w-0">
            {project.client_name && (
              <div className="flex items-center text-slate-500 dark:text-slate-400 text-sm">
                <span className="truncate">{project.client_name}</span>
              </div>
            )}
            <div className="flex items-center text-slate-500 dark:text-slate-400 text-sm">
              <span className="truncate text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors lowercase text-[11px] font-bold tracking-tight">
                {project.site_url
                  .replace(/^https?:\/\/(www\.)?/, "")
                  .replace(/\/$/, "")}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {project.basecamp_account_id &&
              project.basecamp_project_id &&
              project.basecamp_todo_list_id &&
              project.basecamp_post_todo_list_id && (
                <div
                  className="flex items-center justify-center bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-500 border border-yellow-100 dark:border-yellow-900/50 rounded-full w-6 h-6"
                  title="Basecamp Linked"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 35 30"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path>
                  </svg>
                </div>
              )}

            {canManage && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsManageOpen(!isManageOpen)
                }}
                className={`p-1.5 rounded-md transition-colors ${
                  isManageOpen
                    ? "bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900"
                    : "text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1d2a31] hover:text-slate-900 dark:hover:text-white"
                }`}
                title="Manage Team"
              >
                <Users className="w-4 h-4" />
              </button>
            )}
            {canEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsEditModalOpen(true)
                }}
                className="p-1.5 rounded-md transition-colors text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1d2a31] hover:text-slate-900 dark:hover:text-white"
                title="Edit Project"
              >
                <Edit className="w-4 h-4" />
              </button>
            )}

            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                project.status === "active"
                  ? "bg-accent/10 text-accent border border-accent/20"
                  : "bg-slate-100 dark:bg-[#1d2a31] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
              }`}
            >
              {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
            </span>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-50 dark:border-slate-800 flex justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold mb-1 flex items-center">
              <AlertCircle className="w-3 h-3 mr-1" /> Issues
            </span>
            <span
              className={`text-sm font-semibold ${project.open_issues_count > 0 ? "text-red-500" : "text-accent"}`}
            >
              {project.open_issues_count} Open
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold mb-1 flex items-center">
              <Calendar className="w-3 h-3 mr-1" /> Last Run
            </span>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300 text-right">
              {formatDate(project.last_run_date)}
            </span>
          </div>
        </div>
      </div>

      {/* Manage Team Popover */}
      {isManageOpen && (
        <div
          className="absolute inset-0 z-20 bg-slate-50/95 backdrop-blur-sm rounded-xl p-6 flex flex-col border border-slate-200 shadow-xl animate-in fade-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-200 flex items-center tracking-tight">
                <Users className="w-4 h-4 mr-2 text-accent" /> Manage Team
              </h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-widest mt-0.5">
                Project: {project.name}
              </p>
            </div>
            <button
              onClick={() => setIsManageOpen(false)}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleAddMember} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">
                Add User by Email
              </label>
              <input
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 dark:text-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                required
              />
            </div>

            <div className="flex space-x-2">
              {(["qa_engineer", "developer"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setMemberRole(r)}
                  className={`flex-1 py-1.5 px-3 rounded-md text-[10px] font-bold uppercase tracking-widest border transition-all flex items-center justify-center space-x-1 ${
                    memberRole === r
                      ? "bg-slate-900 dark:bg-slate-50 border-slate-900 dark:border-white text-white dark:text-slate-900 shadow-sm"
                      : "bg-slate-50 dark:bg-[#131d22] border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                  }`}
                >
                  {memberRole === r && <Check className="w-3 h-3" />}
                  <span>{r.replace("_", " ")}</span>
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full btn-unified flex items-center justify-center space-x-2 h-10"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Add to Project</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-auto pt-6 text-center">
            <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium italic">
              Users must already exist in the organization's system
            </p>
          </div>
        </div>
      )}

      {project.ongoing_run && !isManageOpen && (
        <Link
          to={`/projects/${project.id}/runs/${project.ongoing_run.id}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute -bottom-3 left-4 right-4 bg-blue-600 text-white rounded-md px-4 h-[30px] flex items-center justify-between shadow-lg hover:bg-black transition-all animate-in slide-in-from-bottom-2 duration-300 z-10 group/ongoing"
        >
          <div className="flex items-center space-x-2 text-[10px] font-bold uppercase tracking-wider">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-100 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-50"></span>
            </div>
            <span>Scan Active</span>
            <span className="opacity-80 font-medium">
              {project.ongoing_run.pages_processed}/
              {project.ongoing_run.pages_total}
            </span>
          </div>
          <ChevronRight className="w-3 h-3 group-hover/ongoing:translate-x-0.5 transition-transform" />
        </Link>
      )}

      <EditProjectModal
        project={project}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
      />
    </div>
  )
}
