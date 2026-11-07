-- Model credentials belong either to an account or to a team, never both.
-- Preserve the old AEAD associated-data context without decrypting in SQL.
ALTER TABLE assistant_configs ADD COLUMN secret_context text;
ALTER TABLE assistant_configs ALTER COLUMN team_id DROP NOT NULL;
UPDATE assistant_configs SET secret_context=team_id,team_id=NULL WHERE owner_id IS NOT NULL;
ALTER TABLE assistant_configs ADD CONSTRAINT assistant_config_scope
 CHECK ((owner_id IS NULL AND team_id IS NOT NULL AND secret_context IS NULL)
     OR (owner_id IS NOT NULL AND team_id IS NULL AND secret_context IS NOT NULL));

-- Retain every existing config/id/revision, but choose one account default.
WITH ranked AS (
 SELECT id,row_number() OVER (PARTITION BY owner_id ORDER BY
   (verified_at IS NOT NULL) DESC,updated_at DESC,id) AS rank
 FROM assistant_configs WHERE owner_id IS NOT NULL AND is_default
)
UPDATE assistant_configs SET is_default=false WHERE id IN (SELECT id FROM ranked WHERE rank>1);
CREATE INDEX assistant_configs_account ON assistant_configs(owner_id) WHERE team_id IS NULL;
CREATE UNIQUE INDEX assistant_configs_account_default ON assistant_configs(owner_id)
 WHERE team_id IS NULL AND is_default;
