ALTER TABLE mcp_servers ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'static';
ALTER TABLE mcp_servers ADD COLUMN oauth_client_id TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_client_secret_json TEXT;

CREATE TABLE mcp_oauth (
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  connected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, server_id)
);

CREATE INDEX mcp_oauth_state ON mcp_oauth (state);
CREATE INDEX mcp_oauth_expires_at ON mcp_oauth (expires_at);
