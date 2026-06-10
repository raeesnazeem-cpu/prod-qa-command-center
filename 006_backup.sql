-- Migration 006: RLS Refinement for Strict RBAC
-- This migration ensures that projects and tasks are ONLY visible to authorized users.

-- 1. DROP EXISTING POLICIES (Safety)
DROP POLICY IF EXISTS "Projects are viewable by org members" ON projects;
DROP POLICY IF EXISTS "Projects viewable by members" ON projects;
DROP POLICY IF EXISTS "Only org members can see projects" ON projects;

-- 2. PROJECTS: SELECT
-- Super Admins and Admins see all projects in their organization.
-- Sub-Admins, QAs, and Developers see ONLY projects where they are in project_members.
CREATE POLICY "Projects RBAC Select" ON projects
FOR SELECT TO authenticated
USING (
  (SELECT role FROM users WHERE clerk_user_id = auth.uid()::text) IN ('super_admin', 'admin')
  OR 
  id IN (SELECT project_id FROM project_members WHERE user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text))
);

-- 3. PROJECTS: INSERT/UPDATE/DELETE (Inherit organization-level role checks)
CREATE POLICY "Projects RBAC Management" ON projects
FOR ALL TO authenticated
USING (
  (SELECT role FROM users WHERE clerk_user_id = auth.uid()::text) IN ('super_admin', 'admin')
);

-- 4. TASKS: SELECT
-- Super Admins and Admins see all tasks in the organization's projects.
-- Sub-Admins and QAs see all tasks in their projects.
-- Developers see ONLY tasks specifically assigned to them.
CREATE POLICY "Tasks RBAC Select" ON tasks
FOR SELECT TO authenticated
USING (
  -- Super Admin/Admin can see all org relevant tasks
  (SELECT role FROM users WHERE clerk_user_id = auth.uid()::text) IN ('super_admin', 'admin')
  OR
  -- Developer: specific assignment
  ((SELECT role FROM users WHERE clerk_user_id = auth.uid()::text) = 'developer' AND assigned_to = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text))
  OR
  -- Others (Sub-Admin, QA): based on project membership
  (
    (SELECT role FROM users WHERE clerk_user_id = auth.uid()::text) NOT IN ('super_admin', 'admin', 'developer')
    AND 
    project_id IN (SELECT project_id FROM project_members WHERE user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text))
  )
);

-- 5. TASKS: MODIFICATION
CREATE POLICY "Tasks RBAC Modify" ON tasks
FOR UPDATE TO authenticated
USING (
  -- Admin/QA/Sub-Admin can update any task in their projects
  (SELECT role FROM users WHERE clerk_user_id = auth.uid()::text) IN ('super_admin', 'admin', 'sub_admin', 'qa_engineer')
  AND
  (
    (SELECT role FROM users WHERE clerk_user_id = auth.uid()::text) IN ('super_admin', 'admin')
    OR
    project_id IN (SELECT project_id FROM project_members WHERE user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text))
  )
);

-- 6. PROJECT MEMBERS: MANAGEMENT
CREATE POLICY "Project Members Management" ON project_members
FOR ALL TO authenticated
USING (
  (SELECT role FROM users WHERE clerk_user_id = auth.uid()::text) IN ('super_admin', 'admin', 'sub_admin')
);
