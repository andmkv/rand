ALTER TABLE users ADD COLUMN test_notice_version text;
ALTER TABLE users ADD COLUMN test_notice_acknowledged_at timestamptz;
CREATE TABLE registration_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(320) NOT NULL,
 token_hash varchar(64) NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz,
 CONSTRAINT invitation_email_normalized CHECK(email=lower(trim(email)))
);
CREATE INDEX registration_invitations_email ON registration_invitations(email);
