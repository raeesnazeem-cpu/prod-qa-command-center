import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useAuthAxios } from '../lib/useAuthAxios';
import { 
  getTasks, 
  getTask, 
  createTask, 
  updateTask, 
  assignTask,
  deleteTask,
  bulkDeleteTasks,
  addComment, 
  addRebuttal,
  pushToBasecamp,
  bulkPushToBasecamp,
  notResolvedTask,
  resolveTask,
  TaskFilters
} from '../api/tasks.api';
import { CreateTaskInput, UpdateTaskInput, RebuttalInput } from '@qacc/shared';
import toast from 'react-hot-toast';

export const useTasks = (filters: TaskFilters) => {
  const axios = useAuthAxios();
  return useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => getTasks(axios, filters),
  });
};

export const useTask = (id: string) => {
  const axios = useAuthAxios();
  return useQuery({
    queryKey: ['tasks', id],
    queryFn: () => getTask(axios, id),
    enabled: !!id,
  });
};

export const useCreateTask = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTaskInput) => createTask(axios, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task created successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to create task');
    },
  });
};

export const useUpdateTask = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskInput }) => 
      updateTask(axios, id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.id] });
      toast.success('Task updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update task');
    },
  });
};

export const useAddComment = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, content }: { taskId: string; content: string }) => 
      addComment(axios, taskId, content),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.taskId] });
      toast.success('Comment added');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to add comment');
    },
  });
};

export const useAddRebuttal = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: Omit<RebuttalInput, 'task_id'> }) => 
      addRebuttal(axios, taskId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.taskId] });
      toast.success('Rebuttal submitted');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to submit rebuttal');
    },
  });
};

export const useAssignTask = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => 
      assignTask(axios, id, userId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.id] });
      toast.success('Task reassigned');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to reassign task');
    },
  });
};

export const usePushToBasecamp = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => pushToBasecamp(axios, taskId),
    onSuccess: (result, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', taskId] });
      
      toast.success(
        (t) => (
          <div className="flex items-center space-x-3">
            <div className="flex flex-col">
              <span className="font-bold text-sm">Pushed to Basecamp</span>
              <a 
                href={result.basecampUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-[#F97316] hover:underline flex items-center mt-1"
                onClick={() => toast.dismiss(t.id)}
              >
                View To-do <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>
          </div>
        ),
        {
          position: 'bottom-left',
          duration: 5000,
        }
      );
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to push to Basecamp');
    },
  });
};
export const useBulkPushToBasecamp = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskIds: string[]) => {
      console.log(`[BasecampSync] Starting push for ${taskIds.length} tasks...`);
      const toastId = toast.loading('Syncing with Basecamp...', { position: 'bottom-left' });
      try {
        const result = await bulkPushToBasecamp(axios, taskIds);
        console.log(`[BasecampSync] Successfully pushed to Basecamp:`, result.basecampUrl);
        return { ...result, toastId };
      } catch (error: any) {
        console.error(`[BasecampSync] API Call Failed:`, error);
        toast.error(error.response?.data?.error || 'Basecamp sync failed', { id: toastId });
        throw error;
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      
      toast.success(
        (t) => (
          <div className="flex items-center space-x-3">
            <div className="flex flex-col">
              <span className="font-bold text-sm">Basecamp Sync Complete</span>
              <a 
                href={result.basecampUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-[#F97316] hover:underline flex items-center mt-1"
                onClick={() => toast.dismiss(t.id)}
              >
                View To-do <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>
          </div>
        ),
        {
          id: result.toastId,
          position: 'bottom-left',
          duration: 5000,
        }
      );
    },
  });
};

export const useDeleteTask = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteTask(axios, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task deleted');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete task');
    },
  });
};

export const useBulkDeleteTasks = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => bulkDeleteTasks(axios, ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Tasks deleted');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete tasks');
    },
  });
};

export const useNotResolvedTask = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: { comment: string; assignees: string[] } }) => 
      notResolvedTask(axios, taskId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.taskId] });
      toast.success('Task re-opened and synced with Basecamp');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update task');
    },
  });
};

export const useResolveTask = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: { comment: string; screenshot_url?: string } }) => 
      resolveTask(axios, taskId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.taskId] });
      toast.success('Task marked as resolved and synced with Basecamp');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update task');
    },
  });
};
