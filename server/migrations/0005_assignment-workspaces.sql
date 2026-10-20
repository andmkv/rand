CREATE TABLE "assignment_workspaces" (
	"class_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_workspaces_assignment_id_student_id_pk" PRIMARY KEY("assignment_id","student_id"),
	CONSTRAINT "assignment_workspaces_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_workspaces" ADD CONSTRAINT "assignment_workspaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_workspaces" ADD CONSTRAINT "assignment_workspaces_class_id_assignment_id_assignments_class_id_id_fk" FOREIGN KEY ("class_id","assignment_id") REFERENCES "public"."assignments"("class_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_workspaces" ADD CONSTRAINT "assignment_workspaces_class_id_student_id_class_memberships_class_id_student_id_fk" FOREIGN KEY ("class_id","student_id") REFERENCES "public"."class_memberships"("class_id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_student" ON "assignment_workspaces" USING btree ("student_id");
--> statement-breakpoint
-- Submission identity/content pointer is immutable; only private review fields may change.
CREATE FUNCTION protect_submission_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.class_id, NEW.assignment_id, NEW.student_id, NEW.revision_id, NEW.attempt, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.class_id, OLD.assignment_id, OLD.student_id, OLD.revision_id, OLD.attempt, OLD.created_at) THEN
    RAISE EXCEPTION 'submission identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER submission_identity_immutable BEFORE UPDATE ON assignment_submissions
FOR EACH ROW EXECUTE FUNCTION protect_submission_identity();
