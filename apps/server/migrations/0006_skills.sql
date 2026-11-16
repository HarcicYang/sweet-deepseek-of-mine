CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  when_to_use TEXT,
  enabled INTEGER NOT NULL,
  user_invocable INTEGER NOT NULL,
  model_invocable INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  source TEXT NOT NULL,
  instructions TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE INDEX skills_user_id ON skills (user_id);
