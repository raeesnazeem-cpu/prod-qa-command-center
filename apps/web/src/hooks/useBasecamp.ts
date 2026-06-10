import { useQuery } from '@tanstack/react-query';
import { useAuthAxios } from '../lib/useAuthAxios';
import { getBasecampTodoLists, getBasecampTodos } from '../api/tasks.api';

export const useBasecampTodoLists = (projectId: string | undefined) => {
  const axios = useAuthAxios();
  return useQuery({
    queryKey: ['basecamp-todolists', projectId],
    queryFn: () => getBasecampTodoLists(axios, projectId!),
    enabled: !!projectId,
  });
};

export const useBasecampTodos = (projectId: string | undefined, todolistId: string | undefined) => {
  const axios = useAuthAxios();
  return useQuery({
    queryKey: ['basecamp-todos', projectId, todolistId],
    queryFn: () => getBasecampTodos(axios, projectId!, todolistId!),
    enabled: !!projectId && !!todolistId,
  });
};
