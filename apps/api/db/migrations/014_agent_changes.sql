-- Compact invalidations, not copies of private task/report bodies. Coverage starts here.
CREATE TABLE agent_changes (
 seq bigserial PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('todo','report','calendar')),
 object_id text NOT NULL,
 project_id text NOT NULL DEFAULT '',
 previous_project_id text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX agent_changes_team_sequence ON agent_changes(team_id,seq);
CREATE FUNCTION coflow_emit_change(t text,k text,o text,p text,previous text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 -- Same team lock as business writes and feed reads: never advance beyond an uncommitted event.
 PERFORM pg_advisory_xact_lock(hashtextextended(t,37));
 INSERT INTO agent_changes(team_id,kind,object_id,project_id,previous_project_id)
 VALUES(t,k,o,coalesce(p,''),coalesce(previous,''));
END $$;
CREATE FUNCTION coflow_report_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 PERFORM coflow_emit_change(NEW.team_id,'report',NEW.id,NEW.project_id,CASE WHEN TG_OP='UPDATE' THEN OLD.project_id ELSE '' END);
 RETURN NEW;
END $$;
CREATE TRIGGER agent_report_change AFTER INSERT OR UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION coflow_report_change();
CREATE FUNCTION coflow_discussion_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r reports%ROWTYPE;
BEGIN
 SELECT * INTO r FROM reports WHERE id=NEW.report_id;
 IF FOUND THEN PERFORM coflow_emit_change(r.team_id,'report',r.id,r.project_id,r.project_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_comment_change AFTER INSERT OR UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION coflow_discussion_change();
CREATE TRIGGER agent_collaboration_change AFTER INSERT OR UPDATE ON collaboration_requests FOR EACH ROW EXECUTE FUNCTION coflow_discussion_change();
CREATE FUNCTION coflow_board_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text; k text; before_map jsonb; after_map jsonb; o text; a jsonb; b jsonb;
BEGIN
 FOREACH field IN ARRAY ARRAY['tasks','calendar_events'] LOOP
  k := CASE WHEN field='tasks' THEN 'todo' ELSE 'calendar' END;
  SELECT coalesce(jsonb_object_agg(x->>'id',x),'{}') INTO after_map FROM jsonb_array_elements(coalesce(nullif(NEW.document->field,'null'::jsonb),'[]')) x;
  before_map := '{}';
  IF TG_OP='UPDATE' THEN
   SELECT coalesce(jsonb_object_agg(x->>'id',x),'{}') INTO before_map FROM jsonb_array_elements(coalesce(nullif(OLD.document->field,'null'::jsonb),'[]')) x;
  END IF;
  FOR o IN SELECT jsonb_object_keys(before_map || after_map) LOOP
   a := after_map->o; b := before_map->o;
   IF a IS DISTINCT FROM b THEN
    PERFORM coflow_emit_change(NEW.team_id,k,o,a->>'project_id',b->>'project_id');
   END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_board_change AFTER INSERT OR UPDATE ON todo_boards FOR EACH ROW EXECUTE FUNCTION coflow_board_change();
