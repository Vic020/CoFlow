ALTER TABLE cli_device_requests ADD COLUMN project_id text NOT NULL DEFAULT '',
 ADD COLUMN todo_id text NOT NULL DEFAULT '',
 ADD COLUMN expected_team_id text NOT NULL DEFAULT '',
 ADD CHECK (project_id = '' OR todo_id = '');
ALTER TABLE agent_tokens ADD COLUMN cli_project_id text NOT NULL DEFAULT '',
 ADD COLUMN cli_todo_id text NOT NULL DEFAULT '',
 ADD CHECK (cli_project_id = '' OR cli_todo_id = '');
