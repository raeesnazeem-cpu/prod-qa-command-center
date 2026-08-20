import { useEffect, useRef, useState } from "react"
import { ChevronDown, LogOut } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useQaccSession } from "@/hooks/useQaccSession"

/** Profile chip + dropdown with "Log out" — backed by qacc_session, not Clerk. */
export function ProfileMenu() {
  const { session, logout } = useQaccSession()
  const [open, setOpen] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  // Reset the broken-image fallback whenever the session's photo URL changes
  // (fresh login, or a refreshed session picking up an updated photo).
  useEffect(() => {
    setPhotoFailed(false)
  }, [session?.photo])

  if (!session) return null

  const handleLogout = async () => {
    setOpen(false)
    await logout()
    // Deliberately never touches TED — no redirect there, no TED-side
    // sign-out call — so logging out of QACC leaves TED signed in.
    navigate("/login", { replace: true })
  }

  const name = session.name || session.email
  const initial = (name || "?").charAt(0).toUpperCase()
  const showPhoto = !!session.photo && !photoFailed

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors py-1 pl-1 pr-2"
      >
        {showPhoto ? (
          <img
            src={session.photo}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setPhotoFailed(true)}
            className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-slate-900 dark:bg-slate-700 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
            {initial}
          </div>
        )}
        <span className="hidden sm:block text-sm font-bold text-slate-700 dark:text-slate-200 max-w-[160px] truncate">
          {name}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-[#0B151B] border border-slate-200 dark:border-slate-800 rounded-md shadow-lg z-[70] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {name}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {session.email}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center space-x-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Log out</span>
          </button>
        </div>
      )}
    </div>
  )
}
