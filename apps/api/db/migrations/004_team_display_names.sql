ALTER TABLE memberships ADD COLUMN display_name text NOT NULL DEFAULT '';
UPDATE memberships SET display_name=users.name FROM users WHERE users.id=memberships.user_id;
