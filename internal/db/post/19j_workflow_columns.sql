-- The project's columns ARE the workflow (see 19f2_workflow_stage.sql). This file: the sync
-- triggers map by stage, the Inbox gets the six default columns, and existing projects are
-- brought up: every column gets a stage, the two missing stages (Backlog, Waiting approval) get
-- a column, and every item moves to the column of its issue status.

-- Issue status changed -> the card moves to that stage's column.
CREATE OR REPLACE FUNCTION reports_sync_card() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cur_stage text;
    cur_cat text;
    col text;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL; -- a write made by the other side's sync
    END IF;
    IF NEW.task_id IS NULL THEN
        IF NEW.request_state IS NULL OR NEW.request_state = 'accepted' THEN
            PERFORM link_issue_card(NEW);
        END IF;
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        UPDATE tasks SET title = left(NEW.title, 500), description = NEW.body,
                         priority = CASE WHEN NEW.priority IS DISTINCT FROM OLD.priority
                                         THEN issue_to_task_priority(NEW.priority) ELSE priority END,
                         updated_at = now()
        WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id
          AND (title IS DISTINCT FROM left(NEW.title, 500) OR description IS DISTINCT FROM NEW.body
               OR NEW.priority IS DISTINCT FROM OLD.priority);
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            SELECT st.stage, st.category INTO cur_stage, cur_cat FROM tasks t JOIN task_statuses st ON st.id = t.status_id
            WHERE t.workspace_id = NEW.workspace_id AND t.id = NEW.task_id;
            IF COALESCE(cur_stage, '') <> NEW.status THEN
                SELECT stage_column(t.workspace_id, t.project_id, NEW.status) INTO col
                FROM tasks t WHERE t.workspace_id = NEW.workspace_id AND t.id = NEW.task_id;
                IF col IS NOT NULL THEN
                    UPDATE tasks SET status_id = col,
                        position = COALESCE((SELECT max(position) FROM tasks WHERE workspace_id = NEW.workspace_id AND status_id = col), 0) + 1024,
                        completed_at = CASE WHEN NEW.status = 'done' THEN COALESCE(completed_at, now()) END,
                        updated_at = now()
                    WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id AND status_id <> col;
                END IF;
            END IF;
        END IF;
    END IF;
    RETURN NULL;
END $$;

-- Card moved to another column -> the issue takes that column's stage.
CREATE OR REPLACE FUNCTION tasks_sync_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cat text;
    stg text;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;
    SELECT category, stage INTO cat, stg FROM task_statuses WHERE id = NEW.status_id;
    stg := COALESCE(stg, CASE cat WHEN 'doing' THEN 'in_progress' WHEN 'done' THEN 'done' ELSE 'todo' END);
    UPDATE reports r SET
        title = NEW.title,
        body = NEW.description,
        priority = task_to_issue_priority(NEW.priority, r.priority),
        status = CASE WHEN NEW.status_id IS DISTINCT FROM OLD.status_id THEN stg ELSE r.status END,
        state = CASE WHEN NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN r.state
                     WHEN stg = 'done' THEN 'closed'
                     WHEN r.state = 'closed' THEN 'open' ELSE r.state END,
        closed_at = CASE WHEN NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN r.closed_at
                         WHEN stg = 'done' THEN COALESCE(r.closed_at, now()) ELSE NULL END,
        updated_at = now()
    WHERE r.workspace_id = NEW.workspace_id AND r.task_id = NEW.id
      AND (r.title IS DISTINCT FROM NEW.title OR r.body IS DISTINCT FROM NEW.description
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR (NEW.status_id IS DISTINCT FROM OLD.status_id AND r.status IS DISTINCT FROM stg));
    RETURN NULL;
END $$;

-- A card made on the board: its issue starts in the column's stage.
CREATE OR REPLACE FUNCTION tasks_link_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cat text;
    stg text;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM reports WHERE workspace_id = NEW.workspace_id AND (task_id = NEW.id OR key = NEW.key)) THEN
        RETURN NULL;
    END IF;
    SELECT category, stage INTO cat, stg FROM task_statuses WHERE id = NEW.status_id;
    stg := COALESCE(stg, CASE cat WHEN 'doing' THEN 'in_progress' WHEN 'done' THEN 'done' ELSE 'todo' END);
    INSERT INTO reports (workspace_id, project_id, number, key, title, body, issue_type, status, state,
                         priority, reporter_id, source, closed_at, sort_order, agent_seconds, human_only,
                         task_id, created_at, from_board)
    VALUES (NEW.workspace_id, NEW.project_id, NEW.number, NEW.key, NEW.title, NEW.description, 'task', stg,
            CASE WHEN stg = 'done' THEN 'closed' ELSE 'open' END,
            task_to_issue_priority(NEW.priority, 'medium'), NEW.created_by, 'app',
            CASE WHEN stg = 'done' THEN COALESCE(NEW.completed_at, now()) END,
            0, 0, false, NEW.id, NEW.created_at, true);
    RETURN NULL;
END $$;

-- The six default columns, in a language.
CREATE OR REPLACE FUNCTION seed_workflow_columns(ws text, pid text, loc text) RETURNS void LANGUAGE sql AS $$
    INSERT INTO task_statuses (workspace_id, project_id, name, color, category, stage, position)
    SELECT ws, pid, CASE WHEN loc = 'ar' THEN x.ar ELSE x.en END, x.color, x.category, x.stage, x.pos
    FROM (VALUES
        ('Backlog', 'قائمة الانتظار', 'slate', 'todo', 'backlog', 1024::float8),
        ('To do', 'للتنفيذ', 'blue', 'todo', 'todo', 2048),
        ('In progress', 'قيد التنفيذ', 'violet', 'doing', 'in_progress', 3072),
        ('Waiting approval', 'بانتظار الموافقة', 'orange', 'doing', 'waiting_approval', 4096),
        ('In review', 'قيد المراجعة', 'amber', 'doing', 'in_review', 5120),
        ('Done', 'منجز', 'green', 'done', 'done', 6144)
    ) AS x(en, ar, color, category, stage, pos)
$$;

CREATE OR REPLACE FUNCTION ensure_inbox_project(ws text, actor text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    pid text;
    loc text;
BEGIN
    SELECT id INTO pid FROM projects WHERE workspace_id = ws AND is_inbox;
    IF pid IS NOT NULL THEN
        RETURN pid;
    END IF;
    SELECT locale INTO loc FROM workspaces WHERE id = ws;
    INSERT INTO projects (workspace_id, name, description, color, created_by, is_inbox)
    VALUES (ws, CASE WHEN loc = 'ar' THEN 'الوارد' ELSE 'Inbox' END,
            CASE WHEN loc = 'ar' THEN 'المشكلات التي وصلت بلا مشروع.' ELSE 'Issues filed without a project.' END,
            'slate', issue_actor(ws, actor), true)
    ON CONFLICT (workspace_id) WHERE is_inbox DO NOTHING
    RETURNING id INTO pid;
    IF pid IS NULL THEN
        SELECT id INTO pid FROM projects WHERE workspace_id = ws AND is_inbox;
        RETURN pid;
    END IF;
    PERFORM seed_workflow_columns(ws, pid, loc);
    RETURN pid;
END $$;

-- Bring existing projects up (idempotent: only columns without a stage / stages without a column).
DO $$
DECLARE
    p record;
    c record;
    n int;
    loc text;
    firstpos float8;
BEGIN
    FOR p IN SELECT pr.id, pr.workspace_id FROM projects pr
             WHERE EXISTS (SELECT 1 FROM task_statuses s WHERE s.project_id = pr.id AND s.stage IS NULL)
                OR NOT EXISTS (SELECT 1 FROM task_statuses s WHERE s.project_id = pr.id AND s.stage = 'backlog') LOOP
        PERFORM set_config('app.workspace_id', p.workspace_id, true);
        SELECT locale INTO loc FROM workspaces WHERE id = p.workspace_id;
        n := 0;
        FOR c IN SELECT id, category FROM task_statuses WHERE project_id = p.id AND stage IS NULL ORDER BY position LOOP
            IF c.category = 'doing' THEN
                n := n + 1;
            END IF;
            UPDATE task_statuses SET stage = CASE c.category
                WHEN 'todo' THEN CASE WHEN EXISTS (SELECT 1 FROM task_statuses WHERE project_id = p.id AND stage = 'todo') THEN 'backlog' ELSE 'todo' END
                WHEN 'done' THEN 'done'
                ELSE CASE WHEN n = 1 THEN 'in_progress' ELSE 'in_review' END END
            WHERE id = c.id;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM task_statuses WHERE project_id = p.id AND stage = 'backlog') THEN
            SELECT COALESCE(min(position), 1024) INTO firstpos FROM task_statuses WHERE project_id = p.id;
            INSERT INTO task_statuses (workspace_id, project_id, name, color, category, stage, position)
            VALUES (p.workspace_id, p.id, CASE WHEN loc = 'ar' THEN 'قائمة الانتظار' ELSE 'Backlog' END, 'slate', 'todo', 'backlog', firstpos / 2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM task_statuses WHERE project_id = p.id AND stage = 'waiting_approval') THEN
            INSERT INTO task_statuses (workspace_id, project_id, name, color, category, stage, position)
            SELECT p.workspace_id, p.id, CASE WHEN loc = 'ar' THEN 'بانتظار الموافقة' ELSE 'Waiting approval' END, 'orange', 'doing', 'waiting_approval',
                   (COALESCE((SELECT max(position) FROM task_statuses WHERE project_id = p.id AND stage = 'in_progress'), 2048)
                    + COALESCE((SELECT min(position) FROM task_statuses WHERE project_id = p.id AND stage IN ('in_review','done')), 8192)) / 2;
        END IF;
        -- Every item sits in the column of its issue status.
        UPDATE tasks t SET status_id = stage_column(t.workspace_id, t.project_id, r.status)
        FROM reports r
        WHERE r.task_id = t.id AND t.project_id = p.id
          AND t.status_id IS DISTINCT FROM stage_column(t.workspace_id, t.project_id, r.status);
    END LOOP;
END $$;
