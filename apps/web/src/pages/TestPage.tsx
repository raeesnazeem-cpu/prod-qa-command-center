import { useState, useEffect } from "react"
import { useAuth } from "@clerk/react"
import { useAuthAxios } from "@/lib/useAuthAxios"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

/**
 * DAY 1 INTEGRATION VERIFICATION CHECKLIST
 *
 * [ ] Clerk login page loads at /login
 * [ ] After login, redirected to /dashboard
 * [ ] /test page shows valid userId
 * [ ] JWT token shown (not empty)
 * [ ] /api/health returns { status: 'ok' } with JWT
 * [ ] /api/me returns user row with role: 'developer' (or 'super_admin' if first user)
 * [ ] User row exists in Supabase users table (check Supabase Dashboard)
 * [ ] RLS prevents access without JWT (test with curl without Authorization header — should get 401)
 */

export const TestPage = () => {
  const { isLoaded, userId, getToken } = useAuth()
  const axios = useAuthAxios()

  const [token, setToken] = useState<string | null>(null)
  const [healthRes, setHealthRes] = useState<any>(null)
  const [meRes, setMeRes] = useState<any>(null)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [loadingMe, setLoadingMe] = useState(false)

  useEffect(() => {
    const fetchToken = async () => {
      if (isLoaded && userId) {
        const t = await getToken()
        setToken(t)
      }
    }
    fetchToken()
  }, [isLoaded, userId, getToken])

  const testHealth = async () => {
    setLoadingHealth(true)
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/health`)
      setHealthRes({ success: true, data: res.data })
    } catch (err: any) {
      setHealthRes({ success: false, error: err.message })
    } finally {
      setLoadingHealth(false)
    }
  }

  const testMe = async () => {
    setLoadingMe(true)
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL}/api/me`)
      setMeRes({ success: true, data: res.data })
    } catch (err: any) {
      setMeRes({ success: false, error: err.message })
    } finally {
      setLoadingMe(false)
    }
  }

  const copyFullToken = async () => {
    const fullToken = await getToken()
    if (fullToken) {
      await navigator.clipboard.writeText(fullToken)
      alert("Full JWT copied to clipboard!")
    }
  }

  if (!isLoaded) {
    return (
      <div className="p-8 flex items-center gap-2">
        <Loader2 className="animate-spin" /> Loading Clerk...
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          Day 1 Integration Test
        </h1>
        <p className="text-slate-500 mt-1">
          Verify end-to-end connectivity between Web, Auth, API, and Database.
        </p>
      </header>

      {/* Clerk Info */}
      <section className="bg-slate-50 p-6 rounded-md border border-slate-200 shadow-sm">
        <h2 className="text-xl font-semibold mb-4 text-slate-900">1. Clerk Auth State</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-100">
            <span className="font-medium text-slate-700">User ID:</span>
            <code className="text-sm bg-slate-100 px-2 py-1 rounded text-slate-900">
              {userId || "Not Logged In"}
            </code>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-100">
            <span className="font-medium text-slate-700">JWT Token (First 50 chars):</span>
            <code className="text-sm bg-slate-100 px-2 py-1 rounded break-all text-slate-900">
              {token ? `${token.substring(0, 50)}...` : "No Token"}
            </code>
          </div>
          <div className="flex items-center gap-2">
            {userId ? (
              <CheckCircle2 className="text-accent" />
            ) : (
              <XCircle className="text-red-500" />
            )}
            <span
              className={
                userId
                  ? "text-accent font-semibold"
                  : "text-red-600 font-semibold"
              }
            >
              {userId ? "Authenticated via Clerk" : "Not Authenticated"}
            </span>
          </div>
          <div className="mt-2">
            <div className="flex justify-between items-center">
              <strong className="text-slate-700">JWT Token (First 50):</strong>
              <button
                onClick={copyFullToken}
                className="btn-unified text-[10px] h-6"
              >
                Copy Full Token
              </button>
            </div>
            <code className="block bg-slate-50 p-2 mt-1 break-all rounded border border-slate-100 text-xs text-slate-600">
              {token ? `${token.substring(0, 50)}...` : "No token found"}
            </code>
          </div>{" "}
        </div>
      </section>

      {/* API Health */}
      <section className="bg-slate-50 p-6 rounded-md border border-slate-200 shadow-sm">
        <h2 className="text-xl font-semibold mb-4 text-slate-900">
          2. API Connectivity (/health)
        </h2>
        <div className="space-y-4">
          <button
            onClick={testHealth}
            disabled={loadingHealth}
            className="btn-unified flex items-center gap-2"
          >
            {loadingHealth && <Loader2 className="animate-spin size-4" />}
            Test API /health
          </button>

          {healthRes && (
            <div
              className={`p-4 rounded border flex items-start gap-3 ${healthRes.success ? "bg-accent/5 border-accent/20" : "bg-red-50 border-red-100"}`}
            >
              {healthRes.success ? (
                <CheckCircle2 className="text-accent shrink-0" />
              ) : (
                <XCircle className="text-red-500 shrink-0" />
              )}
              <div>
                <p
                  className={`font-bold ${healthRes.success ? "text-accent" : "text-red-800"}`}
                >
                  {healthRes.success ? "Success" : "Failed"}
                </p>
                <pre className="text-xs mt-2 overflow-auto max-h-40 text-slate-600 font-mono">
                  {JSON.stringify(healthRes.data || healthRes.error, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Database Sync */}
      <section className="bg-slate-50 p-6 rounded-md border border-slate-200 shadow-sm">
        <h2 className="text-xl font-semibold mb-4 text-slate-900">
          3. Database Sync (/api/me)
        </h2>
        <div className="space-y-4">
          <button
            onClick={testMe}
            disabled={loadingMe}
            className="btn-unified flex items-center gap-2"
          >
            {loadingMe && <Loader2 className="animate-spin size-4" />}
            Test /api/me
          </button>

          {meRes && (
            <div
              className={`p-4 rounded border flex items-start gap-3 ${meRes.success ? "bg-accent/5 border-accent/20" : "bg-red-50 border-red-100"}`}
            >
              {meRes.success ? (
                <CheckCircle2 className="text-accent shrink-0" />
              ) : (
                <XCircle className="text-red-500 shrink-0" />
              )}
              <div>
                <p
                  className={`font-bold ${meRes.success ? "text-accent" : "text-red-800"}`}
                >
                  {meRes.success
                    ? "Success - User Sync Verified"
                    : "Failed - Sync Issues"}
                </p>
                <pre className="text-xs mt-2 overflow-auto max-h-40 text-slate-600 font-mono">
                  {JSON.stringify(meRes.data || meRes.error, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
