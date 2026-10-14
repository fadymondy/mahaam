-- P2 integrity: time entries, member rates, notifications. Same model as 11_p1_constraints.sql:
-- every reference between tenant rows is a composite (workspace_id, ref) foreign key.
--
-- One deliberate exception: time_entries.user_id references users(id), not workspace_members.
-- Removing a member is a DELETE of their membership row; a composite key would either cascade their
-- billing history away or forbid removing anyone who ever tracked time. The domain code
-- (internal/work/time.go) checks active membership on every write instead, and every reference an
-- entry makes into the tenant's data (project, task, client) is still workspace-scoped.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Targets for the composite keys.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_ws_project_id_uq ON tasks (workspace_id, project_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_ws_id_uq  ON time_entries (workspace_id, id);

-- ---- the invariants -------------------------------------------------------------------------------
-- one_running_timer and no_overlap moved to 19p_parallel_agent_timers.sql: agent (source = 'mcp')
-- timers run in parallel, so both now exempt them. That file creates or upgrades them in place.


DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['time_entries_workspace_fk', 'time_entries', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['time_entries_user_fk',      'time_entries', 'FOREIGN KEY (user_id) REFERENCES users (id)'],
        ['time_entries_creator_fk',   'time_entries', 'FOREIGN KEY (created_by) REFERENCES users (id)'],
        ['time_entries_project_fk',   'time_entries', 'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id)'],
        -- The task must belong to the entry's project; a deleted task leaves the entry on its project.
        ['time_entries_task_fk',      'time_entries', 'FOREIGN KEY (workspace_id, project_id, task_id) REFERENCES tasks (workspace_id, project_id, id) ON UPDATE CASCADE ON DELETE SET NULL (task_id)'],
        ['time_entries_client_fk',    'time_entries', 'FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE SET NULL (client_id)'],
        ['member_rates_member_fk',    'member_rates', 'FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE'],
        ['member_rates_creator_fk',   'member_rates', 'FOREIGN KEY (created_by) REFERENCES users (id)'],
        ['notifications_member_fk',   'notifications','FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

-- One rate row per member per effective day; one reminder per (user, kind, key).
CREATE UNIQUE INDEX IF NOT EXISTS member_rates_uq          ON member_rates (workspace_id, user_id, effective_from);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uq  ON notifications (workspace_id, user_id, kind, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Access paths, every one leading with workspace_id.
CREATE INDEX IF NOT EXISTS time_entries_user_idx     ON time_entries (workspace_id, user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_started_idx  ON time_entries (workspace_id, started_at);
CREATE INDEX IF NOT EXISTS time_entries_project_idx  ON time_entries (workspace_id, project_id, started_at) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_inbox_idx   ON notifications (workspace_id, user_id, created_at DESC);
