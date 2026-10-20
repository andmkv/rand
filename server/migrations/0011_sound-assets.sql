-- Extend the existing private asset library to typed audio recipes. Payloads
-- remain compact immutable JSONB versions; no project data is rewritten.
ALTER TABLE "user_assets" DROP CONSTRAINT "user_assets_type";
--> statement-breakpoint
ALTER TABLE "user_assets" ADD CONSTRAINT "user_assets_type"
  CHECK ("type" IN ('sprite', 'sfx', 'instrument'));
