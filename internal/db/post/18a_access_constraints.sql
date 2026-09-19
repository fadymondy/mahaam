-- Integrity for project_labels and access_grants (internal/db/schema/access_grant.sql).
-- project_labels uses composite keys on (workspace_id, ref) like every other table.
-- access_grants names its subject (user/team) and scope (label/task) polymorphically, so
-- the domain layer validates both on write and the trigger below deletes a grant together
-- with its label, task, team or membership.
CREATE UNIQUE INDEX IF NOT EXISTS access_grants_ws_id_uq ON access_grants (workspace_id, id);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['project_labels_workspace_fk', 'project_labels', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['project_labels_project_fk',   'project_labels', 'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        ['project_labels_label_fk',     'project_labels', 'FOREIGN KEY (workspace_id, label_id) REFERENCES labels (workspace_id, id) ON DELETE CASCADE'],
        ['access_grants_workspace_fk',  'access_grants',  'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS project_labels_label_idx ON project_labels (workspace_id, label_id);
CREATE INDEX IF NOT EXISTS access_grants_scope_idx   ON access_grants (workspace_id, scope_type, scope_id);
CREATE INDEX IF NOT EXISTS access_grants_subject_idx ON access_grants (workspace_id, subject_type, subject_id);

-- Polymorphic cleanup: a grant never outlives its label, task, team or user membership.
CREATE OR REPLACE FUNCTION access_grants_cleanup() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
    IF TG_TABLE_NAME = 'labels' THEN
        DELETE FROM access_grants WHERE workspace_id = OLD.workspace_id AND scope_type = 'label' AND scope_id = OLD.id;
    ELSIF TG_TABLE_NAME = 'tasks' THEN
        DELETE FROM access_grants WHERE workspace_id = OLD.workspace_id AND scope_type = 'task' AND scope_id = OLD.id;
    ELSIF TG_TABLE_NAME = 'teams' THEN
        DELETE FROM access_grants WHERE workspace_id = OLD.workspace_id AND subject_type = 'team' AND subject_id = OLD.id;
    ELSIF TG_TABLE_NAME = 'workspace_members' THEN
        DELETE FROM access_grants WHERE workspace_id = OLD.workspace_id AND subject_type = 'user' AND subject_id = OLD.user_id;
    END IF;
    RETURN OLD;
END $f$;

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['labels', 'tasks', 'teams', 'workspace_members'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS access_grants_cleanup ON %I', t);
        EXECUTE format('CREATE TRIGGER access_grants_cleanup AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION access_grants_cleanup()', t);
    END LOOP;
END $$;
