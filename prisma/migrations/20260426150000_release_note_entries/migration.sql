CREATE TABLE release_note_entries (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  release_note_id INTEGER NOT NULL,
  created_by_user_id INTEGER,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  notes_markdown TEXT,
  structured_json TEXT,
  previous_tag_name TEXT,
  previous_tag_sha TEXT,
  commit_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  generated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT release_note_entries_release_note_id_fkey FOREIGN KEY (release_note_id) REFERENCES release_notes (id) ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO release_note_entries (
  release_note_id,
  created_by_user_id,
  trigger,
  status,
  title,
  notes_markdown,
  structured_json,
  previous_tag_name,
  previous_tag_sha,
  commit_count,
  error_message,
  generated_at,
  created_at,
  updated_at
)
SELECT
  id,
  NULL,
  'webhook',
  status,
  title,
  notes_markdown,
  structured_json,
  previous_tag_name,
  previous_tag_sha,
  commit_count,
  error_message,
  generated_at,
  created_at,
  updated_at
FROM release_notes
WHERE status IS NOT NULL;

CREATE INDEX idx_release_note_entries_note_created ON release_note_entries(release_note_id, created_at);
CREATE INDEX idx_release_note_entries_status_created ON release_note_entries(status, created_at);
CREATE INDEX idx_release_note_entries_created_by ON release_note_entries(created_by_user_id);
