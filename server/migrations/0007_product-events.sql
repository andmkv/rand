CREATE TABLE product_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_hash varchar(64) NOT NULL,
 event varchar(40) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT product_event_session_hash CHECK(session_hash ~ '^[0-9a-f]{64}$'),
 CONSTRAINT product_event_known CHECK(event IN ('homepage_viewed','example_opened','example_run','program_run','signup_started','public_project_viewed','public_project_run','file_imported','file_exported','signup_completed','signup_verified','login','cloud_project_created','cloud_project_saved','project_published','project_unpublished','project_remixed','class_created','class_joined','assignment_created','assignment_submitted','assignment_reviewed'))
);
CREATE INDEX product_events_time ON product_events(created_at);
CREATE INDEX product_events_session_time ON product_events(session_hash,created_at);
CREATE INDEX sessions_activity ON sessions(created_at,user_id);
CREATE INDEX revisions_activity ON project_revisions(created_at,actor_id);
