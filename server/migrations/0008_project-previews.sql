CREATE TABLE project_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 png bytea NOT NULL, byte_length integer NOT NULL, sha256 varchar(64) NOT NULL,
 width integer NOT NULL DEFAULT 256, height integer NOT NULL DEFAULT 192,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT preview_dimensions CHECK(width=256 AND height=192),
 CONSTRAINT preview_size CHECK(byte_length=octet_length(png) AND byte_length BETWEEN 1 AND 60000),
 CONSTRAINT preview_checksum CHECK(sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX project_previews_project ON project_previews(project_id);
