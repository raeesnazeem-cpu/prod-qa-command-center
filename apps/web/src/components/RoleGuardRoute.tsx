import { ReactNode } from "react"
import { useRole } from "@/hooks/useRole"
import { UnauthorizedPage } from "@/pages/UnauthorizedPage"
import { Role } from "@/store/appStore"
import { Loader2 } from "lucide-react"

interface RoleGuardRouteProps {
  minRole: Role
  children: ReactNode
}

export const RoleGuardRoute = ({ minRole, children }: RoleGuardRouteProps) => {
  const { canDo, isLoading } = useRole()

  if (isLoading) {
    const isDark = typeof window !== "undefined" && (localStorage.getItem("theme") === "dark" || (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches));
    return (
      <div className={isDark ? "dark w-full h-full" : "w-full h-full"}>
        <div className="relative flex flex-col items-center justify-center min-h-[60vh] dark:bg-[#131d22] font-sans overflow-hidden">
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-emerald-200/5 dark:bg-teal-500/5 rounded-full blur-3xl animate-gemini-glow"></div>
          </div>
          <div className="relative z-10 flex flex-col items-center space-y-4 animate-pulse">
            <img
              src="https://growth99.com/storage/2024/09/LOGO.svg"
              alt="QACC Logo"
              className="h-12 w-12 dark:hidden block"
              style={{ objectFit: "contain" }}
            />
            <img
              src="https://aspire-cc.com/storage/2026/03/G99-Logo.svg"
              alt="QACC Logo"
              className="h-12 w-12 hidden dark:block"
              style={{ objectFit: "contain" }}
            />
            <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest">
              Verifying Authorization...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!canDo(minRole)) {
    return <UnauthorizedPage />
  }

  return <>{children}</>
}
