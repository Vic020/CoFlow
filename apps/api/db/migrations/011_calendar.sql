-- Independent planning nodes. Reports and tasks retain their original storage.
CREATE TABLE calendar_events (
 team_id text NOT NULL REFERENCES teams(id),
 id text NOT NULL,
 creator_id text NOT NULL REFERENCES users(id),
 source_id text NOT NULL,
 start_date date,
 end_date date,
 start_at timestamptz,
 end_at timestamptz,
 document jsonb NOT NULL,
 PRIMARY KEY(team_id,id),
 UNIQUE(team_id,creator_id,source_id)
);
CREATE INDEX calendar_date_range ON calendar_events(team_id,start_date,end_date);
CREATE INDEX calendar_time_range ON calendar_events(team_id,start_at,end_at);
CREATE TABLE calendar_operations (
 team_id text NOT NULL REFERENCES teams(id),
 actor_id text NOT NULL REFERENCES users(id),
 operation_id text NOT NULL,
 hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(team_id,actor_id,operation_id)
);
CREATE INDEX report_calendar_range ON reports(team_id,created_at DESC,id) WHERE deleted_at IS NULL;
