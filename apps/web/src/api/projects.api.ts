import { AxiosInstance } from 'axios';
import { CreateProjectInput, UpdateProjectInput } from '@qacc/shared';

export interface Project {
  id: string;
  name: string;
  site_url: string;
  client_name?: string;
  is_woocommerce: boolean;
  is_pre_release: boolean;
  status: 'active' | 'archived' | 'paused';
  org_id: string;
  created_at: string;
  updated_at: string;
  open_issues_count: number;
  last_run_date: string | null;
  ongoing_run?: {
    id: string;
    status: 'pending' | 'running' | 'paused';
    pages_processed: number;
    pages_total: number;
    created_by_name: string;
  } | null;
  concurrent_scans?: number;
  figma_access_token?: string;
  basecamp_account_id?: string;
  basecamp_project_id?: string;
  basecamp_todo_list_id?: string;
  basecamp_post_todo_list_id?: string;
  basecamp_api_token?: string;
}

export interface ProjectMember {
  role: 'admin' | 'sub_admin' | 'qa_engineer' | 'developer';
  user_id: string;
  users: {
    full_name: string;
    email: string;
    role: string;
  };
}

export interface ProjectWithMembers extends Project {
  project_members: ProjectMember[];
  total_runs_count: number;
  resolved_issues_count: number;
}

export const getProjects = async (axios: AxiosInstance): Promise<Project[]> => {
  const { data } = await axios.get<Project[]>('/api/projects');
  return data;
};

export const getProject = async (axios: AxiosInstance, id: string): Promise<ProjectWithMembers> => {
  const { data } = await axios.get<ProjectWithMembers>(`/api/projects/${id}`);
  return data;
};

export const createProject = async (axios: AxiosInstance, projectData: CreateProjectInput): Promise<Project> => {
  const { data } = await axios.post<Project>('/api/projects', projectData);
  return data;
};

export const updateProject = async (
  axios: AxiosInstance,
  id: string,
  projectData: UpdateProjectInput
): Promise<Project> => {
  const { data } = await axios.patch<Project>(`/api/projects/${id}`, projectData);
  return data;
};

export const addProjectMember = async (
  axios: AxiosInstance,
  projectId: string,
  memberData: { email: string; role: string }
): Promise<any> => {
  const { data } = await axios.post(`/api/projects/${projectId}/members`, memberData);
  return data;
};

export const updateProjectMemberRole = async (
  axios: AxiosInstance,
  projectId: string,
  userId: string,
  role: string
): Promise<any> => {
  const { data } = await axios.patch(`/api/projects/${projectId}/members/${userId}/role`, { role });
  return data;
};

export const deleteProject = async (axios: AxiosInstance, id: string): Promise<void> => {
  await axios.delete(`/api/projects/${id}`);
};

export interface WorkspaceMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

export const getWorkspaceUsers = async (axios: AxiosInstance): Promise<WorkspaceMember[]> => {
  const { data } = await axios.get<WorkspaceMember[]>('/api/users');
  return data;
};
