-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- The trigger that fills this, and its RLS, live in internal/db/post/30_tombstones.sql.
--
-- Tombstones, so a client that was offline learns about deletes.
--
-- Mahaam deletes rows for real — there is no deleted_at anywhere, deliberately, because a soft
-- delete has to be remembered by every query that ever reads the table and is forgotten by exactly
-- one of them. The cost is that a row simply stops existing, which an offline client has no way to
-- notice: it asks "what changed since X" and a deleted row is, by definition, not in the answer.
--
-- So the delete leaves a marker instead. Written by an AFTER DELETE trigger rather than by the Go
-- delete paths: there are a dozen of those, the set grows, and a trigger cannot be forgotten by
-- whoever adds the thirteenth. It also fires for ON DELETE CASCADE, which the Go code never sees
-- at all — deleting a project takes its tasks with it, and a client needs to hear about those too.
CREATE TABLE IF NOT EXISTS deletions (
    -- A uuid, not a bigserial. Every other table here does the same, and the reason is not
    -- taste: the app role is granted DML on tables but nothing grants USAGE on sequences, so a
    -- serial PK makes every insert fail with a permission error the API reports as a 500.
    id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text        NOT NULL,
    -- The table the row was in: 'tasks', 'projects', 'reports', 'task_comments', 'time_entries'.
    entity       text        NOT NULL,
    entity_id    text        NOT NULL,
    deleted_at   timestamptz NOT NULL DEFAULT now()
);

-- The sync query is always "this workspace, since this time", so that is the index.
CREATE INDEX IF NOT EXISTS deletions_since ON deletions (workspace_id, deleted_at);
