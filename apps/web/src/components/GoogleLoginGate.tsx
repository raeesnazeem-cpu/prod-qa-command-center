import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  AUTH_ENABLED,
  GOOGLE_CLIENT_ID,
  getStoredToken,
  tokenIsValid,
  setToken,
  applyToken,
  clearToken,
} from "../lib/googleAuth"

declare global {
  interface Window {
    google?: any
  }
}

// Wraps the app. If VITE_GOOGLE_CLIENT_ID is not set, it renders children
// unchanged (gate OFF — zero behavior change). If set, it requires a Google
// sign-in before showing the app. This is a LOGIN gate only.
export function GoogleLoginGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean>(() => {
    if (!AUTH_ENABLED) return true
    const t = getStoredToken()
    if (tokenIsValid(t)) {
      applyToken(t as string)
      return true
    }
    clearToken()
    return false
  })
  const btnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!AUTH_ENABLED || authed) return

    const SCRIPT_ID = "gsi-client-script"
    const init = () => {
      if (!window.google?.accounts?.id || !btnRef.current) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp: any) => {
          if (resp?.credential) {
            setToken(resp.credential)
            setAuthed(true)
          }
        },
      })
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: "filled_black",
        size: "large",
        text: "signin_with",
        shape: "pill",
      })
    }

    if (document.getElementById(SCRIPT_ID)) {
      init()
    } else {
      const s = document.createElement("script")
      s.src = "https://accounts.google.com/gsi/client"
      s.async = true
      s.defer = true
      s.id = SCRIPT_ID
      s.onload = init
      document.body.appendChild(s)
    }
  }, [authed])

  if (!AUTH_ENABLED || authed) return <>{children}</>

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "#0a0f0d",
        color: "#e5e7eb",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>
        QA Command Center
      </div>
      <div style={{ fontSize: 14, opacity: 0.7, maxWidth: 320 }}>
        Sign in with your Growth99 account to continue.
      </div>
      <div ref={btnRef} />
    </div>
  )
}
