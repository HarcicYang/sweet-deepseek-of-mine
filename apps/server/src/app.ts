import type { HealthResponse } from '@sweet-deepseek/contracts'
import {
  ApiKeyRequestSchema,
  ApiKeyStatusResponseSchema,
  ChatProxyRequestSchema,
  SessionResponseSchema,
  apiRoutes,
  type ApiErrorCode,
  type ApiErrorResponse,
  type ApiKeyStatusResponse,
  type AuthUser,
  type SessionResponse,
} from '@sweet-deepseek/contracts/api'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AccountStore, GitHubProfile, UserRecord } from './account-store.js'
import type { SecurityService } from './security.js'

const SESSION_COOKIE = 'sdom_session'
const OAUTH_STATE_COOKIE = 'sdom_oauth_state'
const OAUTH_STATE_TTL_SECONDS = 10 * 60
const OAUTH_STATE_PATH = '/api/auth/github'
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_API_VERSION = '2022-11-28'

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
  security: SecurityService
  appOrigin: string
  githubClientId: string
  githubClientSecret: string
  githubCallbackUrl: string
  deepSeekBaseUrl: string
  requestTimeoutMs: number
  sessionTtlMs: number
  cookieSecure: boolean
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
    typeof value.login !== 'string' ||
    value.login.trim() === ''
  ) {
    return null
  }
  const avatarUrl =
    value.avatar_url === null
      ? null
      : typeof value.avatar_url === 'string' && URL.canParse(value.avatar_url)
        ? value.avatar_url
        : null
  return {
    githubId: String(value.id),
    githubLogin: value.login,
    avatarUrl,
  }
}

export const createApp = ({
  store,
  security,
  appOrigin,
  githubClientId,
  githubClientSecret,
  githubCallbackUrl,
  deepSeekBaseUrl,
  requestTimeoutMs,
  sessionTtlMs,
  cookieSecure,
  fetchImpl = fetch,
}: AppOptions) => {
  const app = new Hono<AppEnv>()

  app.use('/api/*', async (context, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
      return await next()
    }
    const origin = context.req.header('Origin')
    if (origin && origin !== appOrigin) {
      return apiError(context, 403, 'forbidden', 'Cross-origin request rejected')
    }
    const fetchSite = context.req.header('Sec-Fetch-Site')
    if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
      return apiError(context, 403, 'forbidden', 'Cross-site request rejected')
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
      sameSite: 'Lax',
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
      return apiError(context, 400, 'invalid_request', 'DeepSeek rejected the API key')
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

  app.post(apiRoutes.chat, requireAuth, async (context) => {
    const user = context.get('auth').user
    if (!user.apiKey) {
      return apiError(context, 409, 'api_key_missing', 'A DeepSeek API key is required')
    }
    const json = await readJson(context)
    const parsed = json.ok ? ChatProxyRequestSchema.safeParse(json.value) : null
    if (!parsed?.success) {
      return apiError(context, 400, 'invalid_request', 'Invalid chat request')
    }

    const apiKey = await security.decryptApiKey(user.id, user.apiKey).catch(() => null)
    if (!apiKey) {
      return apiError(context, 500, 'credential_error', 'Stored API key could not be decrypted')
    }

    const clientSignal = context.req.raw.signal
    const signal =
      requestTimeoutMs > 0
        ? AbortSignal.any([clientSignal, AbortSignal.timeout(requestTimeoutMs)])
        : clientSignal
    const requestBody = { ...parsed.data, stream: true }
    const headers: Record<string, string> = {
      'x-api-key': apiKey,
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
      if (clientSignal.aborted) {
        return new Response(null, { status: 499 })
      }
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return apiError(context, 504, 'upstream_error', 'DeepSeek request timed out')
      }
      return apiError(context, 502, 'upstream_error', 'DeepSeek request failed')
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
