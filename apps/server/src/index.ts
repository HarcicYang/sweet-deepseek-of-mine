import { serve } from '@hono/node-server'
import { apiRoutes } from '@sweet-deepseek/contracts/api'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileAccountStore } from './account-store.js'
import { createApp } from './app.js'
import { FileMcpOAuthStore } from './mcp-oauth-store.js'
import { FileMcpStore } from './mcp-store.js'
import { createMcpClient } from './mcp-client.js'
import { parseMcpOAuthClients } from './mcp-oauth-clients.js'
import { createSecurityService } from './security.js'
import { FileShareStore } from './share-store.js'
import { FileSyncStore } from './sync-store.js'

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

const isTrue = (value: string | undefined): boolean => value?.toLowerCase() === 'true'

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:8090').origin
const apiOrigin = new URL(process.env.API_ORIGIN ?? origin).origin
const githubCallbackUrl =
  process.env.GITHUB_CALLBACK_URL ?? new URL(apiRoutes.githubCallback, apiOrigin).toString()
const allowedOrigins = (process.env.APP_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
allowedOrigins.push(apiOrigin)
const cookieSameSite =
  process.env.COOKIE_SAME_SITE?.toLowerCase() === 'none'
    ? 'None'
    : process.env.COOKIE_SAME_SITE?.toLowerCase() === 'strict'
      ? 'Strict'
      : 'Lax'
const port = readPositiveInt(process.env.PORT, 8787)
const sessionTtlDays = readPositiveInt(process.env.SESSION_TTL_DAYS, 30)
const security = await createSecurityService(requireEnv('APP_MASTER_KEY'))
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const store = new FileAccountStore(
  path.resolve(repositoryRoot, process.env.AUTH_DB_PATH ?? '.data/accounts.json')
)
const syncStore = new FileSyncStore(
  path.resolve(repositoryRoot, process.env.SYNC_DB_PATH ?? '.data/sync.json')
)
const shareStore = new FileShareStore(
  path.resolve(repositoryRoot, process.env.SHARE_DB_PATH ?? '.data/shares.json')
)
const mcpStore = new FileMcpStore(
  path.resolve(repositoryRoot, process.env.MCP_DB_PATH ?? '.data/mcp.json')
)
const mcpOAuthStore = new FileMcpOAuthStore(
  path.resolve(repositoryRoot, process.env.MCP_OAUTH_DB_PATH ?? '.data/mcp-oauth.json')
)
const app = createApp({
  store,
  syncStore,
  shareStore,
  mcpStore,
  mcpOAuthStore,
  mcpClient: createMcpClient(),
  security,
  appOrigin: origin,
  apiOrigin,
  githubClientId: requireEnv('GITHUB_CLIENT_ID'),
  githubClientSecret: requireEnv('GITHUB_CLIENT_SECRET'),
  githubCallbackUrl,
  mcpOAuthClients: parseMcpOAuthClients(process.env.MCP_OAUTH_CLIENTS, {
    fallbackRedirectUrl: new URL(apiRoutes.mcpOAuthCallback, apiOrigin).toString(),
    defaults: [
      {
        resource: 'https://api.githubcopilot.com',
        clientId: requireEnv('GITHUB_CLIENT_ID'),
        clientSecret: requireEnv('GITHUB_CLIENT_SECRET'),
        redirectUrl: githubCallbackUrl,
      },
    ],
  }),
  deepSeekBaseUrl: process.env.DEEPSEEK_API_BASE_URL ?? 'https://api.deepseek.com',
  requestTimeoutMs: readPositiveInt(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS, 15 * 60 * 1000),
  sessionTtlMs: sessionTtlDays * 24 * 60 * 60 * 1000,
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : origin.startsWith('https://'),
  cookieSameSite,
  allowedOrigins,
  mcpAllowPrivateNetwork: isTrue(process.env.MCP_ALLOW_PRIVATE_NETWORK),
})

serve({ fetch: app.fetch, port })
