import { AxiosInstance } from 'axios';

export interface VisualDiffIssue {
  issue: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  area: string;
  type: 'layout' | 'color' | 'typography' | 'missing_element' | 'extra_element' | 'spacing';
}

export interface VisualDiff {
  id: string;
  page_id: string;
  run_id: string;
  figma_screenshot_url: string;
  site_screenshot_url: string;
  ai_summary: { issues: VisualDiffIssue[] };
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  created_at: string;
}

export const getVisualDiff = async (axios: AxiosInstance, pageId: string): Promise<VisualDiff | null> => {
  const response = await axios.get<VisualDiff | null>(`/api/visual-diff/pages/${pageId}/visual-diff`);
  return response.data;
};

export const startVisualDiff = async (axios: AxiosInstance, runId: string): Promise<{ message: string; pageCount: number }> => {
  const response = await axios.post<{ message: string; pageCount: number }>(`/api/visual-diff/runs/${runId}/start-visual-diff`);
  return response.data;
};
