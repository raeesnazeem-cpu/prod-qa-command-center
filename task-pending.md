# Task Assignment & Basecamp Integration - Pending Implementation

This document maps the complete end-to-end flow and identifies exactly which files, lines, and endpoints are missing or incomplete.

---

## 1. TASK ASSIGNMENT FLOW

### 1.1 Frontend Flow (`apps/web`)

| File | Role | Lines | Status |
|------|------|-------|--------|
| `src/components/TaskDetailPanel.tsx` | Assignment UI dropdown | 113-127 | ✅ Complete |
| `src/hooks/useTasks.ts` | `useAssignTask` mutation | 102-118 | ✅ Complete |
| `src/api/tasks.api.ts` | `assignTask` API call | 105-112 | ✅ Complete |

**Complete Flow:**
```
User selects assignee in dropdown
    ↓
handleAssigneeChange() @ TaskDetailPanel.tsx:45-47
    ↓
assignTask({ id, userId }) via useAssignTask @ useTasks.ts:107-108
    ↓
POST /api/tasks/:id/assign @ tasks.api.ts:110
```

### 1.2 Backend Flow (`apps/api`)

| File | Role | Lines | Status |
|------|------|-------|--------|
| `src/routes/tasks.ts` | `POST /:id/assign` endpoint | 249-301 | ✅ Partially Complete - **MISSING BASECAMP SYNC** |
| `src/lib/emailNotifier.ts` | Email notification on assign | 42-65 | ✅ Complete |
| `src/lib/realtimeService.ts` | WebSocket broadcast | 7-22 | ✅ Complete |

**Endpoint:** `POST /api/tasks/:id/assign` @ `apps/api/src/routes/tasks.ts:252-301`

---

## 2. BASECAMP INTEGRATION FLOW

### 2.1 Frontend Flow (`apps/web`)

| File | Role | Lines | Status |
|------|------|-------|--------|
| `src/components/SettingsTab.tsx` | Basecamp configuration UI | 211-294 | ✅ Complete |
| `src/components/BasecampPushButton.tsx` | Push button + sync status | 1-67 | ✅ Complete |
| `src/components/TaskDetailPanel.tsx` | Mounts BasecampPushButton conditionally | 129-131 | ✅ Complete |
| `src/hooks/useTasks.ts` | `usePushToBasecamp` mutation | 120-135 | ✅ Complete |
| `src/api/tasks.api.ts` | `pushToBasecamp` API call | 143-149 | ✅ Complete |

**Settings Flow:**
```
SettingsTab.tsx:65-75 → handleTestBasecamp() → POST /api/projects/:id/settings/test-basecamp
SettingsTab.tsx:55-63 → handleUpdateBasecamp() → PATCH /api/projects/:id
```

### 2.2 Backend Flow (`apps/api`)

| File | Role | Lines | Status |
|------|------|-------|--------|
| `src/routes/basecampIntegration.ts` | Push handler + Webhook | 16-83, 89-155 | ✅ Partially Complete - **MISSING UNCOMPLETION & ASSIGNMENT SYNC** |
| `src/routes/projectSettings.ts` | Settings CRUD + Test endpoint | 31-172 | ✅ Complete |
| `src/lib/basecampClient.ts` | HTTP client for Basecamp API | 16-41 | ⚠️ **HARDCODED USER-AGENT @ Line 32** |
| `src/lib/getDecryptedSettings.ts` | Decrypt tokens securely | 22-70 | ✅ Complete |

**Endpoints:**
- `POST /api/tasks/:id/basecamp` @ `apps/api/src/routes/basecampIntegration.ts:16-83`
- `POST /webhooks/basecamp` @ `apps/api/src/routes/basecampIntegration.ts:89-155`

---

## 3. SHARED SCHEMAS (`packages/shared`)

| File | Role | Lines | Status |
|------|------|-------|--------|
| `src/schemas/task.schema.ts` | Task validation schemas | 1-36 | ✅ Complete |
| `src/schemas/project.schema.ts` | Project validation schemas | 1-22 | ✅ Complete |

---

## 4. MISSING / INCOMPLETE IMPLEMENTATION

### 4.1 CRITICAL: Local Assignee Not Synced to Basecamp on Push

**File:** `apps/api/src/routes/basecampIntegration.ts`  
**Lines:** 56-63  
**Issue:** When pushing a task to Basecamp, `createBasecampTodo` is called **without** passing the `assigneeId`, even if the task is already assigned in QACC.

```typescript
// CURRENT (Missing assignee):
const { id: basecampTaskId, url: basecampUrl } = await createBasecampTodo({
  token: projectSettings.basecamp_token,
  accountId: projectSettings.basecamp_account_id,
  projectId: projectSettings.basecamp_project_id,
  todolistId: projectSettings.basecamp_todolist_id,
  title: task.title,
  description: descriptionHtml,
  // MISSING: assigneeId
});
```

**Fix Required:**
1. Read `task.assigned_to` from the task
2. Map QACC user to Basecamp user ID (need user mapping table)
3. Pass `assigneeId` to `createBasecampTodo`

---

### 4.2 CRITICAL: No Assignment Sync After Initial Push

**File:** `apps/api/src/routes/tasks.ts`  
**Lines:** 249-301 (POST /:id/assign endpoint)  
**Issue:** If a task is assigned/reassigned AFTER being pushed to Basecamp, the API doesn't update the assignee on the remote Basecamp to-do.

```typescript
// CURRENT (Missing Basecamp sync):
router.post('/:id/assign', ... , async (req, res) => {
  // ... assignment logic ...
  
  await broadcastTaskUpdate(id, task);
  return res.json(task);
  // MISSING: Check if task.basecamp_task_id exists and sync to Basecamp
});
```

**Fix Required:**
Add after line 295:
```typescript
// If task has been pushed to Basecamp, sync the assignee
if (task.basecamp_task_id) {
  await syncAssigneeToBasecamp(task, targetUserId);
}
```

---

### 4.3 MEDIUM: Hardcoded User-Agent in Basecamp Client

**File:** `apps/api/src/lib/basecampClient.ts`  
**Line:** 32  
**Issue:** `User-Agent: 'QACC (your@email.com)'` is hardcoded. Basecamp requires a descriptive User-Agent with contact info.

```typescript
// CURRENT:
'User-Agent': 'QACC (your@email.com)',

// SHOULD BE:
'User-Agent': `QACC (${process.env.SUPPORT_EMAIL || 'support@example.com'})`,
```

---

### 4.4 MEDIUM: Incomplete "Mark as Resolved" Button

**File:** `apps/web/src/components/TaskDetailPanel.tsx`  
**Lines:** 247-254  
**Issue:** The "Mark as Resolved" button is hardcoded as `disabled` with `cursor-not-allowed` and no `onClick` handler.

```typescript
// CURRENT (Disabled):
<button 
  disabled
  className="inline-flex items-center space-x-2 text-slate-400 font-bold text-xs cursor-not-allowed opacity-60"
>
  <CheckCircle2 className="w-4 h-4" />
  <span>Mark as Resolved</span>
</button>
```

**Fix Required:**
```typescript
<button 
  onClick={() => handleStatusChange('resolved')}
  disabled={task.status === 'resolved'}
  className={...}
>
  ...
</button>
```

---

### 4.5 MEDIUM: Missing Webhook Handler for Todo Un-completion

**File:** `apps/api/src/routes/basecampIntegration.ts`  
**Lines:** 111-148 (within POST /webhooks/basecamp)  
**Issue:** The webhook handles `todo_completion` to resolve a task, but ignores `todo_uncompletion`. If a user unchecks a todo in Basecamp, the task remains `resolved` in QACC.

```typescript
// CURRENT (Only handles completion):
if (kind === 'todo_completion') {
  // ... resolve task ...
}
// MISSING: Handler for todo_uncompletion
```

**Fix Required:**
Add after line 148:
```typescript
if (kind === 'todo_uncompletion') {
  const basecampTaskId = recording.id.toString();
  
  const { data: task } = await supabase
    .from('tasks')
    .select('id')
    .eq('basecamp_task_id', basecampTaskId)
    .maybeSingle();
  
  if (task) {
    await supabase
      .from('tasks')
      .update({ status: 'in_progress' })
      .eq('id', task.id);
    
    await supabase.from('comments').insert({
      task_id: task.id,
      content: `Reopened via Basecamp (todo uncompleted)`,
      author_id: null,
    });
  }
}
```

---

### 4.6 MISSING: User-to-Basecamp ID Mapping

**Issue:** There's no mechanism to map QACC user IDs to Basecamp user IDs for assignment syncing.

**Files to Create/Modify:**
- Database migration: Add `basecamp_user_id` column to `users` table or create `user_integrations` table
- `apps/web/src/components/UserSettings.tsx` or profile page: Add field to input Basecamp user ID
- `apps/api/src/routes/users.ts`: Add endpoint to save Basecamp user ID

---

### 4.7 MISSING: Update Basecamp Assignee API Function

**File to Create/Modify:** `apps/api/src/lib/basecampClient.ts`  
**Issue:** Only `createBasecampTodo` exists. Need a function to update an existing todo's assignee.

**Function to Add:**
```typescript
export async function updateBasecampTodoAssignee(params: {
  token: string;
  accountId: string;
  projectId: string;
  todoId: string;
  assigneeId: number;
}): Promise<void> {
  const { token, accountId, projectId, todoId, assigneeId } = params;
  const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todos/${todoId}.json`;
  
  await axios.put(
    url,
    { assignee_ids: [assigneeId] },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': `QACC (${process.env.SUPPORT_EMAIL})`,
      },
    }
  );
}
```

---

## 5. COMPLETE FILE INVENTORY

### Frontend (`apps/web/src/`)
| File | Purpose |
|------|---------|
| `components/TaskDetailPanel.tsx` | Task detail UI, assignment dropdown, Basecamp button mount |
| `components/BasecampPushButton.tsx` | Push to Basecamp button & sync status display |
| `components/SettingsTab.tsx` | Basecamp integration configuration UI |
| `hooks/useTasks.ts` | React Query hooks for task operations |
| `api/tasks.api.ts` | API client functions for tasks |

### Backend (`apps/api/src/`)
| File | Purpose |
|------|---------|
| `routes/tasks.ts` | Task CRUD + assignment endpoint |
| `routes/basecampIntegration.ts` | Push to Basecamp + webhook handler |
| `routes/projectSettings.ts` | Project settings CRUD + test endpoints |
| `lib/basecampClient.ts` | Basecamp API HTTP client |
| `lib/getDecryptedSettings.ts` | Secure token retrieval |
| `lib/emailNotifier.ts` | Assignment email notifications |
| `lib/realtimeService.ts` | WebSocket broadcast for live updates |
| `index.ts` | Route mounting (lines 56, 104 for basecamp routes) |

### Shared (`packages/shared/src/`)
| File | Purpose |
|------|---------|
| `schemas/task.schema.ts` | Zod validation schemas for tasks |
| `schemas/project.schema.ts` | Zod validation schemas for projects |

---

## 6. PRIORITY FIX ORDER

1. **HIGH**: Fix hardcoded User-Agent @ `basecampClient.ts:32`
2. **HIGH**: Enable "Mark as Resolved" button @ `TaskDetailPanel.tsx:247-254`
3. **HIGH**: Add `todo_uncompletion` webhook handler @ `basecampIntegration.ts`
4. **MEDIUM**: Create user-to-Basecamp ID mapping system
5. **MEDIUM**: Sync local assignee on initial push @ `basecampIntegration.ts:56-63`
6. **MEDIUM**: Sync assignee changes to Basecamp @ `tasks.ts:295`
7. **LOW**: Add `updateBasecampTodoAssignee` function to `basecampClient.ts`

---

## 7. ENVIRONMENT VARIABLES NEEDED

```bash
# Already referenced in code
RESEND_API_KEY              # For assignment emails
FRONTEND_URL                # For email links
CLERK_SECRET_KEY            # For auth
BASECAMP_WEBHOOK_SECRET     # For webhook verification

# NEEDS TO BE ADDED
SUPPORT_EMAIL                 # For Basecamp User-Agent header
```
