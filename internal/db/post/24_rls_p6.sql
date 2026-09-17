-- Row-level security for the P6 tables (see 20_rls.sql for the model). Workspace isolation; the
-- finer rules (managers+ write, members read per project visibility) are in internal/work/invoices.go
-- with explicit predicates in every statement.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['invoices', 'invoice_lines', 'invoice_payments', 'invoice_counters'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
            USING (workspace_id = current_setting('app.workspace_id', true))
            WITH CHECK (workspace_id = current_setting('app.workspace_id', true))$p$, t);
    END LOOP;
END $$;
