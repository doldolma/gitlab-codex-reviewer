ALTER TABLE gitlab_projects ADD COLUMN release_notes_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE release_notes (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  gitlab_project_ref_id INTEGER NOT NULL,
  gitlab_project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  tag_sha TEXT NOT NULL,
  tag_url TEXT,
  previous_tag_name TEXT,
  previous_tag_sha TEXT,
  commit_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  title TEXT,
  notes_markdown TEXT,
  structured_json TEXT,
  error_message TEXT,
  generated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT release_notes_gitlab_project_ref_id_fkey FOREIGN KEY (gitlab_project_ref_id) REFERENCES gitlab_projects (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX uniq_release_notes_project_tag ON release_notes(gitlab_project_ref_id, tag_name);
CREATE INDEX idx_release_notes_status_created ON release_notes(status, created_at);
CREATE INDEX idx_release_notes_project ON release_notes(gitlab_project_ref_id);
