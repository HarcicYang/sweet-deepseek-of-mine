CREATE TABLE share_links (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payload_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX share_links_expires_at ON share_links (expires_at);

CREATE TABLE share_chunks (
  token TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (token, chunk_index)
);
