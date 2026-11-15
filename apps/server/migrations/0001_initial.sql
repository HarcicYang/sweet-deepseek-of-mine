CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id TEXT NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  avatar_url TEXT,
  api_key_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX auth_sessions_user_id ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_at ON auth_sessions (expires_at);

CREATE TABLE sync_settings (
  user_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  client_updated_at INTEGER NOT NULL,
  server_updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE sync_sessions (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  client_updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  server_updated_at TEXT NOT NULL,
  payload_token TEXT,
  payload_size INTEGER NOT NULL,
  PRIMARY KEY (user_id, session_id)
);

CREATE INDEX sync_sessions_user_updated
  ON sync_sessions (user_id, client_updated_at DESC);

CREATE TABLE sync_session_chunks (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload_token TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (user_id, session_id, payload_token, chunk_index)
);
