import { AxiosInstance } from "axios"
import { CreateRunInput, RunStatus } from "@qacc/shared"

export interface QARun {
  id: string
  project_id: string
  run_type: "pre_release" | "post_release"
  site_url: string
  figma_url?: string | null
  enabled_checks: string[]
  is_woocommerce: boolean
  device_matrix: ("desktop" | "tablet" | "mobile")[]
  status: RunStatus
  created_by: string
  created_at: string
  started_at?: string | null
  completed_at?: string | null
  pages_total: number
  pages_processed: number
  progress_percentage?: number
  finding_counts?: Record<string, number>
  created_by_name?: string
  concurrent_scans?: number
  pages?: QAPage[]
  selected_urls?: string[] | null
  is_pinned?: boolean
  custom_name?: string | null
}

export interface CreateFindingInput {
  page_id: string
  run_id: string
  check_factor: string
  severity: "critical" | "high" | "medium" | "low"
  title: string
  description?: string | null
  screenshot_url?: string | null
  context_text?: string | null
  ai_generated?: boolean
}

export interface QAPage {
  id: string
  run_id: string
  url: string
  title?: string | null
  status:
    | "pending"
    | "processing"
    | "done"
    | "failed"
    | "screenshotted"
    | "checked"
  screenshot_url_desktop?: string | null
  screenshot_url_tablet?: string | null
  screenshot_url_mobile?: string | null
  created_at: string
  finding_counts?: Record<string, number>
  progress?: number
  current_step?: string | null
}

export interface QAFinding {
  id: string
  page_id: string
  run_id: string
  check_factor: string
  severity: "critical" | "high" | "medium" | "low"
  title: string
  description?: string | null
  context_text?: string | null
  screenshot_url?: string | null
  gallery_images?: string[]
  status: "open" | "confirmed" | "false_positive"
  ai_generated: boolean
  created_at: string
  updated_at: string
  pages?: {
    url: string
  }
  tasks?: {
    id: string
    status: string
    rebuttals?: {
      id: string
      ai_verdict: "resolved" | "disputed" | null
      ai_confidence: number | null
      ai_reasoning: string | null
    }[]
  }[]
}

export interface QARunsResponse {
  data: QARun[]
  pagination: {
    page: number
    limit: number
    total: number
  }
}

export const createRun = async (
  axios: AxiosInstance,
  data: CreateRunInput,
): Promise<QARun> => {
  const response = await axios.post<QARun>("/api/runs", data)
  return response.data
}

export const fetchUrls = async (
  axios: AxiosInstance,
  siteUrl: string,
): Promise<string[]> => {
  const response = await axios.post<{ urls: string[] }>(
    "/api/runs/fetch-urls",
    { site_url: siteUrl },
  )
  return response.data.urls
}

export const getRuns = async (
  axios: AxiosInstance,
  projectId: string,
  page = 1,
  limit = 20,
): Promise<QARunsResponse> => {
  const response = await axios.get<QARunsResponse>(
    `/api/runs/projects/${projectId}/runs`,
    {
      params: { page, limit, _t: Date.now() },
    },
  )
  return response.data
}

export const getPinnedRuns = async (
  axios: AxiosInstance,
  projectId: string,
): Promise<QARunsResponse> => {
  const response = await axios.get<QARunsResponse>(
    `/api/runs/projects/${projectId}/pinned-runs`,
    {
      params: { _t: Date.now() },
    },
  )
  return response.data
}

export const getRun = async (
  axios: AxiosInstance,
  runId: string,
): Promise<QARun> => {
  const response = await axios.get<QARun>(`/api/runs/${runId}`, {
    params: { _t: Date.now() }, // Cache busting for live progress
  })
  return response.data
}

export const updateRunStatus = async (
  axios: AxiosInstance,
  runId: string,
  status: RunStatus,
): Promise<QARun> => {
  const response = await axios.patch<QARun>(`/api/runs/${runId}/status`, {
    status,
  })
  return response.data
}

export const updateRunPinStatus = async (
  axios: AxiosInstance,
  runId: string,
  is_pinned: boolean,
  custom_name?: string | null,
): Promise<QARun> => {
  const response = await axios.patch<QARun>(`/api/runs/${runId}/pin`, {
    is_pinned,
    custom_name,
  })
  return response.data
}

export const startRun = async (
  axios: AxiosInstance,
  runId: string,
  wp_password?: string,
): Promise<QARun> => {
  const response = await axios.post<QARun>(`/api/runs/${runId}/start`, {
    wp_password,
  })
  return response.data
}

export const signOffRun = async (
  axios: AxiosInstance,
  runId: string,
  notes?: string,
): Promise<any> => {
  const response = await axios.post(`/api/runs/${runId}/sign-off`, { notes })
  return response.data
}

export const getPageFindings = async (
  axios: AxiosInstance,
  pageId: string,
): Promise<QAFinding[]> => {
  const response = await axios.get<QAFinding[]>(
    `/api/runs/pages/${pageId}/findings`,
  )
  return response.data
}

export const updateFinding = async (
  axios: AxiosInstance,
  findingId: string,
  data: Partial<Pick<QAFinding, "severity" | "status">>,
): Promise<QAFinding> => {
  // Use the /api/findings/:id/status endpoint if status is provided
  if (data.status) {
    const response = await axios.patch<QAFinding>(
      `/api/findings/${findingId}/status`,
      { status: data.status },
    )
    return response.data
  }

  const response = await axios.patch<QAFinding>(
    `/api/findings/${findingId}`,
    data,
  )
  return response.data
}

export const createFinding = async (
  axios: AxiosInstance,
  data: CreateFindingInput,
): Promise<QAFinding> => {
  const response = await axios.post<QAFinding>("/api/findings", data)
  return response.data
}
export const deleteRuns = async (
  axios: AxiosInstance,
  runIds: string[],
): Promise<void> => {
  await axios.delete("/api/runs", { data: { runIds } })
}
