-- Row-level security for the P5 tables (see 20_rls.sql for the model). Workspace isolation only;
-- "own or shared" (saved_reports) and "own" (notification_prefs) are explicit predicates in
-- internal/work.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['saved_reports', 'notification_prefs'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
            USING (workspace_id = current_setting('app.workspace_id', true))
            WITH CHECK (workspace_id = current_setting('app.workspace_id', true))$p$, t);
    END LOOP;
END $$;
