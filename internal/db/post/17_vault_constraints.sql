-- Project vault integrity (see internal/db/schema/project_vault_item.sql). Composite
-- keys on (workspace_id, ref), as everywhere else.
CREATE UNIQUE INDEX IF NOT EXISTS project_vault_items_ws_id_uq ON project_vault_items (workspace_id, id);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['vault_workspace_fk', 'project_vault_items', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['vault_project_fk',   'project_vault_items', 'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS project_vault_items_project_idx ON project_vault_items (workspace_id, project_id, kind);
-- Recall: full-text over title + body ('simple' so Arabic and English both tokenize). Tags are
-- matched in the query too, but array_to_string is not IMMUTABLE so they cannot be indexed here;
-- a project vault is small, and the (workspace_id, project_id) index bounds the scan anyway.
CREATE INDEX IF NOT EXISTS project_vault_items_fts_idx ON project_vault_items
    USING gin (to_tsvector('simple', title || ' ' || body));
