import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { exchangeTedTicket } from "@/hooks/useQaccSession"

/**
 * Landing page for the TED SSO handoff: <QACC origin>/sso?ted_sso=<ticket>.
 * Exchanges the ticket with QACC's backend for a qacc_session cookie, then
 * sends the user into the app. A missing/invalid/expired ticket falls back to
 * the normal login page.
 */
export function SsoCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const ticket = params.get("ted_sso")
    // Scrub the ticket from the URL immediately regardless of outcome, so it
    // never lingers in browser history or gets copy-pasted.
    window.history.replaceState(null, "", "/sso")

    if (!ticket) {
      navigate("/login", { replace: true })
      return
    }

    exchangeTedTicket(ticket).then((ok) => {
      if (ok) {
        navigate("/projects", { replace: true })
      } else {
        setFailed(true)
      }
    })
    // Only ever run once per mount — re-running on a `params` identity change
    // would re-submit an already-scrubbed ticket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (failed) {
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
          This QACC sign-in link is no longer valid. Open QACC again from TED,
          or sign in below.
        </div>
        <a href="/login" style={{ color: "#34d399", fontSize: 14 }}>
          Go to sign in
        </a>
      </div>
    )
  }

  return null
}
