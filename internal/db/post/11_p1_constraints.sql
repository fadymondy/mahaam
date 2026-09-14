-- P1 integrity: foreign keys, uniques and indexes for projects, tasks and their satellites.
--
-- Every reference between tenant rows is a COMPOSITE foreign key on (workspace_id, <ref>) into a
-- (workspace_id, id) unique index on the parent. A row can therefore only ever point at a row of
-- its OWN workspace — the database refuses a task whose project, status, parent or label lives in
-- another tenant, whatever the application code does. Nullable references use
-- ON DELETE SET NULL (<col>) so the workspace_id half is never nulled (Postgres 15+).

-- (workspace_id, id) targets for the composite keys.
CREATE UNIQUE INDEX IF NOT EXISTS clients_ws_id_uq         ON clients (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_ws_id_uq        ON projects (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS teams_ws_id_uq           ON teams (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS task_statuses_ws_id_uq   ON task_statuses (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_ws_id_uq           ON tasks (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS labels_ws_id_uq          ON labels (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_ws_user_uq ON workspace_members (workspace_id, user_id);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        -- name, table, definition
        ['clients_workspace_fk',        'clients',        'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['projects_workspace_fk',       'projects',       'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['projects_client_fk',          'projects',       'FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE SET NULL (client_id)'],
        ['projects_creator_fk',         'projects',       'FOREIGN KEY (created_by) REFERENCES users (id)'],
        ['project_members_project_fk',  'project_members','FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        ['project_members_member_fk',   'project_members','FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE'],
        ['teams_workspace_fk',          'teams',          'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['team_members_team_fk',        'team_members',   'FOREIGN KEY (workspace_id, team_id) REFERENCES teams (workspace_id, id) ON DELETE CASCADE'],
        ['team_members_member_fk',      'team_members',   'FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE'],
        ['project_teams_project_fk',    'project_teams',  'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        ['project_teams_team_fk',       'project_teams',  'FOREIGN KEY (workspace_id, team_id) REFERENCES teams (workspace_id, id) ON DELETE CASCADE'],
        ['task_statuses_project_fk',    'task_statuses',  'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        ['tasks_project_fk',            'tasks',          'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        ['tasks_status_fk',             'tasks',          'FOREIGN KEY (workspace_id, status_id) REFERENCES task_statuses (workspace_id, id) ON DELETE RESTRICT'],
        ['tasks_parent_fk',             'tasks',          'FOREIGN KEY (workspace_id, parent_id) REFERENCES tasks (workspace_id, id) ON DELETE SET NULL (parent_id)'],
        ['tasks_creator_fk',            'tasks',          'FOREIGN KEY (created_by) REFERENCES users (id)'],
        ['task_assignees_task_fk',      'task_assignees', 'FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE'],
        ['task_assignees_member_fk',    'task_assignees', 'FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE'],
        ['task_checklist_items_task_fk','task_checklist_items','FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE'],
        ['labels_workspace_fk',         'labels',         'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['task_labels_task_fk',         'task_labels',    'FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE'],
        ['task_labels_label_fk',        'task_labels',    'FOREIGN KEY (workspace_id, label_id) REFERENCES labels (workspace_id, id) ON DELETE CASCADE'],
        ['task_comments_task_fk',       'task_comments',  'FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE'],
        ['task_comments_author_fk',     'task_comments',  'FOREIGN KEY (author_id) REFERENCES users (id)'],
        ['attachments_task_fk',         'attachments',    'FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE'],
        ['attachments_uploader_fk',     'attachments',    'FOREIGN KEY (uploaded_by) REFERENCES users (id)'],
        ['activity_logs_workspace_fk',  'activity_logs',  'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['key_counters_workspace_fk',   'key_counters',   'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

-- One row per pair; keys unique per workspace; case-insensitive names.
CREATE UNIQUE INDEX IF NOT EXISTS project_members_uq      ON project_members (workspace_id, project_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_uq         ON team_members (workspace_id, team_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS project_teams_uq        ON project_teams (workspace_id, project_id, team_id);
CREATE UNIQUE INDEX IF NOT EXISTS task_assignees_uq       ON task_assignees (workspace_id, task_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS task_labels_uq          ON task_labels (workspace_id, task_id, label_id);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_number_uq         ON tasks (workspace_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_key_uq            ON tasks (workspace_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS labels_name_uq          ON labels (workspace_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_uq           ON teams (workspace_id, lower(name));

-- Access paths, every one leading with workspace_id.
CREATE INDEX IF NOT EXISTS clients_ws_name_idx        ON clients (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS projects_ws_status_idx     ON projects (workspace_id, archived_at, status);
CREATE INDEX IF NOT EXISTS project_members_user_idx   ON project_members (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS team_members_user_idx      ON team_members (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS task_statuses_project_idx  ON task_statuses (workspace_id, project_id, position);
CREATE INDEX IF NOT EXISTS tasks_board_idx            ON tasks (workspace_id, project_id, status_id, position);
CREATE INDEX IF NOT EXISTS tasks_parent_idx           ON tasks (workspace_id, parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_assignees_user_idx    ON task_assignees (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS task_checklist_task_idx    ON task_checklist_items (workspace_id, task_id, position);
CREATE INDEX IF NOT EXISTS task_comments_task_idx     ON task_comments (workspace_id, task_id, created_at);
CREATE INDEX IF NOT EXISTS attachments_task_idx       ON attachments (workspace_id, task_id, created_at);
CREATE INDEX IF NOT EXISTS activity_logs_ws_idx       ON activity_logs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_task_idx     ON activity_logs (workspace_id, task_id, created_at DESC) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_logs_project_idx  ON activity_logs (workspace_id, project_id, created_at DESC) WHERE project_id IS NOT NULL;
