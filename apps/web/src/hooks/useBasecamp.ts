import { useQuery, useMutation } from "@tanstack/react-query"
import { useAuthAxios } from "../lib/useAuthAxios"

export interface BasecampProject {
  id: number
  name: string
}

export interface BasecampOrderDetails {
  projectName: string
  clientName: string
  basecampProjectId: string
}

export function useBasecampProjects() {
  const api = useAuthAxios()

  return useQuery({
    queryKey: ["basecamp-projects"],
    queryFn: async () => {
      const { data } = await api.get<BasecampProject[]>("/api/basecamp/projects")
      return data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Do not retry on 403
  })
}

export function useFetchBasecampOrderDetails() {
  const api = useAuthAxios()

  return useMutation({
    mutationFn: async (projectId: string | number) => {
      const { data } = await api.get<BasecampOrderDetails>(`/api/basecamp/projects/${projectId}/order-details`)
      return data
    },
  })
}
