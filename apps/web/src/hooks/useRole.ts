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

  // Headless mode: TED owns auth and the /api/me route was removed in the
  // Phase 1 strip. There is no browser session to profile, so resolve to the
  // synthetic super_admin identity the API/clerk shim already uses. Without
  // this, role is null, canDo() fails, and every role-gated UI element (the
  // project tabs, admin nav) silently disappears.
  const SYSTEM_PROFILE = {
    id: 'system',
    role: 'super_admin' as Role,
    full_name: 'System',
    email: 'system@qacc.internal',
    org_id: 'system',
  };

  const { data: profile, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => SYSTEM_PROFILE,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (profile) {
      setUser(profile);
    }
  }, [profile, setUser]);

  // Apply dev role override if present, else fall back to the system role so the
  // UI is never left role-less (which would hide the tabs).
  const devOverride = getDevRoleOverride();
  const rawRole =
    devOverride ?? user?.role ?? profile?.role ?? SYSTEM_PROFILE.role;
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
