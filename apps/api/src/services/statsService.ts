import { supabase } from "../lib/supabase"

export interface LeaderboardEntry {
  rank: number
  id: string
  name: string
  issues: number
  rebuttals: number
  genuine: number
}

export async function getLeaderboards(
  year: string,
  month: string,
  orgId: string,
) {
  // 1. Fetch all users in the organization
  const { data: users, error: userError } = await supabase
    .from("users")
    .select("id, full_name, role")
    .eq("org_id", orgId)

  if (userError) throw userError

  // 2. Fetch all tasks with joined rebuttals and project (for org filtering)
  let query = supabase
    .from("tasks")
    .select(
      `
      id, 
      assigned_to, 
      created_by, 
      status, 
      created_at, 
      projects!inner(org_id),
      rebuttals(id, submitted_by)
    `,
    )
    .eq("projects.org_id", orgId)

  // Date Filtering Logic (Step 1 Reference)
  if (year && month && year !== "all" && month !== "all") {
    const startDate = new Date(
      parseInt(year),
      parseInt(month) - 1,
      1,
    ).toISOString()
    const endDate = new Date(
      parseInt(year),
      parseInt(month),
      0,
      23,
      59,
      59,
    ).toISOString()
    query = query.gte("created_at", startDate).lte("created_at", endDate)
  } else if (year && year !== "all") {
    const startDate = new Date(parseInt(year), 0, 1).toISOString()
    const endDate = new Date(parseInt(year), 12, 0, 23, 59, 59).toISOString()
    query = query.gte("created_at", startDate).lte("created_at", endDate)
  }

  const { data: tasks, error: taskError } = await query
  if (taskError) throw taskError

  // 3. Aggregate stats in memory
  const devStats: Record<string, any> = {}
  const qaStats: Record<string, any> = {}

  // Initialize everyone with 0s to ensure they appear in leaderboard
  users.forEach((u) => {
    const base = {
      id: u.id,
      name: u.full_name || "Unknown",
      issues: 0,
      rebuttals: 0,
      genuine: 0,
    }
    if (u.role === "developer") devStats[u.id] = { ...base }
    if (u.role === "qa_engineer") qaStats[u.id] = { ...base }
  })

  tasks.forEach((task) => {
    const isGenuine = ["resolved", "closed"].includes(task.status)

    // Developer Stats (Assigned To)
    if (task.assigned_to && devStats[task.assigned_to]) {
      const stats = devStats[task.assigned_to]
      stats.issues += 1
      if (isGenuine) stats.genuine += 1
      // Count rebuttals submitted by this dev on this task
      const devRebuttals =
        (task.rebuttals as any[])?.filter(
          (r) => r.submitted_by === task.assigned_to,
        ).length || 0
      stats.rebuttals += devRebuttals
    }

    // QA Stats (Created By)
    if (task.created_by && qaStats[task.created_by]) {
      const stats = qaStats[task.created_by]
      stats.issues += 1
      if (isGenuine) stats.genuine += 1
      // Count total rebuttals received on this QA's task
      stats.rebuttals += (task.rebuttals as any[])?.length || 0
    }
  })

  // 4. Sort and Rank
  const sortFn = (a: any, b: any) => {
    if (b.genuine !== a.genuine) return b.genuine - a.genuine
    return a.rebuttals - b.rebuttals // Tie-breaker: Lowest rebuttals
  }

  const devSortFn = (a: any, b: any) => {
    if (a.genuine !== b.genuine) return a.genuine - b.genuine
    return a.rebuttals - b.rebuttals // Tie-breaker: Lowest rebuttals
  }

  const developers = Object.values(devStats)
    .sort(devSortFn)
    .map((s, i) => ({ ...s, rank: i + 1 }))

  const qas = Object.values(qaStats)
    .sort(sortFn)
    .map((s, i) => ({ ...s, rank: i + 1 }))

  return {
    topPerformers: {
      developer: developers[0]
        ? { ...developers[0], count: developers[0].genuine }
        : null,
      qa: qas[0] ? { ...qas[0], count: qas[0].genuine } : null,
    },
    leaderboards: {
      developers,
      qas,
    },
  }
}
