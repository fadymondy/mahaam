-- Tombstones: the trigger that records a delete, and the RLS that keeps them tenant-scoped.
--
-- Replayed on every deploy, so everything here is idempotent.

CREATE OR REPLACE FUNCTION record_deletion() RETURNS trigger AS $$
BEGIN
    -- TG_TABLE_NAME rather than a per-table function: one function, five triggers, and adding a
    -- sixth table is a single CREATE TRIGGER below.
    INSERT INTO deletions (workspace_id, entity, entity_id)
    VALUES (OLD.workspace_id, TG_TABLE_NAME, OLD.id);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- AFTER DELETE, so a delete that rolls back leaves no tombstone behind — the marker and the
-- deletion share a transaction and therefore share a fate. FOR EACH ROW so a bulk delete and a
-- cascade both produce one marker per row rather than one per statement.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['projects', 'tasks', 'reports', 'task_comments', 'time_entries']
    LOOP
        -- to_regclass rather than assuming: this file runs against a database that may predate
        -- any one of these tables, and a missing table should not stop the rest being wired.
        IF to_regclass(t) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS record_deletion ON %I', t);
            EXECUTE format(
                'CREATE TRIGGER record_deletion AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_deletion()', t);
        END IF;
    END LOOP;
END $$;

ALTER TABLE deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deletions;
CREATE POLICY tenant_isolation ON deletions
    USING (workspace_id = current_setting('app.workspace_id', true))
    WITH CHECK (workspace_id = current_setting('app.workspace_id', true));

-- No UPDATE or DELETE policy, so the table is append-only to the app role for the same reason
-- activity_logs is: a tombstone that can be removed is a delete a client never hears about.
--
-- The trigger runs as the deleting role, so the WITH CHECK above is what lets it insert — and it
-- passes because the row it writes carries the workspace it just deleted from, which is the
-- workspace already in context. A trigger that needed SECURITY DEFINER to work would be a sign
-- the policy was wrong.
