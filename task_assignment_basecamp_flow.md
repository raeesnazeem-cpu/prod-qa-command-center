# Task Assignment & Basecamp Integration Flow

This document maps out the end-to-end flow for the **Task Assignment** and **Basecamp Integration** features, listing all the files involved and identifying missing or incomplete parts in the current implementation.

## 1. Task Assignment Flow

### Files Involved

**Frontend (`apps/web`)**
*   **`src/components/TaskDetailPanel.tsx`**: Provides the UI for task details. Renders a dropdown to select an assignee if the user has the `qa_engineer` role. Changing the dropdown calls the `useAssignTask` hook.
*   **`src/hooks/useTasks.ts`**: Contains the `useAssignTask` React Query mutation hook which calls `assignTask` from the API layer and invalidates the `['tasks']` query cache on success to update the UI.
*   **`src/api/tasks.api.ts`**: Exposes the `assignTask` function which makes a `POST` request to `/api/tasks/:id/assign` with the `{ user_id }` payload.

**Backend (`apps/api`)**
*   **`src/routes/tasks.ts`**: Defines the `POST /:id/assign` endpoint. It:
    *   Verifies the user has the `qa_engineer` role.
    *   Resolves the target user ID using `getSupabaseUserId`.
    *   Updates the `tasks` table with the new `assigned_to` ID.
    *   Fetches user and project data to send an email notification via `emailNotifier.emailTaskAssigned`.
    *   Broadcasts the update via `broadcastTaskUpdate` (WebSockets).
*   **`src/lib/emailNotifier.ts`**: Handles the email construction and dispatch logic for assignments.

**Shared Packages (`packages/shared`)**
*   **`src/schemas/task.schema.ts`**: Contains validation schemas like `UpdateTaskSchema` which likely defines valid types for assignments, though the assignment route currently just checks for `user_id` or `assigned_to` in the body.

---

## 2. Basecamp Integration Flow

### Files Involved

**Frontend (`apps/web`)**
*   **`src/components/BasecampPushButton.tsx`**: Renders the "Push to Basecamp" button or a "Synced ✓ View in Basecamp" link if the task is already pushed. Triggers `usePushToBasecamp` on click.
*   **`src/components/TaskDetailPanel.tsx`**: Mounts `BasecampPushButton` if the project has Basecamp credentials configured.
*   **`src/hooks/useTasks.ts`**: Exposes the `usePushToBasecamp` mutation hook.
*   **`src/api/tasks.api.ts`**: Contains the `pushToBasecamp` function which sends a `POST` request to `/api/tasks/:id/basecamp`.

**Backend (`apps/api`)**
*   **`src/routes/basecampIntegration.ts`**:
    *   **`POST /:id/basecamp`**: The main push handler. Fetches project settings (Basecamp token, project ID, etc.), generates a rich HTML description for the task, and calls `createBasecampTodo`. Updates the task in the database with `basecamp_task_id`, `basecamp_url`, and changes status to `in_progress`.
    *   **`POST /basecamp` (Webhook)**: Handles incoming webhooks from Basecamp. Verifies the `x-basecamp-signature`. If a `todo_completion` event is received, it matches the Basecamp task ID, marks the local task as `resolved`, and appends a system comment acknowledging who resolved it.
*   **`src/lib/basecampClient.ts`**: Houses `createBasecampTodo`, the HTTP client wrapper that performs the actual Axios request to Basecamp's API using the provided integration settings.
*   **`src/lib/getDecryptedSettings.ts`**: Utility to securely retrieve and decrypt the project's Basecamp settings.

---

## 3. Missing or Incomplete Implementation Details

### Missing/Incomplete Code Lines

1.  **Local Assignee is Not Synced to Basecamp on Push**
    *   *File*: `apps/api/src/routes/basecampIntegration.ts`
    *   *Issue*: When pushing a task to Basecamp, the `createBasecampTodo` function is called **without** passing the `assigneeId`, even if the task is already assigned in QACC.
    *   *Fix Needed*: Read `task.assigned_to`, match it to a Basecamp User ID (if mapped), and pass `assigneeId` to `createBasecampTodo`.

2.  **No Assignment Syncing After Initial Push**
    *   *File*: `apps/api/src/routes/tasks.ts` (`POST /:id/assign`)
    *   *Issue*: If a task is assigned or reassigned *after* it has been pushed to Basecamp, the API does not make a call to Basecamp to update the assignee on the remote to-do item.
    *   *Fix Needed*: In the assign route, check if `task.basecamp_task_id` exists and push an update to Basecamp's API.

3.  **Hardcoded Placeholder User-Agent in Basecamp Client**
    *   *File*: `apps/api/src/lib/basecampClient.ts` (Line 32)
    *   *Issue*: `User-Agent: 'QACC (your@email.com)'` is hardcoded. Basecamp requires a descriptive User-Agent with contact info.
    *   *Fix Needed*: Replace `'your@email.com'` with a proper environment variable like `process.env.SUPPORT_EMAIL`.

4.  **Incomplete "Mark as Resolved" Button UI**
    *   *File*: `apps/web/src/components/TaskDetailPanel.tsx` (Lines 247-254)
    *   *Issue*: The "Mark as Resolved" button at the bottom of the Task Detail Panel is hardcoded as `disabled` with `cursor-not-allowed` and no `onClick` handler.
    *   *Fix Needed*: Wire it up to call `handleStatusChange('resolved')` or use a specific resolution mutation.

5.  **Incomplete Webhook State Management (Un-completion)**
    *   *File*: `apps/api/src/routes/basecampIntegration.ts` (`POST /basecamp`)
    *   *Issue*: The webhook handles `kind === 'todo_completion'` to resolve a task, but ignores `todo_uncompletion`. If a user accidentally checks off a todo in Basecamp and unchecks it, the task remains `resolved` in QACC.
    *   *Fix Needed*: Add a handler for `kind === 'todo_uncompletion'` to revert the task status to `in_progress`.
