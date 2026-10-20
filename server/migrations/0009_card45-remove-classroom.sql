-- Card 45: retire the teacher/student/classroom scope without silently dropping
-- unique student-authored source. Each distinct submission snapshot that is not
-- already saved as one of the student's own projects becomes a private ordinary
-- project first. Assignment metadata, feedback and classroom membership are not
-- carried into the new project; only the authored snapshot is preserved.

INSERT INTO projects (
  owner_id,
  title,
  description,
  snapshot_version,
  snapshot,
  mode,
  visibility,
  short_code,
  created_at,
  updated_at
)
SELECT DISTINCT ON (s.student_id, r.snapshot)
  s.student_id,
  left('Legacy submission: ' || a.title, 120),
  left('Migrated from the removed classroom feature. Original assignment: ' || a.title, 2000),
  r.snapshot_version,
  r.snapshot,
  COALESCE(a.required_mode, 'sandbox'::project_mode),
  'private'::project_visibility,
  substr(md5(s.id::text), 1, 24),
  s.created_at,
  s.created_at
FROM assignment_submissions s
JOIN assignments a ON a.id = s.assignment_id
JOIN project_revisions r ON r.id = s.revision_id
WHERE NOT EXISTS (
  SELECT 1
  FROM projects p
  WHERE p.owner_id = s.student_id AND p.snapshot = r.snapshot
)
ORDER BY s.student_id, r.snapshot, s.created_at;

DROP TABLE IF EXISTS assignment_submissions;
DROP TABLE IF EXISTS assignment_workspaces;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS class_memberships;
DROP TABLE IF EXISTS classes;

DROP TYPE IF EXISTS submission_state;
DROP TYPE IF EXISTS assignment_state;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_product_capability;
ALTER TABLE users DROP COLUMN IF EXISTS can_learn;
ALTER TABLE users DROP COLUMN IF EXISTS can_teach;
