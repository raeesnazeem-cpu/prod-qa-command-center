import { User, Bell, Shield, Globe, LogOut } from "lucide-react"
import { useState, useEffect } from "react"
import { useUser, SignOutButton } from "@clerk/react"
import { useRole } from "../hooks/useRole"
import { useAuthAxios } from "../lib/useAuthAxios"
import { Save, Loader2 } from "lucide-react"
import toast from "react-hot-toast"

export const SettingsPage = () => {
  const { user } = useUser()
  const { role } = useRole()
  const axios = useAuthAxios()
  const [googleChatUserId, setGoogleChatUserId] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [basecampId, setBasecampId] = useState("")
  const [isSavingBasecamp, setIsSavingBasecamp] = useState(false)
  const [isSavingGoogle, setIsSavingGoogle] = useState(false)

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data } = await axios.get("/api/users/notification-prefs")
        if (data && data.google_chat_user_id !== undefined) {
          setGoogleChatUserId(data.google_chat_user_id || "")
        }
        if (data && data.basecamp_person_id !== undefined) {
          setBasecampId(data.basecamp_person_id || "")
        }
      } catch (error) {
        console.error("Failed to fetch profile settings:", error)
      }
    }
    fetchProfile()
  }, [axios])

  const handleSaveGoogle = async () => {
    if (!googleChatUserId.trim()) {
      toast.error("Google Chat ID cannot be empty")
      return
    }
    setIsSavingGoogle(true)

    try {
      await axios.patch("/api/users/notification-prefs", {
        google_chat_user_id: googleChatUserId,
      })
      toast.success("Google Chat ID updated")
    } catch (error: any) {
      toast.error(
        error.response?.data?.error || "Failed to update Google Chat ID",
      )
    } finally {
      setIsSavingGoogle(false)
    }
  }

  const handleSaveBasecamp = async () => {
    if (!basecampId.trim()) {
      toast.error("Basecamp ID cannot be empty")
      return
    }
    setIsSavingBasecamp(true)

    try {
      await axios.patch("/api/users/notification-prefs", {
        basecamp_person_id: basecampId,
      })
      toast.success("Basecamp ID updated")
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to update Basecamp ID")
    } finally {
      setIsSavingBasecamp(false)
    }
  }

  const sections = [
    {
      id: "profile",
      title: "Profile Settings",
      description: "Manage your personal information and account security.",
      icon: User,
      items: [
        {
          label: "Full Name",
          value: user?.fullName || "Not set",
          type: "text",
        },
        {
          label: "Email Address",
          value: user?.primaryEmailAddress?.emailAddress || "Not set",
          type: "text",
        },
        { label: "Role", value: role || "developer", type: "badge" },
        {
          label: "Google Chat ID",
          value: googleChatUserId,
          type: "input",
          placeholder: "Enter your Google internal ID",
        },
        {
          label: "Basecamp ID",
          value: basecampId,
          type: "input",
          placeholder: "Enter your Basecamp ID",
        },
      ],
    },
    // {
    //   id: "notifications",
    //   title: "Notifications",
    //   description: "Configure how you receive updates and alerts.",
    //   icon: Bell,
    //   items: [
    //     { label: "Email Alerts", value: true, type: "toggle" },
    //     { label: "Browser Notifications", value: false, type: "toggle" },
    //     { label: "System Updates", value: "Enabled", type: "status" },
    //   ],
    // },
    // {
    //   id: "workspace",
    //   title: "Workspace",
    //   description: "Global settings for your QACC workspace.",
    //   icon: Globe,
    //   items: [
    //     { label: "Workspace Name", value: "QA Command Center", type: "text" },
    //     {
    //       label: "Organization ID",
    //       value: user?.publicMetadata?.orgId || "Default",
    //       type: "text",
    //     },
    //   ],
    // },
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-50/60 dark:bg-[#1D2A31]/60 backdrop-blur-md border border-slate-400/40 dark:border-slate-800 rounded-lg p-6 shadow-lg dark:shadow-sm transition-all">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-200 tracking-tight">
            Settings
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Manage your account and workspace preferences
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {sections.map((section) => (
          <section
            key={section.id}
            className="bg-slate-50 dark:bg-[#131d22] border border-slate-400/40 dark:border-slate-800 rounded-xl overflow-hidden shadow-lg dark:shadow-sm transition-all"
          >
            <div className="px-6 py-4 border-b border-slate-400/40 dark:border-slate-800/50 flex items-center space-x-3 bg-slate-50/50 dark:bg-[#1D2A31]">
              <div className="p-2 bg-slate-50 dark:bg-[#131D22] border border-slate-400/40 dark:border-slate-700 rounded-lg text-slate-400 dark:text-slate-500">
                <section.icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-200">
                  {section.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {section.description}
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {section.items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-2"
                >
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest text-[10px]">
                    {item.label}
                  </span>
                  <div className="flex items-center space-x-4">
                    {item.type === "text" && (
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                        {item.value as string}
                      </span>
                    )}
                    {item.type === "input" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={
                            item.label === "Basecamp ID"
                              ? basecampId
                              : googleChatUserId
                          }
                          onChange={(e) =>
                            item.label === "Basecamp ID"
                              ? setBasecampId(e.target.value)
                              : setGoogleChatUserId(e.target.value)
                          }
                          placeholder={item.placeholder}
                          className="bg-[#F2F6FC] dark:bg-[#1D2A31] border border-slate-400/40 dark:border-slate-700 dark:text-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-accent w-48"
                        />
                        <button
                          onClick={
                            item.label === "Basecamp ID"
                              ? handleSaveBasecamp
                              : handleSaveGoogle
                          }
                          disabled={
                            item.label === "Basecamp ID"
                              ? isSavingBasecamp
                              : isSavingGoogle
                          }
                          className="btn-unified-secondary h-8 px-3 text-[10px] flex items-center gap-2"
                        >
                          {(
                            item.label === "Basecamp ID"
                              ? isSavingBasecamp
                              : isSavingGoogle
                          ) ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Save className="w-3 h-3" />
                          )}

                          {item.value ? "Save" : "Add"}
                        </button>
                      </div>
                    )}
                    {item.type === "badge" && (
                      <span className="px-2 py-0.5 bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-wider rounded-full border border-accent/20">
                        {item.value as string}
                      </span>
                    )}
                    {item.type === "toggle" && (
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(item.value)}
                          className="sr-only peer"
                          readOnly
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-50 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    )}
                    {item.type === "status" && (
                      <div className="flex items-center space-x-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                          {item.value as string}
                        </span>
                      </div>
                    )}
                    {item.type !== "input" && (
                      <button className="btn-unified-secondary h-6 text-[10px]">
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* Dangerous Zone */}
        <section className="bg-red-50/30 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-red-50 dark:border-red-900/30 flex items-center space-x-3 bg-red-50/50 dark:bg-red-950/30">
            <div className="p-2 bg-slate-50 dark:bg-red-950/50 border border-red-100 dark:border-red-900/50 rounded-lg text-red-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-red-900 dark:text-red-400">
                Delete Zone
              </h3>
              <p className="text-xs text-red-600/70 dark:text-red-400/70 font-medium">
                Irreversible actions for your account and data.
              </p>
            </div>
          </div>
          <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-200">
                Delete Account
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Permanently remove your account and all associated data.
              </p>
            </div>
            <button className="btn-unified-danger">Delete Account</button>
          </div>
          <div className="px-6 py-4 bg-red-50/50 dark:bg-red-950/30 border-t border-red-50 dark:border-red-900/30 flex justify-end">
            <SignOutButton>
              <button className="btn-unified-danger flex items-center space-x-2">
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </SignOutButton>
          </div>
        </section>
      </div>
    </div>
  )
}
