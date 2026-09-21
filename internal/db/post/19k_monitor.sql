-- Backend error-monitoring: project_monitor_keys constraints/RLS/grants, and the reports columns
-- that let a hot-looping error update one issue instead of flooding the board with duplicates.

CREATE UNIQUE INDEX IF NOT EXISTS project_monitor_keys_ws_id_uq ON project_monitor_keys (workspace_id, id);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmk_workspace_fk') THEN
        ALTER TABLE project_monitor_keys ADD CONSTRAINT pmk_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pmk_project_fk') THEN
        ALTER TABLE project_monitor_keys ADD CONSTRAINT pmk_project_fk
            FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS project_monitor_keys_project_idx ON project_monitor_keys (workspace_id, project_id);

ALTER TABLE project_monitor_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_monitor_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_monitor_keys;
CREATE POLICY tenant_isolation ON project_monitor_keys
    USING (workspace_id = current_setting('app.workspace_id', true))
    WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

-- Dedup: a repeat of the same fault updates the OPEN issue's occurrence_count/last_seen_at
-- instead of filing a new one every time it fires.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS monitor_fingerprint text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS occurrence_count bigint NOT NULL DEFAULT 1;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
CREATE INDEX IF NOT EXISTS reports_monitor_fingerprint_idx ON reports (workspace_id, project_id, monitor_fingerprint)
    WHERE monitor_fingerprint IS NOT NULL;
