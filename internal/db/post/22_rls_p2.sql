-- Row-level security for the P2 tables (see 20_rls.sql for the model). Workspace isolation only:
-- time entries, rates and notifications are further narrowed to the person in internal/work
-- (own entries unless time:manage; own inbox always), with explicit predicates in every statement.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['time_entries', 'member_rates', 'notifications'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
            USING (workspace_id = current_setting('app.workspace_id', true))
            WITH CHECK (workspace_id = current_setting('app.workspace_id', true))$p$, t);
    END LOOP;
END $$;
