import { apiRoutes } from '@sweet-deepseek/contracts/api'
import { createApp } from './app.js'
import { D1AccountStore } from './d1-account-store.js'
import { D1McpStore } from './d1-mcp-store.js'
import { D1ShareStore } from './d1-share-store.js'
import { D1SyncStore } from './d1-sync-store.js'
import { createMcpClient } from './mcp-client.js'
import { createSecurityService } from './security.js'

type WorkerEnv = Env & {
  API_ORIGIN?: string
  GITHUB_CALLBACK_URL?: string
  MCP_ALLOW_PRIVATE_NETWORK?: string
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

const appPromises = new WeakMap<object, Promise<ReturnType<typeof createApp>>>()

const getApp = (env: WorkerEnv): Promise<ReturnType<typeof createApp>> => {
  const cached = appPromises.get(env)
  if (cached) {
    return cached
  }
  const promise = (async () => {
    const origin = new URL(env.APP_ORIGIN).origin
    const apiOrigin = new URL(env.API_ORIGIN ?? origin).origin
    const security = await createSecurityService(env.APP_MASTER_KEY)
    const allowedOrigins = (env.APP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    allowedOrigins.push(apiOrigin)
    return createApp({
      store: new D1AccountStore(env.DB),
      syncStore: new D1SyncStore(env.DB),
      shareStore: new D1ShareStore(env.DB),
      mcpStore: new D1McpStore(env.DB),
      mcpClient: createMcpClient(),
      security,
      appOrigin: origin,
      allowedOrigins,
      cookieSameSite: cookieSameSite(env.COOKIE_SAME_SITE),
      cookieSecure: true,
      githubClientId: env.GITHUB_CLIENT_ID,
      githubClientSecret: env.GITHUB_CLIENT_SECRET,
      githubCallbackUrl:
        env.GITHUB_CALLBACK_URL ?? new URL(apiRoutes.githubCallback, apiOrigin).toString(),
      deepSeekBaseUrl: env.DEEPSEEK_API_BASE_URL ?? 'https://api.deepseek.com',
      requestTimeoutMs: readPositiveInt(env.DEEPSEEK_REQUEST_TIMEOUT_MS, 15 * 60 * 1000),
      sessionTtlMs: readPositiveInt(env.SESSION_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
      mcpAllowPrivateNetwork: isTrue(env.MCP_ALLOW_PRIVATE_NETWORK),
    })
  })()
  appPromises.set(env, promise)
  return promise
}

// eslint-disable-next-line import/no-default-export
export default {
  async fetch(request, env): Promise<Response> {
    const app = await getApp(env as WorkerEnv)
    return await app.fetch(request)
  },
} satisfies ExportedHandler<WorkerEnv>
