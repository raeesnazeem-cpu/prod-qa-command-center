import { AxiosInstance } from 'axios';
import { 
  CreateTaskInput, 
  UpdateTaskInput, 
  CreateCommentInput, 
  RebuttalInput,
  TaskStatus,
  TaskSeverity 
} from '@qacc/shared';

export type { TaskStatus, TaskSeverity } from '@qacc/shared';

export interface Task {
  id: string;
  finding_id?: string;
  project_id: string;
  title: string;
  description: string;
  severity: TaskSeverity;
  status: TaskStatus;
  assigned_to?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  basecamp_task_id?: string;
  basecamp_url?: string;
  gallery_images?: string[];
  findings?: any;
  comments?: TaskComment[];
  rebuttals?: TaskRebuttal[];
  users?: {
    full_name: string;
    email: string;
  };
  creator?: {
    full_name: string;
    email: string;
  };
  projects?: {
    name: string;
  };
  assignees?: {
    taskId: string;
    userId: string;
    name: string;
  }[];
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  is_ai_generated: boolean;
  created_at: string;
  users?: {
    full_name: string;
    email: string;
  };
}

export interface TaskRebuttal {
  id: string;
  task_id: string;
  submitted_by: string;
  text: string;
  screenshot_url?: string;
  created_at: string;
  users?: {
    full_name: string;
    email: string;
  };
}

export interface TaskFilters {
  projectId?: string;
  status?: TaskStatus;
  severity?: TaskSeverity;
  assignedTo?: string;
  createdBy?: string;
}

export const getTasks = async (
  axios: AxiosInstance, 
  filters: TaskFilters
): Promise<{ data: Task[]; pagination: any }> => {
  const params = new URLSearchParams();
  if (filters.projectId) params.append('project_id', filters.projectId);
  if (filters.status) params.append('status', filters.status);
  if (filters.severity) params.append('severity', filters.severity);
  if (filters.assignedTo) params.append('assigned_to', filters.assignedTo);
  if (filters.createdBy) params.append('created_by', filters.createdBy);

  const { data } = await axios.get(`/api/tasks?${params.toString()}`);
  return data;
};

export const getTask = async (axios: AxiosInstance, id: string): Promise<Task> => {
  const { data } = await axios.get<Task>(`/api/tasks/${id}`);
  return data;
};

export const createTask = async (axios: AxiosInstance, taskData: CreateTaskInput): Promise<Task> => {
  const { data } = await axios.post<Task>('/api/tasks', taskData);
  return data;
};

export const updateTask = async (
  axios: AxiosInstance, 
  id: string, 
  taskData: UpdateTaskInput
): Promise<Task> => {
  const { data } = await axios.patch<Task>(`/api/tasks/${id}`, taskData);
  return data;
};

export const assignTask = async (
  axios: AxiosInstance, 
  id: string, 
  userId: string
): Promise<Task> => {
  const { data } = await axios.post<Task>(`/api/tasks/${id}/assign`, { user_id: userId });
  return data;
};

export const addComment = async (
  axios: AxiosInstance, 
  taskId: string, 
  content: string
): Promise<TaskComment> => {
  const commentData: CreateCommentInput = { task_id: taskId, content };
  const { data } = await axios.post<TaskComment>(`/api/tasks/${taskId}/comments`, commentData);
  return data;
};

export const addRebuttal = async (
  axios: AxiosInstance, 
  taskId: string, 
  rebuttalData: Omit<RebuttalInput, 'task_id'>
): Promise<TaskRebuttal> => {
  const fullData: RebuttalInput = { ...rebuttalData, task_id: taskId };
  const { data } = await axios.post<TaskRebuttal>(`/api/tasks/${taskId}/rebuttals`, fullData);
  return data;
};

export const updateFindingStatus = async (
  axios: AxiosInstance, 
  findingId: string, 
  status: 'confirmed' | 'false_positive'
): Promise<any> => {
  const { data } = await axios.patch(`/api/findings/${findingId}/status`, { status });
  return data;
};

export const pushToBasecamp = async (
  axios: AxiosInstance,
  taskId: string
): Promise<{ basecampUrl: string }> => {
  const { data } = await axios.post<{ basecampUrl: string }>(`/api/tasks/${taskId}/basecamp`);
  return data;
};

export const bulkPushToBasecamp = async (
  axios: AxiosInstance,
  taskIds: string[]
): Promise<{ basecampUrl: string; count: number }> => {
  const { data } = await axios.post<{ basecampUrl: string; count: number }>(`/api/tasks/basecamp/bulk-push`, { taskIds });
  return data;
};

export const bulkPushCommentsToBasecamp = async (
  axios: AxiosInstance,
  taskIds: string[],
  status: 'pending' | 'completed'
): Promise<{ success: boolean; count: number; skipped: number }> => {
  const { data } = await axios.post<{ success: boolean; count: number; skipped: number }>(`/api/tasks/basecamp/bulk-comment`, { taskIds, status });
  return data;
};

export const deleteTask = async (
  axios: AxiosInstance,
  id: string
): Promise<void> => {
  await axios.delete(`/api/tasks/${id}`);
};

export const bulkDeleteTasks = async (
  axios: AxiosInstance,
  ids: string[]
): Promise<void> => {
  await axios.post(`/api/tasks/bulk-delete`, { ids });
};

export const getBasecampPeople = async (
  axios: AxiosInstance,
  projectId: string
): Promise<Record<number, { sgid: string; name: string }>> => {
  const { data } = await axios.get<Record<number, { sgid: string; name: string }>>(`/api/basecamp/people`, {
    params: { projectId }
  });
  return data;
};

export const notResolvedTask = async (
  axios: AxiosInstance,
  taskId: string,
  data: { comment: string; assignees: string[] }
): Promise<{ success: boolean }> => {
  const { data: response } = await axios.post<{ success: boolean }>(
    `/api/basecamp/tasks/${taskId}/not-resolved`,
    data
  );
  return response;
};

export const resolveTask = async (
  axios: AxiosInstance,
  taskId: string,
  data: { comment: string; screenshot_url?: string }
): Promise<{ success: boolean }> => {
  const { data: response } = await axios.post<{ success: boolean }>(
    `/api/basecamp/tasks/${taskId}/resolve`,
    data
  );
  return response;
};

export const pushPendingReminder = async (
  axios: AxiosInstance,
  data: { 
    taskIds: string[], 
    assigneeIds: string[], 
    comment: string,
    projectId: string
  }
): Promise<{ success: boolean }> => {
  const { data: response } = await axios.post<{ success: boolean }>(
    `/api/basecamp/pending-reminder`,
    data
  );
  return response;
};
