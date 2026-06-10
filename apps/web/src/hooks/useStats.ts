import { useQuery } from '@tanstack/react-query';
import { useAuthAxios } from '../lib/useAuthAxios';

export interface DashboardStats {
  stats: {
    activeProjects: number;
    totalRuns: number;
    openIssues: number;
    resolvedToday: number;
  };
  recentActivity: Array<{
    id: string;
    type: 'qa_run';
    projectName: string;
    userName: string;
    timestamp: string;
    status: string;
    runType: string;
  }>;
  priorityTasks: Array<{
    id: string;
    title: string;
    severity: string;
    projectId: string;
    projectName: string;
  }>;
}

export const useStats = () => {
  const axios = useAuthAxios();
  return useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const { data } = await axios.get('/api/stats');
      return data;
    },
  });
};

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  issues: number;
  rebuttals: number;
  genuine: number;
  count: number;
}

export interface LeaderboardResponse {
  topPerformers: {
    developer: LeaderboardEntry | null;
    qa: LeaderboardEntry | null;
  };
  leaderboards: {
    developers: LeaderboardEntry[];
    qas: LeaderboardEntry[];
  };
}

/**
 * Hook for fetching leaderboard data with year/month filters.
 */
export const useLeaderboardStats = (year: string, month: string) => {
  const axios = useAuthAxios();
  return useQuery<LeaderboardResponse>({
    queryKey: ['leaderboard-stats', year, month],
    queryFn: async () => {
      const { data } = await axios.get(`/api/stats/leaderboard?year=${year}&month=${month}`);
      return data;
    },
    // Only fetch if we have valid filters or 'all'
    enabled: !!year && !!month,
  });
};

