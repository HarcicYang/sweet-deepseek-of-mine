import { apiRoutes } from '@sweet-deepseek/contracts/api'
import { env } from 'cloudflare:workers'
import { createApp, DEFAULT_REQUEST_BODY_LIMITS } from './app.js'
import { D1AccountStore } from './d1-account-store.js'
import { D1McpStore } from './d1-mcp-store.js'
import { D1McpOAuthStore } from './d1-mcp-oauth-store.js'
import { D1ProviderStore } from './d1-provider-store.js'
import { D1ShareStore } from './d1-share-store.js'
import { D1SkillStore } from './d1-skill-store.js'
import { D1SyncStore } from './d1-sync-store.js'
import type { McpClient } from './mcp-client.js'
import { parseMcpOAuthClients } from './mcp-oauth-clients.js'
import { createSecurityService } from './security.js'

type WorkerEnv = Env & {
  API_ORIGIN?: string
  GITHUB_CALLBACK_URL?: string
  MCP_ALLOW_PRIVATE_NETWORK?: string
  MCP_OAUTH_CLIENTS?: string
}

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

const isTrue = (value: string | undefined): boolean => value?.toLowerCase() === 'true'

const cookieSameSite = (value: string | undefined): 'Lax' | 'Strict' | 'None' => {
  switch (value?.toLowerCase()) {
    case 'none':
      return 'None'
    case 'strict':
      return 'Strict'
    default:
      return 'Lax'
  }
}

let mcpClientPromise: Promise<McpClient> | null = null

const getMcpClient = (): Promise<McpClient> =>
  (mcpClientPromise ??= import('./mcp-client.js').then(({ createMcpClient }) => createMcpClient()))

const lazyMcpClient: McpClient = {
  probe: async (config, signal) => (await getMcpClient()).probe(config, signal),
  callTool: async (config, rawName, args, approved, signal) =>
    (await getMcpClient()).callTool(config, rawName, args, approved, signal),
  beginOAuth: async (config, provider, signal) =>
    (await getMcpClient()).beginOAuth(config, provider, signal),
  completeOAuth: async (config, provider, callbackParams, signal) =>
    (await getMcpClient()).completeOAuth(config, provider, callbackParams, signal),
}

const createWorkerApp = async (workerEnv: WorkerEnv) => {
  const origin = new URL(workerEnv.APP_ORIGIN).origin
  const apiOrigin = new URL(workerEnv.API_ORIGIN ?? origin).origin
  const githubCallbackUrl =
    workerEnv.GITHUB_CALLBACK_URL ?? new URL(apiRoutes.githubCallback, apiOrigin).toString()
  const security = await createSecurityService(workerEnv.APP_MASTER_KEY)
  const allowedOrigins = (workerEnv.APP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  allowedOrigins.push(apiOrigin)
  return createApp({
    store: new D1AccountStore(workerEnv.DB),
    providerStore: new D1ProviderStore(workerEnv.DB),
    syncStore: new D1SyncStore(workerEnv.DB),
    shareStore: new D1ShareStore(workerEnv.DB),
    mcpStore: new D1McpStore(workerEnv.DB),
    mcpOAuthStore: new D1McpOAuthStore(workerEnv.DB),
    skillStore: new D1SkillStore(workerEnv.DB),
    mcpClient: lazyMcpClient,
    security,
    appOrigin: origin,
    apiOrigin,
    allowedOrigins,
    cookieSameSite: cookieSameSite(workerEnv.COOKIE_SAME_SITE),
    cookieSecure: true,
    githubClientId: workerEnv.GITHUB_CLIENT_ID,
    githubClientSecret: workerEnv.GITHUB_CLIENT_SECRET,
    githubCallbackUrl,
    mcpOAuthClients: parseMcpOAuthClients(workerEnv.MCP_OAUTH_CLIENTS, {
      fallbackRedirectUrl: new URL(apiRoutes.mcpOAuthCallback, apiOrigin).toString(),
      defaults: [
        {
          resource: 'https://api.githubcopilot.com',
          clientId: workerEnv.GITHUB_CLIENT_ID,
          clientSecret: workerEnv.GITHUB_CLIENT_SECRET,
          redirectUrl: githubCallbackUrl,
        },
      ],
    }),
    deepSeekBaseUrl: workerEnv.DEEPSEEK_API_BASE_URL ?? 'https://api.deepseek.com',
    requestTimeoutMs: readPositiveInt(workerEnv.DEEPSEEK_REQUEST_TIMEOUT_MS, 15 * 60 * 1000),
    requestBodyLimits: {
      chat: readPositiveInt(
        workerEnv.REQUEST_BODY_LIMIT_CHAT_BYTES,
        DEFAULT_REQUEST_BODY_LIMITS.chat
      ),
      sync: readPositiveInt(
        workerEnv.REQUEST_BODY_LIMIT_SYNC_BYTES,
        DEFAULT_REQUEST_BODY_LIMITS.sync
      ),
      settings: readPositiveInt(
        workerEnv.REQUEST_BODY_LIMIT_SETTINGS_BYTES,
        DEFAULT_REQUEST_BODY_LIMITS.settings
      ),
      apiKey: readPositiveInt(
        workerEnv.REQUEST_BODY_LIMIT_API_KEY_BYTES,
        DEFAULT_REQUEST_BODY_LIMITS.apiKey
      ),
      speech: readPositiveInt(
        workerEnv.REQUEST_BODY_LIMIT_SPEECH_BYTES,
        DEFAULT_REQUEST_BODY_LIMITS.speech
      ),
    },
    sessionTtlMs: readPositiveInt(workerEnv.SESSION_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
    mcpAllowPrivateNetwork: isTrue(workerEnv.MCP_ALLOW_PRIVATE_NETWORK),
  })
}

const app = await createWorkerApp(env as WorkerEnv)

// eslint-disable-next-line import/no-default-export
export default {
  fetch(request): Response | Promise<Response> {
    return app.fetch(request)
  },
} satisfies ExportedHandler<WorkerEnv>
