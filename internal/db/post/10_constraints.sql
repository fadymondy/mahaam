-- Applied by `togo migrate` AFTER every internal/db/schema/*.sql file.
--
-- Foreign keys and indexes live here rather than in the per-resource schema
-- fragments because the fragments are applied in filename order
-- (invitation.sql sorts before workspace.sql) and each fragment is owned by one
-- resource. Every tenant table's index leads with workspace_id.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_workspace_fk') THEN
        ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_user_fk') THEN
        ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_user_fk
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitations_workspace_fk') THEN
        ALTER TABLE invitations ADD CONSTRAINT invitations_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_tokens_workspace_fk') THEN
        ALTER TABLE mcp_tokens ADD CONSTRAINT mcp_tokens_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_tokens_user_fk') THEN
        ALTER TABLE mcp_tokens ADD CONSTRAINT mcp_tokens_user_fk
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_mcp_tokens_user_fk') THEN
        ALTER TABLE admin_mcp_tokens ADD CONSTRAINT admin_mcp_tokens_user_fk
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_workspace_fk') THEN
        ALTER TABLE reports ADD CONSTRAINT reports_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_comments_workspace_fk') THEN
        ALTER TABLE report_comments ADD CONSTRAINT report_comments_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_comments_report_fk') THEN
        ALTER TABLE report_comments ADD CONSTRAINT report_comments_report_fk
            FOREIGN KEY (report_id) REFERENCES reports (id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id, workspace_id);
CREATE INDEX IF NOT EXISTS invitations_workspace_idx ON invitations (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_tokens_workspace_user_idx ON mcp_tokens (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS reports_workspace_status_idx ON reports (workspace_id, status, sort_order);
CREATE INDEX IF NOT EXISTS report_comments_workspace_report_idx ON report_comments (workspace_id, report_id, created_at);
