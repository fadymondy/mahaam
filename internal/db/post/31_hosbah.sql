-- MH-1151: 'hosbah' is a project integration provider (internal/integrations/hosbah.go).
--
-- The provider CHECK was created with three values, and CREATE TABLE IF NOT EXISTS does not
-- revisit it, so a database created before this refuses the new provider. This replaces it.
-- Replayed on every deploy: once the constraint names hosbah it returns before touching
-- anything, so the plan update below runs exactly once per database and a platform admin who
-- later takes hosbah off a plan is not overruled.
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'project_integrations'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%provider%'
    LOOP
        IF c.def LIKE '%hosbah%' THEN
            RETURN; -- already widened; nothing to do
        END IF;
        EXECUTE format('ALTER TABLE project_integrations DROP CONSTRAINT %I', c.conname);
    END LOOP;

    ALTER TABLE project_integrations ADD CONSTRAINT project_integrations_provider_check
        CHECK (provider IN ('github', 'jira', 'linear', 'hosbah'));

    -- Plans that offer every integration (business, unlimited) offer this one too.
    UPDATE plans SET features = jsonb_set(features, '{integrations}', (features->'integrations') || '["hosbah"]'::jsonb)
    WHERE features->'integrations' ? 'linear' AND NOT (features->'integrations' ? 'hosbah');
END $$;
