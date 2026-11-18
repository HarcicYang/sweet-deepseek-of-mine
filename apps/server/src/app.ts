import type { HealthResponse } from '@sweet-deepseek/contracts'
import {
  ProviderCreateRequestSchema,
  ProviderResponseSchema,
  ProviderUpdateRequestSchema,
  ProvidersResponseSchema,
  type ProviderSummary,
} from '@sweet-deepseek/contracts/providers'
import type { StoredOAuthClientInformation } from '@modelcontextprotocol/client'
import {
  ApiKeyRequestSchema,
  ApiKeyStatusResponseSchema,
  ChatProxyRequestSchema,
  DeepSeekFetchRequestSchema,
  DeepSeekFetchResponseSchema,
  DeepSeekSearchRequestSchema,
  DeepSeekSearchResponseSchema,
  FileObjectResponseSchema,
  SessionResponseSchema,
  SpeechSynthesisRequestSchema,
  SpeechTranscriptionResponseSchema,
  apiRoutes,
  type ApiErrorCode,
  type ApiErrorResponse,
  type ApiKeyStatusResponse,
  type AuthUser,
  type SessionResponse,
} from '@sweet-deepseek/contracts/api'
import {
  JSON_RENDER_LIMITS,
  JsonRenderValidationRequestSchema,
  JsonRenderValidationResponseSchema,
  parseJsonRenderSource,
} from '@sweet-deepseek/json-render'
import {
  SyncDeleteRequestSchema,
  SyncSettingsResponseSchema,
  SyncSettingsUpdateRequestSchema,
  SyncSessionResponseSchema,
  SyncSessionsResponseSchema,
  SyncUpsertRequestSchema,
  type SyncSessionPayload,
} from '@sweet-deepseek/contracts/sync'
import {
  SHARE_TOKEN_PATTERN,
  ShareCreateRequestSchema,
  ShareCreateResponseSchema,
  SharedSessionResponseSchema,
} from '@sweet-deepseek/contracts/share'
import {
  McpProbeResponseSchema,
  McpHeadersSchema,
  McpOAuthStartResponseSchema,
  McpServerInputSchema,
  McpServerResponseSchema,
  McpServersResponseSchema,
  McpServerUpdateSchema,
  McpToolCallRequestSchema,
  McpToolCallResponseSchema,
  McpToolsResponseSchema,
  type McpHeaders,
  type McpServerSummary,
  type McpToolSummary,
} from '@sweet-deepseek/contracts/mcp'
import {
  SKILL_BUNDLE_MAX_BYTES,
  SkillCreateSchema,
  SkillResponseSchema,
  SkillUpdateSchema,
  SkillsResponseSchema,
  type SkillSummary,
} from '@sweet-deepseek/contracts/skills'
import { parseSkillBundle, SkillParseError } from '@sweet-deepseek/skills'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AccountStore, GitHubProfile, UserRecord } from './account-store.js'
import {
  McpApprovalRequiredError,
  McpToolNotFoundError,
  type McpClient,
  type McpConnectionConfig,
} from './mcp-client.js'
import { assertAllowedMcpUrl, mcpHeadersAdditionalData } from './mcp-policy.js'
import {
  fetchOfficialMcpRegistryServers,
  McpRegistrySearchTooShortError,
  McpRegistryUpstreamError,
} from './mcp-registry.js'
import type { McpServerRecord, McpStore } from './mcp-store.js'
import type { McpOAuthRecord, McpOAuthStore } from './mcp-oauth-store.js'
import { findMcpOAuthClient, type McpOAuthClientConfig } from './mcp-oauth-clients.js'
import {
  decryptMcpOAuthPayload,
  encryptMcpOAuthPayload,
  McpOAuthRequiredError,
  McpOAuthProvider,
  type McpOAuthPayload,
} from './mcp-oauth.js'
import { toMcpToolSummaries } from './mcp-tools.js'
import type { SecurityService } from './security.js'
import type { ShareStore } from './share-store.js'
import type { SkillRecord, SkillStore, SkillWrite } from './skill-store.js'
import { SyncConflictError, SyncSettingsConflictError, type SyncStore } from './sync-store.js'
import type { ProviderStore } from './provider-store.js'
import {
  createPiSseResponse,
  providerSummary,
  providerTemplates,
} from './pi-provider-runtime.js'

const SESSION_COOKIE = 'sdom_session'
const OAUTH_STATE_COOKIE = 'sdom_oauth_state'
const OAUTH_STATE_TTL_SECONDS = 10 * 60
const OAUTH_STATE_TTL_MS = OAUTH_STATE_TTL_SECONDS * 1000
const OAUTH_STATE_PATH = '/api/auth/github'
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_API_VERSION = '2022-11-28'
// Workers only supports Fetch redirect modes "follow" and "manual".
const UPSTREAM_REDIRECT_MODE = 'manual' as const
const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024
const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024
const MAX_SHARE_BODY_BYTES = 20 * 1024 * 1024
const MAX_JSON_RENDER_BODY_BYTES = JSON_RENDER_LIMITS.maxDocumentBytes + 1024
const MAX_MCP_CONFIG_BODY_BYTES = 256 * 1024
const MAX_MCP_CALL_BODY_BYTES = 2 * 1024 * 1024
const MAX_SKILL_BODY_BYTES = SKILL_BUNDLE_MAX_BYTES * 2 + 32 * 1024

export type RequestBodyLimits = {
  chat: number
  sync: number
  settings: number
  apiKey: number
  speech: number
}

export const DEFAULT_REQUEST_BODY_LIMITS: RequestBodyLimits = {
  chat: 20 * 1024 * 1024,
  sync: 20 * 1024 * 1024,
  settings: 256 * 1024,
  apiKey: 16 * 1024,
  speech: 1024 * 1024,
}

const DEEPSEEK_PROVIDER: ProviderSummary = {
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'deepseek',
  authModes: ['api_key'],
  configured: false,
  api: 'anthropic-messages',
  models: [
    {
      id: 'deepseek-flash',
      name: 'DeepSeek Flash',
      api: 'anthropic-messages',
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      input: ['text', 'image'],
      reasoning: true,
      thinkingLevels: ['off', 'low', 'high', 'max'],
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      api: 'anthropic-messages',
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      input: ['text'],
      reasoning: true,
      thinkingLevels: ['off', 'low', 'high', 'max'],
    },
  ],
}

const providerCredentialAad = (userId: string, providerId: string) =>
  `provider-api-key:v1:${userId}:${providerId}`

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the configured limit')
    this.name = 'RequestBodyTooLargeError'
  }
}

type AuthContext = {
  user: UserRecord
  sessionTokenHash: string
}

type AppEnv = {
  Variables: {
    auth: AuthContext
  }
}

export type AppOptions = {
  store: AccountStore
  providerStore: ProviderStore
  syncStore: SyncStore
  shareStore: ShareStore
  mcpStore: McpStore
  mcpOAuthStore: McpOAuthStore
  skillStore: SkillStore
  mcpClient: McpClient
  security: SecurityService
  appOrigin: string
  apiOrigin: string
  githubClientId: string
  githubClientSecret: string
  githubCallbackUrl: string
  mcpOAuthClients?: McpOAuthClientConfig[]
  deepSeekBaseUrl: string
  requestTimeoutMs: number
  requestBodyLimits?: Partial<RequestBodyLimits>
  sessionTtlMs: number
  cookieSecure: boolean
  cookieSameSite?: 'Lax' | 'Strict' | 'None'
  allowedOrigins?: string[]
  mcpAllowPrivateNetwork?: boolean
  mcpRegistryFetchImpl?: typeof fetch
  fetchImpl?: typeof fetch
  logger?: Pick<Console, 'warn'>
}

type JsonResult = { ok: true; value: unknown } | { ok: false }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readLimitedJson = async (
  context: Context<AppEnv>,
  limit: number
): Promise<JsonResult | 'too-large'> => {
  if (contentLengthExceeds(context, limit)) {
    return 'too-large'
  }
  const body = context.req.raw.body
  if (!body) {
    return { ok: false }
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        return 'too-large'
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return { ok: false }
  }
}

const apiError = (
  context: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string
) => {
  const body: ApiErrorResponse = { error: { code, message } }
  return context.json(body, status)
}

const toAuthUser = (user: UserRecord): AuthUser => ({
  id: user.id,
  githubLogin: user.githubLogin,
  avatarUrl: user.avatarUrl,
  hasApiKey: Boolean(user.apiKey),
})

const readMcpHeaders = async (
  security: SecurityService,
  server: McpServerRecord
): Promise<McpHeaders> => {
  if (!server.encryptedHeaders) {
    return {}
  }
  const raw = await security.decryptValue(
    mcpHeadersAdditionalData(server.userId, server.id),
    server.encryptedHeaders
  )
  const parsed = McpHeadersSchema.safeParse(JSON.parse(raw) as unknown)
  if (!parsed.success) {
    throw new Error('Stored MCP headers are invalid')
  }
  return parsed.data
}

const encryptMcpHeaders = async (
  security: SecurityService,
  userId: string,
  serverId: string,
  headers: McpHeaders | undefined
) => {
  if (headers === undefined) {
    return undefined
  }
  if (Object.keys(headers).length === 0) {
    return null
  }
  return await security.encryptValue(
    mcpHeadersAdditionalData(userId, serverId),
    JSON.stringify(headers)
  )
}

const toMcpServerSummary = async (
  security: SecurityService,
  mcpOAuthStore: McpOAuthStore,
  server: McpServerRecord
): Promise<McpServerSummary> => {
  const headers = await readMcpHeaders(security, server).catch(() => ({}))
  const oauth = await mcpOAuthStore.find(server.userId, server.id).catch(() => null)
  return {
    id: server.id,
    name: server.name,
    slug: server.slug,
    url: server.url,
    authMode: server.authMode,
    trustMode: server.trustMode,
    oauthConnected: oauth?.connected ?? false,
    enabled: server.enabled,
    headerNames: Object.keys(headers).sort(),
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  }
}

const toSkillSummary = (skill: SkillRecord): SkillSummary => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  whenToUse: skill.whenToUse,
  enabled: skill.enabled,
  userInvocable: skill.userInvocable,
  modelInvocable: skill.modelInvocable,
  createdAt: skill.createdAt,
  updatedAt: skill.updatedAt,
})

const toSkillWrite = (
  bundle: ReturnType<typeof parseSkillBundle>,
  enabled: boolean
): SkillWrite => ({
  name: bundle.skill.name,
  description: bundle.skill.description,
  whenToUse: bundle.skill.whenToUse,
  enabled,
  userInvocable: bundle.skill.userInvocable,
  modelInvocable: bundle.skill.modelInvocable,
  metadata: bundle.skill.metadata,
  files: bundle.files,
})

const toSkillDetail = (skill: SkillRecord) => {
  const bundle = parseSkillBundle(
    skill.files.map((file) => ({ path: file.path, content: file.content }))
  )
  return {
    ...toSkillSummary(skill),
    instructions: bundle.skill.instructions,
    warnings: bundle.skill.warnings,
    files: bundle.files,
  }
}

const toSharedMessage = (
  message: SyncSessionPayload['messages'][number]
): SyncSessionPayload['messages'][number] => {
  if (message.role === 'user') {
    return {
      ...message,
      files: message.files.map((file) => ({ ...file, serverId: null })),
    }
  }
  return {
    ...message,
    blocks: message.blocks.map((block) => {
      if (block.type === 'tool_use') {
        return { ...block, input: {}, inputText: undefined }
      }
      if (block.type === 'tool_result') {
        return {
          ...block,
          content: [{ type: 'text' as const, text: '[Tool output hidden in public share]' }],
        }
      }
      return block
    }),
  }
}

const toSharedSessionPayload = (payload: SyncSessionPayload): SyncSessionPayload => ({
  ...payload,
  messages: payload.messages.map(toSharedMessage),
})

const hasFileBlocks = (messages: unknown[]): boolean =>
  messages.some(
    (message) =>
      isRecord(message) &&
      Array.isArray(message.content) &&
      message.content.some(
        (block) => isRecord(block) && (block.type === 'image' || block.type === 'document')
      )
  )

const contentLengthExceeds = (context: Context<AppEnv>, limit: number): boolean => {
  const header = context.req.header('Content-Length')
  if (!header) {
    return false
  }
  const length = Number(header)
  return Number.isFinite(length) && length > limit
}

const readMultipartContentType = (context: Context<AppEnv>): string | null => {
  const contentType = context.req.header('Content-Type')?.trim()
  if (!contentType || !/^multipart\/form-data\s*;/iu.test(contentType)) {
    return null
  }
  return /\bboundary=/iu.test(contentType) ? contentType : null
}

const limitRequestBody = (
  body: ReadableStream<Uint8Array>,
  limit: number
): ReadableStream<Uint8Array> => {
  let bytesRead = 0
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength
        if (bytesRead > limit) {
          controller.error(new RequestBodyTooLargeError())
          return
        }
        controller.enqueue(chunk)
      },
    })
  )
}

const hasTooLargeCause = (error: unknown): boolean => {
  let current = error
  for (let depth = 0; depth < 4; depth++) {
    if (current instanceof RequestBodyTooLargeError) {
      return true
    }
    if (!(current instanceof Error) || !current.cause) {
      return false
    }
    current = current.cause
  }
  return false
}

const forwardUpstreamError = (context: Context<AppEnv>, response: Response): Response => {
  if (response.status === 401 || response.status === 403) {
    void response.body?.cancel().catch(() => {})
    return apiError(context, 400, 'invalid_api_key', 'DeepSeek rejected the API key')
  }
  const headers = new Headers()
  const contentType = response.headers.get('content-type')
  if (contentType) {
    headers.set('Content-Type', contentType)
  }
  return new Response(response.body, { status: response.status, headers })
}

const readGitHubToken = (value: unknown): string | null => {
  if (
    !isRecord(value) ||
    typeof value.access_token !== 'string' ||
    value.access_token.trim() === ''
  ) {
    return null
  }
  return value.access_token.trim()
}

const readGitHubTokenError = (value: unknown): string => {
  if (!isRecord(value) || typeof value.error !== 'string') {
    return 'invalid_response'
  }
  const errorCode = value.error.trim()
  return /^[a-z0-9_]{1,100}$/iu.test(errorCode) ? errorCode : 'unknown_error'
}

const readGitHubProfile = (value: unknown): GitHubProfile | null => {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    typeof value.login !== 'string'
  ) {
    return null
  }
  const githubLogin = value.login.trim()
  if (!githubLogin || githubLogin.length > 100) {
    return null
  }
  let avatarUrl: string | null = null
  if (typeof value.avatar_url === 'string' && URL.canParse(value.avatar_url)) {
    const parsed = new URL(value.avatar_url)
    if (parsed.protocol === 'https:' && parsed.hostname === 'avatars.githubusercontent.com') {
      avatarUrl = parsed.toString()
    }
  }
  return {
    githubId: String(value.id),
    githubLogin,
    avatarUrl,
  }
}

export const createApp = ({
  store,
  providerStore,
  syncStore,
  shareStore,
  mcpStore,
  mcpOAuthStore,
  skillStore,
  mcpClient,
  security,
  appOrigin,
  apiOrigin,
  githubClientId,
  githubClientSecret,
  githubCallbackUrl,
  mcpOAuthClients = [],
  deepSeekBaseUrl,
  requestTimeoutMs,
  requestBodyLimits,
  sessionTtlMs,
  cookieSecure,
  cookieSameSite = 'Lax',
  allowedOrigins = [],
  mcpAllowPrivateNetwork = false,
  mcpRegistryFetchImpl = fetch,
  fetchImpl = fetch,
  logger = globalThis.console,
}: AppOptions) => {
  const app = new Hono<AppEnv>()
  const bodyLimits = { ...DEFAULT_REQUEST_BODY_LIMITS, ...requestBodyLimits }
  const trustedOrigins = new Set(
    [appOrigin, ...allowedOrigins].map((origin) => new URL(origin).origin)
  )

  app.use('/api/*', async (context, next) => {
    const origin = context.req.header('Origin')
    const publicShareGet =
      context.req.method === 'GET' &&
      /^\/api\/shares\/[A-Za-z0-9_-]{20,128}$/u.test(context.req.path)
    if (origin && !publicShareGet && !trustedOrigins.has(origin)) {
      logger.warn('Rejected cross-origin API request', {
        origin,
        method: context.req.method,
        path: context.req.path,
      })
      return apiError(context, 403, 'forbidden', 'Cross-origin request rejected')
    }
    if (origin) {
      context.header('Access-Control-Allow-Origin', publicShareGet ? '*' : origin)
      if (!publicShareGet) {
        context.header('Access-Control-Allow-Credentials', 'true')
      }
      context.header('Vary', 'Origin')
    }
    if (context.req.method === 'OPTIONS') {
      context.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS')
      context.header(
        'Access-Control-Allow-Headers',
        context.req.header('Access-Control-Request-Headers') ?? 'Content-Type, Accept'
      )
      context.header('Access-Control-Max-Age', '600')
      return context.body(null, 204)
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
      return await next()
    }
    return await next()
  })

  const readAuthContext = async (context: Context<AppEnv>): Promise<AuthContext | null> => {
    const token = getCookie(context, SESSION_COOKIE)
    if (!token) {
      return null
    }
    const sessionTokenHash = await security.hashToken(token)
    const session = await store.findSessionByTokenHash(sessionTokenHash)
    if (!session) {
      deleteCookie(context, SESSION_COOKIE, { path: '/' })
      return null
    }
    const user = await store.findUserById(session.userId)
    if (!user) {
      await store.deleteSession(sessionTokenHash)
      deleteCookie(context, SESSION_COOKIE, { path: '/' })
      return null
    }
    return { user, sessionTokenHash }
  }

  const requireAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
    const auth = await readAuthContext(context)
    if (!auth) {
      return apiError(context, 401, 'unauthorized', 'Sign in with GitHub to continue')
    }
    context.set('auth', auth)
    return await next()
  }

  const requireApiKey = async (
    context: Context<AppEnv>
  ): Promise<{ ok: true; apiKey: string } | { ok: false; response: Response }> => {
    const user = context.get('auth').user
    if (!user.apiKey) {
      return {
        ok: false,
        response: apiError(context, 409, 'api_key_missing', 'A DeepSeek API key is required'),
      }
    }
    const apiKey = await security.decryptApiKey(user.id, user.apiKey).catch(() => null)
    if (!apiKey) {
      return {
        ok: false,
        response: apiError(
          context,
          500,
          'credential_error',
          'Stored API key could not be decrypted'
        ),
      }
    }
    return { ok: true, apiKey }
  }

  const createProxySignal = (context: Context<AppEnv>): AbortSignal => {
    const clientSignal = context.req.raw.signal
    return requestTimeoutMs > 0
      ? AbortSignal.any([clientSignal, AbortSignal.timeout(requestTimeoutMs)])
      : clientSignal
  }

  const proxyFailure = (context: Context<AppEnv>, error: unknown, clientSignal: AbortSignal) => {
    if (clientSignal.aborted) {
      return new Response(null, { status: 499 })
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return apiError(context, 504, 'upstream_error', 'DeepSeek request timed out')
    }
    return apiError(context, 502, 'upstream_error', 'DeepSeek request failed')
  }

  const createSession = async (context: Context<AppEnv>, user: UserRecord) => {
    const token = security.createToken()
    const now = Date.now()
    const sessionTokenHash = await security.hashToken(token)
    await store.createSession({
      tokenHash: sessionTokenHash,
      userId: user.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + sessionTtlMs).toISOString(),
    })
    setCookie(context, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: '/',
      maxAge: Math.floor(sessionTtlMs / 1000),
    })
  }

  const mcpOAuthCallbackUrl = new URL(apiRoutes.mcpOAuthCallback, apiOrigin).toString()

  const readMcpOAuthPayload = async (record: McpOAuthRecord) =>
    await decryptMcpOAuthPayload(security, record.userId, record.serverId, record.encryptedPayload)

  const saveMcpOAuthPayload = async (
    record: McpOAuthRecord,
    payload: McpOAuthPayload,
    update: Partial<Pick<McpOAuthRecord, 'state' | 'connected' | 'expiresAt'>> = {}
  ) =>
    await mcpOAuthStore.upsert({
      ...record,
      ...update,
      encryptedPayload: await encryptMcpOAuthPayload(
        security,
        record.userId,
        record.serverId,
        payload
      ),
      updatedAt: new Date().toISOString(),
    })

  const mcpOAuthClientConfiguration = (
    server: McpServerRecord
  ): {
    redirectUrl: string
    clientInformation?: StoredOAuthClientInformation
    clientAuthMethod: 'none' | 'client_secret_post'
  } => {
    const configured = findMcpOAuthClient(mcpOAuthClients, server.url)
    if (!configured) {
      return {
        redirectUrl: mcpOAuthCallbackUrl,
        clientAuthMethod: 'none',
      }
    }
    return {
      redirectUrl: configured.redirectUrl,
      clientInformation: {
        client_id: configured.clientId,
        redirect_uris: [configured.redirectUrl],
        token_endpoint_auth_method: configured.clientAuthMethod,
        ...(configured.clientSecret === undefined
          ? {}
          : { client_secret: configured.clientSecret }),
      } as StoredOAuthClientInformation,
      clientAuthMethod: configured.clientAuthMethod,
    }
  }

  const createMcpOAuthProvider = (
    server: McpServerRecord,
    record: McpOAuthRecord,
    payload: McpOAuthPayload
  ) => {
    const client = mcpOAuthClientConfiguration(server)
    return new McpOAuthProvider({
      state: record.state,
      redirectUrl: client.redirectUrl,
      initialPayload: payload,
      ...(client.clientInformation === undefined
        ? {}
        : { clientInformation: client.clientInformation }),
      clientAuthMethod: client.clientAuthMethod,
      persist: async (nextPayload) => {
        await saveMcpOAuthPayload(record, nextPayload)
      },
    })
  }

  const mcpConnectionConfig = async (server: McpServerRecord): Promise<McpConnectionConfig> => {
    const headers = await readMcpHeaders(security, server)
    if (server.authMode !== 'oauth') {
      return { url: server.url, headers, trustMode: server.trustMode }
    }
    const record = await mcpOAuthStore.find(server.userId, server.id)
    if (!record?.connected) {
      throw new McpOAuthRequiredError()
    }
    const payload = await readMcpOAuthPayload(record)
    return {
      url: server.url,
      headers,
      trustMode: server.trustMode,
      authProvider: createMcpOAuthProvider(server, record, payload),
    }
  }

  const mcpOAuthResultPage = (
    ok: boolean,
    serverId: string,
    message = ok ? 'MCP authorization completed.' : 'MCP authorization failed.'
  ) => {
    const payload = JSON.stringify({
      type: 'sdom:mcp-oauth',
      ok,
      serverId,
    }).replaceAll('<', '\\u003c')
    const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sweet DeepSeek O'Mine</title>
<style>
body{font:14px/1.6 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee}
main{max-width:420px;padding:32px;text-align:center}
</style>
<main><p>${message}</p><p>You can close this window.</p></main>
<script>
const data=${payload};
if(window.opener)window.opener.postMessage(data,${JSON.stringify(appOrigin)});
if(data.ok)setTimeout(()=>window.close(),250);
</script>
</html>`
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      },
    })
  }

  const completeMcpOAuthCallback = async (
    context: Context<AppEnv>,
    auth: AuthContext,
    record: McpOAuthRecord,
    callbackParams: URLSearchParams
  ): Promise<Response> => {
    if (record.userId !== auth.user.id) {
      return mcpOAuthResultPage(false, '', 'MCP authorization state is invalid or expired.')
    }
    if (callbackParams.get('error')) {
      return mcpOAuthResultPage(false, record.serverId, 'MCP authorization was not completed.')
    }
    const server = await mcpStore.findServer(auth.user.id, record.serverId)
    if (!server || server.authMode !== 'oauth') {
      return mcpOAuthResultPage(false, record.serverId, 'MCP server no longer exists.')
    }
    let headers: McpHeaders
    let payload: McpOAuthPayload
    try {
      assertAllowedMcpUrl(server.url, mcpAllowPrivateNetwork)
      headers = await readMcpHeaders(security, server)
      payload = await readMcpOAuthPayload(record)
    } catch {
      return mcpOAuthResultPage(
        false,
        record.serverId,
        'MCP authorization configuration is invalid.'
      )
    }
    const provider = createMcpOAuthProvider(server, record, payload)
    try {
      await mcpClient.completeOAuth(
        {
          url: server.url,
          headers,
          trustMode: server.trustMode,
          authProvider: provider,
        },
        provider,
        callbackParams,
        context.req.raw.signal
      )
      await saveMcpOAuthPayload(record, provider.snapshot(), {
        state: security.createToken(),
        connected: true,
        expiresAt: 0,
      })
      return mcpOAuthResultPage(true, record.serverId)
    } catch (error) {
      logger.warn('MCP OAuth callback failed', {
        serverId: record.serverId,
        name: error instanceof Error ? error.name : 'unknown',
      })
      return mcpOAuthResultPage(false, record.serverId, 'MCP authorization could not be completed.')
    }
  }

  const authRedirect = (context: Context<AppEnv>, result: 'success' | 'error', reason?: string) => {
    const target = new URL('/', appOrigin)
    target.searchParams.set('auth', result)
    if (reason) {
      target.searchParams.set('reason', reason)
    }
    return context.redirect(target.toString())
  }

  app.get(apiRoutes.health, (context) => {
    const body: HealthResponse = { status: 'ok' }
    return context.json(body)
  })

  app.get(apiRoutes.githubStart, (context) => {
    const state = security.createToken()
    setCookie(context, OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'Lax',
      path: OAUTH_STATE_PATH,
      maxAge: OAUTH_STATE_TTL_SECONDS,
    })
    const target = new URL(GITHUB_AUTHORIZE_URL)
    target.searchParams.set('client_id', githubClientId)
    target.searchParams.set('redirect_uri', githubCallbackUrl)
    target.searchParams.set('scope', 'read:user')
    target.searchParams.set('state', state)
    target.searchParams.set('allow_signup', 'true')
    return context.redirect(target.toString())
  })

  app.get(apiRoutes.githubCallback, async (context) => {
    const state = context.req.query('state')
    const mcpRecord = state ? await mcpOAuthStore.findByState(state) : null
    if (mcpRecord) {
      const auth = await readAuthContext(context)
      if (!auth) {
        return mcpOAuthResultPage(
          false,
          mcpRecord.serverId,
          'Sign in again before completing MCP authorization.'
        )
      }
      return await completeMcpOAuthCallback(
        context,
        auth,
        mcpRecord,
        new URL(context.req.url).searchParams
      )
    }
    const expectedState = getCookie(context, OAUTH_STATE_COOKIE)
    deleteCookie(context, OAUTH_STATE_COOKIE, { path: OAUTH_STATE_PATH })
    if (!state || !expectedState || state !== expectedState) {
      return authRedirect(context, 'error', 'oauth_state')
    }
    if (context.req.query('error')) {
      return authRedirect(context, 'error', 'github_denied')
    }
    const code = context.req.query('code')
    if (!code) {
      return authRedirect(context, 'error', 'oauth_code')
    }

    const tokenResponse = await fetchImpl(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'sweet-deepseek-omine',
      },
      body: new URLSearchParams({
        client_id: githubClientId,
        client_secret: githubClientSecret,
        code,
        redirect_uri: githubCallbackUrl,
      }),
      signal: AbortSignal.timeout(20_000),
      redirect: UPSTREAM_REDIRECT_MODE,
    }).catch((error: unknown) => {
      logger.warn('GitHub OAuth token exchange request failed', {
        name: error instanceof Error ? error.name : 'unknown',
      })
      return null
    })
    if (!tokenResponse?.ok) {
      logger.warn('GitHub OAuth token exchange returned an HTTP error', {
        status: tokenResponse?.status ?? null,
      })
      return authRedirect(context, 'error', 'oauth_exchange')
    }
    const tokenPayload = await tokenResponse.json().catch(() => null)
    const accessToken = readGitHubToken(tokenPayload)
    if (!accessToken) {
      logger.warn('GitHub OAuth token exchange returned no access token', {
        githubError: readGitHubTokenError(tokenPayload),
      })
      return authRedirect(context, 'error', 'oauth_exchange')
    }

    const profileResponse = await fetchImpl(GITHUB_USER_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'sweet-deepseek-omine',
      },
      signal: AbortSignal.timeout(20_000),
      redirect: UPSTREAM_REDIRECT_MODE,
    }).catch(() => null)
    if (!profileResponse?.ok) {
      return authRedirect(context, 'error', 'github_profile')
    }
    const profile = readGitHubProfile(await profileResponse.json().catch(() => null))
    if (!profile) {
      return authRedirect(context, 'error', 'github_profile')
    }

    const user = await store.upsertGithubUser(profile)
    await createSession(context, user)
    return authRedirect(context, 'success')
  })

  app.get(apiRoutes.session, requireAuth, (context) => {
    const body: SessionResponse = { user: toAuthUser(context.get('auth').user) }
    return context.json(SessionResponseSchema.parse(body))
  })

  app.post(apiRoutes.jsonRenderValidate, requireAuth, async (context) => {
    const json = await readLimitedJson(context, MAX_JSON_RENDER_BODY_BYTES)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'JSON-Render document is too large')
    }
    const request = json.ok ? JsonRenderValidationRequestSchema.safeParse(json.value) : null
    if (!request?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid JSON-Render request')
    }
    const result = parseJsonRenderSource(request.data.source)
    if (!result.success) {
      return apiError(context, 400, 'invalid_request', result.error)
    }
    return context.json(JsonRenderValidationResponseSchema.parse({ document: result.data }))
  })

  app.get(apiRoutes.skills, requireAuth, async (context) => {
    const skills = await skillStore.listSkills(context.get('auth').user.id)
    return context.json(
      SkillsResponseSchema.parse({
        skills: skills.map(toSkillSummary),
      })
    )
  })

  app.get(apiRoutes.skill, requireAuth, async (context) => {
    const skill = await skillStore.findSkill(
      context.get('auth').user.id,
      context.req.param('skillId')
    )
    if (!skill) {
      return apiError(context, 404, 'invalid_request', 'Skill not found')
    }
    return context.json(
      SkillResponseSchema.parse({
        skill: {
          ...toSkillDetail(skill),
        },
      })
    )
  })

  app.post(apiRoutes.skills, requireAuth, async (context) => {
    const json = await readLimitedJson(context, MAX_SKILL_BODY_BYTES)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Skill is too large')
    }
    const parsedBody = json.ok ? SkillCreateSchema.safeParse(json.value) : null
    if (!parsedBody?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid skill')
    }
    let parsedBundle: ReturnType<typeof parseSkillBundle>
    try {
      parsedBundle = parseSkillBundle(parsedBody.data.files)
    } catch (error) {
      return apiError(
        context,
        400,
        'invalid_request',
        error instanceof SkillParseError ? error.message : 'Invalid skill'
      )
    }
    const user = context.get('auth').user
    try {
      const skill = await skillStore.createSkill({
        id: crypto.randomUUID(),
        userId: user.id,
        ...toSkillWrite(parsedBundle, parsedBody.data.enabled),
      })
      return context.json(
        SkillResponseSchema.parse({
          skill: {
            ...toSkillDetail(skill),
          },
        }),
        201
      )
    } catch (error) {
      if (/name|unique/iu.test(error instanceof Error ? error.message : '')) {
        return apiError(context, 409, 'conflict', 'Skill name already exists')
      }
      logger.warn('Could not create skill', {
        name: error instanceof Error ? error.name : 'unknown',
      })
      return apiError(context, 500, 'server_error', 'Could not create skill')
    }
  })

  app.put(apiRoutes.skill, requireAuth, async (context) => {
    const user = context.get('auth').user
    const skillId = context.req.param('skillId')
    const current = await skillStore.findSkill(user.id, skillId)
    if (!current) {
      return apiError(context, 404, 'invalid_request', 'Skill not found')
    }
    const json = await readLimitedJson(context, MAX_SKILL_BODY_BYTES)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Skill is too large')
    }
    const parsedBody = json.ok ? SkillUpdateSchema.safeParse(json.value) : null
    if (!parsedBody?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid skill')
    }
    const files =
      parsedBody.data.files ??
      current.files.map((file) => ({ path: file.path, content: file.content }))
    let parsedBundle: ReturnType<typeof parseSkillBundle>
    try {
      parsedBundle = parseSkillBundle(files)
    } catch (error) {
      return apiError(
        context,
        400,
        'invalid_request',
        error instanceof SkillParseError ? error.message : 'Invalid skill'
      )
    }
    try {
      const skill = await skillStore.updateSkill(
        user.id,
        skillId,
        toSkillWrite(parsedBundle, parsedBody.data.enabled ?? current.enabled)
      )
      if (!skill) {
        return apiError(context, 404, 'invalid_request', 'Skill not found')
      }
      return context.json(
        SkillResponseSchema.parse({
          skill: {
            ...toSkillDetail(skill),
          },
        })
      )
    } catch (error) {
      if (/name|unique/iu.test(error instanceof Error ? error.message : '')) {
        return apiError(context, 409, 'conflict', 'Skill name already exists')
      }
      logger.warn('Could not update skill', {
        name: error instanceof Error ? error.name : 'unknown',
      })
      return apiError(context, 500, 'server_error', 'Could not update skill')
    }
  })

  app.delete(apiRoutes.skill, requireAuth, async (context) => {
    const removed = await skillStore.deleteSkill(
      context.get('auth').user.id,
      context.req.param('skillId')
    )
    if (!removed) {
      return apiError(context, 404, 'invalid_request', 'Skill not found')
    }
    return context.body(null, 204)
  })

  app.get(apiRoutes.mcpServers, requireAuth, async (context) => {
    const servers = await mcpStore.listServers(context.get('auth').user.id)
    return context.json(
      McpServersResponseSchema.parse({
        servers: await Promise.all(
          servers.map((server) => toMcpServerSummary(security, mcpOAuthStore, server))
        ),
      })
    )
  })

  app.get(apiRoutes.mcpRegistryServers, requireAuth, async (context) => {
    const search = (context.req.query('search') ?? '').trim()
    const cursor = context.req.query('cursor')?.trim()
    const limitValue = context.req.query('limit')?.trim()
    if (search.length > 128 || (cursor?.length ?? 0) > 4096) {
      return apiError(context, 400, 'invalid_request', 'Invalid MCP Registry query')
    }
    const limit = limitValue === undefined ? 30 : Number(limitValue)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      return apiError(context, 400, 'invalid_request', 'Invalid MCP Registry page size')
    }
    try {
      return context.json(
        await fetchOfficialMcpRegistryServers({
          search,
          ...(cursor ? { cursor } : {}),
          limit,
          signal: context.req.raw.signal,
          fetchImpl: mcpRegistryFetchImpl,
        })
      )
    } catch (error) {
      if (error instanceof McpRegistrySearchTooShortError) {
        return apiError(context, 400, 'invalid_request', error.message)
      }
      if (error instanceof McpRegistryUpstreamError) {
        return apiError(context, 502, 'upstream_error', error.message)
      }
      logger.warn('MCP Registry request failed', {
        name: error instanceof Error ? error.name : 'unknown',
      })
      return apiError(context, 502, 'upstream_error', 'MCP Registry request failed')
    }
  })

  app.post(apiRoutes.mcpServers, requireAuth, async (context) => {
    const json = await readLimitedJson(context, MAX_MCP_CONFIG_BODY_BYTES)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'MCP server configuration is too large')
    }
    const parsed = json.ok ? McpServerInputSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid MCP server configuration')
    }
    try {
      assertAllowedMcpUrl(parsed.data.url, mcpAllowPrivateNetwork)
    } catch (error) {
      return apiError(
        context,
        400,
        'invalid_request',
        error instanceof Error ? error.message : 'Invalid MCP server URL'
      )
    }
    const user = context.get('auth').user
    const serverId = crypto.randomUUID()
    try {
      const server = await mcpStore.createServer({
        id: serverId,
        userId: user.id,
        name: parsed.data.name,
        slug: parsed.data.slug,
        url: parsed.data.url,
        authMode: parsed.data.authMode,
        trustMode: parsed.data.trustMode,
        enabled: parsed.data.enabled,
        encryptedHeaders:
          (await encryptMcpHeaders(security, user.id, serverId, parsed.data.headers)) ?? null,
      })
      return context.json(
        McpServerResponseSchema.parse({
          server: await toMcpServerSummary(security, mcpOAuthStore, server),
        }),
        201
      )
    } catch (error) {
      if (/slug|unique/iu.test(error instanceof Error ? error.message : '')) {
        return apiError(context, 409, 'conflict', 'MCP server slug already exists')
      }
      logger.warn('Could not create MCP server', {
        name: error instanceof Error ? error.name : 'unknown',
      })
      return apiError(context, 500, 'server_error', 'Could not create MCP server')
    }
  })

  app.put(apiRoutes.mcpServer, requireAuth, async (context) => {
    const user = context.get('auth').user
    const serverId = context.req.param('serverId')
    const current = await mcpStore.findServer(user.id, serverId)
    if (!current) {
      return apiError(context, 404, 'invalid_request', 'MCP server not found')
    }
    const json = await readLimitedJson(context, MAX_MCP_CONFIG_BODY_BYTES)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'MCP server configuration is too large')
    }
    const parsed = json.ok ? McpServerUpdateSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid MCP server configuration')
    }
    if (parsed.data.url) {
      try {
        assertAllowedMcpUrl(parsed.data.url, mcpAllowPrivateNetwork)
      } catch (error) {
        return apiError(
          context,
          400,
          'invalid_request',
          error instanceof Error ? error.message : 'Invalid MCP server URL'
        )
      }
    }
    try {
      const server = await mcpStore.updateServer(user.id, serverId, {
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.slug === undefined ? {} : { slug: parsed.data.slug }),
        ...(parsed.data.url === undefined ? {} : { url: parsed.data.url }),
        ...(parsed.data.authMode === undefined ? {} : { authMode: parsed.data.authMode }),
        ...(parsed.data.trustMode === undefined ? {} : { trustMode: parsed.data.trustMode }),
        ...(parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }),
        ...(parsed.data.headers === undefined
          ? {}
          : {
              encryptedHeaders: await encryptMcpHeaders(
                security,
                user.id,
                serverId,
                parsed.data.headers
              ),
            }),
      })
      if (!server) {
        return apiError(context, 404, 'invalid_request', 'MCP server not found')
      }
      if (server.authMode === 'static') {
        await mcpOAuthStore.delete(user.id, server.id)
      }
      return context.json(
        McpServerResponseSchema.parse({
          server: await toMcpServerSummary(security, mcpOAuthStore, server),
        })
      )
    } catch (error) {
      if (/slug|unique/iu.test(error instanceof Error ? error.message : '')) {
        return apiError(context, 409, 'conflict', 'MCP server slug already exists')
      }
      logger.warn('Could not update MCP server', {
        name: error instanceof Error ? error.name : 'unknown',
      })
      return apiError(context, 500, 'server_error', 'Could not update MCP server')
    }
  })

  app.delete(apiRoutes.mcpServer, requireAuth, async (context) => {
    const user = context.get('auth').user
    const serverId = context.req.param('serverId')
    const removed = await mcpStore.deleteServer(user.id, serverId)
    if (!removed) {
      return apiError(context, 404, 'invalid_request', 'MCP server not found')
    }
    await mcpOAuthStore.delete(user.id, serverId)
    return context.body(null, 204)
  })

  app.post(apiRoutes.mcpServerProbe, requireAuth, async (context) => {
    const server = await mcpStore.findServer(
      context.get('auth').user.id,
      context.req.param('serverId')
    )
    if (!server) {
      return apiError(context, 404, 'invalid_request', 'MCP server not found')
    }
    let config: McpConnectionConfig
    try {
      assertAllowedMcpUrl(server.url, mcpAllowPrivateNetwork)
      config = await mcpConnectionConfig(server)
    } catch (error) {
      if (error instanceof McpOAuthRequiredError) {
        return context.json(
          McpProbeResponseSchema.parse({
            ok: false,
            stage: 'connect',
            message: error.message,
            durationMs: 0,
          })
        )
      }
      return apiError(
        context,
        500,
        'credential_error',
        error instanceof Error ? error.message : 'Could not read MCP server credentials'
      )
    }
    const result = await mcpClient.probe(config, context.req.raw.signal)
    if (!result.ok) {
      return context.json(
        McpProbeResponseSchema.parse({
          ok: false,
          stage: result.stage,
          message: result.message,
          durationMs: result.durationMs,
        })
      )
    }
    try {
      return context.json(
        McpProbeResponseSchema.parse({
          ok: true,
          server: result.server,
          tools: await toMcpToolSummaries(server, result.tools),
          durationMs: result.durationMs,
        })
      )
    } catch (error) {
      return context.json(
        McpProbeResponseSchema.parse({
          ok: false,
          stage: 'list',
          message: error instanceof Error ? error.message : 'Invalid MCP tool list',
          durationMs: result.durationMs,
        })
      )
    }
  })

  app.post(apiRoutes.mcpServerOAuthStart, requireAuth, async (context) => {
    const user = context.get('auth').user
    const server = await mcpStore.findServer(user.id, context.req.param('serverId'))
    if (!server || server.authMode !== 'oauth') {
      return apiError(context, 404, 'invalid_request', 'OAuth-enabled MCP server not found')
    }
    try {
      assertAllowedMcpUrl(server.url, mcpAllowPrivateNetwork)
    } catch (error) {
      return apiError(
        context,
        400,
        'invalid_request',
        error instanceof Error ? error.message : 'Invalid MCP server URL'
      )
    }
    let headers: McpHeaders
    try {
      headers = await readMcpHeaders(security, server)
    } catch (error) {
      return apiError(
        context,
        500,
        'credential_error',
        error instanceof Error ? error.message : 'Could not read MCP server credentials'
      )
    }
    const existing = await mcpOAuthStore.find(user.id, server.id)
    const existingPayload = existing ? await readMcpOAuthPayload(existing) : {}
    const now = new Date().toISOString()
    const state = security.createToken()
    const baseRecord: McpOAuthRecord = {
      userId: user.id,
      serverId: server.id,
      state,
      encryptedPayload: await encryptMcpOAuthPayload(security, user.id, server.id, existingPayload),
      connected: existing?.connected ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    }
    await mcpOAuthStore.upsert(baseRecord)
    const provider = createMcpOAuthProvider(server, baseRecord, existingPayload)
    try {
      await mcpClient.beginOAuth(
        {
          url: server.url,
          headers,
          trustMode: server.trustMode,
          authProvider: provider,
        },
        provider,
        context.req.raw.signal
      )
      const authorizationUrl = provider.getAuthorizationUrl()
      if (!authorizationUrl) {
        return apiError(
          context,
          502,
          'upstream_error',
          'MCP OAuth did not return an authorization URL'
        )
      }
      assertAllowedMcpUrl(authorizationUrl, mcpAllowPrivateNetwork)
      return context.json(McpOAuthStartResponseSchema.parse({ authorizationUrl }))
    } catch (error) {
      logger.warn('MCP OAuth start failed', {
        serverId: server.id,
        name: error instanceof Error ? error.name : 'unknown',
      })
      return apiError(context, 502, 'upstream_error', 'MCP OAuth start failed')
    }
  })

  app.get(apiRoutes.mcpOAuthCallback, requireAuth, async (context) => {
    const auth = context.get('auth')
    const state = context.req.query('state')?.trim()
    const record = state ? await mcpOAuthStore.findByState(state) : null
    if (!record) {
      return mcpOAuthResultPage(false, '', 'MCP authorization state is invalid or expired.')
    }
    return await completeMcpOAuthCallback(
      context,
      auth,
      record,
      new URL(context.req.url).searchParams
    )
  })

  app.post(apiRoutes.mcpServerOAuthDisconnect, requireAuth, async (context) => {
    const user = context.get('auth').user
    const server = await mcpStore.findServer(user.id, context.req.param('serverId'))
    if (!server) {
      return apiError(context, 404, 'invalid_request', 'MCP server not found')
    }
    await mcpOAuthStore.delete(user.id, server.id)
    return context.body(null, 204)
  })

  app.get(apiRoutes.mcpTools, requireAuth, async (context) => {
    const user = context.get('auth').user
    const servers = (await mcpStore.listServers(user.id)).filter((server) => server.enabled)
    const collected = (
      await Promise.all(
        servers.map(async (server): Promise<McpToolSummary[]> => {
          try {
            assertAllowedMcpUrl(server.url, mcpAllowPrivateNetwork)
            const config = await mcpConnectionConfig(server)
            const result = await mcpClient.probe(config, context.req.raw.signal)
            if (!result.ok) {
              logger.warn('MCP server tool discovery failed', {
                serverId: server.id,
                stage: result.stage,
              })
              return []
            }
            return await toMcpToolSummaries(server, result.tools)
          } catch (error) {
            logger.warn('MCP server tool discovery failed', {
              serverId: server.id,
              name: error instanceof Error ? error.name : 'unknown',
            })
            return []
          }
        })
      )
    ).flat()
    return context.json(McpToolsResponseSchema.parse({ tools: collected }))
  })

  app.post(apiRoutes.mcpToolCall, requireAuth, async (context) => {
    if (contentLengthExceeds(context, MAX_MCP_CALL_BODY_BYTES)) {
      return apiError(context, 413, 'invalid_request', 'MCP tool call is too large')
    }
    const json = await readLimitedJson(context, MAX_MCP_CALL_BODY_BYTES)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'MCP tool call is too large')
    }
    const parsed = json.ok ? McpToolCallRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid MCP tool call')
    }
    const user = context.get('auth').user
    const server = await mcpStore.findServer(user.id, parsed.data.serverId)
    if (!server || !server.enabled) {
      return apiError(context, 404, 'invalid_request', 'MCP server not found')
    }
    let config: McpConnectionConfig
    try {
      assertAllowedMcpUrl(server.url, mcpAllowPrivateNetwork)
      config = await mcpConnectionConfig(server)
    } catch (error) {
      if (error instanceof McpOAuthRequiredError) {
        return apiError(context, 409, 'mcp_auth_required', error.message)
      }
      return apiError(
        context,
        502,
        'upstream_error',
        error instanceof Error ? error.message : 'Could not read MCP server configuration'
      )
    }
    try {
      const result = await mcpClient.callTool(
        config,
        parsed.data.rawName,
        parsed.data.arguments,
        parsed.data.approved,
        context.req.raw.signal
      )
      return context.json(McpToolCallResponseSchema.parse(result))
    } catch (error) {
      if (error instanceof McpToolNotFoundError) {
        return apiError(context, 404, 'invalid_request', 'MCP tool not found')
      }
      if (error instanceof McpApprovalRequiredError) {
        return apiError(context, 403, 'forbidden', 'MCP tool requires explicit approval')
      }
      if (context.req.raw.signal.aborted) {
        return new Response(null, { status: 499 })
      }
      logger.warn('MCP tool call failed', {
        serverId: server.id,
        name: error instanceof Error ? error.name : 'unknown',
      })
      return apiError(context, 502, 'upstream_error', 'MCP tool call failed')
    }
  })

  app.post(apiRoutes.logout, requireAuth, async (context) => {
    await store.deleteSession(context.get('auth').sessionTokenHash)
    deleteCookie(context, SESSION_COOKIE, { path: '/' })
    return context.body(null, 204)
  })

  app.post(apiRoutes.shares, requireAuth, async (context) => {
    if (contentLengthExceeds(context, MAX_SHARE_BODY_BYTES)) {
      return apiError(context, 413, 'invalid_request', 'Shared session is too large')
    }
    const json = await readLimitedJson(context, MAX_SHARE_BODY_BYTES)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Shared session is too large')
    }
    const parsed = json.ok ? ShareCreateRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid share request')
    }
    const expiresAt = new Date(
      Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000
    ).toISOString()
    const record = await shareStore.createShare(
      context.get('auth').user.id,
      toSharedSessionPayload(parsed.data.session),
      expiresAt
    )
    const url = new URL(`/?share=${encodeURIComponent(record.token)}`, appOrigin).toString()
    return context.json(
      ShareCreateResponseSchema.parse({
        share: { token: record.token, url, expiresAt: record.expiresAt },
      })
    )
  })

  app.get(apiRoutes.sharedSession, async (context) => {
    const token = context.req.param('token')
    if (!SHARE_TOKEN_PATTERN.test(token)) {
      return apiError(context, 404, 'invalid_request', 'Shared session not found')
    }
    const record = await shareStore.getShare(token)
    if (!record) {
      context.header('Cache-Control', 'no-store')
      return apiError(context, 404, 'invalid_request', 'Shared session not found')
    }
    context.header('Cache-Control', 'no-store')
    return context.json(
      SharedSessionResponseSchema.parse({
        share: {
          session: record.session,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
        },
      })
    )
  })

  app.get(apiRoutes.deepseekKey, requireAuth, (context) => {
    const body: ApiKeyStatusResponse = {
      configured: Boolean(context.get('auth').user.apiKey),
    }
    return context.json(ApiKeyStatusResponseSchema.parse(body))
  })

  app.put(apiRoutes.deepseekKey, requireAuth, async (context) => {
    const json = await readLimitedJson(context, bodyLimits.apiKey)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'API key payload is too large')
    }
    const parsed = json.ok ? ApiKeyRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid API key payload')
    }
    const user = context.get('auth').user
    const verification = await fetchImpl(`${deepSeekBaseUrl.replace(/\/+$/u, '')}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${parsed.data.apiKey}` },
      signal: AbortSignal.timeout(20_000),
      redirect: UPSTREAM_REDIRECT_MODE,
    }).catch(() => null)
    if (!verification) {
      return apiError(context, 502, 'upstream_error', 'Could not verify the DeepSeek API key')
    }
    if (verification.status === 401 || verification.status === 403) {
      return apiError(context, 400, 'invalid_api_key', 'DeepSeek rejected the API key')
    }
    if (!verification.ok) {
      return apiError(context, 502, 'upstream_error', 'DeepSeek API key verification failed')
    }
    const encrypted = await security.encryptApiKey(user.id, parsed.data.apiKey)
    await store.setApiKey(user.id, encrypted)
    const body: ApiKeyStatusResponse = { configured: true }
    return context.json(body)
  })

  app.delete(apiRoutes.deepseekKey, requireAuth, async (context) => {
    const user = context.get('auth').user
    await store.clearApiKey(user.id)
    const body: ApiKeyStatusResponse = { configured: false }
    return context.json(body)
  })

  const deepSeekToolRequest = async (
    context: Context<AppEnv>,
    path: string,
    body: unknown,
    credential: string
  ): Promise<Response> =>
    await fetchImpl(`${deepSeekBaseUrl.replace(/\/+$/u, '')}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([
        context.req.raw.signal,
        AbortSignal.timeout(60_000),
      ]),
      redirect: UPSTREAM_REDIRECT_MODE,
    })

  const deepSeekToolFailure = async (
    context: Context<AppEnv>,
    response: Response,
    action: string
  ): Promise<Response> => {
    if (response.status === 401) {
      return apiError(context, 400, 'invalid_api_key', 'DeepSeek rejected the API key')
    }
    const sanitizedMessage = await response
      .json()
      .then((value) =>
        isRecord(value) &&
        isRecord(value.error) &&
        typeof value.error.message === 'string'
          ? value.error.message.slice(0, 500)
          : null
      )
      .catch(() => null)
    const status = [402, 403, 404, 408, 413, 429].includes(response.status)
      ? (response.status as ContentfulStatusCode)
      : 502
    return apiError(
      context,
      status,
      'upstream_error',
      sanitizedMessage ?? `DeepSeek ${action} request failed`
    )
  }

  app.post(apiRoutes.deepseekSearch, requireAuth, async (context) => {
    const json = await readLimitedJson(context, bodyLimits.settings)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Search payload is too large')
    }
    const parsed = json.ok ? DeepSeekSearchRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid search request')
    }
    const credential = await requireApiKey(context)
    if (!credential.ok) {
      return credential.response
    }
    let response: Response
    try {
      response = await deepSeekToolRequest(
        context,
        '/v1/tools/search',
        parsed.data,
        credential.apiKey
      )
    } catch {
      return apiError(context, 502, 'upstream_error', 'DeepSeek search request failed')
    }
    if (!response.ok) {
      return await deepSeekToolFailure(context, response, 'search')
    }
    const payload = DeepSeekSearchResponseSchema.safeParse(
      await response.json().catch(() => null)
    )
    if (!payload.success) {
      return apiError(context, 502, 'upstream_error', 'DeepSeek returned an invalid search result')
    }
    return context.json(payload.data)
  })

  app.post(apiRoutes.deepseekFetch, requireAuth, async (context) => {
    const json = await readLimitedJson(context, bodyLimits.settings)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Fetch payload is too large')
    }
    const parsed = json.ok ? DeepSeekFetchRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid fetch request')
    }
    const credential = await requireApiKey(context)
    if (!credential.ok) {
      return credential.response
    }
    let response: Response
    try {
      response = await deepSeekToolRequest(
        context,
        '/v1/tools/fetch',
        parsed.data,
        credential.apiKey
      )
    } catch {
      return apiError(context, 502, 'upstream_error', 'DeepSeek fetch request failed')
    }
    if (!response.ok) {
      return await deepSeekToolFailure(context, response, 'fetch')
    }
    const payload = DeepSeekFetchResponseSchema.safeParse(
      await response.json().catch(() => null)
    )
    if (!payload.success) {
      return apiError(context, 502, 'upstream_error', 'DeepSeek returned an invalid fetch result')
    }
    return context.json(payload.data)
  })

  app.get(apiRoutes.providers, requireAuth, async (context) => {
    const user = context.get('auth').user
    const stored = await providerStore.listProviders(user.id)
    const providers = [
      { ...DEEPSEEK_PROVIDER, configured: Boolean(user.apiKey) },
      ...stored.map((record) =>
        providerSummary(record, record.encryptedApiKey !== null)
      ),
    ]
    return context.json(
      ProvidersResponseSchema.parse({
        providers,
        templates: providerTemplates(),
      })
    )
  })

  app.post(apiRoutes.providers, requireAuth, async (context) => {
    const json = await readLimitedJson(context, bodyLimits.settings)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Provider payload is too large')
    }
    const parsed = json.ok ? ProviderCreateRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid provider payload')
    }
    const template = providerTemplates().find(
      (candidate) => candidate.id === parsed.data.templateId
    )
    if (!template) {
      return apiError(context, 400, 'invalid_request', 'Unknown provider template')
    }
    if (!template.authModes.includes('api_key')) {
      return apiError(
        context,
        400,
        'invalid_request',
        'This provider currently requires OAuth authentication'
      )
    }
    const user = context.get('auth').user
    const providerId =
      template.kind === 'builtin'
        ? template.id
        : `custom-${crypto.randomUUID()}`
    if (await providerStore.findProvider(user.id, providerId)) {
      return apiError(context, 409, 'conflict', 'Provider is already configured')
    }
    if (template.kind === 'custom' && !parsed.data.baseUrl) {
      return apiError(context, 400, 'invalid_request', 'Custom provider requires a base URL')
    }
    if (template.kind === 'custom' && !parsed.data.models?.length) {
      return apiError(context, 400, 'invalid_request', 'Custom provider requires models')
    }
    if (parsed.data.baseUrl) {
      try {
        assertAllowedMcpUrl(parsed.data.baseUrl, mcpAllowPrivateNetwork)
      } catch {
        return apiError(context, 400, 'invalid_request', 'Invalid provider base URL')
      }
    }
    const api = template.kind === 'custom' ? template.api : null
    if (template.kind === 'custom' && !api) {
      return apiError(context, 400, 'invalid_request', 'Custom provider requires an API')
    }
    const encryptedApiKey = await security.encryptValue(
      providerCredentialAad(user.id, providerId),
      parsed.data.apiKey
    )
    const record = await providerStore.createProvider(user.id, {
      id: providerId,
      kind: template.kind,
      name: parsed.data.name ?? template.name,
      api: api ?? null,
      baseUrl: parsed.data.baseUrl ?? null,
      models: template.kind === 'custom' ? (parsed.data.models ?? []) : [],
      encryptedApiKey,
    })
    return context.json(
      ProviderResponseSchema.parse({
        provider: providerSummary(record, true),
      })
    )
  })

  app.put(apiRoutes.provider, requireAuth, async (context) => {
    const providerId = context.req.param('providerId')
    const user = context.get('auth').user
    const current = await providerStore.findProvider(user.id, providerId)
    if (!current) {
      return apiError(context, 404, 'invalid_request', 'Provider not found')
    }
    const json = await readLimitedJson(context, bodyLimits.settings)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Provider payload is too large')
    }
    const parsed = json.ok ? ProviderUpdateRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid provider payload')
    }
    if (current.kind === 'custom' && parsed.data.baseUrl === null) {
      return apiError(context, 400, 'invalid_request', 'Custom provider requires a base URL')
    }
    if (parsed.data.baseUrl) {
      try {
        assertAllowedMcpUrl(parsed.data.baseUrl, mcpAllowPrivateNetwork)
      } catch {
        return apiError(context, 400, 'invalid_request', 'Invalid provider base URL')
      }
    }
    const encryptedApiKey =
      parsed.data.apiKey === undefined
        ? current.encryptedApiKey
        : parsed.data.apiKey === null
          ? null
          : await security.encryptValue(
              providerCredentialAad(user.id, providerId),
              parsed.data.apiKey
            )
    const record = await providerStore.updateProvider(user.id, providerId, {
      id: current.id,
      kind: current.kind,
      name: parsed.data.name ?? current.name,
      api: current.api,
      baseUrl:
        parsed.data.baseUrl === undefined
          ? current.baseUrl
          : parsed.data.baseUrl,
      models:
        current.kind === 'custom' && parsed.data.models
          ? parsed.data.models
          : current.models,
      encryptedApiKey,
    })
    if (!record) {
      return apiError(context, 404, 'invalid_request', 'Provider not found')
    }
    return context.json(
      ProviderResponseSchema.parse({
        provider: providerSummary(record, record.encryptedApiKey !== null),
      })
    )
  })

  app.delete(apiRoutes.provider, requireAuth, async (context) => {
    const deleted = await providerStore.deleteProvider(
      context.get('auth').user.id,
      context.req.param('providerId')
    )
    if (!deleted) {
      return apiError(context, 404, 'invalid_request', 'Provider not found')
    }
    return context.body(null, 204)
  })

  app.get(apiRoutes.syncSessions, requireAuth, async (context) => {
    const userId = context.get('auth').user.id
    const body = SyncSessionsResponseSchema.parse({
      sessions: await syncStore.listSessions(userId),
    })
    return context.json(body)
  })

  app.delete(apiRoutes.syncSessions, requireAuth, async (context) => {
    await syncStore.clearSessions(context.get('auth').user.id)
    return context.body(null, 204)
  })

  app.get(apiRoutes.syncSession, requireAuth, async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!/^[\w-]{1,200}$/u.test(sessionId)) {
      return apiError(context, 400, 'invalid_request', 'Invalid session ID')
    }
    const record = await syncStore.getSession(context.get('auth').user.id, sessionId)
    if (!record || record.deletedAt !== null) {
      return apiError(context, 404, 'invalid_request', 'Session not found')
    }
    return context.json(SyncSessionResponseSchema.parse({ session: record }))
  })

  app.put(apiRoutes.syncSession, requireAuth, async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!/^[\w-]{1,200}$/u.test(sessionId)) {
      return apiError(context, 400, 'invalid_request', 'Invalid session ID')
    }
    const json = await readLimitedJson(context, bodyLimits.sync)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Session payload is too large')
    }
    const parsed = json.ok ? SyncUpsertRequestSchema.safeParse(json.value) : null
    if (!parsed?.success || parsed.data.payload.id !== sessionId) {
      return apiError(context, 400, 'invalid_request', 'Invalid session sync payload')
    }
    try {
      const record = await syncStore.putSession(
        context.get('auth').user.id,
        sessionId,
        parsed.data.baseRevision,
        parsed.data.payload
      )
      return context.json(SyncSessionResponseSchema.parse({ session: record }))
    } catch (error) {
      if (error instanceof SyncConflictError) {
        return apiError(context, 409, 'sync_conflict', 'Session changed on another device')
      }
      throw error
    }
  })

  app.delete(apiRoutes.syncSession, requireAuth, async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!/^[\w-]{1,200}$/u.test(sessionId)) {
      return apiError(context, 400, 'invalid_request', 'Invalid session ID')
    }
    const json = await readLimitedJson(context, bodyLimits.settings)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Session delete payload is too large')
    }
    const parsed = json.ok ? SyncDeleteRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid session delete payload')
    }
    try {
      const record = await syncStore.deleteSession(
        context.get('auth').user.id,
        sessionId,
        parsed.data.baseRevision,
        parsed.data.deletedAt
      )
      return context.json(SyncSessionResponseSchema.parse({ session: record }))
    } catch (error) {
      if (error instanceof SyncConflictError) {
        return apiError(context, 409, 'sync_conflict', 'Session changed on another device')
      }
      throw error
    }
  })

  app.get(apiRoutes.syncSettings, requireAuth, async (context) => {
    const settings = await syncStore.getSettings(context.get('auth').user.id)
    return context.json(SyncSettingsResponseSchema.parse({ settings }))
  })

  app.put(apiRoutes.syncSettings, requireAuth, async (context) => {
    const json = await readLimitedJson(context, bodyLimits.settings)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Settings payload is too large')
    }
    const parsed = json.ok ? SyncSettingsUpdateRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid settings sync payload')
    }
    try {
      const settings = await syncStore.putSettings(
        context.get('auth').user.id,
        parsed.data.baseRevision,
        parsed.data.payload
      )
      return context.json(SyncSettingsResponseSchema.parse({ settings }))
    } catch (error) {
      if (error instanceof SyncSettingsConflictError) {
        return apiError(context, 409, 'sync_conflict', 'Settings changed on another device')
      }
      throw error
    }
  })

  app.post(apiRoutes.files, requireAuth, async (context) => {
    const credential = await requireApiKey(context)
    if (!credential.ok) {
      return credential.response
    }
    const limit = MAX_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
    if (contentLengthExceeds(context, limit)) {
      return apiError(context, 413, 'invalid_request', 'Attachment is too large')
    }
    const contentType = readMultipartContentType(context)
    const body = context.req.raw.body
    if (!contentType || !body) {
      return apiError(context, 400, 'invalid_request', 'Invalid multipart upload')
    }
    const clientSignal = context.req.raw.signal
    let response: Response
    try {
      response = await fetchImpl(`${deepSeekBaseUrl.replace(/\/+$/u, '')}/anthropic/v1/files`, {
        method: 'POST',
        headers: {
          'x-api-key': credential.apiKey,
          'anthropic-beta': 'files-api-2025-04-14',
          'Content-Type': contentType,
        },
        body: limitRequestBody(body, limit),
        signal: createProxySignal(context),
        redirect: UPSTREAM_REDIRECT_MODE,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' })
    } catch (error) {
      if (hasTooLargeCause(error)) {
        return apiError(context, 413, 'invalid_request', 'Attachment is too large')
      }
      return proxyFailure(context, error, clientSignal)
    }
    if (!response.ok) {
      return forwardUpstreamError(context, response)
    }
    const parsed = FileObjectResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) {
      return apiError(context, 502, 'upstream_error', 'DeepSeek returned an invalid file object')
    }
    return context.json(parsed.data)
  })

  app.delete(apiRoutes.file, requireAuth, async (context) => {
    const credential = await requireApiKey(context)
    if (!credential.ok) {
      return credential.response
    }
    const fileId = context.req.param('fileId')
    if (!/^[\w-]{1,200}$/u.test(fileId)) {
      return apiError(context, 400, 'invalid_request', 'Invalid file ID')
    }
    const clientSignal = context.req.raw.signal
    let response: Response
    try {
      response = await fetchImpl(
        `${deepSeekBaseUrl.replace(/\/+$/u, '')}/anthropic/v1/files/${encodeURIComponent(fileId)}`,
        {
          method: 'DELETE',
          headers: {
            'x-api-key': credential.apiKey,
            'anthropic-beta': 'files-api-2025-04-14',
          },
          signal: createProxySignal(context),
          redirect: UPSTREAM_REDIRECT_MODE,
        }
      )
    } catch (error) {
      return proxyFailure(context, error, clientSignal)
    }
    if (!response.ok) {
      return forwardUpstreamError(context, response)
    }
    return context.body(null, 204)
  })

  app.post(apiRoutes.speechAsr, requireAuth, async (context) => {
    const credential = await requireApiKey(context)
    if (!credential.ok) {
      return credential.response
    }
    const limit = MAX_AUDIO_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
    if (contentLengthExceeds(context, limit)) {
      return apiError(context, 413, 'invalid_request', 'Audio is too large')
    }
    const contentType = readMultipartContentType(context)
    const body = context.req.raw.body
    if (!contentType || !body) {
      return apiError(context, 400, 'invalid_request', 'Invalid multipart upload')
    }
    const clientSignal = context.req.raw.signal
    let response: Response
    try {
      response = await fetchImpl(`${deepSeekBaseUrl.replace(/\/+$/u, '')}/v1/tools/asr`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.apiKey}`,
          'Content-Type': contentType,
        },
        body: limitRequestBody(body, limit),
        signal: createProxySignal(context),
        redirect: UPSTREAM_REDIRECT_MODE,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' })
    } catch (error) {
      if (hasTooLargeCause(error)) {
        return apiError(context, 413, 'invalid_request', 'Audio is too large')
      }
      return proxyFailure(context, error, clientSignal)
    }
    if (!response.ok) {
      return forwardUpstreamError(context, response)
    }
    const parsed = SpeechTranscriptionResponseSchema.safeParse(
      await response.json().catch(() => null)
    )
    if (!parsed.success) {
      return apiError(context, 502, 'upstream_error', 'DeepSeek returned an invalid transcript')
    }
    return context.json(parsed.data)
  })

  app.post(apiRoutes.speechTts, requireAuth, async (context) => {
    const credential = await requireApiKey(context)
    if (!credential.ok) {
      return credential.response
    }
    const json = await readLimitedJson(context, bodyLimits.speech)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Speech synthesis request is too large')
    }
    const parsed = json.ok ? SpeechSynthesisRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid speech synthesis request')
    }
    const clientSignal = context.req.raw.signal
    let response: Response
    try {
      response = await fetchImpl(`${deepSeekBaseUrl.replace(/\/+$/u, '')}/v1/tools/tts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsed.data),
        signal: createProxySignal(context),
        redirect: UPSTREAM_REDIRECT_MODE,
      })
    } catch (error) {
      return proxyFailure(context, error, clientSignal)
    }
    if (!response.ok) {
      return forwardUpstreamError(context, response)
    }
    if (!response.body) {
      return apiError(context, 502, 'upstream_error', 'DeepSeek returned empty audio')
    }
    const headers = new Headers()
    const contentType = response.headers.get('content-type')
    if (contentType) {
      headers.set('Content-Type', contentType)
    }
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  })

  app.post(apiRoutes.chat, requireAuth, async (context) => {
    const json = await readLimitedJson(context, bodyLimits.chat)
    if (json === 'too-large') {
      return apiError(context, 413, 'invalid_request', 'Chat request is too large')
    }
    const parsed = json.ok ? ChatProxyRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      const issues =
        parsed?.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path.join('.') || 'body',
          code: issue.code,
        })) ?? [{ path: 'body', code: 'invalid_json' }]
      logger.warn('Rejected invalid chat request', { issues })
      return apiError(
        context,
        400,
        'invalid_request',
        `Invalid chat request: ${issues[0].path} (${issues[0].code})`
      )
    }

    const user = context.get('auth').user
    const providerId = parsed.data.providerId
    if (providerId !== 'deepseek') {
      const record = await providerStore.findProvider(user.id, providerId)
      if (!record || !record.encryptedApiKey) {
        return apiError(context, 409, 'api_key_missing', 'A provider API key is required')
      }
      const apiKey = await security
        .decryptValue(
          providerCredentialAad(user.id, providerId),
          record.encryptedApiKey
        )
        .catch(() => null)
      if (!apiKey) {
        return apiError(
          context,
          500,
          'credential_error',
          'Stored provider API key could not be decrypted'
        )
      }
      try {
        return await createPiSseResponse(
          parsed.data,
          record,
          apiKey,
          createProxySignal(context)
        )
      } catch (error) {
        logger.warn('Provider chat request failed', {
          providerId,
          message: error instanceof Error ? error.message : String(error),
        })
        return apiError(
          context,
          400,
          'invalid_request',
          error instanceof Error ? error.message : 'Provider request failed'
        )
      }
    }

    if (parsed.data.model !== 'deepseek-flash' && parsed.data.model !== 'deepseek-v4-pro') {
      return apiError(context, 400, 'invalid_request', 'Invalid DeepSeek model')
    }
    const credential = await requireApiKey(context)
    if (!credential.ok) {
      return credential.response
    }
    const clientSignal = context.req.raw.signal
    const signal = createProxySignal(context)
    const requestBody = { ...parsed.data, providerId: undefined, stream: true }
    const headers: Record<string, string> = {
      'x-api-key': credential.apiKey,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (hasFileBlocks(parsed.data.messages)) {
      headers['anthropic-beta'] = 'files-api-2025-04-14'
    }

    let response: Response
    try {
      response = await fetchImpl(`${deepSeekBaseUrl.replace(/\/+$/u, '')}/anthropic/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal,
        redirect: UPSTREAM_REDIRECT_MODE,
      })
    } catch (error) {
      return proxyFailure(context, error, clientSignal)
    }

    if (!response.ok && (response.status === 401 || response.status === 403)) {
      void response.body?.cancel().catch(() => {})
      return apiError(context, 400, 'invalid_api_key', 'DeepSeek rejected the API key')
    }
    if (!response.body) {
      return apiError(context, 502, 'upstream_error', 'DeepSeek returned an empty response')
    }
    const responseHeaders = new Headers()
    const contentType = response.headers.get('content-type')
    if (contentType) {
      responseHeaders.set('Content-Type', contentType)
    }
    responseHeaders.set('Cache-Control', 'no-store')
    responseHeaders.set('X-Accel-Buffering', 'no')
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  })

  return app
}
