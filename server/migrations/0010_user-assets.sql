CREATE TABLE "user_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" varchar(16) DEFAULT 'sprite' NOT NULL,
	"name" varchar(64) NOT NULL,
	"alias" varchar(32) NOT NULL,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "user_assets_type" CHECK ("user_assets"."type" = 'sprite'),
	CONSTRAINT "user_assets_name" CHECK (length(trim("user_assets"."name")) between 1 and 64 and "user_assets"."name" !~ '[<>]'),
	CONSTRAINT "user_assets_alias" CHECK ("user_assets"."alias" ~ '^@[a-z][a-z0-9_-]{0,30}$'),
	CONSTRAINT "user_assets_latest_version" CHECK ("user_assets"."latest_version" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "user_assets" ADD CONSTRAINT "user_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_assets_owner_alias" ON "user_assets" USING btree ("owner_id","alias");
--> statement-breakpoint
CREATE INDEX "user_assets_owner_updated" ON "user_assets" USING btree ("owner_id","updated_at","id");
--> statement-breakpoint
CREATE TABLE "user_asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"sprite" jsonb NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_asset_versions_number_check" CHECK ("user_asset_versions"."number" between 1 and 100),
	CONSTRAINT "user_asset_versions_sprite" CHECK (jsonb_typeof("user_asset_versions"."sprite") = 'object'),
	CONSTRAINT "user_asset_versions_sha256" CHECK ("user_asset_versions"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "user_asset_versions" ADD CONSTRAINT "user_asset_versions_asset_id_user_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."user_assets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_asset_versions" ADD CONSTRAINT "user_asset_versions_asset_number_unique" UNIQUE ("asset_id", "number");
--> statement-breakpoint
CREATE INDEX "user_asset_versions_asset_created" ON "user_asset_versions" USING btree ("asset_id","number");
--> statement-breakpoint
CREATE FUNCTION reject_user_asset_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'user asset versions are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_asset_versions_immutable
BEFORE UPDATE ON "user_asset_versions"
FOR EACH ROW EXECUTE FUNCTION reject_user_asset_version_update();
