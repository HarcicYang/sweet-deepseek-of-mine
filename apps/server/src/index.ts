import { serve } from '@hono/node-server'
import { apiRoutes } from '@sweet-deepseek/contracts/api'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileAccountStore } from './account-store.js'
import { createApp } from './app.js'
import { createSecurityService } from './security.js'
import { FileSyncStore } from './sync-store.js'

const readPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:8090').origin
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
const app = createApp({
  store,
  syncStore,
  security,
  appOrigin: origin,
  githubClientId: requireEnv('GITHUB_CLIENT_ID'),
  githubClientSecret: requireEnv('GITHUB_CLIENT_SECRET'),
  githubCallbackUrl:
    process.env.GITHUB_CALLBACK_URL ?? new URL(apiRoutes.githubCallback, origin).toString(),
  deepSeekBaseUrl: process.env.DEEPSEEK_API_BASE_URL ?? 'https://api.deepseek.com',
  requestTimeoutMs: readPositiveInt(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS, 15 * 60 * 1000),
  sessionTtlMs: sessionTtlDays * 24 * 60 * 60 * 1000,
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : origin.startsWith('https://'),
})

serve({ fetch: app.fetch, port })
