ALTER TABLE reports ADD COLUMN deleted_at timestamptz;
ALTER TABLE comments ADD COLUMN deleted_at timestamptz;
-- Audit notifications refer to the originating comment, allowing deleted comments to hide their own alerts.
ALTER TABLE notifications ADD COLUMN comment_id text NOT NULL DEFAULT '';
CREATE INDEX reports_trash ON reports(team_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
