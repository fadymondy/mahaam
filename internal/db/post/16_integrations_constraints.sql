-- Integrations integrity (GitHub / Jira / Linear per project). Same rule as the rest of the
-- schema: every reference between tenant rows is a COMPOSITE foreign key on
-- (workspace_id, <ref>), so a row can only point at a row of its own workspace.

CREATE UNIQUE INDEX IF NOT EXISTS project_integrations_ws_id_uq ON project_integrations (workspace_id, id);
-- One integration of each provider per project (GitHub: one linked repository).
CREATE UNIQUE INDEX IF NOT EXISTS project_integrations_provider_uq ON project_integrations (workspace_id, project_id, provider);
-- Webhook routing: installation id + repository, looked up across workspaces on the owner pool.
CREATE INDEX IF NOT EXISTS project_integrations_gh_install_idx ON project_integrations ((config->>'installation_id')) WHERE provider = 'github';

CREATE UNIQUE INDEX IF NOT EXISTS github_events_uq ON github_events (workspace_id, project_id, kind, external_id);
CREATE INDEX IF NOT EXISTS github_events_recent_idx ON github_events (workspace_id, project_id, kind, occurred_at DESC);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['project_integrations_workspace_fk', 'project_integrations', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['project_integrations_project_fk',   'project_integrations', 'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        ['github_events_workspace_fk',        'github_events',        'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['github_events_project_fk',          'github_events',        'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

-- Imported / linked issues live in reports (external_source github|jira|linear, external_id the
-- provider's id). One Mahaam issue per external issue per workspace, so a re-import updates
-- instead of duplicating (internal/integrations/upsert.go).
CREATE UNIQUE INDEX IF NOT EXISTS reports_external_uq ON reports (workspace_id, external_source, external_id)
    WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
-- The last state Mahaam saw on (or pushed to) the external issue: open | closed. The GitHub
-- mirror compares it with reports.state to push a close/reopen made in Mahaam.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS external_state text;
