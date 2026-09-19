-- Hand-written Postgres DDL. FKs/RLS in internal/db/post (16_*, 26_*).
--
-- github_events: a small log of what GitHub told us about a linked repository — commits
-- (push), deployments (deployment_status), workflow runs, pull requests — kept for delivery
-- KPIs later, and the dedupe ledger for webhook redeliveries (issue comments are logged here
-- too so a redelivered issue_comment is not posted twice).
--   kind         commit | deployment | workflow_run | pull_request | comment
--   external_id  the GitHub id (commit sha, deployment status id, run id, PR id, comment id)
CREATE TABLE IF NOT EXISTS github_events (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    project_id   text NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('commit', 'deployment', 'workflow_run', 'pull_request', 'comment')),
    external_id  text NOT NULL,
    repo         text NOT NULL DEFAULT '',
    ref          text NOT NULL DEFAULT '',
    sha          text NOT NULL DEFAULT '',
    author_login text NOT NULL DEFAULT '',
    author_email text NOT NULL DEFAULT '',
    title        text NOT NULL DEFAULT '',
    status       text NOT NULL DEFAULT '',
    url          text NOT NULL DEFAULT '',
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now()
);
