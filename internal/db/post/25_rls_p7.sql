-- Row-level security for the P7 tables (see 20_rls.sql for the model): the app
-- pool sees only its own workspace's rows. The public embed endpoint resolves a
-- key on the OWNER pool with an explicit predicate, so it does not depend on this.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['client_contacts', 'project_feedback_keys'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
            USING (workspace_id = current_setting('app.workspace_id', true))
            WITH CHECK (workspace_id = current_setting('app.workspace_id', true))$p$, t);
    END LOOP;
END $$;
