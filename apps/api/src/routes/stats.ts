import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { clerkAuth } from '../middleware/clerkAuth';
import * as statsService from '../services/statsService';


const router: Router = Router();

/**
 * Helper to get Supabase user UUID from Clerk ID
 */
async function getSupabaseUserId(clerkId: string): Promise<string> {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_user_id', clerkId)
    .single();
  
  if (error || !data) {
    throw new Error(`User not synced: ${clerkId}`);
  }
  return data.id;
}

/**
 * GET /api/stats
 * Get global statistics for the dashboard.
 */
router.get('/', clerkAuth, async (req: Request, res: Response) => {
  const { orgId, userId: clerkUserId } = req.auth!;

  if (!orgId) {
    return res.status(400).json({ error: 'Organization ID is required' });
  }

  try {
    const supabaseUserId = await getSupabaseUserId(clerkUserId);

    // 1. Get project IDs for the organization where the user is a member
    const { data: memberProjects, error: memberError } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', supabaseUserId);

    if (memberError) throw memberError;
    const projectIds = memberProjects.map(p => p.project_id);

    if (projectIds.length === 0) {
      return res.json({
        stats: {
          activeProjects: 0,
          totalRuns: 0,
          openIssues: 0,
          resolvedToday: 0
        },
        recentActivity: [],
        priorityTasks: []
      });
    }

    // 2. Fetch counts
    // Projects count
    const { count: activeProjectsCount, error: projectsError } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .in('id', projectIds)
      .eq('status', 'active');

    if (projectsError) throw projectsError;

    // Total runs count
    const { count: totalRunsCount, error: runsError } = await supabase
      .from('qa_runs')
      .select('*', { count: 'exact', head: true })
      .in('project_id', projectIds);

    if (runsError) throw runsError;

    // Open issues count
    const { count: openIssuesCount, error: issuesError } = await supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .eq('status', 'open');

    if (issuesError) throw issuesError;

    // Resolved today count
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: resolvedTodayCount, error: resolvedError } = await supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .eq('status', 'resolved')
      .gte('updated_at', today.toISOString());

    if (resolvedError) throw resolvedError;

    // 3. Recent Activity (Last 5 QA runs)
    const { data: recentRuns, error: recentRunsError } = await supabase
      .from('qa_runs')
      .select(`
        id,
        created_at,
        run_type,
        status,
        projects(name),
        users:created_by(full_name)
      `)
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentRunsError) throw recentRunsError;

    // 4. Priority Tasks (Top 5 critical/high open tasks)
    const { data: priorityTasks, error: priorityTasksError } = await supabase
      .from('tasks')
      .select(`
        id,
        title,
        severity,
        project_id,
        projects(name)
      `)
      .in('project_id', projectIds)
      .eq('status', 'open')
      .in('severity', ['critical', 'high'])
      .order('created_at', { ascending: false })
      .limit(5);

    if (priorityTasksError) throw priorityTasksError;

    return res.json({
      stats: {
        activeProjects: activeProjectsCount || 0,
        totalRuns: totalRunsCount || 0,
        openIssues: openIssuesCount || 0,
        resolvedToday: resolvedTodayCount || 0
      },
      recentActivity: recentRuns.map((run: any) => ({
        id: run.id,
        type: 'qa_run',
        projectName: run.projects?.name,
        userName: run.users?.full_name,
        timestamp: run.created_at,
        status: run.status,
        runType: run.run_type
      })),
      priorityTasks: priorityTasks.map((task: any) => ({
        id: task.id,
        title: task.title,
        severity: task.severity,
        projectId: task.project_id,
        projectName: task.projects?.name
      }))
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stats/leaderboard
 * Get performance leaderboard for Developers and QAs.
 */
router.get('/leaderboard', clerkAuth, async (req: Request, res: Response) => {
  const { orgId } = req.auth!;
  const { year, month } = req.query;

  if (!orgId) {
    return res.status(400).json({ error: 'Organization ID is required' });
  }

  try {
    const data = await statsService.getLeaderboards(
      (year as string) || 'all',
      (month as string) || 'all',
      orgId
    );
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});


export { router as statsRouter };
