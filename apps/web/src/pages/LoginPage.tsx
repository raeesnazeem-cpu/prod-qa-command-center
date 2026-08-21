import { useSearchParams } from "react-router-dom"

const TED_BASE_URL = import.meta.env.VITE_TED_BASE_URL || ""

function errorMessage(code: string | null): string | null {
  if (!code) return null
  if (code === "invalid_or_expired_ticket") {
    return "Your TED sign-in link expired or was invalid. Please try again."
  }
  return "Something went wrong signing you in."
}

// Same card layout as website-build-tool's /login (public/login.html): a
// small dark logo badge, product name + subtitle, a full-width dark button,
// and a muted footnote — just QACC's own copy instead of the build tool's.
export const LoginPage = () => {
  const [params] = useSearchParams()
  const message = errorMessage(params.get("error"))

  // QACC's own origin is what TED validates the return address against
  // (registered as QACC_URL on TED's side). The ticket lands on /sso, which
  // exchanges it with QACC's backend for a qacc_session cookie.
  const returnTo = `${window.location.origin}/sso`
  const tedLoginUrl = TED_BASE_URL
    ? `${TED_BASE_URL}/login?qaccReturnTo=${encodeURIComponent(returnTo)}`
    : ""

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-[360px] text-center bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(16,16,20,.04),0_12px_32px_rgba(16,16,20,.07)] px-8 py-9">
        <div className="w-11 h-11 rounded-xl mx-auto mb-[18px] bg-slate-900 text-white flex items-center justify-center font-extrabold text-xl">
          Q
        </div>

        <h1 className="text-[19px] font-extrabold tracking-tight text-slate-900">
          QACC
        </h1>
        <p className="mt-1 mb-[26px] text-[12.5px] font-semibold text-slate-500">
          QA Command Center
        </p>

        {message && (
          <div className="mb-4 text-left text-[12.5px] text-red-600 bg-red-50 rounded-[10px] px-3 py-2.5">
            {message}
          </div>
        )}

        {tedLoginUrl ? (
          <>
            <a
              href={tedLoginUrl}
              className="w-full inline-flex items-center justify-center gap-2 bg-slate-900 hover:opacity-90 text-white rounded-[10px] px-4 py-[11px] text-sm font-bold transition-opacity"
            >
              Continue with TED
            </a>
            <p className="mt-4 text-[11.5px] text-slate-500">
              You'll be brought right back here once you're signed in.
            </p>
          </>
        ) : (
          <div className="text-left text-[12.5px] text-red-600 bg-red-50 rounded-[10px] px-3 py-2.5">
            TED sign-in isn't configured on this deployment. Ask an admin to
            set VITE_TED_BASE_URL.
          </div>
        )}
      </div>
    </div>
  )
}
