import type { HealthResponse } from '@sweet-deepseek/contracts'
import {
  ApiKeyRequestSchema,
  ApiKeyStatusResponseSchema,
  ChatProxyRequestSchema,
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
  SyncDeleteRequestSchema,
  SyncSettingsResponseSchema,
  SyncSettingsUpdateRequestSchema,
  SyncSessionResponseSchema,
  SyncSessionsResponseSchema,
  SyncUpsertRequestSchema,
} from '@sweet-deepseek/contracts/sync'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AccountStore, GitHubProfile, UserRecord } from './account-store.js'
import type { SecurityService } from './security.js'
import {
  SyncConflictError,
  SyncSettingsConflictError,
  type SyncStore,
} from './sync-store.js'

const SESSION_COOKIE = 'sdom_session'
const OAUTH_STATE_COOKIE = 'sdom_oauth_state'
const OAUTH_STATE_TTL_SECONDS = 10 * 60
const OAUTH_STATE_PATH = '/api/auth/github'
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_API_VERSION = '2022-11-28'
const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024
const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024
const MAX_SYNC_BODY_BYTES = 20 * 1024 * 1024

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
  syncStore: SyncStore
  security: SecurityService
  appOrigin: string
  githubClientId: string
  githubClientSecret: string
  githubCallbackUrl: string
  deepSeekBaseUrl: string
  requestTimeoutMs: number
  sessionTtlMs: number
  cookieSecure: boolean
  cookieSameSite?: 'Lax' | 'Strict' | 'None'
  allowedOrigins?: string[]
  fetchImpl?: typeof fetch
}

type JsonResult = { ok: true; value: unknown } | { ok: false }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readJson = async (context: Context<AppEnv>): Promise<JsonResult> => {
  try {
    return { ok: true, value: await context.req.json<unknown>() }
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
  syncStore,
  security,
  appOrigin,
  githubClientId,
  githubClientSecret,
  githubCallbackUrl,
  deepSeekBaseUrl,
  requestTimeoutMs,
  sessionTtlMs,
  cookieSecure,
  cookieSameSite = 'Lax',
  allowedOrigins = [],
  fetchImpl = fetch,
}: AppOptions) => {
  const app = new Hono<AppEnv>()
  const trustedOrigins = new Set(
    [appOrigin, ...allowedOrigins].map((origin) => new URL(origin).origin)
  )

  app.use('/api/*', async (context, next) => {
    const origin = context.req.header('Origin')
    if (origin && !trustedOrigins.has(origin)) {
      return apiError(context, 403, 'forbidden', 'Cross-origin request rejected')
    }
    if (origin) {
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Access-Control-Allow-Credentials', 'true')
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

  const requireAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
    const token = getCookie(context, SESSION_COOKIE)
    if (!token) {
      return apiError(context, 401, 'unauthorized', 'Sign in with GitHub to continue')
    }
    const sessionTokenHash = await security.hashToken(token)
    const session = await store.findSessionByTokenHash(sessionTokenHash)
    if (!session) {
      deleteCookie(context, SESSION_COOKIE, { path: '/' })
      return apiError(context, 401, 'unauthorized', 'Session expired')
    }
    const user = await store.findUserById(session.userId)
    if (!user) {
      await store.deleteSession(sessionTokenHash)
      deleteCookie(context, SESSION_COOKIE, { path: '/' })
      return apiError(context, 401, 'unauthorized', 'Account not found')
    }
    context.set('auth', { user, sessionTokenHash })
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
      redirect: 'error',
    }).catch(() => null)
    if (!tokenResponse?.ok) {
      return authRedirect(context, 'error', 'oauth_exchange')
    }
    const accessToken = readGitHubToken(await tokenResponse.json().catch(() => null))
    if (!accessToken) {
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
      redirect: 'error',
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

  app.post(apiRoutes.logout, requireAuth, async (context) => {
    await store.deleteSession(context.get('auth').sessionTokenHash)
    deleteCookie(context, SESSION_COOKIE, { path: '/' })
    return context.body(null, 204)
  })

  app.get(apiRoutes.deepseekKey, requireAuth, (context) => {
    const body: ApiKeyStatusResponse = {
      configured: Boolean(context.get('auth').user.apiKey),
    }
    return context.json(ApiKeyStatusResponseSchema.parse(body))
  })

  app.put(apiRoutes.deepseekKey, requireAuth, async (context) => {
    const json = await readJson(context)
    const parsed = json.ok ? ApiKeyRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid API key payload')
    }
    const user = context.get('auth').user
    const verification = await fetchImpl(`${deepSeekBaseUrl.replace(/\/+$/u, '')}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${parsed.data.apiKey}` },
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
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
    if (contentLengthExceeds(context, MAX_SYNC_BODY_BYTES)) {
      return apiError(context, 413, 'invalid_request', 'Session payload is too large')
    }
    const json = await readJson(context)
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
    const json = await readJson(context)
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
    const json = await readJson(context)
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
        redirect: 'error',
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
          redirect: 'error',
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
        redirect: 'error',
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
    const json = await readJson(context)
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
        redirect: 'error',
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
    const credential = await requireApiKey(context)
    if (!credential.ok) {
      return credential.response
    }
    const json = await readJson(context)
    const parsed = json.ok ? ChatProxyRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid chat request')
    }

    const clientSignal = context.req.raw.signal
    const signal = createProxySignal(context)
    const requestBody = { ...parsed.data, stream: true }
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
        redirect: 'error',
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
