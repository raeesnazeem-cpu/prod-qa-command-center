import { AxiosInstance } from "axios"

export interface AiFixRunRow {
  id: string
  run_id: string
  project_id: string
  run_type: string | null
  committed: number
  commit_url: string | null
  created_at: string
}

export interface AiFixFinding {
  check_factor: string
  title: string
  pageUrl: string
  category: string
  fix: string
  applied: boolean
}

export interface AiFixRunDetail extends AiFixRunRow {
  data: { repoUrl?: string | null; findings: AiFixFinding[] }
}

export interface AiFixRunsResponse {
  data: AiFixRunRow[]
  pagination: { page: number; limit: number; total: number }
}

export const getAiFixRuns = async (
  axios: AxiosInstance,
  projectId: string,
  page = 1,
  limit = 20,
): Promise<AiFixRunsResponse> => {
  const res = await axios.get<AiFixRunsResponse>(
    `/api/ai-fix-runs/projects/${projectId}`,
    { params: { page, limit, _t: Date.now() } },
  )
  return res.data
}

export const getAiFixRun = async (
  axios: AxiosInstance,
  id: string,
): Promise<AiFixRunDetail> => {
  const res = await axios.get<AiFixRunDetail>(`/api/ai-fix-runs/${id}`)
  return res.data
}
