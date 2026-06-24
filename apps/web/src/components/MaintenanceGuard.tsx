import { Outlet } from "react-router-dom"
import { useRole } from "../hooks/useRole"
import { useSystemSettings } from "../hooks/useSystemSettings"
import { MaintenancePage } from "../pages/MaintenancePage"

export const MaintenanceGuard = () => {
  const { role } = useRole()
  const { systemSettings, isLoading } = useSystemSettings()

  // Wait until settings are loaded to prevent flicker
  // If there's an error fetching settings, we can default to showing the app
  // or checking what the error is. We'll just pass through if isLoading is true.
  if (isLoading) {
    // Optionally return a full screen loader or null to prevent flickering
    return null
  }

  const isMaintenanceMode = systemSettings?.is_maintenance_mode ?? false
  const isSuperAdmin = role === "super_admin"

  if (isMaintenanceMode && !isSuperAdmin) {
    return <MaintenancePage />
  }

  return <Outlet />
}
