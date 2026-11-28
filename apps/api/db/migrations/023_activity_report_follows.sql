ALTER TABLE activity_follows DROP CONSTRAINT activity_follows_kind_check;
ALTER TABLE activity_follows ADD CONSTRAINT activity_follows_kind_check CHECK (kind IN ('project', 'member', 'report'));
ALTER TABLE activity_follows ADD COLUMN followed_at timestamptz NOT NULL DEFAULT now();
