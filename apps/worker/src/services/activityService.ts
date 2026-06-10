import { supabase } from '../lib/supabase';

/**
 * ACTION TYPES
 * -----------------------------------------
 * PROJECT_CREATED: A new project was created
 * PROJECT_UPDATED: Project settings or name changed
 * PROJECT_DELETED: A project was removed
 * 
 * TASK_CREATED: A new task was added
 * TASK_ASSIGNED: A task was assigned to a user
 * TASK_UPDATED: Task description, severity, or status changed
 * TASK_DELETED: A task was removed
 * 
 * COMMENT_ADDED: A new comment on a task
 * REBUTTAL_SUBMITTED: A developer submitted a rebuttal
 * 
 * RUN_STARTED: A QA run was initiated
 * RUN_COMPLETED: A QA run finished
 * RUN_FAILED: A QA run failed
 * -----------------------------------------
 */

export interface ActivityPerformer {
  id: string;
  name: string;
}

export interface ActivityEntity {
  id: string;
  type: 'project' | 'task' | 'run' | 'user';
}

export interface ActivityAction {
  type: string;
  details?: any;
  isAdminOnly?: boolean;
}

/**
 * Main function to log activity and notify users.
 */
export async function logActivity(
  performer: ActivityPerformer,
  action: ActivityAction,
  entity: ActivityEntity,
  targetUsers: string[] = []
): Promise<string | null> {
  let activityId: string | null = null;

  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .insert({
        performer_id: performer.id,
        performer_name: performer.name,
        action_type: action.type,
        entity_id: entity.id,
        entity_type: entity.type,
        details: action.details || {}
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ActivityService] Error saving activity log:', error);
      return null;
    }

    activityId = data.id;
  } catch (error) {
    console.error('[ActivityService] Unexpected error saving log:', error);
    return null;
  }

  try {
    if (!action.isAdminOnly && targetUsers.length > 0) {
      const notificationRows = targetUsers.map(userId => ({
        user_id: userId,
        activity_id: activityId,
        is_read: false
      }));

      const { error: notifyError } = await supabase
        .from('notifications')
        .insert(notificationRows);

      if (notifyError) {
        console.error('[ActivityService] Error creating notifications:', notifyError);
      }
    }


  } catch (error) {
    console.error('[ActivityService] Notification/Broadcast failed:', error);
  }

  return activityId;
}

export async function notifyProjectCreated(
  performer: ActivityPerformer,
  project: { id: string; name: string },
  targetUsers: string[] = []
) {
  return logActivity(
    performer,
    { type: 'PROJECT_CREATED', details: { projectName: project.name } },
    { id: project.id, type: 'project' },
    targetUsers
  );
}

export async function notifyTaskAssigned(
  performer: ActivityPerformer,
  task: { id: string; title: string },
  projectName: string,
  assigneeName: string,
  targetUserId: string
) {
  return logActivity(
    performer,
    { type: 'TASK_ASSIGNED', details: { taskTitle: task.title, projectName, assigneeName } },
    { id: task.id, type: 'task' },
    [targetUserId]
  );
}

export async function notifyTaskStatusChanged(
  performer: ActivityPerformer,
  task: { id: string; title: string },
  projectName: string,
  newStatus: string,
  targetUsers: string[] = []
) {
  return logActivity(
    performer,
    { type: 'TASK_UPDATED', details: { taskTitle: task.title, projectName, newStatus } },
    { id: task.id, type: 'task' },
    targetUsers
  );
}

export async function notifyCommentAdded(
  performer: ActivityPerformer,
  task: { id: string; title: string },
  projectName: string,
  targetUsers: string[] = []
) {
  return logActivity(
    performer,
    { type: 'COMMENT_ADDED', details: { taskTitle: task.title, projectName } },
    { id: task.id, type: 'task' },
    targetUsers
  );
}
