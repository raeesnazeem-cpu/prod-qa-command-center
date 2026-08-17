import { Navigate } from "react-router-dom"
import {
  captureSsoTokenFromUrl,
  getStoredToken,
  tokenIsValid,
} from "@/lib/googleAuth"

// Landing page for the TED SSO handoff: https://qacc.raees.dev/sso#token=...
//
// The token is normally captured in main.tsx before React renders, but we call
// captureSsoTokenFromUrl() again here in case this mounted via in-app
// navigation. If we now hold a valid token, drop the user straight into the
// app. Otherwise the link was stale/invalid — send them to the normal login.
export function SsoCallback() {
  captureSsoTokenFromUrl()

  if (tokenIsValid(getStoredToken())) {
    return <Navigate to="/projects" replace />
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: "#0a0f0d",
        color: "#e5e7eb",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800 }}>Sign-in link expired</div>
      <div style={{ fontSize: 14, opacity: 0.7, maxWidth: 340 }}>
        This QACC sign-in link is no longer valid. Open QACC again from TED, or
        sign in below.
      </div>
      <a href="/" style={{ color: "#34d399", fontSize: 14 }}>
        Go to sign in
      </a>
    </div>
  )
}
