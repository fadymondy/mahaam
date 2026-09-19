-- A project's avatar: a small image (the UI downsizes it to 128px) stored inline as a data: URL,
-- so lists render it with no extra request. NULL = the coloured initials tile.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS avatar text
    CHECK (avatar IS NULL OR (avatar ~ '^data:image/(png|jpeg|webp);base64,' AND length(avatar) <= 300000));
