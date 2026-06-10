import { useEffect } from 'react';
import { useAuthAxios } from '../lib/useAuthAxios';
import { getBasecampPeople } from '../api/tasks.api';
import { useAppStore } from '../store/appStore';
import { useQuery } from '@tanstack/react-query';

export const useBasecampPeople = (projectId: string | undefined) => {
  const axios = useAuthAxios();
  const setBasecampPeople = useAppStore((state) => state.setBasecampPeople);

  const query = useQuery({
    queryKey: ['basecamp-people', projectId],
    queryFn: () => getBasecampPeople(axios, projectId!),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    if (query.data) {
      setBasecampPeople(query.data);
    }
  }, [query.data, setBasecampPeople]);

  return query;
};
