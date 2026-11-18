CREATE TABLE provider_profiles (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  api TEXT,
  base_url TEXT,
  models_json TEXT NOT NULL,
  credential_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX provider_profiles_user_id ON provider_profiles (user_id);
