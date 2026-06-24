import { User, Bell, Shield, Globe, LogOut } from "lucide-react"
import { useState, useEffect } from "react"
import { useUser, SignOutButton } from "@clerk/react"
import { useRole } from "../hooks/useRole"
import { useAuthAxios } from "../lib/useAuthAxios"
import { useSystemSettings } from "../hooks/useSystemSettings"
import { Save, Loader2, Edit2, RefreshCw } from "lucide-react"
import toast from "react-hot-toast"

export const SettingsPage = () => {
  const { user } = useUser()
  const { role } = useRole()
  const { systemSettings, updateMaintenanceMode } = useSystemSettings()
  const axios = useAuthAxios()
  const [googleChatUserId, setGoogleChatUserId] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [basecampId, setBasecampId] = useState("")
  const [isSavingBasecamp, setIsSavingBasecamp] = useState(false)
  const [basecampTokenExpiresAt, setBasecampTokenExpiresAt] = useState<
    string | null
  >(null)
  const [countdown, setCountdown] = useState<string>("")
  const [isSavingGoogle, setIsSavingGoogle] = useState(false)

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return

      try {
        const { data } = await axios.get("/api/users/notification-prefs")

        let fetchedGoogleId = data?.google_chat_user_id || ""

        if (!fetchedGoogleId) {
          const googleAccount = user.externalAccounts?.find(
            (acc: any) =>
              acc.provider === "oauth_google" || acc.provider === "google",
          ) as any

          const googleId =
            googleAccount?.externalId || googleAccount?.providerUserId

          if (googleId) {
            fetchedGoogleId = googleId
            axios
              .patch("/api/users/notification-prefs", {
                google_chat_user_id: googleId,
              })
              .catch(console.error)
          }
        }

        setGoogleChatUserId(fetchedGoogleId)

        if (data && data.basecamp_person_id !== undefined) {
          setBasecampId(data.basecamp_person_id || "")
          if (data.basecamp_token_expires_at) {
            setBasecampTokenExpiresAt(data.basecamp_token_expires_at)
          }
        }
      } catch (error) {
        console.error("Failed to fetch profile settings:", error)
      }
    }

    if (user) {
      fetchProfile()
    }
  }, [axios, user])

  useEffect(() => {
    if (!basecampTokenExpiresAt) return

    const updateCountdown = () => {
      const expiry = new Date(basecampTokenExpiresAt).getTime()
      const now = new Date().getTime()
      const distance = expiry - now

      if (distance < 0) {
        setCountdown("Token Expired")
        return
      }

      const days = Math.floor(distance / (1000 * 60 * 60 * 24))
      const hours = Math.floor(
        (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      )
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))

      if (days > 0) {
        setCountdown(`Expires in ${days}d ${hours}h`)
      } else {
        setCountdown(`Expires in ${hours}h ${minutes}m`)
      }
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 60000) // Update every minute
    return () => clearInterval(interval)
  }, [basecampTokenExpiresAt])

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get("basecamp") === "connected") {
      toast.success("Successfully connected to Basecamp!")
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    if (urlParams.get("google") === "connected") {
      const googleAccount = user?.externalAccounts?.find(
        (acc: any) =>
          acc.provider === "oauth_google" || acc.provider === "google",
      ) as any

      const googleId =
        googleAccount?.externalId || googleAccount?.providerUserId

      if (googleId) {
        axios
          .patch("/api/users/notification-prefs", {
            google_chat_user_id: googleId,
          })
          .then(() => {
            setGoogleChatUserId(googleId)

            toast.success("Successfully connected to Google Chat!")
          })
          .catch(() => {
            toast.error("Failed to link Google Chat ID")
          })
      }
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [user, axios])

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

  type SettingsItem = {
    label: string
    value: any
    type: string
    placeholder?: string
  }
  
  type SettingsSection = {
    id: string
    title: string
    description: string
    icon: any
    items: SettingsItem[]
  }

  const sections: SettingsSection[] = [
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
          label: "Basecamp ID",
          value: basecampId,
          type: "disabled-input",
          placeholder: "Connect Basecamp below to fetch",
        },
        {
          label: "Google Chat ID",
          value: googleChatUserId,
          type: "disabled-input",
          placeholder: "Connect Google below to fetch",
        },
        {
          label: "Basecamp Integration",
          value: "",
          type: "oauth",
        },
        {
          label: "Basecamp Personal Token",
          value: basecampTokenExpiresAt,
          type: "basecamp_token_ui",
        },
        {
          label: "Google Integration",
          value: "",
          type: "google_oauth",
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

  if (role === "super_admin") {
    sections.push({
      id: "system",
      title: "System Administration",
      description: "Global settings affecting all users in the system.",
      icon: Shield,
      items: [
        {
          label: "Maintenance Mode",
          value: systemSettings?.is_maintenance_mode ?? false,
          type: "maintenance_toggle",
        },
      ],
    })
  }

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

                    {item.type === "disabled-input" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={item.value as string}
                          placeholder={item.placeholder}
                          readOnly
                          className="bg-slate-100 dark:bg-[#131D22] border border-slate-300 dark:border-slate-800 text-slate-500 dark:text-slate-600 rounded px-2 py-1 text-sm focus:outline-none w-48 cursor-not-allowed"
                        />
                      </div>
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

                    {item.type === "google_oauth" && (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={async () => {
                            try {
                              const account = await user?.createExternalAccount(
                                {
                                  strategy: "oauth_google",
                                  redirectUrl: `${window.location.origin}/settings?google=connected`,
                                },
                              )

                              // Clerk generates the Google Auth URL here, we must redirect to it!
                              if (
                                account?.verification
                                  ?.externalVerificationRedirectURL
                              ) {
                                window.location.href =
                                  account.verification.externalVerificationRedirectURL.href
                              }
                            } catch (err: any) {
                              toast.error(
                                err.errors?.[0]?.message ||
                                  "Failed to connect to Google",
                              )
                              setTimeout(() => {
                                toast(
                                  "If facing issues, sign out & sign back in. Retry within 5 mins of login.",
                                  {
                                    duration: 5000,
                                    icon: "💡",
                                  },
                                )
                              }, 500)
                            }
                          }}
                          className="bg-white text-black hover:bg-slate-100 border border-slate-300 font-bold text-xs py-1.5 px-4 rounded shadow-sm transition-all flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                            <path
                              fill="currentColor"
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            />
                            <path
                              fill="#EA4335"
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                          </svg>
                          Connect Google Account
                        </button>
                      </div>
                    )}

                    {item.type === "oauth" && (
                      <button
                        onClick={() =>
                          (window.location.href = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/basecamp/user-auth`)
                        }
                        className="bg-[#F5D88D] text-black hover:bg-[#E5C87D] border border-[#D4A643] font-bold text-xs py-1.5 px-4 rounded shadow-sm transition-all"
                      >
                        Fetch your ID
                      </button>
                    )}
                    {item.type === "basecamp_token_ui" && (
                      <div className="flex items-end gap-2">
                        {item.value ? (
                          <div
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-bold shadow-sm ${countdown === "Token Expired" ? "bg-red-50 text-red-600 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}
                          >
                            <div
                              className={`w-2 h-2 rounded-full animate-pulse ${countdown === "Token Expired" ? "bg-red-500" : "bg-emerald-500"}`}
                            ></div>
                            {countdown}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic">
                            No personal token generated yet
                          </span>
                        )}

                        <button
                          onClick={() =>
                            (window.location.href = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/basecamp/user-auth`)
                          }
                          className="bg-[#F5D88D] text-black hover:bg-[#E5C87D] border border-[#D4A643] font-bold text-xs py-1.5 px-4 rounded shadow-sm transition-all flex items-center gap-2"
                        >
                          {item.value ? (
                            <>
                              <RefreshCw size={14} />
                              Regenerate Token
                            </>
                          ) : (
                            "Generate Token"
                          )}
                        </button>
                      </div>
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
                    {item.type === "maintenance_toggle" && (
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(item.value)}
                          onChange={(e) => {
                            if (!updateMaintenanceMode.isPending) {
                              updateMaintenanceMode.mutate(e.target.checked)
                            }
                          }}
                          disabled={updateMaintenanceMode.isPending}
                          className="sr-only peer"
                        />
                        <div className={`w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-50 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent ${updateMaintenanceMode.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}></div>
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
                    {item.type !== "input" &&
                      (role === "admin" || role === "super_admin"
                        ? item.label !== "Google Integration" &&
                          item.label !== "Basecamp Integration" &&
                          item.label !== "Basecamp Personal Token"
                        : item.label === "Full Name" ||
                          item.label === "Role") && (
                        <button className="h-6 w-6 p-0 flex items-center justify-center dark:bg-transparent border-none shadow-none`">
                          <Edit2 className="w-3.5 h-3.5" />
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
