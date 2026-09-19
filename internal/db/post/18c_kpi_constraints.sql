-- Integrity for the employee KPI tables (schema/user_github_account.sql, member_review.sql).
-- user_id / author_id reference users(id) like time_entries.user_id (12_p2_constraints.sql):
-- the domain checks active membership on every write.
CREATE UNIQUE INDEX IF NOT EXISTS user_github_accounts_ws_id_uq    ON user_github_accounts (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS user_github_accounts_ws_login_uq ON user_github_accounts (workspace_id, lower(login));
CREATE UNIQUE INDEX IF NOT EXISTS member_reviews_ws_id_uq          ON member_reviews (workspace_id, id);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['ugh_workspace_fk',     'user_github_accounts', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['ugh_user_fk',          'user_github_accounts', 'FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE'],
        ['mreview_workspace_fk', 'member_reviews',       'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['mreview_user_fk',      'member_reviews',       'FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE'],
        ['mreview_author_fk',    'member_reviews',       'FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS member_reviews_user_idx   ON member_reviews (workspace_id, user_id, period_end DESC);
-- KPI attribution joins github_events on lower(author_login) / lower(author_email).
CREATE INDEX IF NOT EXISTS github_events_login_idx   ON github_events (workspace_id, lower(author_login), occurred_at);
CREATE INDEX IF NOT EXISTS github_events_email_idx   ON github_events (workspace_id, lower(author_email), occurred_at);
CREATE INDEX IF NOT EXISTS ai_usage_user_day_idx     ON ai_usage (workspace_id, user_id, day);
CREATE INDEX IF NOT EXISTS activity_logs_actor_idx   ON activity_logs (workspace_id, actor_id, created_at);
