-- Row-level security for the project vault (see 20_rls.sql for the model).
ALTER TABLE project_vault_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_vault_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_vault_items;
CREATE POLICY tenant_isolation ON project_vault_items
    USING (workspace_id = current_setting('app.workspace_id', true))
    WITH CHECK (workspace_id = current_setting('app.workspace_id', true));
