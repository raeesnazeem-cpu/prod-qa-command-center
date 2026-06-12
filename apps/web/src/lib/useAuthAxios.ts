import { useMemo } from "react"
import { useAuth } from "@clerk/react"
import axios, { AxiosInstance } from "axios"
import { useAppStore } from "../store/appStore"

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
        return Promise.reject(error)
      },
    )

    return instance
  }, [getToken, userId])

  return authAxios
}
