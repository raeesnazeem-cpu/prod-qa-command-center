import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom"
import { useUser, UserButton } from "@clerk/react"
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  BarChart2,
  Settings as SettingsIcon,
  Users,
  History,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  ListTodo,
  Kanban,
  ListChecks,
  Monitor,
  User,
  MessageSquare,
} from "lucide-react"
import { useRole } from "../hooks/useRole"
import { useEffect, useState } from "react"
import { ChatSidebar } from "../components/ChatSidebar"
import { AdminRedisWidget } from "../components/AdminRedisWidget"
import { useRealtimeTasks } from "../hooks/useRealtimeTasks"
import { NotificationBell } from "../components/NotificationBell"
import { useRealtimeNotifications } from "../hooks/useRealtimeNotifications"
import { todo } from "node:test"

export const AppLayout = () => {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { user } = useUser()
  const { role, profile, isLoading, isAdmin } = useRole()
  const navigate = useNavigate()
  const location = useLocation()

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const isDark =
      localStorage.getItem("theme") === "dark" ||
      (!("theme" in localStorage) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    if (typeof document !== "undefined") {
      if (isDark) {
        document.documentElement.classList.add("dark")
      } else {
        document.documentElement.classList.remove("dark")
      }
    }
    return isDark
  })

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark")
      localStorage.setItem("theme", "dark")
    } else {
      document.documentElement.classList.remove("dark")
      localStorage.setItem("theme", "light")
    }
  }, [isDarkMode])

  const toggleDarkMode = () => setIsDarkMode(!isDarkMode)

  // Initialize global real-time listeners
  useRealtimeTasks()
  useRealtimeNotifications()

  useEffect(() => {
    // Redirect to onboarding if profile is incomplete in Supabase
    if (!isLoading && location.pathname !== "/onboarding") {
      // A profile is incomplete if role is missing, full_name is missing,
      // or if it's the default "New User" name we set in the middleware.
      const isProfileIncomplete =
        !profile?.role ||
        !profile?.full_name ||
        profile?.full_name === "New User"

      if (isProfileIncomplete) {
        navigate("/onboarding", { replace: true })
      }
    }
  }, [profile, isLoading, navigate, location.pathname])

  const isDeveloper = role === "developer"

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    ...(isAdmin
      ? [{ to: "/all-tasks", label: "All tasks", icon: ListChecks }]
      : []),
    { to: "/tasks", label: "Monitor", icon: Monitor },

    { to: "/stats", label: "Stats", icon: BarChart2 },
    ...(!isDeveloper ? [{ to: "/team", label: "Team", icon: Users }] : []),
    ...(!isDeveloper
      ? [{ to: "/admin/queue-history", label: "Queue History", icon: History }]
      : []),
    ...(!isDeveloper
      ? [{ to: "/admin/activity-logs", label: "Activity Logs", icon: History }]
      : []),
    { to: "/feedback", label: "Feedback", icon: MessageSquare },
    ...[{ to: "/settings", label: "Settings", icon: SettingsIcon }],
  ]

  return (
    <div className="flex h-screen bg-bg-main dark:bg-[#131D22] font-sans">
      {/* Sidebar */}
      <aside
        className={`${isCollapsed ? "w-20" : "w-64"} bg-slate-50 dark:bg-[#0B151B] text-slate-900 dark:text-slate-100 flex flex-col border-r border-slate-300/50 dark:border-slate-800 transition-all duration-300 relative`}
      >
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-6 bg-[#e2e8f0] dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full p-1 z-20 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-slate-500" />
          )}
        </button>
        <div
          className={`p-6 text-xl font-bold dark:border-slate-800 tracking-tight flex items-center ${isCollapsed ? "justify-center space-x-0" : "space-x-2"}`}
        >
          <img
            src={
              isCollapsed
                ? "/images/qacc-mobile.png"
                : isDarkMode
                  ? "https://aspire-cc.com/storage/2026/03/G99-Logo.svg"
                  : "https://growth99.com/storage/2024/09/LOGO.svg"
            }
            style={{
              objectFit: "contain",
              width: isCollapsed ? "32px" : "130px",
            }}
            alt="logo"
            className={
              isCollapsed ? "h-8 w-8 flex-shrink-0" : "h-8 w-auto flex-shrink-0"
            }
          />

          {!isCollapsed && <span className="tracking-tighter">QACC</span>}
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `relative group border bg-slate-50/20 dark:bg-transparent border-transparent flex items-center ${isCollapsed ? "justify-center px-0 gap-0" : "gap-3 px-4"} py-2 rounded-md text-[13px] font-medium capitalize transition-all ${
                  isActive
                    ? "text-accent shadow-sm bg-slate-50 dark:bg-slate-800"
                    : "text-[#6b7280] dark:text-slate-400 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                }`
              }
              title={isCollapsed ? item.label : undefined}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <div
                      className="absolute inset-0 rounded-md pointer-events-none p-[1px] drop-shadow-sm overflow-hidden"
                      style={{
                        WebkitMask:
                          "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                        WebkitMaskComposite: "xor",
                        maskComposite: "exclude",
                      }}
                    >
                      {/* Base Ambient Border */}
                      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-[#a3d4c7]/30 to-white/30 opacity-50" />

                      {/* Iridescent Slow Shimmer */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200%] aspect-square bg-[conic-gradient(from_0deg,transparent_0_178deg,#a3d4c7_250deg,transparent_202deg_360deg)] opacity-60 animate-[spin_8s_linear_infinite]" />
                    </div>
                  )}

                  <item.icon
                    className={`relative z-10 w-4 h-4 transition-colors flex-shrink-0 ${isActive ? "text-accent" : "text-slate-400 group-hover:text-black dark:group-hover:text-white"}`}
                  />

                  {!isCollapsed && (
                    <span className="relative z-10 whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 bg-slate-50 dark:bg-[#0B151B] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 shadow-sm z-49">
          <div className="flex items-center space-x-2">
            {!isLoading && role && (
              <div className="flex items-center space-x-2 px-3 py-1.5 rounded-md bg-slate-100 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700">
                <span className="text-[8px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-widest">
                  {role.replace("_", "-")}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-6">
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? (
                <Sun className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              ) : (
                <Moon className="w-5 h-5 text-slate-600" />
              )}
            </button>
            <NotificationBell />
            <div className="flex items-center space-x-4">
              {user?.firstName && (
                <span className="text-sm text-slate-700 dark:text-slate-300 font-bold tracking-tight">
                  {user.firstName}
                </span>
              )}
              <UserButton
                appearance={{
                  elements: {
                    avatarBox:
                      "w-8 h-8 border border-slate-200 shadow-sm transition-all hover:scale-105",
                  },
                }}
              />
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-8 bg-bg-main dark:bg-[#131D22]">
          <Outlet />
        </main>
        {isAdmin && <ChatSidebar />}
      </div>
    </div>
  )
}
