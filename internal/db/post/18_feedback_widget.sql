-- The Feedback SDK launcher's look per key (so per project and per customer site):
-- {color, text_color, icon, text, shape, position, theme, hide_text}. Validated in
-- internal/work/feedback_widget.go; served publicly by GET /api/feedback/embed/config.
ALTER TABLE project_feedback_keys ADD COLUMN IF NOT EXISTS widget jsonb NOT NULL DEFAULT '{}'::jsonb;
