import { AxiosInstance } from 'axios';

import { QARun } from './runs.api';
import { Task } from './tasks.api';

export interface DashboardStats {
  open_issues: number;
  total_runs: number;
  runs_this_week: number;
  my_open_tasks: number;
  projects_count: number;
  recent_runs: QARun[];
  my_tasks: Task[];
  pending_signoffs: QARun[];
  pre_release_projects: any[];
  post_release_projects: any[];
  all_projects: any[];
  qa_projects?: any[];
  dev_projects?: any[];
}

export const getDashboardStats = async (
  axios: AxiosInstance,
  orgId: string
): Promise<DashboardStats> => {
  const { data } = await axios.get<DashboardStats>(`/api/dashboard/stats`, {
    params: { orgId }
  });
  return data;
};
