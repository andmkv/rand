-- Normalize historical addresses before tightening the write invariant.
UPDATE "users" SET "email" = lower(trim("email"));--> statement-breakpoint
CREATE INDEX "projects_owner_updated" ON "projects" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "projects_gallery" ON "projects" USING btree ("published_at","id") WHERE "projects"."visibility" = 'public' and "projects"."moderation_state" = 'active' and "projects"."deleted_at" is null and "projects"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(trim("users"."email")) and length("users"."email") > 3);