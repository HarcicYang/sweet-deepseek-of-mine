UPDATE mcp_servers
SET oauth_client_id = NULL,
    oauth_client_secret_json = NULL
WHERE oauth_client_id IS NOT NULL
   OR oauth_client_secret_json IS NOT NULL;
