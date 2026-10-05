-- Platform admin and plans (internal/db/schema/platform.sql): workspace status + overrides, the
-- seeded plans, the one-off move of existing workspaces to `unlimited`, and the usage triggers.
-- Runs before 20_rls. Nothing here needs a superuser: the owner role (DATABASE_URL) owns every
-- table involved, and SECURITY DEFINER functions only need CREATE on the schema.

-- ---- workspace status and per-workspace overrides ---------------------------------------------
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS suspended_reason text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
-- {"limits": {"projects": {"limit": 10, "policy": "block", ...}}, "features": {"vault": true}}
-- A key present in limits replaces the plan's rule for that key; features merge key by key.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_status_ck') THEN
        ALTER TABLE workspaces ADD CONSTRAINT workspaces_status_ck CHECK (status IN ('active', 'suspended'));
    END IF;
END $$;

-- ---- seeded plans (ON CONFLICT DO NOTHING: an admin's edits survive every migrate run) ---------
INSERT INTO plans (key, name_en, name_ar, description_en, description_ar, currency, base_fee_minor,
                   price_label_en, price_label_ar, sort, limits, features)
VALUES
('free', 'Free', 'مجاني', 'For trying Mahaam with a small team.', 'لتجربة مهام مع فريق صغير.', 'USD', 0,
 'Free', 'مجاناً', 10,
 '{"members": {"limit": 3, "policy": "block"}, "projects": {"limit": 2, "policy": "block"},
   "clients": {"limit": 5, "policy": "block"}, "tasks": {"limit": 200, "policy": "block"},
   "issues": {"limit": 200, "policy": "block"}, "teams": {"limit": 1, "policy": "block"},
   "feedback_keys": {"limit": 1, "policy": "block"}, "mcp_tokens": {"limit": 2, "policy": "block"},
   "storage_mb": {"limit": 100, "policy": "block", "unit_size": 1024},
   "issues_per_month": {"limit": 50, "policy": "block", "unit_size": 100},
   "tasks_per_month": {"limit": 200, "policy": "block", "unit_size": 100},
   "api_calls_per_month": {"limit": 10000, "policy": "block", "unit_size": 1000},
   "api_rate_per_minute": {"limit": 60, "policy": "block"}}',
 '{"ai_usage_tracking": false, "integrations": [], "customer_portal": false, "vault": false, "kpi": false}'),
('pro', 'Pro', 'احترافي', 'Pay as you go for growing teams.', 'ادفع حسب الاستخدام للفرق النامية.', 'USD', 2900,
 '$29 / month + usage', '29$ شهرياً + الاستخدام', 20,
 '{"members": {"limit": 10, "policy": "overage", "unit_price_minor": 800}, "projects": {"limit": 20, "policy": "overage", "unit_price_minor": 200},
   "clients": {"limit": 50, "policy": "overage", "unit_price_minor": 50}, "tasks": {"limit": null, "policy": "overage"},
   "issues": {"limit": null, "policy": "overage"}, "teams": {"limit": 5, "policy": "block"},
   "feedback_keys": {"limit": 10, "policy": "block"}, "mcp_tokens": {"limit": 10, "policy": "block"},
   "storage_mb": {"limit": 5120, "policy": "overage", "unit_size": 1024, "unit_price_minor": 100},
   "issues_per_month": {"limit": 1000, "policy": "overage", "unit_size": 100, "unit_price_minor": 500},
   "tasks_per_month": {"limit": null, "policy": "overage", "unit_size": 100},
   "api_calls_per_month": {"limit": 100000, "policy": "overage", "unit_size": 1000, "unit_price_minor": 100},
   "api_rate_per_minute": {"limit": 120, "policy": "block"}}',
 '{"ai_usage_tracking": true, "integrations": ["github"], "customer_portal": true, "vault": true, "kpi": false}'),
('business', 'Business', 'أعمال', 'Every feature, generous quotas, usage billed beyond them.', 'كل الميزات وحصص واسعة، والاستخدام الزائد يُحتسب.', 'USD', 9900,
 '$99 / month + usage', '99$ شهرياً + الاستخدام', 30,
 '{"members": {"limit": 50, "policy": "overage", "unit_price_minor": 700}, "projects": {"limit": null, "policy": "overage"},
   "clients": {"limit": null, "policy": "overage"}, "tasks": {"limit": null, "policy": "overage"},
   "issues": {"limit": null, "policy": "overage"}, "teams": {"limit": null, "policy": "overage"},
   "feedback_keys": {"limit": 50, "policy": "block"}, "mcp_tokens": {"limit": 50, "policy": "block"},
   "storage_mb": {"limit": 51200, "policy": "overage", "unit_size": 1024, "unit_price_minor": 50},
   "issues_per_month": {"limit": 10000, "policy": "overage", "unit_size": 100, "unit_price_minor": 300},
   "tasks_per_month": {"limit": null, "policy": "overage", "unit_size": 100},
   "api_calls_per_month": {"limit": 1000000, "policy": "overage", "unit_size": 1000, "unit_price_minor": 50},
   "api_rate_per_minute": {"limit": 600, "policy": "block"}}',
 '{"ai_usage_tracking": true, "integrations": ["github", "jira", "linear", "hosbah"], "customer_portal": true, "vault": true, "kpi": true}'),
('unlimited', 'Unlimited', 'غير محدود', 'No quotas and no overage (existing workspaces, the platform, partners).', 'بلا حصص ولا رسوم زائدة (مساحات العمل الحالية والمنصة والشركاء).', 'USD', 0,
 'Custom', 'حسب الاتفاق', 99,
 '{}',
 '{"ai_usage_tracking": true, "integrations": ["github", "jira", "linear", "hosbah"], "customer_portal": true, "vault": true, "kpi": true}')
ON CONFLICT (key) DO NOTHING;

-- ---- one-off: every workspace that exists before plans are enforced moves to `unlimited` -------
-- (the `plan` column defaulted to 'free' for years without meaning anything; enforcing it now
-- would break production). New workspaces get PLAN_DEFAULT (default free) from the API.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_meta WHERE key = 'plans_grandfathered') THEN
        UPDATE workspaces SET plan = 'unlimited', updated_at = now() WHERE plan IS DISTINCT FROM 'unlimited';
        INSERT INTO platform_meta (key, value) VALUES ('plans_grandfathered', 'existing workspaces moved to unlimited');
    END IF;
END $$;

-- Any stray plan value (never expected) falls back to unlimited rather than failing the FK.
UPDATE workspaces SET plan = 'unlimited' WHERE plan NOT IN (SELECT key FROM plans);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['workspaces_plan_fk',        'workspaces',      'FOREIGN KEY (plan) REFERENCES plans (key) ON UPDATE CASCADE'],
        ['workspace_usage_ws_fk',     'workspace_usage', 'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['platform_users_user_fk',    'platform_users',  'FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS workspaces_plan_idx ON workspaces (plan);
CREATE INDEX IF NOT EXISTS platform_users_seen_idx ON platform_users (last_seen_at);

-- ---- metered usage: issues and tasks created this month ----------------------------------------
-- SECURITY DEFINER so an insert on the app pool (mahaam_app, no grant on workspace_usage) still
-- counts. search_path is pinned; the function only ever touches workspace_usage.
CREATE OR REPLACE FUNCTION mahaam_usage_bump() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO workspace_usage AS u (workspace_id, period, issues_created, tasks_created)
    VALUES (NEW.workspace_id, date_trunc('month', now() AT TIME ZONE 'UTC')::date,
            CASE WHEN TG_TABLE_NAME = 'reports' THEN 1 ELSE 0 END,
            CASE WHEN TG_TABLE_NAME = 'tasks' THEN 1 ELSE 0 END)
    ON CONFLICT (workspace_id, period) DO UPDATE SET
        issues_created = u.issues_created + EXCLUDED.issues_created,
        tasks_created  = u.tasks_created + EXCLUDED.tasks_created,
        updated_at     = now();
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION mahaam_usage_bump() FROM PUBLIC;

DROP TRIGGER IF EXISTS reports_usage_bump ON reports;
CREATE TRIGGER reports_usage_bump AFTER INSERT ON reports FOR EACH ROW EXECUTE FUNCTION mahaam_usage_bump();
DROP TRIGGER IF EXISTS tasks_usage_bump ON tasks;
CREATE TRIGGER tasks_usage_bump AFTER INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION mahaam_usage_bump();
