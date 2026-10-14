-- A workspace's logo: a 256px JPEG stored inline as a data: URL (same as users.avatar). NULL = initials.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo text;
