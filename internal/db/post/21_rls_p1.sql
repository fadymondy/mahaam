-- Row-level security for the P1 tables (see 20_rls.sql for the model).

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'clients', 'projects', 'project_members', 'teams', 'team_members', 'project_teams',
        'task_statuses', 'tasks', 'task_assignees', 'task_checklist_items', 'labels', 'task_labels',
        'task_comments', 'attachments', 'key_counters'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
            USING (workspace_id = current_setting('app.workspace_id', true))
            WITH CHECK (workspace_id = current_setting('app.workspace_id', true))$p$, t);
    END LOOP;
END $$;

-- The activity feed is append-only for the app role: it may read and insert its own workspace's
-- entries, and there is no UPDATE or DELETE policy, so with FORCE RLS both affect zero rows.
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON activity_logs;
DROP POLICY IF EXISTS activity_read ON activity_logs;
DROP POLICY IF EXISTS activity_append ON activity_logs;
CREATE POLICY activity_read ON activity_logs FOR SELECT
    USING (workspace_id = current_setting('app.workspace_id', true));
CREATE POLICY activity_append ON activity_logs FOR INSERT
    WITH CHECK (workspace_id = current_setting('app.workspace_id', true));
