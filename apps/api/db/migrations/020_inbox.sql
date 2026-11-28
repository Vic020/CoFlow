ALTER TABLE notifications ADD COLUMN actor_id text NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN needs_response boolean NOT NULL DEFAULT false;
CREATE TABLE todo_follows (
 team_id text NOT NULL,
 user_id text NOT NULL,
 todo_id text NOT NULL,
 PRIMARY KEY (team_id,user_id,todo_id),
 FOREIGN KEY (team_id,user_id) REFERENCES memberships(team_id,user_id) ON DELETE CASCADE
);
CREATE INDEX todo_follows_task ON todo_follows(team_id,todo_id);
ALTER TABLE comments ADD COLUMN parent_id text NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN calendar_event_id text NOT NULL DEFAULT '';
