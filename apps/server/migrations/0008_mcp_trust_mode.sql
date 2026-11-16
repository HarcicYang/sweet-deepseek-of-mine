ALTER TABLE mcp_servers
  ADD COLUMN trust_mode TEXT NOT NULL DEFAULT 'prompt';
