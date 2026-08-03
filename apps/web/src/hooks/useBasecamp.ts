import { useInfiniteQuery, useMutation } from "@tanstack/react-query"
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

  return useInfiniteQuery({
    queryKey: ["basecamp-projects"],
    queryFn: async ({ pageParam = 1 }) => {
      const { data } = await api.get<BasecampProject[]>(`/api/basecamp/projects?page=${pageParam}`)
      return data
    },
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length > 0 ? allPages.length + 1 : undefined
    },
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
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
