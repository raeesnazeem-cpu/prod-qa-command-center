import { useState, useEffect } from "react"
import { Bell, Mail, Hash, Clock, Save, TestTube, Loader2 } from "lucide-react"
import { useAuthAxios } from "../lib/useAuthAxios"
import { ProjectWithMembers } from "../api/projects.api"
import toast from "react-hot-toast"
import { CanDo } from "../components/CanDo"

interface NotificationSettingsPageProps {
  project: ProjectWithMembers
}

export const NotificationSettingsPage = ({
  project,
}: NotificationSettingsPageProps) => {
  const axios = useAuthAxios()
  const [isSaving, setIsSaving] = useState(false)
  const [isTestingSlack, setIsTestingSlack] = useState(false)

  // Email Notification State
  const [emailPrefs, setEmailPrefs] = useState({
    taskAssigned: true,
    newComment: true,
    rebuttalVerdict: true,
    runCompleted: false,
  })

  // Slack Notification State
  const [slackPrefs, setSlackPrefs] = useState({
    webhookUrl: "",
    notifyRunComplete: true,
    notifyCriticalFinding: true,
    notifySignOff: true,
  })
  const [googleChatPrefs, setGoogleChatPrefs] = useState({
    webhookUrl: "",
    enabled: false,
  })
  const [googleChatUserId, setGoogleChatUserId] = useState("")

  // Frequency State
  const [frequency, setFrequency] = useState<"immediate" | "daily">("immediate")

  useEffect(() => {
    // Fetch current preferences
    const fetchPrefs = async () => {
      try {
        const { data: userPrefs } = await axios.get(
          "/api/users/notification-prefs",
        )
        if (userPrefs) {
          setEmailPrefs(userPrefs.email || emailPrefs)
          setFrequency(userPrefs.frequency || frequency)
          setGoogleChatUserId(userPrefs.google_chat_user_id || "")
        }

        const { data: projSettings } = await axios.get(
          `/api/projects/${project.id}/settings`,
        )
        if (projSettings) {
          setSlackPrefs({
            webhookUrl: projSettings.slack_webhook_url || "",
            notifyRunComplete: projSettings.notify_run_complete ?? true,
            notifyCriticalFinding: projSettings.notify_critical_finding ?? true,
            notifySignOff: projSettings.notify_sign_off ?? true,
          })
          setGoogleChatPrefs({
            webhookUrl: projSettings.google_chat_webhook_url || "",
            enabled: projSettings.google_chat_enabled ?? false,
          })
        }
      } catch (error) {
        console.error("Failed to fetch notification preferences:", error)
      }
    }

    fetchPrefs()
  }, [project.id, axios])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // 1. Save User Preferences
      await axios.patch("/api/users/notification-prefs", {
        email: emailPrefs,
        frequency,
        google_chat_user_id: googleChatUserId,
      })

      // 2. Save Project Slack Settings (if admin)
      await axios.patch(`/api/projects/${project.id}/settings`, {
        slack_webhook_url: slackPrefs.webhookUrl,
        notify_run_complete: slackPrefs.notifyRunComplete,
        notify_critical_finding: slackPrefs.notifyCriticalFinding,
        notify_sign_off: slackPrefs.notifySignOff,
        google_chat_webhook_url: googleChatPrefs.webhookUrl,
        google_chat_enabled: googleChatPrefs.enabled,
      })

      toast.success("Notification settings saved")
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  const handleTestSlack = async () => {
    if (!slackPrefs.webhookUrl) {
      toast.error("Please enter a Slack Webhook URL first")
      return
    }

    setIsTestingSlack(true)
    try {
      await axios.post(`/api/projects/${project.id}/settings/test-slack`, {
        webhook_url: slackPrefs.webhookUrl,
      })
      toast.success("Test notification sent to Slack")
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Slack test failed")
    } finally {
      setIsTestingSlack(false)
    }
  }

  const Toggle = ({
    checked,
    onChange,
    label,
  }: {
    checked: boolean
    onChange: (val: boolean) => void
    label: string
  }) => (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onChange(!checked)
        }}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
          checked ? "bg-accent" : "bg-slate-200 dark:bg-slate-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-slate-50 transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  )

  return (
    <div className="space-y-8 max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-500 pb-20">
      {/* Email Notifications */}
      <section className="bg-slate-50 dark:bg-[#1d2a31] border border-slate-400/50 rounded-md overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-400/50 flex items-center space-x-3 bg-slate-50/50 dark:bg-[#131D22]/50">
          <div className="p-2 bg-slate-50 dark:bg-[#131D22] border border-slate-400/50 rounded-md text-slate-400 shadow-sm">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-200">
              Email Notifications
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Choose which updates you want delivered to your inbox.
            </p>
          </div>
        </div>
        <div className="p-6 divide-y divide-slate-400/50">
          <Toggle
            label="Task assigned to me"
            checked={emailPrefs.taskAssigned}
            onChange={(val) =>
              setEmailPrefs({ ...emailPrefs, taskAssigned: val })
            }
          />
          <Toggle
            label="New comment on my task"
            checked={emailPrefs.newComment}
            onChange={(val) =>
              setEmailPrefs({ ...emailPrefs, newComment: val })
            }
          />
          <Toggle
            label="Rebuttal verdict delivered"
            checked={emailPrefs.rebuttalVerdict}
            onChange={(val) =>
              setEmailPrefs({ ...emailPrefs, rebuttalVerdict: val })
            }
          />
          <Toggle
            label="Run completed with my tasks"
            checked={emailPrefs.runCompleted}
            onChange={(val) =>
              setEmailPrefs({ ...emailPrefs, runCompleted: val })
            }
          />
        </div>
      </section>

      {/* Slack Integration */}
      {/* <section className="bg-slate-50 dark:bg-[#1d2a31] border border-slate-400/50 rounded-md overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-400/50 flex items-center space-x-3 bg-slate-50/50 dark:bg-[#131D22]/50">
          <div className="p-2 bg-slate-50 dark:bg-[#131D22] border border-slate-400/50 rounded-md text-slate-400 shadow-sm">
            <Hash className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-200">Slack Integration</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Broadcast project updates to your Slack workspace.
            </p>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <CanDo role="admin">
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                  Slack Webhook URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={slackPrefs.webhookUrl}
                    onChange={(e) =>
                      setSlackPrefs({
                        ...slackPrefs,
                        webhookUrl: e.target.value,
                      })
                    }
                    placeholder="https://hooks.slack.com/services/..."
                    className="flex-1 bg-slate-50 dark:bg-[#131D22] border border-slate-400/50 rounded-md px-3 py-2 text-slate-900 dark:text-slate-200 text-sm focus:outline-none focus:border-accent transition-all"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      handleTestSlack()
                    }}
                    disabled={isTestingSlack || !slackPrefs.webhookUrl}
                    className="btn-unified-secondary flex items-center gap-2 text-accent"
                  >
                    {isTestingSlack ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                    <span>Test</span>
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-400/50 pt-2">
                <Toggle
                  label="Notify when a run is completed"
                  checked={slackPrefs.notifyRunComplete}
                  onChange={(val) =>
                    setSlackPrefs({ ...slackPrefs, notifyRunComplete: val })
                  }
                />
                <Toggle
                  label="Notify on critical findings"
                  checked={slackPrefs.notifyCriticalFinding}
                  onChange={(val) =>
                    setSlackPrefs({ ...slackPrefs, notifyCriticalFinding: val })
                  }
                />
                <Toggle
                  label="Notify when sign-off is completed"
                  checked={slackPrefs.notifySignOff}
                  onChange={(val) =>
                    setSlackPrefs({ ...slackPrefs, notifySignOff: val })
                  }
                />
              </div>
            </div>
          </CanDo>
          <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-md border border-amber-100">
            <Bell className="w-4 h-4 text-amber-500" />
            <p className="text-xs text-amber-700 font-medium">
              Only project admins can configure Slack webhooks.
            </p>
          </div>
        </div>
      </section> */}

      {/* Google Chat Integration */}
      <section className="bg-slate-50 dark:bg-[#1d2a31] border border-slate-400/50 rounded-md overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-400/50 flex items-center space-x-3 bg-slate-50/50 dark:bg-[#131D22]/50">
          <div className="p-2 bg-slate-50 dark:bg-[#131D22] border border-slate-400/50 rounded-md text-slate-400 shadow-sm">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-200">
              Google Chat Integration
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Broadcast project updates to a Google Chat space.
            </p>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <CanDo role="admin">
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                  Google Chat Webhook URL
                </label>
                <input
                  type="url"
                  value={googleChatPrefs.webhookUrl}
                  onChange={(e) =>
                    setGoogleChatPrefs({
                      ...googleChatPrefs,
                      webhookUrl: e.target.value,
                    })
                  }
                  placeholder="https://chat.googleapis.com/v1/spaces/..."
                  className="w-full bg-slate-50 dark:bg-[#131D22] border border-slate-400/50 rounded-md px-3 py-2 text-slate-900 dark:text-slate-200 text-sm focus:outline-none focus:border-accent transition-all"
                />
              </div>
              <Toggle
                label="Enable Google Chat Notifications"
                checked={googleChatPrefs.enabled}
                onChange={(val) =>
                  setGoogleChatPrefs({ ...googleChatPrefs, enabled: val })
                }
              />
            </div>
          </CanDo>
          {/* <div className="pt-4 border-t border-slate-400/50">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              My Google Chat User ID (for tagging)
            </label>
            <input
              type="text"
              value={googleChatUserId}
              onChange={(e) => setGoogleChatUserId(e.target.value)}
              placeholder="e.g. 1092837465..."
              className="w-full bg-slate-50 dark:bg-[#131D22] border border-slate-400/50 rounded-md px-3 py-2 text-slate-900 dark:text-slate-200 text-sm focus:outline-none focus:border-accent transition-all"
            />
            <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
              Find your ID by clicking your profile picture in Google Chat.
              Required for personal @mentions.
            </p>
          </div> */}
        </div>
      </section>

      <div className="flex justify-end pt-4">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            handleSave()
          }}
          disabled={isSaving}
          className="btn-unified flex items-center space-x-2"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>{isSaving ? "Saving..." : "Save All Preferences"}</span>
        </button>
      </div>
    </div>
  )
}
