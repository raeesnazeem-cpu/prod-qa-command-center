import { useQuery } from '@tanstack/react-query';
import { useAuthAxios } from '../lib/useAuthAxios';

export interface AssignedUser {
  id: string;
  full_name: string;
  email: string;
}

export const useFindingTasks = (findingId: string) => {
  const axios = useAuthAxios();

  return useQuery<AssignedUser[]>({
    queryKey: ['finding-tasks', findingId],
    queryFn: async () => {
      const { data } = await axios.get(`/api/tasks`, {
        params: { finding_id: findingId }
      });
      
      const rawUsers = (data.data || []).flatMap((task: any) => 
        task.users ? [{ id: task.assigned_to, ...task.users }] : []
      );

      // Deduplicate by user ID
      const uniqueUsers = Array.from(
        new Map(rawUsers.map((u: any) => [u.id, u])).values()
      );
      
      return uniqueUsers;
    },
    enabled: !!findingId,
    staleTime: 1000 * 60, // 1 minute
  });
};
