import { useState } from "react"
import { ProjectWithMembers } from "../api/projects.api"
import { useUpdateProject } from "../hooks/useProjects"
import { useAuthAxios } from "../lib/useAuthAxios"
import {
  Settings,
  Globe,
  Layout,
  ShieldCheck,
  Database,
  Eye,
  EyeOff,
  Save,
  TestTube,
} from "lucide-react"
import { CanDo } from "./CanDo"
import { NotificationSettingsPage } from "../pages/NotificationSettingsPage"
import toast from "react-hot-toast"

interface SettingsTabProps {
  project: ProjectWithMembers
}

export const SettingsTab = ({ project }: SettingsTabProps) => {
  const { mutate: updateProject, isPending: isUpdating } = useUpdateProject(
    project.id,
  )
  const axios = useAuthAxios()
  const [activeSection, setActiveSection] = useState<
    "project" | "notifications"
  >("project")

  const [formData, setFormData] = useState({
    name: project.name,
    site_url: project.site_url,
    client_name: project.client_name || "",
  })

  const [figmaToken, setFigmaToken] = useState(project.figma_access_token || "")
  const [showFigma, setShowFigma] = useState(false)

  const [basecamp, setBasecamp] = useState({
    accountId: project.basecamp_account_id || "",
    projectId: project.basecamp_project_id || "",
    todoListId: project.basecamp_todo_list_id || "",
    postTodoListId: project.basecamp_post_todo_list_id || "",
    apiToken: project.basecamp_api_token || "",
  })
  const [preReleaseLink, setPreReleaseLink] = useState("")
  const [postReleaseLink, setPostReleaseLink] = useState("")

  const handleLinkChange = (type: "pre" | "post", url: string) => {
    if (type === "pre") setPreReleaseLink(url)
    else setPostReleaseLink(url)

    const match = url.match(
      /basecamp\.com\/(\d+)\/buckets\/(\d+)\/todolists\/(\d+)/,
    )
    if (match) {
      const [, accountId, projectId, todoListId] = match
      setBasecamp((prev) => ({
        ...prev,
        accountId,
        projectId,
        [type === "pre" ? "todoListId" : "postTodoListId"]: todoListId,
      }))
    }
  }
  const [showBasecamp, setShowBasecamp] = useState(false)

  const maskValue = (value: string, showLast = 0) => {
    if (!value) return ""
    if (showLast === 0) return "••••••••••••••••"
    const masked = "•".repeat(Math.max(0, value.length - showLast))
    const lastChars = value.slice(-showLast)
    return masked + lastChars
  }
  const [isTestingBasecamp, setIsTestingBasecamp] = useState(false)

  const handleUpdateBasic = (e: React.FormEvent) => {
    e.preventDefault()
    updateProject(formData)
  }

  const handleUpdateFigma = async (e: React.FormEvent) => {
    e.preventDefault()
    updateProject({ figma_access_token: figmaToken })
  }

  const handleUpdateBasecamp = async (e: React.FormEvent) => {
    e.preventDefault()
    updateProject({
      basecamp_account_id: basecamp.accountId,
      basecamp_project_id: basecamp.projectId,
      basecamp_todo_list_id: basecamp.todoListId,
      basecamp_post_todo_list_id: basecamp.postTodoListId,
      basecamp_api_token: basecamp.apiToken,
    })
  }

  const handleTestBasecamp = async () => {
    setIsTestingBasecamp(true)
    try {
      await axios.post(`/api/projects/${project.id}/settings/test-basecamp`)
      toast.success("Basecamp connection successful")
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Basecamp connection failed")
    } finally {
      setIsTestingBasecamp(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Sub-navigation for Settings */}
      <div className="flex items-center space-x-1 p-1 bg-slate-100/50 dark:bg-[#1d2a31]/50 rounded-lg w-fit border border-slate-400/50 dark:border-slate-700 shadow-sm">
        <button
          onClick={() => setActiveSection("project")}
          className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
            activeSection === "project"
              ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-400/50 dark:border-slate-700"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          }`}
        >
          Project Settings
        </button>
        <button
          onClick={() => setActiveSection("notifications")}
          className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
            activeSection === "notifications"
              ? "bg-slate-50 dark:bg-[#1D2A31] text-slate-900 dark:text-slate-200 shadow-sm border border-slate-400/50 dark:border-slate-700"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          }`}
        >
          Notification Hub
        </button>
      </div>

      {activeSection === "project" ? (
        <>
          {/* Basic Settings */}
          <section className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-400/50 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-400/50 dark:border-slate-700 flex items-center space-x-2">
              <Settings className="w-5 h-5 text-slate-400" />
              <h3 className="font-bold text-slate-900 dark:text-slate-200">
                General Settings
              </h3>
            </div>
            <form onSubmit={handleUpdateBasic} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Client Name
                  </label>
                  <input
                    type="text"
                    value={formData.client_name}
                    onChange={(e) =>
                      setFormData({ ...formData, client_name: e.target.value })
                    }
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  Site URL
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="url"
                    value={formData.site_url}
                    onChange={(e) =>
                      setFormData({ ...formData, site_url: e.target.value })
                    }
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                  />
                </div>
              </div>
              <CanDo role="admin">
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="btn-unified flex items-center space-x-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isUpdating ? "Saving..." : "Save Changes"}</span>
                  </button>
                </div>
              </CanDo>
            </form>
          </section>

          {/* Figma Integration */}
          <section className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-400/50 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-400/50 dark:border-slate-700 flex items-center space-x-2">
              <Layout className="w-5 h-5 text-slate-400" />
              <h3 className="font-bold text-slate-900 dark:text-slate-200">
                Figma Integration
              </h3>
            </div>
            <form onSubmit={handleUpdateFigma} className="p-6 space-y-6">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Connect Figma to automatically pull design specs and compare
                them during QA runs.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Personal Access Token
                  </label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type={showFigma ? "text" : "password"}
                      value={figmaToken}
                      onChange={(e) => setFigmaToken(e.target.value)}
                      placeholder="Enter Figma PAT"
                      className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md pl-10 pr-12 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                    />
                    {!showFigma && figmaToken && (
                      <div className="absolute left-10 top-1/2 -translate-y-1/2 text-sm text-slate-900 dark:text-slate-200 pointer-events-none bg-slate-50 dark:bg-[#1d2a31] pr-2">
                        {maskValue(figmaToken, 4)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowFigma(!showFigma)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showFigma ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <CanDo role="admin">
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="btn-unified flex items-center space-x-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isUpdating ? "Saving..." : "Update Token"}</span>
                  </button>
                </div>
              </CanDo>
            </form>
          </section>

          {/* Basecamp Integration */}
          <section className="bg-slate-50 dark:bg-[#1D2A31] border border-slate-400/50 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-400/50 dark:border-slate-700 flex items-center space-x-2">
              <Database className="w-5 h-5 text-slate-400" />
              <h3 className="font-bold text-slate-900 dark:text-slate-200">
                Basecamp Integration
              </h3>
            </div>
            <form onSubmit={handleUpdateBasecamp} className="p-6 space-y-6">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Automatically sync QA issues to your Basecamp project's to-do
                list.
              </p>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                      Pre-release to-do task link
                    </label>
                    <input
                      type="url"
                      value={preReleaseLink}
                      onChange={(e) => handleLinkChange("pre", e.target.value)}
                      placeholder="Paste Basecamp to-do list URL"
                      className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                      Post-release to-do task link
                    </label>
                    <input
                      type="url"
                      value={postReleaseLink}
                      onChange={(e) => handleLinkChange("post", e.target.value)}
                      placeholder="Paste Basecamp to-do list URL"
                      className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Account ID
                  </label>
                  <input
                    type={showBasecamp ? "text" : "password"}
                    value={basecamp.accountId}
                    onChange={(e) =>
                      setBasecamp({ ...basecamp, accountId: e.target.value })
                    }
                    placeholder="Enter Account ID"
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Project ID
                  </label>
                  <input
                    type={showBasecamp ? "text" : "password"}
                    value={basecamp.projectId}
                    onChange={(e) =>
                      setBasecamp({ ...basecamp, projectId: e.target.value })
                    }
                    placeholder="Enter Project ID"
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Pre-release To-Do List ID
                  </label>
                  <input
                    type={showBasecamp ? "text" : "password"}
                    value={basecamp.todoListId}
                    onChange={(e) =>
                      setBasecamp({ ...basecamp, todoListId: e.target.value })
                    }
                    placeholder="Enter To-Do List ID"
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    Post-release To-Do List ID
                  </label>
                  <input
                    type={showBasecamp ? "text" : "password"}
                    value={basecamp.postTodoListId}
                    onChange={(e) =>
                      setBasecamp({
                        ...basecamp,
                        postTodoListId: e.target.value,
                      })
                    }
                    placeholder="Enter Post-release To-Do List ID"
                    className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1.5">
                    API Token
                  </label>
                  <div className="relative">
                    <input
                      type={showBasecamp ? "text" : "password"}
                      value={basecamp.apiToken}
                      onChange={(e) =>
                        setBasecamp({ ...basecamp, apiToken: e.target.value })
                      }
                      placeholder="Enter API Token"
                      className="w-full bg-slate-50 dark:bg-[#1d2a31] text-slate-900 dark:text-slate-200 border border-slate-400/50 dark:border-slate-700 rounded-md pr-12 py-2 text-sm focus:outline-none focus:border-accent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBasecamp(!showBasecamp)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showBasecamp ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <CanDo role="admin">
                <div className="flex items-center justify-between pt-4 border-t border-slate-400/50 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={handleTestBasecamp}
                    disabled={isTestingBasecamp}
                    className="btn-unified flex items-center space-x-2 text-white"
                  >
                    {isTestingBasecamp ? (
                      <Settings className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                    <span>Test Connection</span>
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="btn-unified flex items-center space-x-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>
                      {isUpdating ? "Saving..." : "Save Basecamp Settings"}
                    </span>
                  </button>
                </div>
              </CanDo>
            </form>
          </section>
        </>
      ) : (
        <NotificationSettingsPage project={project} />
      )}
    </div>
  )
}
