-- ============================================================
-- 006_rls.sql
-- Row Level Security policies for all QACC tables
-- ============================================================

-- ============================================================
-- Enable RLS on all tables
-- ============================================================
ALTER TABLE organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebuttals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_diffs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sign_offs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings         ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper functions
-- ============================================================

-- Returns the org_id of the currently authenticated user
CREATE OR REPLACE FUNCTION auth_user_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT org_id FROM users WHERE id = auth.uid();
$$;

-- Returns the role of the currently authenticated user
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$;

-- Returns true if the current user is a member of the given project
CREATE OR REPLACE FUNCTION is_project_member(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id
      AND user_id = auth.uid()
  );
$$;

-- Returns true if the current user has at least admin-level access in their org
CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth_user_role() IN ('super_admin','admin');
$$;

-- ============================================================
-- organizations
-- ============================================================
CREATE POLICY "org_select_own"
  ON organizations FOR SELECT
  USING (id = auth_user_org_id());

-- ============================================================
-- users
-- ============================================================

-- Every user can read their own row
CREATE POLICY "users_select_self"
  ON users FOR SELECT
  USING (id = auth.uid());

-- Admins can read all users in the same org
CREATE POLICY "users_select_org_admin"
  ON users FOR SELECT
  USING (
    org_id = auth_user_org_id()
    AND is_org_admin()
  );

-- A user can update only their own row
CREATE POLICY "users_update_self"
  ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Only admins can insert new users into the org
CREATE POLICY "users_insert_admin"
  ON users FOR INSERT
  WITH CHECK (
    org_id = auth_user_org_id()
    AND is_org_admin()
  );

-- ============================================================
-- projects
-- ============================================================

-- A user can see a project only if they are a member
CREATE POLICY "projects_select_member"
  ON projects FOR SELECT
  USING (is_project_member(id));

-- Only org admins can create projects
CREATE POLICY "projects_insert_admin"
  ON projects FOR INSERT
  WITH CHECK (
    org_id = auth_user_org_id()
    AND is_org_admin()
  );

-- Only org admins can update projects
CREATE POLICY "projects_update_admin"
  ON projects FOR UPDATE
  USING (
    org_id = auth_user_org_id()
    AND is_org_admin()
  );

-- ============================================================
-- project_members
-- ============================================================

-- Members of a project can see the membership list
CREATE POLICY "project_members_select"
  ON project_members FOR SELECT
  USING (is_project_member(project_id));

-- Only org admins can manage membership
CREATE POLICY "project_members_insert_admin"
  ON project_members FOR INSERT
  WITH CHECK (is_org_admin());

CREATE POLICY "project_members_delete_admin"
  ON project_members FOR DELETE
  USING (is_org_admin());

-- ============================================================
-- qa_runs
-- ============================================================

-- Visible to project members
CREATE POLICY "qa_runs_select_member"
  ON qa_runs FOR SELECT
  USING (is_project_member(project_id));

-- qa_engineer+ can create runs
CREATE POLICY "qa_runs_insert_engineer"
  ON qa_runs FOR INSERT
  WITH CHECK (
    is_project_member(project_id)
    AND auth_user_role() IN ('super_admin','admin','sub_admin','project_manager','qa_engineer')
  );

-- qa_engineer+ can update runs
CREATE POLICY "qa_runs_update_engineer"
  ON qa_runs FOR UPDATE
  USING (
    is_project_member(project_id)
    AND auth_user_role() IN ('super_admin','admin','sub_admin','project_manager','qa_engineer')
  );

-- ============================================================
-- pages
-- ============================================================

CREATE POLICY "pages_select_member"
  ON pages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM qa_runs r
      WHERE r.id = pages.run_id
        AND is_project_member(r.project_id)
    )
  );

-- ============================================================
-- findings
-- ============================================================

CREATE POLICY "findings_select_member"
  ON findings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM qa_runs r
      WHERE r.id = findings.run_id
        AND is_project_member(r.project_id)
    )
  );

CREATE POLICY "findings_insert_engineer"
  ON findings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM qa_runs r
      WHERE r.id = findings.run_id
        AND is_project_member(r.project_id)
        AND auth_user_role() IN ('super_admin','admin','sub_admin','project_manager','qa_engineer')
    )
  );

CREATE POLICY "findings_update_engineer"
  ON findings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM qa_runs r
      WHERE r.id = findings.run_id
        AND is_project_member(r.project_id)
        AND auth_user_role() IN ('super_admin','admin','sub_admin','project_manager','qa_engineer')
    )
  );

-- ============================================================
-- tasks
-- ============================================================

-- Developers can only see tasks assigned to them
CREATE POLICY "tasks_select_developer"
  ON tasks FOR SELECT
  USING (
    is_project_member(project_id)
    AND (
      auth_user_role() IN ('super_admin','admin','sub_admin','project_manager','qa_engineer')
      OR assigned_to = auth.uid()
    )
  );

-- qa_engineer+ can create tasks
CREATE POLICY "tasks_insert_engineer"
  ON tasks FOR INSERT
  WITH CHECK (
    is_project_member(project_id)
    AND auth_user_role() IN ('super_admin','admin','sub_admin','project_manager','qa_engineer')
  );

-- Developers can update only their assigned tasks; qa_engineer+ can update all in project
CREATE POLICY "tasks_update"
  ON tasks FOR UPDATE
  USING (
    is_project_member(project_id)
    AND (
      auth_user_role() IN ('super_admin','admin','sub_admin','project_manager','qa_engineer')
      OR assigned_to = auth.uid()
    )
  );

-- ============================================================
-- rebuttals
-- ============================================================

-- Visible to project members via task → project chain
CREATE POLICY "rebuttals_select_member"
  ON rebuttals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = rebuttals.task_id
        AND is_project_member(t.project_id)
    )
  );

-- Any project member can submit a rebuttal
CREATE POLICY "rebuttals_insert_member"
  ON rebuttals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = rebuttals.task_id
        AND is_project_member(t.project_id)
    )
  );

-- ============================================================
-- comments
-- ============================================================

CREATE POLICY "comments_select_member"
  ON comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = comments.task_id
        AND is_project_member(t.project_id)
    )
  );

CREATE POLICY "comments_insert_member"
  ON comments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = comments.task_id
        AND is_project_member(t.project_id)
    )
  );

-- ============================================================
-- visual_diffs
-- ============================================================

CREATE POLICY "visual_diffs_select_member"
  ON visual_diffs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM qa_runs r
      WHERE r.id = visual_diffs.run_id
        AND is_project_member(r.project_id)
    )
  );

-- ============================================================
-- sign_offs
-- ============================================================

CREATE POLICY "sign_offs_select_member"
  ON sign_offs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM qa_runs r
      WHERE r.id = sign_offs.run_id
        AND is_project_member(r.project_id)
    )
  );

-- qa_engineer+ can sign off runs
CREATE POLICY "sign_offs_insert_engineer"
  ON sign_offs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM qa_runs r
      WHERE r.id = sign_offs.run_id
        AND is_project_member(r.project_id)
        AND auth_user_role() IN ('super_admin','admin','sub_admin','project_manager','qa_engineer')
    )
  );

-- ============================================================
-- project_settings
-- ============================================================

-- Only project members can view settings
CREATE POLICY "project_settings_select_member"
  ON project_settings FOR SELECT
  USING (is_project_member(project_id));

-- Only org admins can modify project settings
CREATE POLICY "project_settings_insert_admin"
  ON project_settings FOR INSERT
  WITH CHECK (is_org_admin());

CREATE POLICY "project_settings_update_admin"
  ON project_settings FOR UPDATE
  USING (is_org_admin());

-- ============================================================
-- embeddings — strict org_id isolation (critical)
-- ============================================================

CREATE POLICY "embeddings_select_own_org"
  ON embeddings FOR SELECT
  USING (org_id = auth_user_org_id());

CREATE POLICY "embeddings_insert_own_org"
  ON embeddings FOR INSERT
  WITH CHECK (org_id = auth_user_org_id());

CREATE POLICY "embeddings_delete_admin"
  ON embeddings FOR DELETE
  USING (
    org_id = auth_user_org_id()
    AND is_org_admin()
  );
