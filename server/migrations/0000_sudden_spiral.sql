CREATE TYPE "public"."assignment_state" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_mode" AS ENUM('story', 'sandbox');--> statement-breakpoint
CREATE TYPE "public"."moderation_state" AS ENUM('active', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."report_state" AS ENUM('open', 'dismissed', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."submission_state" AS ENUM('submitted', 'reviewed', 'needs_changes');--> statement-breakpoint
CREATE TYPE "public"."user_state" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TABLE "assignment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"state" "submission_state" DEFAULT 'submitted' NOT NULL,
	"feedback" text,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_attempt" UNIQUE("assignment_id","student_id","attempt"),
	CONSTRAINT "submission_attempt_positive" CHECK ("assignment_submissions"."attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"state" "assignment_state" DEFAULT 'draft' NOT NULL,
	"required_mode" "project_mode",
	"starter_revision_id" uuid,
	"starter_example_id" text,
	"allow_resubmit" boolean DEFAULT true NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_class_id" UNIQUE("class_id","id"),
	CONSTRAINT "assignment_one_starter" CHECK ("assignments"."starter_revision_id" is null or "assignments"."starter_example_id" is null)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_memberships" (
	"class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "class_memberships_class_id_student_id_pk" PRIMARY KEY("class_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(2000) DEFAULT '' NOT NULL,
	"join_code_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "classes_join_code_hash_unique" UNIQUE("join_code_hash")
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"project_id" uuid,
	"user_id" uuid,
	"report_id" uuid,
	"action" varchar(64) NOT NULL,
	"reason" varchar(2000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_has_target" CHECK ("moderation_actions"."project_id" is not null or "moderation_actions"."user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "project_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reporter_id" uuid,
	"reason" varchar(32) NOT NULL,
	"detail" varchar(2000),
	"state" "report_state" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid,
	"number" integer NOT NULL,
	"snapshot_version" integer DEFAULT 2 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_project_number" UNIQUE("project_id","number"),
	CONSTRAINT "revision_project_id" UNIQUE("project_id","id"),
	CONSTRAINT "revision_positive" CHECK ("project_revisions"."number" > 0 and "project_revisions"."snapshot_version" > 0),
	CONSTRAINT "revision_snapshot_object" CHECK (jsonb_typeof("project_revisions"."snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "project_tags" (
	"project_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "project_tags_project_id_tag_id_pk" PRIMARY KEY("project_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(120) DEFAULT '' NOT NULL,
	"description" varchar(2000) DEFAULT '' NOT NULL,
	"snapshot_version" integer DEFAULT 2 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"mode" "project_mode" NOT NULL,
	"story_id" text,
	"scene_id" integer,
	"visibility" "project_visibility" DEFAULT 'private' NOT NULL,
	"short_code" varchar(32) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"preview_key" text,
	"moderation_state" "moderation_state" DEFAULT 'active' NOT NULL,
	"remixed_from_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "projects_short_code_unique" UNIQUE("short_code"),
	CONSTRAINT "projects_version_positive" CHECK ("projects"."version" > 0 and "projects"."snapshot_version" > 0),
	CONSTRAINT "projects_snapshot_object" CHECK (jsonb_typeof("projects"."snapshot") = 'object'),
	CONSTRAINT "projects_publication_pair" CHECK (("projects"."published_revision_id" is null) = ("projects"."published_at" is null)),
	CONSTRAINT "projects_shared_snapshot" CHECK ("projects"."visibility" = 'private' or "projects"."published_revision_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(32) NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"locale" varchar(16) DEFAULT 'en' NOT NULL,
	"can_learn" boolean DEFAULT true NOT NULL,
	"can_teach" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"state" "user_state" DEFAULT 'active' NOT NULL,
	"terms_version" text,
	"privacy_version" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_product_capability" CHECK ("users"."can_learn" or "users"."can_teach"),
	CONSTRAINT "users_admin_verified" CHECK (not "users"."is_admin" or "users"."verified_at" is not null),
	CONSTRAINT "users_display_name" CHECK (length(trim("users"."display_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_revision_id_project_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."project_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_class_id_assignment_id_assignments_class_id_id_fk" FOREIGN KEY ("class_id","assignment_id") REFERENCES "public"."assignments"("class_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_class_id_student_id_class_memberships_class_id_student_id_fk" FOREIGN KEY ("class_id","student_id") REFERENCES "public"."class_memberships"("class_id","student_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_starter_revision_id_project_revisions_id_fk" FOREIGN KEY ("starter_revision_id") REFERENCES "public"."project_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_memberships" ADD CONSTRAINT "class_memberships_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_memberships" ADD CONSTRAINT "class_memberships_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_project_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."project_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tags" ADD CONSTRAINT "project_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_published_own_revision" FOREIGN KEY ("id","published_revision_id") REFERENCES "public"."project_revisions"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_remix_revision" FOREIGN KEY ("remixed_from_revision_id") REFERENCES "public"."project_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_student" ON "assignment_submissions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "assignments_class" ON "assignments" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "audit_actor_time" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_target_time" ON "audit_log" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "memberships_student" ON "class_memberships" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "classes_teacher" ON "classes" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "verification_user" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "moderation_project" ON "moderation_actions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "reset_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reports_queue" ON "project_reports" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "reports_project" ON "project_reports" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tags_tag" ON "project_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_ci" ON "users" USING btree (lower("email"));