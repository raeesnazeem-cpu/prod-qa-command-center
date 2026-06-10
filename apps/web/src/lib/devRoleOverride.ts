import { Role } from '@/store/appStore';

/**
 * Returns a role from the 'devRole' URL parameter if in development mode.
 * Usage: http://localhost:3000/projects?devRole=qa_engineer
 */
export const getDevRoleOverride = (): Role | null => {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const devRole = params.get('devRole') as Role | null;

  const validRoles: Role[] = [
    'developer',
    'qa_engineer',
    'project_manager',
    'sub_admin',
    'admin',
    'super_admin',
  ];

  if (devRole && validRoles.includes(devRole)) {
    return devRole;
  }

  return null;
};
