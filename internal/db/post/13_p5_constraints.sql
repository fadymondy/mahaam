-- P5 integrity: saved reports and notification settings. Same model as 11/12: every reference
-- between tenant rows is a composite (workspace_id, ref) foreign key.
DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['saved_reports_owner_fk',       'saved_reports',      'FOREIGN KEY (workspace_id, owner_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE'],
        ['notification_prefs_member_fk', 'notification_prefs', 'FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS notification_prefs_uq   ON notification_prefs (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS saved_reports_owner_idx        ON saved_reports (workspace_id, owner_id);
-- The email job's work queue: unprocessed inbox items.
CREATE INDEX IF NOT EXISTS notifications_email_queue_idx  ON notifications (workspace_id, created_at) WHERE email_status IS NULL;
