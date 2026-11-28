CREATE TABLE activity_follows (
 team_id text NOT NULL,
 user_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('project', 'member')),
 target_id text NOT NULL,
 PRIMARY KEY (team_id, user_id, kind, target_id),
 FOREIGN KEY (team_id, user_id) REFERENCES memberships(team_id, user_id) ON DELETE CASCADE
);
CREATE INDEX notification_team_activity ON notifications(team_id, created_at DESC, id DESC) WHERE left(kind,4)='own-';
