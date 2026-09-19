-- Integrity for project_catalogue (internal/db/schema/project_catalogue.sql): the row belongs
-- to a project of the same workspace and goes with it; one name per kind per project
-- (case-insensitive), which is also the upsert target of work.AddCatalogueItem/SyncCatalogue.
DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['project_catalogue_workspace_fk', 'project_catalogue', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['project_catalogue_project_fk',   'project_catalogue', 'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS project_catalogue_name_uq
    ON project_catalogue (workspace_id, project_id, kind, lower(name));
