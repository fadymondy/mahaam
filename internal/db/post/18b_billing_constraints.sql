-- Integrity for AI usage and project subscriptions (internal/db/schema/ai_usage.sql,
-- project_subscription.sql). Composite keys on (workspace_id, ref) as everywhere else.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_markup_bp integer NOT NULL DEFAULT 0
    CHECK (ai_markup_bp >= 0 AND ai_markup_bp <= 100000);
COMMENT ON COLUMN projects.ai_markup_bp IS 'Markup on AI cost when invoiced, in basis points (2000 = +20%)';

CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_ws_id_uq              ON ai_usage (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS project_subscriptions_ws_id_uq ON project_subscriptions (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_charges_ws_id_uq  ON subscription_charges (workspace_id, id);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['ai_usage_workspace_fk', 'ai_usage', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['ai_usage_project_fk',   'ai_usage', 'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        ['ai_usage_invoice_fk',   'ai_usage', 'FOREIGN KEY (workspace_id, invoice_id) REFERENCES invoices (workspace_id, id) ON DELETE SET NULL (invoice_id)'],
        ['psub_workspace_fk',     'project_subscriptions', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['psub_project_fk',       'project_subscriptions', 'FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE'],
        ['scharge_workspace_fk',  'subscription_charges', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['scharge_sub_fk',        'subscription_charges', 'FOREIGN KEY (workspace_id, subscription_id) REFERENCES project_subscriptions (workspace_id, id) ON DELETE CASCADE'],
        ['scharge_invoice_fk',    'subscription_charges', 'FOREIGN KEY (workspace_id, invoice_id) REFERENCES invoices (workspace_id, id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS ai_usage_project_day_idx     ON ai_usage (workspace_id, project_id, day);
CREATE INDEX IF NOT EXISTS ai_usage_unbilled_idx        ON ai_usage (workspace_id, project_id) WHERE invoice_id IS NULL;
CREATE INDEX IF NOT EXISTS project_subscriptions_idx    ON project_subscriptions (workspace_id, project_id);
CREATE INDEX IF NOT EXISTS subscription_charges_inv_idx ON subscription_charges (workspace_id, invoice_id);
