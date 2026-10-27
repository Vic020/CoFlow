-- A team board is updated under the existing team transaction lock. The document
-- contains stable task IDs, revisions and event snapshots; unrelated reports remain relational.
CREATE TABLE todo_boards (
 team_id text PRIMARY KEY REFERENCES teams(id),
 document jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ALTER COLUMN report_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN todo_id text NOT NULL DEFAULT '';
CREATE INDEX todo_notifications_lookup ON notifications(team_id,todo_id) WHERE todo_id<>'';
ALTER TABLE collaboration_requests ADD COLUMN todo_id text NOT NULL DEFAULT '';
