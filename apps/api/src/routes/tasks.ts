import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { clerkAuth } from '../middleware/clerkAuth';
import { requireRole } from '../middleware/requireRole';
import { zodValidate } from '../middleware/zodValidate';
import { broadcastTaskUpdate } from '../lib/realtimeService';
import { qaQueue } from '../lib/queue';
import { 
  CreateTaskSchema, 
  UpdateTaskSchema, 
  CreateCommentSchema, 
  RebuttalSchema 
} from '@qacc/shared';
import * as emailNotifier from '../lib/emailNotifier';
import { logger } from '../lib/logger';
import * as activityService from '../services/activityService';


const router: Router = Router();

/**
 * Helper to get Supabase user UUID from Clerk ID.
 */
async function getSupabaseUserId(clerkIdOrUuid: string): Promise<string> {
  if (clerkIdOrUuid.length === 36 && clerkIdOrUuid.includes('-')) {
    return clerkIdOrUuid;
  }

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_user_id', clerkIdOrUuid)
    .maybeSingle();
  
  if (error || !data) {
    throw new Error(`User not synced: ${clerkIdOrUuid}`);
  }
  return data.id;
}

/**
 * POST /api/tasks
 * Create a new task. Restricted to qa_engineer and above.
 */
router.post(
  '/',
  clerkAuth,
  requireRole('qa_engineer'),
  zodValidate(CreateTaskSchema),
  async (req: Request, res: Response) => {
    const { finding_id, project_id, title, description, severity, assigned_to, gallery_images } = req.body;
    const { userId: clerkUserId } = req.auth!;

    try {
      const supabaseUserId = await getSupabaseUserId(clerkUserId);

      // 1. Calculate Issue Number
      // A "Task" (Issue) is defined by a unique combination of finding_id or title.
      // One Finding = One Issue Number, regardless of number of assignees (rows).
      
      const cleanTitle = title.replace(/^Issue #\d+:?\s*/, "");
      
      // Fetch all tasks for the project to determine unique issue count and check for existing numbers
      const { data: allProjectTasks, error: fetchError } = await supabase
        .from('tasks')
        .select('finding_id, title, status, basecamp_task_id, basecamp_url')
        .eq('project_id', project_id);

      if (fetchError) throw fetchError;

      const uniqueIssues = new Set<string>();
      let existingNumber: number | null = null;
      let existingStatus: string = 'open';
      let existingBasecampId: string | null = null;
      let existingBasecampUrl: string | null = null;

      allProjectTasks?.forEach(t => {
        const taskCleanTitle = t.title.replace(/^Issue #\d+:?\s*/, "");
        const key = t.finding_id || taskCleanTitle;
        uniqueIssues.add(key);

        // Check if this new task matches an existing issue
        if (!existingNumber) {
          const isMatch = finding_id 
            ? t.finding_id === finding_id 
            : taskCleanTitle.toLowerCase() === cleanTitle.toLowerCase();
          
          if (isMatch) {
            const match = t.title.match(/^Issue #(\d+):/);
            if (match) existingNumber = parseInt(match[1]);
            
            // Inherit state from existing sibling
            existingStatus = t.status;
            existingBasecampId = t.basecamp_task_id;
            existingBasecampUrl = t.basecamp_url;
          }
        }
      });

      const issueNumber = existingNumber || (uniqueIssues.size + 1);
      const finalTitle = `Issue #${issueNumber}: ${cleanTitle}`;

      const { data: task, error } = await supabase
        .from('tasks')
        .insert({
          finding_id,
          project_id,
          title: finalTitle,
          description,
          severity,
          assigned_to,
          gallery_images,
          created_by: supabaseUserId,
          status: existingStatus as any,
          basecamp_task_id: existingBasecampId,
          basecamp_url: existingBasecampUrl
        })
        .select()
        .single();

      if (error) throw error;

      // If task is assigned on creation, notify the user
      if (assigned_to) {
        try {
          const { data: userData } = await supabase
            .from('users')
            .select('full_name, email')
            .eq('id', assigned_to)
            .single();
          
          const { data: projectData } = await supabase
            .from('projects')
            .select('name')
            .eq('id', project_id)
            .single();
          
          if (userData && projectData) {
            await emailNotifier.emailTaskAssigned(userData, task, projectData.name);
          }
        } catch (err: any) {
          logger.error(err, `Failed to send assignment email for new task ${task.id}`);
        }
      }

      // Log Task Creation
      try {
        const { clerkUserId } = req.auth!;
        const [performerRes, projectRes] = await Promise.all([
          supabase.from('users').select('id, full_name').eq('clerk_user_id', clerkUserId).single(),
          supabase.from('projects').select('name').eq('id', project_id).single()
        ]);

        if (performerRes.data && projectRes.data) {
          await activityService.logActivity(
            { id: performerRes.data.id, name: performerRes.data.full_name || 'QA Engineer' },
            { 
              type: 'TASK_CREATED', 
              details: { 
                taskTitle: finalTitle,
                projectName: projectRes.data.name,
                message: `Created task: ${finalTitle}` 
              } 
            },
            { id: task.id, type: 'task' },
            assigned_to ? [assigned_to] : []
          );
        }
      } catch (logError) {
        logger.error(logError, '[ActivityService] Failed to log task creation');
      }

      await broadcastTaskUpdate(task.id, task);
      return res.status(201).json(task);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/tasks
 * List tasks with filters.
 */
/**
 * GET /api/tasks/count/unique
 * Get unique task count for a project to support automated issue numbering.
 */
router.get('/count/unique', clerkAuth, async (req: Request, res: Response) => {
  const projectId = req.query.project_id as string;
  if (!projectId) return res.status(400).json({ error: 'project_id is required' });

  try {
    const { data: allProjectTasks, error: fetchError } = await supabase
      .from('tasks')
      .select('finding_id, title')
      .eq('project_id', projectId);

    if (fetchError) throw fetchError;

    const uniqueIssues = new Set<string>();
    allProjectTasks?.forEach(t => {
      const taskCleanTitle = t.title.replace(/^Issue #\d+:?\s*/, "");
      const key = t.finding_id || taskCleanTitle;
      uniqueIssues.add(key);
    });

    res.json({ count: uniqueIssues.size });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', clerkAuth, async (req: Request, res: Response) => {
  const { project_id, projectId, status, severity, assigned_to, page = '1', limit = '10' } = req.query;
  const { userId: clerkUserId, role, orgId } = req.auth!;

  try {
    const supabaseUserId = await getSupabaseUserId(clerkUserId);
    
    let query = supabase
      .from('tasks')
      .select(`
        *,
        users:assigned_to (id, full_name, email),
        creator:created_by (id, full_name, email),
        projects:project_id (id, name, org_id)
      `, { count: 'exact' });

    // Filter by organization
    query = query.eq('projects.org_id', orgId);

    // Apply filters
    const effectiveProjectId = project_id || projectId;
    if (effectiveProjectId) query = query.eq('project_id', effectiveProjectId);
    if (status) query = query.eq('status', status);
    if (severity) query = query.eq('severity', severity);
    if (req.query.created_by) query = query.eq('created_by', req.query.created_by);
    
    // RBAC: If explicitly filtering by assignee, apply it
    if (assigned_to) {
      query = query.eq('assigned_to', assigned_to);
    }

    // RBAC: Sub-Admin/QA/PM only see tasks in their project memberships
    else if (role !== 'super_admin' && role !== 'admin') {
      const { data: memberships } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', supabaseUserId);
      
      const projectIds = memberships?.map(m => m.project_id) || [];
      if (projectIds.length === 0) return res.json({ data: [], pagination: { total: 0 } });
      query = query.in('project_id', projectIds);
    }

    // Pagination
    const from = (Number(page) - 1) * Number(limit);
    const to = from + Number(limit) - 1;
    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tasks/:id
 */
router.get('/:id', clerkAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId: clerkUserId, role, orgId } = req.auth!;

  // Validate UUID format to prevent invalid input errors
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) {
    return res.status(404).json({ error: 'Task not found' });
  }

  try {
    const supabaseUserId = await getSupabaseUserId(clerkUserId);

    const { data, error } = await supabase
      .from('tasks')
      .select(`
        *,
        users:assigned_to (id, full_name, email),
        creator:created_by (id, full_name, email),
        projects (id, name, org_id),
        comments (
          *,
          users:author_id (full_name, email)
        ),
        rebuttals (
          *,
          users:submitted_by (full_name, email)
        )
      `)
      .eq('id', id)
      .eq('projects.org_id', orgId)
      .single();

    const task = data as any;

    if (error || !task) return res.status(404).json({ error: 'Task not found' });

    // RBAC Check: Handled by project membership check in list route, 
    // and org_id check in single fetch. Developers can view all tasks in their projects.

    // Unify comments and rebuttals across all tasks sharing the same finding_id
    if (task.finding_id) {
      const { data: siblingTasks } = await supabase
        .from('tasks')
        .select('id, assigned_to, users:assigned_to (id, full_name, email)')
        .eq('finding_id', task.finding_id);
      
      const siblingIds = siblingTasks?.map(t => t.id) || [id];
      task.assignees = siblingTasks?.map(t => ({
        taskId: t.id,
        userId: t.assigned_to,
        name: (t.users as any)?.full_name || 'Unknown'
      })).filter(a => a.userId) || [];

      if (siblingIds.length > 1) {
        // Fetch unified comments
        const { data: unifiedComments } = await supabase
          .from('comments')
          .select(`
            *,
            users:author_id (full_name, email)
          `)
          .in('task_id', siblingIds)
          .order('created_at', { ascending: true });
        
        // Fetch unified rebuttals
        const { data: unifiedRebuttals } = await supabase
          .from('rebuttals')
          .select(`
            *,
            users:submitted_by (full_name, email)
          `)
          .in('task_id', siblingIds)
          .order('created_at', { ascending: true });
        
        task.comments = unifiedComments || [];
        task.rebuttals = unifiedRebuttals || [];
      }
    }

    return res.json(task);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/tasks/:id
 */
router.patch(
  '/:id',
  clerkAuth,
  zodValidate(UpdateTaskSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, assigned_to, description, gallery_images, severity } = req.body;
    try {
      let targetUserId = assigned_to;
      if (assigned_to) {
        targetUserId = await getSupabaseUserId(assigned_to);
      }

      // 1. Get the current task to find siblings
      const { data: currentTask } = await supabase
        .from('tasks')
        .select('finding_id, title, project_id')
        .eq('id', id)
        .single();

      // 2. Update the primary task
      const { data: task, error } = await supabase
        .from('tasks')
        .update({ 
          status, 
          assigned_to: targetUserId, 
          description,
          gallery_images,
          severity
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Centralized Setup for Logging
      const { clerkUserId } = req.auth!;
      const [performerRes, projectRes] = await Promise.all([
        supabase.from('users').select('id, full_name').eq('clerk_user_id', clerkUserId).single(),
        supabase.from('projects').select('name').eq('id', task.project_id).single()
      ]);

      const performerId = performerRes.data;
      const performerName = performerId?.full_name || 'User';
      const projectName = projectRes.data?.name || 'Project';

      // Log Task Status Change and Notify Creator
      if (status) {
        try {
          const targetUsersSet: string[] = [];
          // Notify creator on all meaningful status transitions
          if (['resolved', 'in-progress', 'closed', 'to-do'].includes(status) && currentTask) {
            const { data: creator } = await supabase
              .from('tasks')
              .select('created_by')
              .eq('id', id)
              .single();
            if (creator?.created_by) targetUsersSet.push(creator.created_by);
          }
          // For to-do (reopened), also notify the current assignee
          if (status === 'to-do' && task.assigned_to) {
            targetUsersSet.push(task.assigned_to);
          }
          const targetUsers = Array.from(new Set(targetUsersSet));


          await activityService.notifyTaskStatusChanged(
            { id: performerId?.id || '', name: performerName },
            { id: task.id, title: task.title },
            projectName,
            status,
            targetUsers
          );
        } catch (logError) {
          logger.error(logError, '[ActivityService] Failed to log task status update');
        }
      }

      // Log Task Description/Severity Update
      if (description || severity) {
        try {
          const changes = [];
          if (description) changes.push('description');
          if (severity) changes.push(`severity to ${severity}`);

          await activityService.logActivity(
            { id: performerId?.id || '', name: performerName },
            { 
              type: 'TASK_UPDATED', 
              details: { 
                taskTitle: task.title,
                projectName,
                message: `Updated task ${changes.join(' and ')}` 
              } 
            },
            { id: task.id, type: 'task' },
            [task.created_by]
          );
        } catch (logError) {
          logger.error(logError, '[ActivityService] Failed to log task update');
        }
      }

      // Log Task Assignment Change (Assign/De-assign)
      if (req.body.hasOwnProperty('assigned_to')) {
        try {
          let actionMessage = '';
          let targetUsers = [];
          if (targetUserId) {
            const { data: assignee } = await supabase
              .from('users')
              .select('full_name')
              .eq('id', targetUserId)
              .single();
            const assigneeName = assignee?.full_name || 'Developer';
            actionMessage = `assigned task to ${assigneeName}`;
            targetUsers.push(targetUserId); // Notify the new assignee
          } else {
            actionMessage = `unassigned task`;
          }
          await activityService.logActivity(
            { id: performerId?.id || '', name: performerName },
            { 
              type: 'TASK_ASSIGNED', 
              details: { 
                taskTitle: task.title,
                projectName,
                message: `${actionMessage} ("${task.title}")` 
              } 
            },
            { id: task.id, type: 'task' },
            targetUsers
          );
        } catch (logError) {
          logger.error(logError, '[ActivityService] Failed to log assignment change');
        }
      }



      // 3. If status changed, sync with siblings (tasks with same finding_id)
      if (status && currentTask) {
        const { data: siblings } = await supabase
          .from("tasks")
          .select("id")
          .eq("project_id", currentTask.project_id)
          .or(`finding_id.eq.${currentTask.finding_id}${currentTask.finding_id ? "" : ",title.eq." + currentTask.title}`);
        
        const siblingIds = (siblings || []).map(s => s.id).filter(sid => sid !== id);
        
        if (siblingIds.length > 0) {
          await supabase
            .from('tasks')
            .update({ status })
            .in('id', siblingIds);
        }
      }

      await broadcastTaskUpdate(id, task);
      return res.json(task);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/tasks/:id/assign
 */
router.post(
  '/:id/assign',
  clerkAuth,
  requireRole('qa_engineer'),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { user_id, assigned_to } = req.body;
    const inputId = user_id || assigned_to;
    if (!inputId) return res.status(400).json({ error: 'user_id or assigned_to is required' });

    try {
      const targetUserId = await getSupabaseUserId(inputId);

      const { data: task, error } = await supabase
        .from('tasks')
        .update({ assigned_to: targetUserId })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

            // [Step 4.5 - 4.6] Log Task Assignment and Notify Assignee
      try {
        const { clerkUserId } = req.auth!;
        const [performerRes, assigneeRes, projectRes] = await Promise.all([
          supabase.from('users').select('id, full_name').eq('clerk_user_id', clerkUserId).single(),
          supabase.from('users').select('full_name').eq('id', targetUserId).single(),
          supabase.from('projects').select('name').eq('id', task.project_id).single()
        ]);

        const performerName = performerRes.data?.full_name || 'QA Engineer';
        const assigneeName = assigneeRes.data?.full_name || 'Developer';
        const projectName = projectRes.data?.name || 'Project';

        await activityService.notifyTaskAssigned(
          { id: performerRes.data?.id || '', name: performerName },
          { id: task.id, title: task.title },
          projectName,
          assigneeName,
          targetUserId
        );
      } catch (logError) {
        logger.error(logError, '[ActivityService] Failed to log task assignment');
      }


      // Notify the user via email
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('full_name, email')
          .eq('id', targetUserId)
          .single();
        
        const { data: projectData } = await supabase
          .from('projects')
          .select('name')
          .eq('id', task.project_id)
          .single();
        
        if (userData && projectData) {
          await emailNotifier.emailTaskAssigned(userData, task, projectData.name);
        }
      } catch (err: any) {
        logger.error(err, `Failed to send assignment email for task ${id}`);
      }

      await broadcastTaskUpdate(id, task);
      return res.json(task);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/tasks/:id/comments
 */
router.post(
  '/:id/comments',
  clerkAuth,
  zodValidate(CreateCommentSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { content } = req.body;
    const { userId: clerkUserId } = req.auth!;

    try {
      const supabaseUserId = await getSupabaseUserId(clerkUserId);
      const { data: comment, error } = await supabase
        .from('comments')
        .insert({
          task_id: id,
          author_id: supabaseUserId,
          content
        })
        .select()
        .single();

      if (error) throw error;

      // Log Comment and Notify
      try {
        const { clerkUserId } = req.auth!;
        const [performerRes, taskRes] = await Promise.all([
          supabase.from('users').select('id, full_name').eq('clerk_user_id', clerkUserId).single(),
          supabase.from('tasks').select('title, created_by, assigned_to, project_id').eq('id', id).single()
        ]);

        if (performerRes.data && taskRes.data) {
          const projectRes = await supabase
            .from('projects')
            .select('name')
            .eq('id', taskRes.data.project_id)
            .single();
          
          const projectName = projectRes.data?.name || 'Project';
          const performerName = performerRes.data.full_name || 'User';
          const taskData = taskRes.data;
          // Notify both creator and assignee
          const targetUsers = [taskData.created_by, taskData.assigned_to]
            .filter(uid => uid);

          await activityService.notifyCommentAdded(
            { id: performerRes.data?.id || '', name: performerName },
            { id, title: taskData.title },
            projectName,
            Array.from(new Set(targetUsers))
          );
        }
      } catch (logError) {
        logger.error(logError, '[ActivityService] Failed to log comment');
      }

      await broadcastTaskUpdate(id, { id }); // Notify that task has new activity
      return res.status(201).json(comment);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/tasks/:id/rebuttals
 */
router.post(
  '/:id/rebuttals',
  clerkAuth,
  requireRole('developer'),
  zodValidate(RebuttalSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { text, screenshot_url } = req.body;
    const { userId: clerkUserId } = req.auth!;

    try {
      const supabaseUserId = await getSupabaseUserId(clerkUserId);
      const { data: rebuttal, error } = await supabase
        .from('rebuttals')
        .insert({
          task_id: id,
          submitted_by: supabaseUserId,
          text,
          screenshot_url
        })
        .select()
        .single();

      if (error) throw error;

      // Log Rebuttal and Notify Creator
      try {
        const { clerkUserId } = req.auth!;
        const [performerRes, taskRes] = await Promise.all([
          supabase.from('users').select('id, full_name').eq('clerk_user_id', clerkUserId).single(),
          supabase.from('tasks').select('title, created_by, project_id').eq('id', id).single()
        ]);

        const projectRes = await supabase 
          .from('projects')
          .select('name')
          .eq('id', taskRes.data?.project_id)
          .single();
        const projectName = projectRes.data?.name || 'Project'; 

        if (taskRes.data) {
          await activityService.logActivity(
            { id: performerRes.data?.id || '', name: performerRes.data?.full_name || 'Developer' },
            { 
              type: 'REBUTTAL_ADDED', 
              details: { 
                taskTitle: taskRes.data.title,
                projectName,
                message: ` submitted a rebuttal for "${taskRes.data.title}" in ${projectName}` 
              } 
            },
            { id, type: 'task' },
            [taskRes.data.created_by] // Notify the creator
          );
        }
      } catch (logError) {
        logger.error(logError, '[ActivityService] Failed to log rebuttal');
      }


      await broadcastTaskUpdate(id, { id }); // Notify that task has new activity
      
      await qaQueue.add('analyze_rebuttal', { rebuttalId: rebuttal.id, taskId: id }, {
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
      });

      return res.status(201).json(rebuttal);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /api/tasks/:id
 */
router.delete(
  '/:id',
  clerkAuth,
  requireRole('qa_engineer'),
  async (req: Request, res: Response) => {
    const { id } = req.params;

    // Log Task Deletion
    try {
      const { clerkUserId } = req.auth!;
      const [performerRes, taskRes] = await Promise.all([
        supabase.from('users').select('id, full_name').eq('clerk_user_id', clerkUserId).single(),
        supabase.from('tasks').select('title, project_id').eq('id', id).single()
      ]);

      if (taskRes.data) {
        await activityService.logActivity(
          { id: performerRes.data?.id || '', name: performerRes.data?.full_name || 'QA Engineer' },
          { 
            type: 'TASK_DELETED', 
            details: { 
              taskTitle: taskRes.data.title,
              message: `Deleted task: ${taskRes.data.title}` 
            },
            isAdminOnly: true
          },
          { id: taskRes.data.project_id, type: 'project' }
        );
      }
    } catch (logError) {
      logger.error(logError, '[ActivityService] Failed to log task deletion');
    }



    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await broadcastTaskUpdate(id, { id, deleted: true });
      return res.status(204).send();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/tasks/bulk-delete
 */
router.post(
  '/bulk-delete',
  clerkAuth,
  requireRole('qa_engineer'),
  async (req: Request, res: Response) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    try {
      // Fetch task metadata before deletion for logging and broadcast
      const { clerkUserId } = req.auth!;
      const [performerRes, tasksRes] = await Promise.all([
        supabase.from('users').select('id, full_name').eq('clerk_user_id', clerkUserId).single(),
        supabase.from('tasks').select('id, title, project_id').in('id', ids)
      ]);

      const { error } = await supabase
        .from('tasks')
        .delete()
        .in('id', ids);

      if (error) throw error;

      // Log activity and broadcast for each deleted task
      try {
        const performer = { id: performerRes.data?.id || '', name: performerRes.data?.full_name || 'QA Engineer' };
        for (const task of tasksRes.data || []) {
          await activityService.logActivity(
            performer,
            {
              type: 'TASK_DELETED',
              details: {
                taskTitle: task.title,
                message: `Bulk deleted task: ${task.title}`
              },
              isAdminOnly: true
            },
            { id: task.project_id, type: 'project' }
          );
          await broadcastTaskUpdate(task.id, { id: task.id, deleted: true });
        }
      } catch (logError) {
        logger.error(logError, '[ActivityService] Failed to log bulk task deletion');
      }

      return res.status(204).send();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/tasks/:id/activity
 * Returns activity logs for a specific task.
 */
router.get('/:id/activity', clerkAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('entity_id', id)
      .eq('entity_type', 'task')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data);
  } catch (error: any) {
    logger.error(error, 'Error fetching task activity');
    return res.status(500).json({ error: error.message });
  }
});

export { router as tasksRouter };
