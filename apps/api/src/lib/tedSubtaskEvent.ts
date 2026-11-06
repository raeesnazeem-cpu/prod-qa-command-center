/**
 * True when a TED task event is about a checklist row (subtask) rather than its parent task.
 *
 * TED sends a row's update under its parent's template key, so the parent-level gates in
 * routes/webhooks.ts would read a row edit as a manual re-trigger of the whole flow. Rows say so
 * with `subjectKind: "subtask"` and a non-blank `parentTaskId`; a top-level task sends
 * `subjectKind: "task"` and a blank `parentTaskId`. Payloads from before those fields existed have
 * neither, and count as not-a-subtask, so their behavior is unchanged.
 */
export function isSubtaskEvent(task: {
  subjectKind?: unknown
  parentTaskId?: unknown
}): boolean {
  if (task.subjectKind === "subtask") return true
  const parent = task.parentTaskId
  return parent != null && String(parent).trim() !== ""
}
