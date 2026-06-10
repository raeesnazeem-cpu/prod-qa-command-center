import { supabase } from '../lib/supabase';

/**
 * Find a project by name using fuzzy matching.
 */
export async function findProjectByName(name: string, orgId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, site_url')
    .eq('org_id', orgId)
    .ilike('name', `%${name}%`)
    .limit(5);

  if (error) throw error;
  return data;
}

/**
 * Find multiple projects by name using fuzzy matching.
 */
export async function findProjectsByNames(names: string[], orgId: string) {
  const results: any[] = [];
  for (const name of names) {
    const { data } = await supabase
      .from('projects')
      .select('id, name, site_url')
      .eq('org_id', orgId)
      .ilike('name', `%${name}%`)
      .limit(3);
    if (data) results.push(...data);
  }
  // De-duplicate results by ID
  return Array.from(new Map(results.map(item => [item.id, item])).values());
}

/**
 * Get project findings statistics grouped by status and severity.
 */
export async function getProjectStats(projectId: string) {
  const { data: runs } = await supabase
    .from('qa_runs')
    .select('id')
    .eq('project_id', projectId);

  const runIds = runs?.map(r => r.id) || [];
  if (runIds.length === 0) return { findings: [] };

  const { data, error } = await supabase
    .from('findings')
    .select('status, severity')
    .in('run_id', runIds);

  if (error) throw error;
  return { findings: data };
}

/**
 * Get project task statistics grouped by status.
 */
export async function getTaskStats(projectId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('status, severity')
    .eq('project_id', projectId);

  if (error) throw error;
  return { tasks: data };
}

/**
 * List all developers assigned to a project.
 */
export async function getDevelopersForProject(projectId: string) {
  const { data, error } = await supabase
    .from('project_members')
    .select('role, users(id, full_name, email)')
    .eq('project_id', projectId)
    .eq('role', 'developer');

  if (error) throw error;
  return data.map((m: any) => m.users);
}

/**
 * List all QA engineers assigned to a project.
 */
export async function getQAForProject(projectId: string) {
  const { data, error } = await supabase
    .from('project_members')
    .select('role, users(id, full_name, email)')
    .eq('project_id', projectId)
    .eq('role', 'qa_engineer');

  if (error) throw error;
  return data.map((m: any) => m.users);
}

/**
 * List all members of a project with their roles.
 */
export async function getProjectMembers(projectId: string) {
  const { data, error } = await supabase
    .from('project_members')
    .select('role, users(id, full_name, email)')
    .eq('project_id', projectId);

  if (error) throw error;
  return data.map((m: any) => ({
    role: m.role,
    ...m.users
  }));
}

/**
 * Get the pre-release or post-release status of a project.
 */
export async function getProjectPreReleaseStatus(projectId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('is_pre_release')
    .eq('id', projectId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get the Basecamp project link for a project.
 */
export async function getProjectBasecampLink(projectId: string) {
  const { data, error } = await supabase
    .from('project_settings')
    .select('basecamp_account_id, basecamp_project_id')
    .eq('project_id', projectId)
    .single();

  if (error) throw error;
  if (!data?.basecamp_account_id || !data?.basecamp_project_id) {
    return { link: null, message: 'Basecamp not configured for this project' };
  }

  return {
    link: `https://3.basecamp.com/${data.basecamp_account_id}/projects/${data.basecamp_project_id}`
  };
}

/**
 * Get the count of open tasks assigned to each developer in a project.
 */
export async function getIssueCountsByDeveloper(projectId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('assigned_to, users(full_name, email)')
    .eq('project_id', projectId)
    .eq('status', 'open');

  if (error) throw error;

  const counts: Record<string, any> = {};
  data.forEach((t: any) => {
    if (!t.assigned_to) return;
    const name = t.users?.full_name || t.users?.email || 'Unknown';
    if (!counts[name]) counts[name] = 0;
    counts[name]++;
  });

  return counts;
}

/**
 * Get the count of findings reported by each QA engineer in a project.
 */
export async function getIssueCountsByQA(projectId: string) {
  const { data: runs } = await supabase
    .from('qa_runs')
    .select('id, created_by, users(full_name, email)')
    .eq('project_id', projectId);

  if (!runs) return {};

  const runMap = new Map(runs.map(r => [r.id, r.users?.full_name || r.users?.email || 'Unknown']));
  const { data: findings, error } = await supabase
    .from('findings')
    .select('run_id')
    .in('run_id', Array.from(runMap.keys()));

  if (error) throw error;

  const counts: Record<string, number> = {};
  findings.forEach((f: any) => {
    const qaName = runMap.get(f.run_id) || 'Unknown';
    counts[qaName] = (counts[qaName] || 0) + 1;
  });

  return counts;
}

/**
 * List all users in the organization.
 */
export async function getAllOrgUsers(orgId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .eq('org_id', orgId);

  if (error) throw error;
  return data;
}

/**
 * Find a user by their email address.
 */
export async function getUserByEmail(email: string, orgId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .eq('email', email)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * List all projects in the organization.
 */
export async function listProjects(orgId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, site_url')
    .eq('org_id', orgId);

  if (error) throw error;
  return data;
}

/**
 * Find a user by name using fuzzy matching.
 */
export async function findUserByName(name: string, orgId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .eq('org_id', orgId)
    .ilike('full_name', `%${name}%`)
    .limit(5);

  if (error) throw error;
  return data;
}

/**
 * Get all tasks assigned to a specific user.
 */
export async function getTasksByUserId(userId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id, 
      title, 
      status, 
      severity, 
      project_id, 
      projects (
        name
      )
    `)
    .eq('assigned_to', userId)
    .neq('status', 'closed')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}
/**
 * Get task counts by status for a specific user.
 */
export async function getUserTaskStats(userId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('status')
    .eq('assigned_to', userId);

  if (error) throw error;

  const stats = data.reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  return stats;
}

/**
 * Get task counts by status for the whole organization.
 */
export async function getOrgTaskStats(orgId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('status, projects!inner(org_id)')
    .eq('projects.org_id', orgId);

  if (error) throw error;

  const stats = data.reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  return stats;
}

/**
 * Get all projects assigned to a specific user.
 */
export async function getUserProjects(userId: string) {
  const { data, error } = await supabase
    .from('project_members')
    .select(`
      role,
      projects (
        id,
        name,
        site_url
      )
    `)
    .eq('user_id', userId);

  if (error) throw error;
  return data.map((m: any) => ({
    role: m.role,
    ...m.projects
  }));
}

