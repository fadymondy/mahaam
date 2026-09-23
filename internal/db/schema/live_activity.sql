-- iOS Live Activity push tokens (MH-355): how the server updates the lock-screen / Dynamic Island
-- timer when it's started or stopped somewhere else (web, desktop, an agent). Owner pool only,
-- like devices, which each row belongs to.
--
--   token_type 'update'  the token of one running activity, handed out when the app starts it
--   token_type 'start'   the app's push-to-start token (iOS 17.2+), which lets the server START
--                        an activity when the timer was started elsewhere
CREATE TABLE IF NOT EXISTS live_activity_tokens (
    id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    device_id  text        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       text        NOT NULL CHECK (kind IN ('timer')),
    token_type text        NOT NULL CHECK (token_type IN ('update', 'start')),
    token      text        NOT NULL UNIQUE CHECK (length(token) BETWEEN 1 AND 4096),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (device_id, kind, token_type)
);
CREATE INDEX IF NOT EXISTS live_activity_tokens_user ON live_activity_tokens (user_id);
