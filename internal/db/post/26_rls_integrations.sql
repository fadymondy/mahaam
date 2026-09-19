-- Row-level security for the integration tables (see 20_rls.sql for the model). The public
-- GitHub webhook and callback resolve an integration on the OWNER pool with explicit
-- predicates (installation id + repository / signed state), then act through the app pool
-- scoped to that integration's workspace.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['project_integrations', 'github_events'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
            USING (workspace_id = current_setting('app.workspace_id', true))
            WITH CHECK (workspace_id = current_setting('app.workspace_id', true))$p$, t);
    END LOOP;
END $$;
