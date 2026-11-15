import assert from 'node:assert/strict'
import test from 'node:test'
import { apiRoutes } from '@sweet-deepseek/contracts/api'
import { MemoryAccountStore } from './account-store.js'
import { createApp } from './app.js'
import { createSecurityService } from './security.js'

const APP_ORIGIN = 'http://localhost:8090'
const MASTER_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
const SSE_BODY = 'event: message_stop\ndata: {"type":"message_stop"}\n\n'

const cookieValue = (setCookie: string | null, name: string): string | null => {
  if (!setCookie) {
    return null
  }
  const match = new RegExp(`${name}=([^;,\\s]+)`, 'u').exec(setCookie)
  return match?.[1] ?? null
}

const createTestApp = async () => {
  const security = await createSecurityService(MASTER_KEY)
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    calls.push({ url, init })
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json({ access_token: 'github-access-token' })
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: 12345,
        login: 'octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/12345',
      })
    }
    if (url === 'https://api.deepseek.test/anthropic/v1/messages') {
      return new Response(SSE_BODY, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    if (url === 'https://api.deepseek.test/models') {
      return Response.json({ data: [] })
    }
    return new Response('unexpected request', { status: 500 })
  }
  const app = createApp({
    store: new MemoryAccountStore(),
    security,
    appOrigin: APP_ORIGIN,
    githubClientId: 'github-client-id',
    githubClientSecret: 'github-client-secret',
    githubCallbackUrl: `${APP_ORIGIN}${apiRoutes.githubCallback}`,
    deepSeekBaseUrl: 'https://api.deepseek.test',
    requestTimeoutMs: 60_000,
    sessionTtlMs: 24 * 60 * 60 * 1000,
    cookieSecure: false,
    fetchImpl,
  })
  return { app, calls }
}

test('GitHub OAuth creates an authenticated server session', async () => {
  const { app, calls } = await createTestApp()
  const start = await app.request(`${APP_ORIGIN}${apiRoutes.githubStart}`)
  const state = cookieValue(start.headers.get('set-cookie'), 'sdom_oauth_state')
  assert.equal(start.status, 302)
  assert.ok(state)
  assert.match(
    start.headers.get('location') ?? '',
    /^https:\/\/github\.com\/login\/oauth\/authorize\?/u
  )

  const callback = await app.request(
    `${APP_ORIGIN}${apiRoutes.githubCallback}?code=oauth-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: `sdom_oauth_state=${state}` } }
  )
  const sessionToken = cookieValue(callback.headers.get('set-cookie'), 'sdom_session')
  assert.equal(callback.status, 302)
  assert.ok(sessionToken)
  assert.equal(calls.filter((call) => call.url === 'https://api.github.com/user').length, 1)

  const session = await app.request(`${APP_ORIGIN}${apiRoutes.session}`, {
    headers: { Cookie: `sdom_session=${sessionToken}` },
  })
  assert.equal(session.status, 200)
  const sessionBody = (await session.json()) as {
    user: { id: string; githubLogin: string; avatarUrl: string | null; hasApiKey: boolean }
  }
  assert.match(sessionBody.user.id, /^[0-9a-f-]{36}$/u)
  assert.equal(sessionBody.user.githubLogin, 'octocat')
  assert.equal(sessionBody.user.avatarUrl, 'https://avatars.githubusercontent.com/u/12345')
  assert.equal(sessionBody.user.hasApiKey, false)
})

test('API key storage and chat proxy keep credentials on the server', async () => {
  const { app, calls } = await createTestApp()
  const start = await app.request(`${APP_ORIGIN}${apiRoutes.githubStart}`)
  const state = cookieValue(start.headers.get('set-cookie'), 'sdom_oauth_state')
  assert.ok(state)
  const callback = await app.request(
    `${APP_ORIGIN}${apiRoutes.githubCallback}?code=oauth-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: `sdom_oauth_state=${state}` } }
  )
  const sessionToken = cookieValue(callback.headers.get('set-cookie'), 'sdom_session')
  assert.ok(sessionToken)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }

  const saveKey = await app.request(`${APP_ORIGIN}${apiRoutes.deepseekKey}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ apiKey: 'sk-test-key' }),
  })
  assert.equal(saveKey.status, 200)
  assert.deepEqual(await saveKey.json(), { configured: true })

  const chat = await app.request(`${APP_ORIGIN}${apiRoutes.chat}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'deepseek-flash',
      system: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'disabled' },
      tools: [],
      safety_check: { level: 'high' },
    }),
  })
  assert.equal(chat.status, 200)
  assert.equal(await chat.text(), SSE_BODY)

  const upstream = calls.find(
    (call) => call.url === 'https://api.deepseek.test/anthropic/v1/messages'
  )
  assert.ok(upstream)
  const upstreamHeaders = new Headers(upstream.init?.headers)
  assert.equal(upstreamHeaders.get('x-api-key'), 'sk-test-key')
  assert.equal(JSON.parse(String(upstream.init?.body)).stream, true)
})

test('cross-origin writes are rejected before authentication', async () => {
  const { app } = await createTestApp()
  const response = await app.request(`${APP_ORIGIN}${apiRoutes.logout}`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
  })
  assert.equal(response.status, 403)
})
