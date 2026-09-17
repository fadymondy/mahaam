-- P7 integrity: the client portal link table, per-project feedback keys, and the
-- reports.source column that marks where an issue came from (app | portal | embed).
--
-- Same rule as the rest of the schema: every reference between tenant rows is a
-- COMPOSITE foreign key on (workspace_id, <ref>), so a row can only ever point at
-- a row of its own workspace whatever the code does.

-- reports.source: how an issue was filed. 'app' (the in-app Report a problem dialog,
-- the historical default), 'portal' (a client filed it through the portal), 'embed'
-- (the public embeddable Feedback SDK, via a per-project public key).
ALTER TABLE reports ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';

-- (workspace_id, id) targets for the P7 composite keys.
CREATE UNIQUE INDEX IF NOT EXISTS client_contacts_ws_id_uq        ON client_contacts (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS project_feedback_keys_ws_id_uq  ON project_feedback_keys (workspace_id, id);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['client_contacts_workspace_fk', 'client_contacts', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['client_contacts_client_fk',    'client_contacts', 'FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE'],
        ['client_contacts_member_fk',    'client_contacts', 'FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE'],
        ['pfk_workspace_fk',             'project_feedback_keys', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['pfk_project_fk',               'project_feedback_keys', 'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        -- reports.project_id was never given its FK; do it now that the portal files into projects.
        ['reports_project_fk',           'reports',          'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE SET NULL (project_id)']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

-- A person is the portal contact of at most one client per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS client_contacts_user_uq ON client_contacts (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS client_contacts_client_idx     ON client_contacts (workspace_id, client_id);
CREATE INDEX IF NOT EXISTS project_feedback_keys_project_idx ON project_feedback_keys (workspace_id, project_id);
-- reports lookups the portal makes: a client's own issues within a project.
CREATE INDEX IF NOT EXISTS reports_project_idx ON reports (workspace_id, project_id);
