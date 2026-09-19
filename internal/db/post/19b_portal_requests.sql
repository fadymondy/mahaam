-- Roadmap 5: the request portal. A customer's REQUEST (feature / change / bug) is a reports
-- row with request_state set; a normal issue has request_state NULL.
--
--   pending    filed by the customer, waiting in the staff Requests inbox — NOT on the board
--   accepted   a manager accepted it: it is a normal issue on the board from now on
--   declined   closed with a reason (request_reply) the customer sees
--   converted  a manager turned it into a task (request_reply names the task key)
--
-- The board / list_issues show request_state IS NULL OR 'accepted' (internal/reports List).
-- RLS on reports already covers these columns (20_rls.sql).
ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_state text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_kind  text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_reply text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS desired_on    date;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_request_state_ck') THEN
        ALTER TABLE reports ADD CONSTRAINT reports_request_state_ck
            CHECK (request_state IS NULL OR request_state IN ('pending', 'accepted', 'declined', 'converted'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_request_kind_ck') THEN
        ALTER TABLE reports ADD CONSTRAINT reports_request_kind_ck
            CHECK (request_kind IS NULL OR request_kind IN ('feature', 'change', 'bug'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS reports_request_state_idx ON reports (workspace_id, request_state) WHERE request_state IS NOT NULL;
