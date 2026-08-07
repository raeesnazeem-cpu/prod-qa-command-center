import { useQuery } from "@tanstack/react-query"
import { useAuthAxios } from "../lib/useAuthAxios"
import {
  getAiFixRuns,
  getAiFixRun,
  AiFixRunsResponse,
  AiFixRunDetail,
} from "../api/aiFixRuns.api"

export const useAiFixRuns = (projectId: string, page = 1, limit = 20) => {
  const axios = useAuthAxios()
  return useQuery<AiFixRunsResponse>({
    queryKey: ["ai-fix-runs", projectId, page, limit],
    queryFn: () => getAiFixRuns(axios, projectId, page, limit),
    enabled: !!projectId,
  })
}

export const useAiFixRun = (id: string | null) => {
  const axios = useAuthAxios()
  return useQuery<AiFixRunDetail>({
    queryKey: ["ai-fix-run", id],
    queryFn: () => getAiFixRun(axios, id as string),
    enabled: !!id,
  })
}
