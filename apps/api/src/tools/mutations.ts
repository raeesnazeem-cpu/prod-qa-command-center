import { supabase } from "../lib/supabase"
import { upsertFindingEmbedding, upsertTaskEmbedding } from "./embedSync"
import * as activityService from "../services/activityService"

/**
 * Create a new project.
 */
export async function createProject(
  args: any,
  orgId: string,
  performer?: activityService.ActivityPerformer,
) {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: args.name,
      site_url: args.site_url,
      client_name: args.is_internal ? "Internal" : args.client_name,
      is_pre_release: args.is_pre_release || false,
      org_id: orgId,
      status: "active",
    })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      throw new Error(`A project with the name "${args.name}" already exists.`)
    }
    throw error
  }

  if (performer) {
    // 1. Add creator to members
    await supabase.from("project_members").insert({
      project_id: data.id,
      user_id: performer.id,
      role: "sub_admin",
    })

    // 2. Log activity
    await activityService.notifyProjectCreated(performer, {
      id: data.id,
      name: data.name,
    })
  }

  return data
}

/**
 * Update an existing project.
 */
export async function updateProject(
  args: any,
  orgId: string,
  performer?: activityService.ActivityPerformer,
) {
  const { project_id, ...updates } = args
  const { data, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", project_id)
    .eq("org_id", orgId)
    .select()
    .single()

  if (error) throw error

  if (performer) {
    await activityService.logActivity(
      performer,
      { type: "PROJECT_UPDATED", details: { projectName: data.name } },
      { id: data.id, type: "project" },
    )
  }

  return data
}

/**
 * Delete a project and all its associated data.
 */
export async function deleteProject(
  args: any,
  orgId: string,
  performer?: activityService.ActivityPerformer,
) {
  const { project_id } = args

  // 0. Verify project exists and get name for logging
  const { data: project, error: fetchError } = await supabase
    .from("projects")
    .select("name")
    .eq("id", project_id)
    .eq("org_id", orgId)
    .single()

  if (fetchError || !project) {
    throw new Error(
      `Project not found or you don't have permission to delete it.`,
    )
  }

  const projectName = project.name

  // 1. Get all task IDs for this project
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("project_id", project_id)
  const taskIds = tasks?.map((t) => t.id) || []

  // 2. Get all finding IDs for this project (via runs)
  const { data: runs } = await supabase
    .from("qa_runs")
    .select("id")
    .eq("project_id", project_id)
  const runIds = runs?.map((r) => r.id) || []

  let findingIds: string[] = []
  if (runIds.length > 0) {
    const { data: findings } = await supabase
      .from("findings")
      .select("id")
      .in("run_id", runIds)
    findingIds = findings?.map((f) => f.id) || []
  }

  // 3. Delete embeddings
  if (taskIds.length > 0) {
    await supabase
      .from("embeddings")
      .delete()
      .eq("source_type", "task")
      .in("source_id", taskIds)
  }
  if (findingIds.length > 0) {
    await supabase
      .from("embeddings")
      .delete()
      .eq("source_type", "finding")
      .in("source_id", findingIds)
  }

  // 4. Delete the project (CASCADE will handle runs, findings, tasks, members)
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", project_id)
    .eq("org_id", orgId)

  if (error) throw error

  if (performer) {
    await activityService.logActivity(
      performer,
      { type: "PROJECT_DELETED", details: { project_id, projectName } },
      { id: project_id, type: "project" },
    )
  }

  return { success: true }
}

/**
 * Delete multiple projects and all their associated data.
 */
export async function deleteProjectsBulk(
  args: { project_ids: string[] },
  orgId: string,
  performer?: activityService.ActivityPerformer,
) {
  const { project_ids } = args

  for (const project_id of project_ids) {
    // 1. Get all task IDs for this project
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id")
      .eq("project_id", project_id)
    const taskIds = tasks?.map((t) => t.id) || []

    // 2. Get all finding IDs for this project (via runs)
    const { data: runs } = await supabase
      .from("qa_runs")
      .select("id")
      .eq("project_id", project_id)
    const runIds = runs?.map((r) => r.id) || []

    let findingIds: string[] = []
    if (runIds.length > 0) {
      const { data: findings } = await supabase
        .from("findings")
        .select("id")
        .in("run_id", runIds)
      findingIds = findings?.map((f) => f.id) || []
    }

    // 3. Delete embeddings
    if (taskIds.length > 0) {
      await supabase
        .from("embeddings")
        .delete()
        .eq("source_type", "task")
        .in("source_id", taskIds)
    }
    if (findingIds.length > 0) {
      await supabase
        .from("embeddings")
        .delete()
        .eq("source_type", "finding")
        .in("source_id", findingIds)
    }
  }

  // 4. Delete the projects (CASCADE will handle runs, findings, tasks, members)
  const { error } = await supabase
    .from("projects")
    .delete()
    .in("id", project_ids)
    .eq("org_id", orgId)

  if (error) throw error
  return { success: true, count: project_ids.length }
}

/**
 * Add a member to a project.
 */
export async function addProjectMember(
  args: any,
  performer?: activityService.ActivityPerformer,
) {
  const { project_id, user_id, role } = args
  const { data, error } = await supabase
    .from("project_members")
    .upsert({ project_id, user_id, role }, { onConflict: "project_id,user_id" })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Remove a member from a project.
 */
export async function removeProjectMember(
  args: any,
  performer?: activityService.ActivityPerformer,
) {
  const { project_id, user_id } = args
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", project_id)
    .eq("user_id", user_id)

  if (error) throw error
  return { success: true }
}

/**
 * Create a new task and sync to embeddings.
 */
export async function createTask(
  args: any,
  orgId: string,
  performer?: activityService.ActivityPerformer,
) {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      project_id: args.project_id,
      title: args.title,
      description: args.description,
      severity: args.severity || "medium",
      status: "open",
      assigned_to: args.assigned_to,
      finding_id: args.finding_id,
    })
    .select()
    .single()

  if (error) throw error

  // Sync to embeddings (background)
  upsertTaskEmbedding({
    id: data.id,
    project_id: data.project_id,
    org_id: orgId,
    title: data.title,
    description: data.description,
    severity: data.severity,
    status: data.status,
  }).catch((err) => console.error("Failed to sync task embedding:", err))

  if (performer) {
    // Get project name for logs
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", data.project_id)
      .single()

    await activityService.logActivity(
      performer,
      {
        type: "TASK_CREATED",
        details: { taskTitle: data.title, projectName: project?.name },
      },
      { id: data.id, type: "task" },
    )
  }

  return data
}

/**
 * Update a task and sync to embeddings.
 */
export async function updateTask(
  args: any,
  orgId: string,
  performer?: activityService.ActivityPerformer,
) {
  const { task_id, project_id, ...updates } = args
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", task_id)
    .eq("project_id", project_id)
    .select()
    .single()

  if (error) throw error

  // Sync to embeddings
  upsertTaskEmbedding({
    id: data.id,
    project_id: data.project_id,
    org_id: orgId,
    title: data.title,
    description: data.description,
    severity: data.severity,
    status: data.status,
  }).catch((err) => console.error("Failed to sync task embedding:", err))

  if (performer) {
    // Get project name for logs
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", data.project_id)
      .single()

    await activityService.notifyTaskStatusChanged(
      performer,
      { id: data.id, title: data.title },
      project?.name || "Unknown",
      data.status,
    )
  }

  return data
}

/**
 * Delete a task.
 */
export async function deleteTask(
  args: any,
  performer?: activityService.ActivityPerformer,
) {
  const { task_id, project_id } = args

  // 0. Verify task exists and get title for logging
  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select("title, project_id")
    .eq("id", task_id)
    .eq("project_id", project_id)
    .single()

  if (fetchError || !task) {
    throw new Error(`Task not found or you don't have permission to delete it.`)
  }

  const taskTitle = task.title

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", task_id)
    .eq("project_id", project_id)

  if (error) throw error

  // Ideally delete from embeddings too
  await supabase
    .from("embeddings")
    .delete()
    .eq("source_type", "task")
    .eq("source_id", task_id)

  if (performer) {
    // Get project name for logs
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", project_id)
      .single()

    await activityService.logActivity(
      performer,
      {
        type: "TASK_DELETED",
        details: { taskTitle, projectName: project?.name },
      },
      { id: task_id, type: "task" },
    )
  }

  return { success: true }
}

/**
 * Delete multiple tasks.
 */
export async function deleteTasksBulk(
  args: { task_ids: string[]; project_id: string },
  performer?: activityService.ActivityPerformer,
) {
  const { task_ids, project_id } = args
  const { error } = await supabase
    .from("tasks")
    .delete()
    .in("id", task_ids)
    .eq("project_id", project_id)

  if (error) throw error

  // Delete from embeddings
  await supabase
    .from("embeddings")
    .delete()
    .eq("source_type", "task")
    .in("source_id", task_ids)

  return { success: true, count: task_ids.length }
}

/**
 * Delete all tasks for a specific user in a project.
 */
export async function deleteUserTasksInProject(
  args: {
    user_id: string
    project_id: string
  },
  performer?: any,
) {
  const { user_id, project_id } = args

  // Get task IDs first for embedding sync
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("assigned_to", user_id)
    .eq("project_id", project_id)

  const taskIds = tasks?.map((t) => t.id) || []
  if (taskIds.length === 0) return { success: true, count: 0 }

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("assigned_to", user_id)
    .eq("project_id", project_id)

  if (error) throw error

  // Delete from embeddings
  await supabase
    .from("embeddings")
    .delete()
    .eq("source_type", "task")
    .in("source_id", taskIds)

  return { success: true, count: taskIds.length }
}

/**
 * Update a finding and sync to embeddings.
 */
export async function updateFinding(
  args: any,
  orgId: string,
  performer?: activityService.ActivityPerformer,
) {
  const { finding_id, run_id, ...updates } = args
  const { data, error } = await supabase
    .from("findings")
    .update(updates)
    .eq("id", finding_id)
    .eq("run_id", run_id)
    .select("*, qa_runs(project_id)")
    .single()

  if (error) throw error

  const project_id = (data.qa_runs as any)?.project_id

  // Sync to embeddings
  upsertFindingEmbedding({
    id: data.id,
    run_id: data.run_id,
    title: data.title,
    description: data.description,
    severity: data.severity,
    status: data.status,
    org_id: orgId,
    project_id,
  }).catch((err) => console.error("Failed to sync finding embedding:", err))

  return data
}

/**
 * Delete a finding.
 */
export async function deleteFinding(
  args: any,
  performer?: activityService.ActivityPerformer,
) {
  const { finding_id, run_id } = args
  const { error } = await supabase
    .from("findings")
    .delete()
    .eq("id", finding_id)
    .eq("run_id", run_id)

  if (error) throw error

  // Delete from embeddings
  await supabase
    .from("embeddings")
    .delete()
    .eq("source_type", "finding")
    .eq("source_id", finding_id)

  return { success: true }
}

/**
 * Update user org role.
 */
export async function updateUserRole(
  args: any,
  performer?: activityService.ActivityPerformer,
) {
  const { user_id, role } = args
  const { data, error } = await supabase
    .from("users")
    .update({ role })
    .eq("id", user_id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Create a new QA run.
 */
export async function createRun(
  args: any,
  performer?: activityService.ActivityPerformer,
) {
  const { project_id, urls, device_matrix, start_immediately } = args
  const { data, error } = await supabase
    .from("qa_runs")
    .insert({
      project_id,
      urls: urls || [],
      device_matrix: device_matrix || [],
      status: start_immediately ? "pending" : "paused",
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Cancel a QA run.
 */
export async function cancelRun(
  args: any,
  performer?: activityService.ActivityPerformer,
) {
  const { run_id, project_id } = args
  const { data, error } = await supabase
    .from("qa_runs")
    .update({ status: "cancelled" })
    .eq("id", run_id)
    .eq("project_id", project_id)
    .select()
    .single()

  if (error) throw error
  return data
}
