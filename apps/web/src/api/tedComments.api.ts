import { AxiosInstance } from "axios"

export interface TedComment {
  id: string
  project_id: string | null
  qa_run_id: string | null
  ted_task_id: string | null
  target_kind: string | null
  check_factor: string | null
  body_html: string
  event_key: string | null
  source: "report" | "manual" | "status" | "report_raw" | null
  author: string | null
  created_at: string
}

export interface TedCommentRun {
  id: string
  run_type?: "pre_release" | "post_release" | "internal_qa"
  site_url?: string
  status?: string
  created_at?: string
  custom_name?: string | null
}

export interface TedCommentGroup {
  run: TedCommentRun
  comments: TedComment[]
}

export interface TedCommentsResponse {
  groups: TedCommentGroup[]
  unlinked: TedComment[]
}

export interface CreateTedCommentInput {
  project_id: string
  body_html: string
  qa_run_id?: string | null
  ted_task_id?: string | null
  check_factor?: string | null
}

export const getTedComments = async (
  axios: AxiosInstance,
  projectId: string,
): Promise<TedCommentsResponse> => {
  const { data } = await axios.get<TedCommentsResponse>(
    `/api/ted-comments?project_id=${encodeURIComponent(projectId)}`,
  )
  return data
}

export const createTedComment = async (
  axios: AxiosInstance,
  input: CreateTedCommentInput,
): Promise<TedComment> => {
  const { data } = await axios.post<TedComment>("/api/ted-comments", input)
  return data
}

export const deleteTedComment = async (
  axios: AxiosInstance,
  id: string,
): Promise<void> => {
  await axios.delete(`/api/ted-comments/${id}`)
}

export const deleteAllTedComments = async (
  axios: AxiosInstance,
  projectId: string,
): Promise<void> => {
  await axios.delete(
    `/api/ted-comments?project_id=${encodeURIComponent(projectId)}`,
  )
}
