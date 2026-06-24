import { Settings } from "lucide-react"

export const MaintenancePage = () => {
  const isDark =
    typeof window !== "undefined" &&
    (localStorage.getItem("theme") === "dark" ||
      (!localStorage.getItem("theme") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches))

  return (
    <div className={isDark ? "dark w-full h-full" : "w-full h-full"}>
      <div className="relative min-h-screen flex flex-col items-center justify-center bg-bg-main dark:bg-[#131d22] font-sans overflow-hidden">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-emerald-200/5 dark:bg-teal-500/5 rounded-full blur-3xl animate-gemini-glow"></div>
        </div>
        <div className="relative z-10 flex flex-col items-center space-y-6 text-center max-w-lg px-6">
          <div className="p-4 bg-emerald-100 dark:bg-emerald-900/30 rounded-full">
            <Settings className="w-12 h-12 text-emerald-600 dark:text-emerald-400 animate-spin-slow" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            System Under Maintenance
          </h1>
          <p className="text-slate-600 dark:text-slate-300 text-lg">
            We are currently performing scheduled maintenance to improve your experience.
            Please check back later.
          </p>
        </div>
      </div>
    </div>
  )
}
