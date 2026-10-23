ALTER TABLE classifications ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
WITH ranked AS (
  SELECT team_id,kind,id,row_number() OVER (PARTITION BY team_id,kind ORDER BY state,name,id)::integer AS position
  FROM classifications
)
UPDATE classifications c SET sort_order=r.position FROM ranked r
WHERE c.team_id=r.team_id AND c.kind=r.kind AND c.id=r.id;
