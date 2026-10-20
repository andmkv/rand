CREATE FUNCTION prevent_revision_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.number IS DISTINCT FROM OLD.number OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NEW.actor_id IS NOT NULL)
  THEN RAISE EXCEPTION 'immutable_revision' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_project_revision BEFORE UPDATE ON project_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_revision_rewrite();
