-- Issues live on the board. Every issue (reports row: SDK, portal, MCP, in-app, GitHub/Jira/Linear
-- import, the /issues agent loop) IS a task card on its project's board: the same key (MH-n — tasks
-- and reports share key_counters), and title, description, priority and status kept in step both
-- ways. The reports row keeps what only an issue has: type, source, reporter, page, screenshot,
-- console/network logs, agent time, customer-request state. One item, one key, one place to work.
--
--   report inserted (or a customer request accepted) -> a card in its project (an issue without a project goes to the
--                                 workspace's Inbox project, created on demand)
--   report title/body/priority/status changes -> the card follows (status by category)
--   card title/description/priority/column changes -> the issue follows
--   card deleted -> the issue goes with it (FK cascade); issue deleted -> the card goes
--
-- The triggers run as the invoking role in the same statement, so row-level security applies
-- exactly as it did to the write that fired them (the same app.workspace_id).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_inbox boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS projects_one_inbox ON projects (workspace_id) WHERE is_inbox;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS task_id text;
-- from_board: the issue was born from a card (a task made on the board, by create_task, a subtask,
-- a converted request). It is internal work, like a task always was: customer-facing lists (the
-- portal, the customer MCP) never show it; only issues filed as issues (SDK, portal, MCP
-- create_issue, in-app reports, imports) are visible to customers.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS from_board boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS reports_task_uq ON reports (task_id) WHERE task_id IS NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_task_fk') THEN
        ALTER TABLE reports ADD CONSTRAINT reports_task_fk FOREIGN KEY (workspace_id, task_id)
            REFERENCES tasks (workspace_id, id) ON DELETE CASCADE;
    END IF;
END $$;

-- Board category of an issue status, and back.
CREATE OR REPLACE FUNCTION issue_status_category(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN s IN ('in_progress', 'waiting_approval', 'in_review') THEN 'doing'
                WHEN s = 'done' THEN 'done' ELSE 'todo' END
$$;

CREATE OR REPLACE FUNCTION issue_to_task_priority(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p WHEN 'highest' THEN 'urgent' WHEN 'high' THEN 'high' WHEN 'medium' THEN 'medium'
                  WHEN 'low' THEN 'low' WHEN 'lowest' THEN 'low' ELSE 'none' END
$$;

CREATE OR REPLACE FUNCTION task_to_issue_priority(p text, current text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p WHEN 'urgent' THEN 'highest' WHEN 'high' THEN 'high' WHEN 'medium' THEN 'medium'
                  WHEN 'low' THEN CASE WHEN current = 'lowest' THEN 'lowest' ELSE 'low' END
                  ELSE current END
$$;

-- Who a card or the Inbox is "created by" (users FK): the reporter, else the workspace owner,
-- else any member, else whoever created the workspace. Membership rows only — the app role
-- cannot read users.
CREATE OR REPLACE FUNCTION issue_actor(ws text, reporter text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT COALESCE(reporter,
        (SELECT user_id FROM workspace_members WHERE workspace_id = ws AND status = 'active'
         ORDER BY (role = 'owner') DESC, created_at LIMIT 1),
        (SELECT created_by FROM workspaces WHERE id = ws))
$$;

-- The workspace's Inbox project (issues filed without a project land here), created on first use
-- with the four default columns in the workspace language.
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
    INSERT INTO task_statuses (workspace_id, project_id, name, color, category, position)
    SELECT ws, pid, x.name, x.color, x.category, x.pos
    FROM (VALUES
        (CASE WHEN loc = 'ar' THEN 'للتنفيذ' ELSE 'To do' END, 'slate', 'todo', 1024::float8),
        (CASE WHEN loc = 'ar' THEN 'قيد التنفيذ' ELSE 'In progress' END, 'blue', 'doing', 2048),
        (CASE WHEN loc = 'ar' THEN 'قيد المراجعة' ELSE 'In review' END, 'amber', 'doing', 3072),
        (CASE WHEN loc = 'ar' THEN 'تمّ' ELSE 'Done' END, 'green', 'done', 4096)
    ) AS x(name, color, category, pos);
    RETURN pid;
END $$;

-- The first column of a category in a project (falls back to the first column at all).
CREATE OR REPLACE FUNCTION project_column(ws text, pid text, cat text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT id FROM task_statuses WHERE workspace_id = ws AND project_id = pid
    ORDER BY (category = cat) DESC, position ASC LIMIT 1
$$;

-- BEFORE INSERT on reports: every issue belongs to a project.
CREATE OR REPLACE FUNCTION reports_default_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.project_id IS NULL THEN
        NEW.project_id := ensure_inbox_project(NEW.workspace_id, NEW.reporter_id);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reports_default_project ON reports;
CREATE TRIGGER reports_default_project BEFORE INSERT ON reports
    FOR EACH ROW EXECUTE FUNCTION reports_default_project();

-- Create the card for an issue that has none yet.
CREATE OR REPLACE FUNCTION link_issue_card(r reports) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    col text;
    tid text;
    pid text := r.project_id;
BEGIN
    IF pid IS NULL THEN
        pid := ensure_inbox_project(r.workspace_id, r.reporter_id);
        UPDATE reports SET project_id = pid WHERE id = r.id;
    END IF;
    -- A card with this key already exists (e.g. created before the link): adopt it.
    SELECT id INTO tid FROM tasks WHERE workspace_id = r.workspace_id AND key = r.key;
    IF tid IS NULL THEN
        col := project_column(r.workspace_id, pid, issue_status_category(r.status));
        IF col IS NULL THEN
            RETURN NULL; -- a project with no columns: nothing to put the card in
        END IF;
        INSERT INTO tasks (workspace_id, project_id, status_id, number, key, title, description,
                           position, priority, created_by, completed_at, created_at)
        VALUES (r.workspace_id, pid, col, r.number, r.key, left(r.title, 500), r.body,
                COALESCE((SELECT max(position) FROM tasks WHERE workspace_id = r.workspace_id AND status_id = col), 0) + 1024,
                issue_to_task_priority(r.priority), issue_actor(r.workspace_id, r.reporter_id),
                CASE WHEN r.status = 'done' THEN COALESCE(r.closed_at, now()) END, r.created_at)
        RETURNING id INTO tid;
        IF r.assignee_id IS NOT NULL THEN
            INSERT INTO task_assignees (workspace_id, task_id, user_id)
            VALUES (r.workspace_id, tid, r.assignee_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;
    UPDATE reports SET task_id = tid WHERE id = r.id;
    RETURN tid;
END $$;

-- AFTER INSERT / UPDATE on reports: create or follow the card.
CREATE OR REPLACE FUNCTION reports_sync_card() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cur_cat text;
    want text;
    col text;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL; -- a write made by the other side's sync
    END IF;
    IF NEW.task_id IS NULL THEN
        -- A customer request joins the board once accepted (pending, declined and converted
        -- requests stay in the Requests inbox, as before).
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
            want := issue_status_category(NEW.status);
            SELECT st.category INTO cur_cat FROM tasks t JOIN task_statuses st ON st.id = t.status_id
            WHERE t.workspace_id = NEW.workspace_id AND t.id = NEW.task_id;
            IF cur_cat IS DISTINCT FROM want THEN
                SELECT project_column(t.workspace_id, t.project_id, want) INTO col
                FROM tasks t WHERE t.workspace_id = NEW.workspace_id AND t.id = NEW.task_id;
                IF col IS NOT NULL THEN
                    UPDATE tasks SET status_id = col,
                        position = COALESCE((SELECT max(position) FROM tasks WHERE workspace_id = NEW.workspace_id AND status_id = col), 0) + 1024,
                        completed_at = CASE WHEN want = 'done' THEN COALESCE(completed_at, now()) END,
                        updated_at = now()
                    WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id;
                END IF;
            END IF;
        END IF;
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS reports_sync_card ON reports;
CREATE TRIGGER reports_sync_card AFTER INSERT OR UPDATE OF title, body, priority, status, request_state ON reports
    FOR EACH ROW EXECUTE FUNCTION reports_sync_card();

-- AFTER UPDATE on tasks: the issue follows its card.
CREATE OR REPLACE FUNCTION tasks_sync_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cat text;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;
    SELECT category INTO cat FROM task_statuses WHERE id = NEW.status_id;
    UPDATE reports r SET
        title = NEW.title,
        body = NEW.description,
        priority = task_to_issue_priority(NEW.priority, r.priority),
        status = CASE
            WHEN cat = issue_status_category(r.status) THEN r.status
            WHEN cat = 'doing' THEN 'in_progress'
            WHEN cat = 'done' THEN 'done'
            ELSE 'todo' END,
        state = CASE WHEN cat = 'done' THEN 'closed'
                     WHEN r.state = 'closed' THEN 'open' ELSE r.state END,
        closed_at = CASE WHEN cat = 'done' THEN COALESCE(r.closed_at, now()) ELSE NULL END,
        updated_at = now()
    WHERE r.workspace_id = NEW.workspace_id AND r.task_id = NEW.id
      AND (r.title IS DISTINCT FROM NEW.title OR r.body IS DISTINCT FROM NEW.description
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR cat IS DISTINCT FROM issue_status_category(r.status));
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tasks_sync_issue ON tasks;
CREATE TRIGGER tasks_sync_issue AFTER UPDATE OF title, description, priority, status_id ON tasks
    FOR EACH ROW EXECUTE FUNCTION tasks_sync_issue();

-- AFTER DELETE on reports: the card goes too (deleting the card cascades to the issue by FK).
CREATE OR REPLACE FUNCTION reports_drop_card() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.task_id IS NOT NULL THEN
        DELETE FROM tasks WHERE workspace_id = OLD.workspace_id AND id = OLD.task_id;
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS reports_drop_card ON reports;
CREATE TRIGGER reports_drop_card AFTER DELETE ON reports
    FOR EACH ROW EXECUTE FUNCTION reports_drop_card();

-- Backfill: every existing issue gets its card (idempotent — linked issues are skipped).
DO $$
DECLARE
    r reports;
BEGIN
    FOR r IN SELECT * FROM reports WHERE task_id IS NULL
             AND (request_state IS NULL OR request_state = 'accepted') ORDER BY created_at LOOP
        PERFORM set_config('app.workspace_id', r.workspace_id, true);
        PERFORM link_issue_card(r);
    END LOOP;
END $$;

-- ...and the other way: every card is an issue. A task created on the board (or by create_task,
-- a subtask, an import) gets its issue row (type task, source app) with the same number and key,
-- so the project's issue tracker — statuses, agent loop, MCP issue tools — sees all the work.
CREATE OR REPLACE FUNCTION tasks_link_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    cat text;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL; -- the card of an issue being filed (link_issue_card)
    END IF;
    IF EXISTS (SELECT 1 FROM reports WHERE workspace_id = NEW.workspace_id AND (task_id = NEW.id OR key = NEW.key)) THEN
        RETURN NULL;
    END IF;
    SELECT category INTO cat FROM task_statuses WHERE id = NEW.status_id;
    INSERT INTO reports (workspace_id, project_id, number, key, title, body, issue_type, status, state,
                         priority, reporter_id, source, closed_at, sort_order, agent_seconds, human_only,
                         task_id, created_at, from_board)
    VALUES (NEW.workspace_id, NEW.project_id, NEW.number, NEW.key, NEW.title, NEW.description, 'task',
            CASE cat WHEN 'doing' THEN 'in_progress' WHEN 'done' THEN 'done' ELSE 'todo' END,
            CASE WHEN cat = 'done' THEN 'closed' ELSE 'open' END,
            task_to_issue_priority(NEW.priority, 'medium'), NEW.created_by, 'app',
            CASE WHEN cat = 'done' THEN COALESCE(NEW.completed_at, now()) END,
            0, 0, false, NEW.id, NEW.created_at, true);
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tasks_link_issue ON tasks;
CREATE TRIGGER tasks_link_issue AFTER INSERT ON tasks
    FOR EACH ROW EXECUTE FUNCTION tasks_link_issue();

-- Backfill: existing cards without an issue.
DO $$
DECLARE
    t tasks;
    cat text;
BEGIN
    FOR t IN SELECT * FROM tasks x WHERE NOT EXISTS (
        SELECT 1 FROM reports r WHERE r.workspace_id = x.workspace_id AND (r.task_id = x.id OR r.key = x.key))
        ORDER BY created_at LOOP
        PERFORM set_config('app.workspace_id', t.workspace_id, true);
        SELECT category INTO cat FROM task_statuses WHERE id = t.status_id;
        INSERT INTO reports (workspace_id, project_id, number, key, title, body, issue_type, status, state,
                             priority, reporter_id, source, closed_at, sort_order, agent_seconds, human_only,
                             task_id, created_at, from_board)
        VALUES (t.workspace_id, t.project_id, t.number, t.key, t.title, t.description, 'task',
                CASE cat WHEN 'doing' THEN 'in_progress' WHEN 'done' THEN 'done' ELSE 'todo' END,
                CASE WHEN cat = 'done' THEN 'closed' ELSE 'open' END,
                task_to_issue_priority(t.priority, 'medium'), t.created_by, 'app',
                CASE WHEN cat = 'done' THEN COALESCE(t.completed_at, now()) END,
                0, 0, false, t.id, t.created_at, true);
    END LOOP;
END $$;

-- One conversation per item: the card shows the issue thread (comments, @agent hand-offs, agent
-- notes). Comments written on the card side (comment_task, older clients) are mirrored into it.
CREATE OR REPLACE FUNCTION task_comments_to_issue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO report_comments (workspace_id, report_id, author_id, author_kind, body, mentions, created_at)
    SELECT NEW.workspace_id, r.id, NEW.author_id, NEW.author_kind, NEW.body, NEW.mentions, NEW.created_at
    FROM reports r WHERE r.workspace_id = NEW.workspace_id AND r.task_id = NEW.task_id;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS task_comments_to_issue ON task_comments;
CREATE TRIGGER task_comments_to_issue AFTER INSERT ON task_comments
    FOR EACH ROW EXECUTE FUNCTION task_comments_to_issue();

-- Backfill: card comments made before the merge join the thread (idempotent).
INSERT INTO report_comments (workspace_id, report_id, author_id, author_kind, body, mentions, created_at)
SELECT c.workspace_id, r.id, c.author_id, c.author_kind, c.body, c.mentions, c.created_at
FROM task_comments c JOIN reports r ON r.workspace_id = c.workspace_id AND r.task_id = c.task_id
WHERE NOT EXISTS (SELECT 1 FROM report_comments x WHERE x.report_id = r.id AND x.created_at = c.created_at
                  AND x.body = c.body AND x.author_id IS NOT DISTINCT FROM c.author_id);
