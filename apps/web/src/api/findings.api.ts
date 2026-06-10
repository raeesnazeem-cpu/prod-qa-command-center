import { AxiosInstance } from 'axios';
import { QAFinding } from './runs.api';

export interface FindingFilters {
  runId?: string;
  pageId?: string;
  status?: string;
  checkFactor?: string;
  severity?: string;
}

export const updateFindingStatus = async (
  axios: AxiosInstance,
  id: string,
  status: 'open' | 'confirmed' | 'false_positive'
): Promise<QAFinding> => {
  const response = await axios.patch<QAFinding>(`/api/findings/${id}/status`, { status });
  return response.data;
};

export const updateFindingSeverity = async (
  axios: AxiosInstance,
  id: string,
  severity: 'critical' | 'high' | 'medium' | 'low'
): Promise<QAFinding> => {
  const response = await axios.patch<QAFinding>(`/api/findings/${id}`, { severity });
  return response.data;
};

export const addToSpellingAllowlist = async (
  axios: AxiosInstance,
  projectId: string,
  word: string
): Promise<{ success: boolean }> => {
  const response = await axios.post<{ success: boolean }>(`/api/projects/${projectId}/spelling-allowlist`, { word });
  return response.data;
};

export const getFindings = async (
  axios: AxiosInstance,
  filters: FindingFilters
): Promise<QAFinding[]> => {
  const response = await axios.get<QAFinding[]>('/api/findings', { params: filters });
  return response.data;
};
