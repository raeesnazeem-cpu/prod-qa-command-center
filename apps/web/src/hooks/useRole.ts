import { useQuery } from '@tanstack/react-query';
import { useAuthAxios } from '@/lib/useAuthAxios';
import { useAppStore, Role } from '@/store/appStore';
import { useEffect } from 'react';
import { getDevRoleOverride } from '@/lib/devRoleOverride';

const ROLE_HIERARCHY: Role[] = [
  'developer',
  'qa_engineer',
  'project_manager',
  'sub_admin',
  'admin',
  'super_admin',
];

interface UseRoleReturn {
  role: Role | null;
  profile: any | null;
  isAdmin: boolean;
  isSubAdmin: boolean;
  isProjectManager: boolean;
  isQaEngineer: boolean;
  isDeveloper: boolean;
  canDo: (minRole: Role) => boolean;
  isLoading: boolean;
}

export const useRole = (): UseRoleReturn => {
  const axios = useAuthAxios();
  const { user, setUser } = useAppStore();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await axios.get('/api/me');
      return response.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    if (profile) {
      setUser(profile);
    }
  }, [profile, setUser]);

  // Apply dev role override if present
  const devOverride = getDevRoleOverride();
  const rawRole = devOverride ?? user?.role ?? profile?.role ?? null;
  const role = (() => {
    if (!rawRole) return null;
    const normalized = rawRole.toLowerCase().replace(/[\s-]/g, '_');
    if (normalized === 'qa') return 'qa_engineer' as Role;
    return normalized as Role;
  })();

  const getRoleLevel = (r: Role | null): number => {
    if (!r) return -1;
    return ROLE_HIERARCHY.indexOf(r);
  };

  const canDo = (minRole: Role): boolean => {
    const userLevel = getRoleLevel(role);
    const requiredLevel = getRoleLevel(minRole);
    return userLevel >= requiredLevel;
  };

  return {
    role,
    profile: profile || user,
    isAdmin: role === 'admin' || role === 'super_admin',
    isSubAdmin: role === 'sub_admin',
    isProjectManager: role === 'project_manager',
    isQaEngineer: role === 'qa_engineer',
    isDeveloper: role === 'developer',
    canDo,
    isLoading,
  };
};
