-- A board column belongs to a workflow stage — the six the issue tracker and the agent loop
-- speak (backlog, todo, in_progress, waiting_approval, in_review, done). Project settings →
-- Board columns is the workflow: rename, recolour, reorder, add or remove columns there and the
-- board follows. An item's stage is its column's stage (post/19g + 19j keep them in step).
ALTER TABLE task_statuses ADD COLUMN IF NOT EXISTS stage text
    CHECK (stage IS NULL OR stage IN ('backlog','todo','in_progress','waiting_approval','in_review','done'));

-- The column of a stage in a project: the first with that stage, else the first of its category.
CREATE OR REPLACE FUNCTION stage_column(ws text, pid text, st text) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT id FROM task_statuses WHERE workspace_id = ws AND project_id = pid
    ORDER BY (stage = st) DESC NULLS LAST,
             (category = CASE WHEN st IN ('in_progress','waiting_approval','in_review') THEN 'doing'
                              WHEN st = 'done' THEN 'done' ELSE 'todo' END) DESC,
             position ASC LIMIT 1
$$;
