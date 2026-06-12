import { useMemo } from "react"
import { useAuth } from "@clerk/react"
import axios, { AxiosInstance } from "axios"
import { useAppStore } from "../store/appStore"
import toast from "react-hot-toast"

export const useAuthAxios = (): AxiosInstance => {
  const { getToken, userId } = useAuth()

  const authAxios = useMemo(() => {
    const instance = axios.create({
      baseURL: import.meta.env.VITE_API_URL || "http://localhost:3001",
      headers: {
        "Content-Type": "application/json",
      },
    })

    instance.interceptors.request.use(
      async (config) => {
        const token = await getToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }

        const appState = useAppStore.getState()
        if (appState.user?.id && appState.user.id !== userId) {
          config.headers["X-Impersonate-User"] = appState.user.id
        }

        return config
      },
      (error) => {
        return Promise.reject(error)
      },
    )

        instance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          console.error("Unauthorized access - token may be invalid")
        }
        
        // Catch Basecamp 403 Error and show the Connect button popup
        if (error.response?.status === 403 && error.response?.data?.error?.includes("Basecamp account")) {
          toast((t) => (
            <div className="flex flex-col gap-2">
              <span className="font-bold text-sm text-slate-900 dark:text-white">Action Required</span>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                You need to connect your personal Basecamp account to push tasks.
              </span>
              <button 
                onClick={() => {
                  toast.dismiss(t.id);
                  window.location.href = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/basecamp/user-auth`;
                }}
                className="mt-2 bg-[#F5D88D] text-black hover:bg-[#E5C87D] font-bold text-xs py-1.5 px-3 rounded shadow-sm transition-colors"
              >
                Connect to Basecamp
              </button>
            </div>
          ), { duration: Infinity, position: "top-center" });
        }
        
        return Promise.reject(error)
      },
    )


    return instance
  }, [getToken, userId])

  return authAxios
}
