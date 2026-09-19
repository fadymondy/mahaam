-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (18a_access_constraints.sql, 28_rls_access.sql).
--
-- Access beyond a project's own members (project_members / project_teams):
--   project_labels  groups projects under workspace labels ("Client X", "Retainers", …);
--   access_grants   gives a USER or a TEAM access to every project carrying a LABEL, or to
--                   one TASK (the person then sees that project, but only the granted tasks
--                   and the ones assigned to them). A team grant follows the team's members.
-- Roles stay the workspace roles (owner/admin = admin, manager = project manager, member =
-- employee, client = customer); managers+ see everything, so grants matter for members.
CREATE TABLE IF NOT EXISTS project_labels (
    workspace_id text NOT NULL,
    project_id   text NOT NULL,
    label_id     text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, project_id, label_id)
);

CREATE TABLE IF NOT EXISTS access_grants (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'team')),
    subject_id   text NOT NULL,
    scope_type   text NOT NULL CHECK (scope_type IN ('label', 'task')),
    scope_id     text NOT NULL,
    created_by   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, subject_type, subject_id, scope_type, scope_id)
);
