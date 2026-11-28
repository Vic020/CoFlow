CREATE TABLE assistant_approvals (
 team_id text NOT NULL,
 owner_id text NOT NULL,
 conversation_scope text NOT NULL,
 capability text NOT NULL,
 target_id text NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (team_id,owner_id,conversation_scope,capability,target_id),
 FOREIGN KEY (team_id,owner_id) REFERENCES memberships(team_id,user_id) ON DELETE CASCADE
);
