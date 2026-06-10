import { useQuery } from '@tanstack/react-query';
import { useAuthAxios } from '../lib/useAuthAxios';
import { getDashboardStats, DashboardStats } from '../api/dashboard.api';
import { useAuth } from '@clerk/react';
import { useRole } from './useRole';

export const useDashboardStats = () => {
  const axios = useAuthAxios();
  const { isLoaded, userId, orgId: clerkOrgId } = useAuth();
  const { profile } = useRole();
  const orgId = clerkOrgId || profile?.org_id;

  return useQuery<DashboardStats>({
    queryKey: ['dashboard-stats', orgId],
    queryFn: () => getDashboardStats(axios, orgId || ''),
    enabled: isLoaded && !!userId && !!orgId,
  });
};
