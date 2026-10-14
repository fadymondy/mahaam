-- A board column's name per locale (labels: {"en": …, "ar": …}; name stays the fallback and the
-- value the API matches on) and its icon (a lucide name from the web's allow-list; NULL = the
-- stage's default icon).
ALTER TABLE task_statuses ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE task_statuses ADD COLUMN IF NOT EXISTS icon text;

DO $$ BEGIN
    ALTER TABLE task_statuses ADD CONSTRAINT task_statuses_labels_object CHECK (jsonb_typeof(labels) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE task_statuses ADD CONSTRAINT task_statuses_icon_format CHECK (icon IS NULL OR icon ~ '^[a-z0-9-]{1,40}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The six default columns (either language) get both labels, so they translate with the UI.
UPDATE task_statuses st SET labels = jsonb_build_object('en', d.en, 'ar', d.ar)
FROM (VALUES
    ('backlog', 'Backlog', 'قائمة الانتظار'),
    ('todo', 'To do', 'للتنفيذ'),
    ('in_progress', 'In progress', 'قيد التنفيذ'),
    ('waiting_approval', 'Waiting approval', 'بانتظار الموافقة'),
    ('in_review', 'In review', 'قيد المراجعة'),
    ('done', 'Done', 'منجز')
) AS d(stage, en, ar)
WHERE st.labels = '{}'::jsonb AND st.stage = d.stage AND (st.name = d.en OR st.name = d.ar);
