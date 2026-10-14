-- The agent clock and per-issue AI cost.
--
-- Every status change runs the clock, whatever moved the issue (a board drag, move_task,
-- update_issue, reorder_issue, a sync): leaving the backlog for work (todo, in_progress) starts
-- it; reaching in_review, waiting_approval or done (or going back to backlog) banks the span
-- into agent_seconds and stops it. The lifecycle tools (start/review/finish_issue) set the same
-- columns themselves; the trigger leaves a row alone when the statement already touched them.
--
-- ai_* totals are what agents reported spending on this one issue (record_issue_usage, or the
-- usage fields of review_issue / finish_issue). The same numbers are added to ai_usage for the
-- project and day, so project billing sees them too.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_input_tokens  bigint NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_output_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_cache_tokens  bigint NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_cost_minor    bigint NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_currency      text   NOT NULL DEFAULT 'USD';

CREATE OR REPLACE FUNCTION reports_agent_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.agent_seconds IS DISTINCT FROM OLD.agent_seconds THEN
        RETURN NEW;
    END IF;
    IF NEW.status IN ('todo', 'in_progress') THEN
        IF NEW.started_at IS NULL THEN
            NEW.started_at := now();
        END IF;
    ELSIF NEW.started_at IS NOT NULL THEN
        NEW.agent_seconds := NEW.agent_seconds + GREATEST(0, floor(extract(epoch FROM now() - NEW.started_at)))::bigint;
        NEW.started_at := NULL;
        IF NEW.status IN ('in_review', 'done') THEN
            NEW.finished_at := now();
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reports_agent_clock ON reports;
CREATE TRIGGER reports_agent_clock BEFORE UPDATE OF status ON reports
    FOR EACH ROW EXECUTE FUNCTION reports_agent_clock();
