// Build-time feature switches for the AWS build (VITE_* = "false" turns one off;
// unset keeps today's behaviour).

// No Supabase Realtime server on AWS: run detail falls back to polling
// (hooks/useRunRealtime) and the live-collab widgets (presence, notifications,
// task feeds) are not mounted.
export const REALTIME_ENABLED = import.meta.env.VITE_REALTIME_ENABLED !== "false"

// Task management is out of the AWS scope (the API no longer serves tasks).
export const TASKS_ENABLED = import.meta.env.VITE_TASKS_ENABLED !== "false"
