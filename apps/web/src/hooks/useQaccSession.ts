import { useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001"

export interface QaccSession {
  email: string
  name: string
  photo: string
}

const SESSION_QUERY_KEY = ["qacc-session"]

async function fetchSession(): Promise<QaccSession | null> {
  try {
    const { data } = await axios.get(`${API_URL}/api/auth/me`, {
      withCredentials: true,
    })
    if (!data?.email) return null
    return { email: data.email, name: data.name || "", photo: data.photo || "" }
  } catch {
    return null
  }
}

/**
 * QACC's own session state — backed by the qacc_session HttpOnly cookie the
 * backend sets after verifying a TED SSO ticket (see routes/auth.ts). Never
 * reads TED's own auth state directly; QACC decides for itself what "signed
 * in" means, exactly like g99-web-audit's cro_session.
 */
export function useQaccSession() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 60_000,
    retry: false,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })

  const logout = async () => {
    try {
      await axios.post(`${API_URL}/api/auth/logout`, {}, { withCredentials: true })
    } catch {
      // Still clear local state even if the network call fails.
    }
    queryClient.setQueryData(SESSION_QUERY_KEY, null)
  }

  return { session: data ?? null, isLoading, refresh, logout }
}

/**
 * Exchanges a TED SSO ticket for a qacc_session cookie — used both by the
 * initial "Continue with TED" login (SsoCallback) and by TedSessionGuard's
 * periodic silent-check refresh.
 */
export async function exchangeTedTicket(ticket: string): Promise<boolean> {
  try {
    await axios.post(
      `${API_URL}/api/auth/ted-exchange`,
      { ticket },
      { withCredentials: true },
    )
    return true
  } catch {
    return false
  }
}
