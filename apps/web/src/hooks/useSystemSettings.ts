import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuthAxios } from "../lib/useAuthAxios"
import toast from "react-hot-toast"
import axios from "axios"

export interface SystemSettings {
  is_maintenance_mode: boolean
}

export function useSystemSettings() {
  const authAxios = useAuthAxios()
  const queryClient = useQueryClient()

  // Use raw axios for fetch so it works even if user isn't logged in, or use authAxios
  // The backend route /api/system-settings is public
  const fetchSettings = async (): Promise<SystemSettings> => {
    // If we have an auth instance, we can use it, but since it's public we can also use regular axios.
    // However, if VITE_API_URL is needed, authAxios is pre-configured with the base URL.
    const { data } = await authAxios.get("/api/system-settings")
    return data
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["systemSettings"],
    queryFn: fetchSettings,
    refetchInterval: 30000, // Poll every 30 seconds for maintenance updates
  })

  const updateMaintenanceMode = useMutation({
    mutationFn: async (is_maintenance_mode: boolean) => {
      const { data } = await authAxios.patch("/api/admin/maintenance-mode", {
        is_maintenance_mode,
      })
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["systemSettings"] })
      toast.success("Maintenance mode updated successfully")
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || "Failed to update maintenance mode")
    },
  })

  return {
    systemSettings: data,
    isLoading,
    error,
    updateMaintenanceMode,
  }
}
