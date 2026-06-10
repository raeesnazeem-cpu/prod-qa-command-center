import { Navigate, Outlet } from "react-router-dom"
import { useAuth } from "@clerk/react"

export const ProtectedRoute = () => {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
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
          <div className="relative z-10 flex flex-col items-center space-y-4 animate-pulse">
            <img
              src="https://growth99.com/storage/2024/09/LOGO.svg"
              alt="QACC Logo"
              className="h-72 w-72 dark:hidden block"
              style={{ objectFit: "contain" }}
            />
            <img
              src="https://aspire-cc.com/storage/2026/03/G99-Logo.svg"
              alt="QACC Logo"
              className="h-72 w-72 hidden dark:block"
              style={{ objectFit: "contain" }}
            />
          </div>
        </div>
      </div>
    )
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
