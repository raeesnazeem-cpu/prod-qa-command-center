import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthAxios } from '../lib/useAuthAxios';
import { 
  getProjects, 
  getProject, 
  createProject, 
  updateProject, 
  addProjectMember,
  updateProjectMemberRole,
  getWorkspaceUsers,
  transitionProjectReleaseState,
  deleteProject,
  Project,
  ProjectWithMembers,
  WorkspaceMember 
} from '../api/projects.api';
import { CreateProjectInput, UpdateProjectInput } from '@qacc/shared';
import toast from 'react-hot-toast';

export const useProjects = () => {
  const axios = useAuthAxios();
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => getProjects(axios),
    refetchInterval: (query) => {
      const data = query.state.data as Project[] | undefined;
      const hasOngoing = data?.some(p => p.ongoing_run);
      return hasOngoing ? 3000 : false;
    },
  });
};

export const useProject = (id: string) => {
  const axios = useAuthAxios();
  return useQuery<ProjectWithMembers>({
    queryKey: ['projects', id],
    queryFn: () => getProject(axios, id),
    enabled: !!id,
  });
};

export const useCreateProject = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProjectInput) => createProject(axios, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created successfully');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to create project';
      toast.error(message);
    },
  });
};

export const useUpdateProject = (id: string) => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateProjectInput) => updateProject(axios, id, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['projects', id], (old: any) => old ? { ...old, ...data } : old);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', id] });
      toast.success('Project updated successfully');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to update project';
      toast.error(message);
    },
  });
};

export const useDeleteProjects = () => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => deleteProject(axios, id)),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      const deleted = total - failed;
      if (failed === 0) {
        toast.success(`${deleted} project${deleted === 1 ? '' : 's'} deleted`);
      } else {
        toast.error(`Deleted ${deleted}, failed ${failed}`);
      }
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to delete projects';
      toast.error(message);
    },
  });
};

export const useTransitionReleaseState = (id: string) => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (is_pre_release: boolean) => transitionProjectReleaseState(axios, id, is_pre_release),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', id] });
      toast.success('Project state updated successfully');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to update project state';
      toast.error(message);
    },
  });
};

export const useAddProjectMember = (projectId: string) => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      addProjectMember(axios, projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      toast.success('Member added successfully');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to add member';
      toast.error(message);
    },
  });
};

export const useUpdateProjectMemberRole = (projectId: string) => {
  const axios = useAuthAxios();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { userId: string; role: string }) =>
      updateProjectMemberRole(axios, projectId, data.userId, data.role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      toast.success('Member role updated');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to update role';
      toast.error(message);
    },
  });
};

export const useWorkspaceUsers = () => {
  const axios = useAuthAxios();
  return useQuery<WorkspaceMember[]>({
    queryKey: ['workspace-users'],
    queryFn: () => getWorkspaceUsers(axios),
    staleTime: 0,
  });
};
