export type Role = 'super_admin' | 'admin' | 'sub_admin' | 'project_manager' | 'qa_engineer' | 'developer';

export const ROLE_HIERARCHY: Role[] = [
  'developer',
  'qa_engineer',
  'project_manager',
  'sub_admin',
  'admin',
  'super_admin'
];

const ROLE_LEVELS: Record<Role, number> = {
  developer: 1,
  qa_engineer: 2,
  project_manager: 3,
  sub_admin: 4,
  admin: 5,
  super_admin: 6
};

/**
 * Map of endpoint patterns to minimum required role.
 * This is a reference for the API's access control policy.
 */
export const ENDPOINT_PERMISSIONS: Record<string, Role> = {
  'GET /api/projects': 'developer',
  'POST /api/projects': 'sub_admin',
  'GET /api/projects/:id': 'developer',
  'PATCH /api/projects/:id': 'admin',
  'POST /api/projects/:id/members': 'admin',
  'PATCH /api/projects/:id/members/:userId/role': 'admin',
  'GET /api/projects/:id/settings': 'developer',
  'PATCH /api/projects/:id/settings': 'admin',
  'POST /api/projects/:id/settings/test-basecamp': 'admin',
  'GET /api/runs': 'developer',
  'POST /api/runs': 'qa_engineer',
  'GET /api/runs/:id': 'developer',
  'PATCH /api/runs/:id/status': 'qa_engineer',
  'GET /api/tasks': 'developer',
  'POST /api/tasks': 'qa_engineer',
  'PATCH /api/tasks/:id': 'qa_engineer',
  'DELETE /api/tasks/:id': 'admin',
};

/**
 * Checks if a user's role has sufficient permission for a required role.
 * @param userRole The role of the authenticated user
 * @param requiredRole The minimum role required for the action
 * @returns true if user has access, false otherwise
 */
export function canAccess(userRole: string | undefined | null, requiredRole: Role): boolean {
  if (!userRole) return false;
  
  const userLevel = ROLE_LEVELS[userRole as Role];
  const requiredLevel = ROLE_LEVELS[requiredRole];
  
  if (userLevel === undefined || requiredLevel === undefined) {
    return false;
  }
  
  return userLevel >= requiredLevel;
}
