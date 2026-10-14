-- Parallel agent timers. Agents act through the user's own mgy_ token (entries with source = 'mcp'),
-- and several agents work on different tasks at once, so they may not share the human's single timer.
--
--   human timers (source <> 'mcp')  at most one running per (workspace, user); never overlap each other
--   agent timers (source =  'mcp')  at most one running per (workspace, user, task); may overlap anything
--
-- Replaces the originals from 12_p2_constraints.sql (which no longer creates them). Idempotent: a
-- fresh database creates the new shape; an upgraded one drops the old shape once. Index and constraint
-- names are unchanged, so error mapping (internal/work/work.go) keeps working.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'one_running_timer' AND indexdef NOT LIKE '%mcp%') THEN
        DROP INDEX one_running_timer;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'no_overlap' AND pg_get_constraintdef(oid) NOT LIKE '%mcp%') THEN
        ALTER TABLE time_entries DROP CONSTRAINT no_overlap;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS one_running_timer
    ON time_entries (workspace_id, user_id) WHERE ended_at IS NULL AND source <> 'mcp';

CREATE UNIQUE INDEX IF NOT EXISTS one_running_agent_timer_per_task
    ON time_entries (workspace_id, user_id, task_id) WHERE ended_at IS NULL AND source = 'mcp' AND task_id IS NOT NULL;

-- Workspace-scoped for the reasons given in the original (a cross-tenant constraint leaks rows).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'no_overlap') THEN
        ALTER TABLE time_entries ADD CONSTRAINT no_overlap EXCLUDE USING gist (
            workspace_id WITH =,
            user_id WITH =,
            tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') WITH &&
        ) WHERE (source <> 'mcp');
    END IF;
END $$;
