import assert from 'node:assert/strict'
import test from 'node:test'
import { apiRoutes } from '@sweet-deepseek/contracts/api'
import { JSON_RENDER_LIMITS, JSON_RENDER_VERSION } from '@sweet-deepseek/json-render'
import { MemoryAccountStore } from './account-store.js'
import { createApp, type RequestBodyLimits } from './app.js'
import { McpApprovalRequiredError, type McpClient } from './mcp-client.js'
import { MemoryMcpStore } from './mcp-store.js'
import type { McpOAuthClientConfig } from './mcp-oauth-clients.js'
import { MemoryMcpOAuthStore } from './mcp-oauth-store.js'
import { createSecurityService } from './security.js'
import { MemoryShareStore } from './share-store.js'
import { MemorySkillStore } from './skill-store.js'
import { MemorySyncStore } from './sync-store.js'
import { MemoryProviderStore } from './provider-store.js'

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

const createTestApp = async (
  options: {
    allowedOrigins?: string[]
    mcpClient?: McpClient
    mcpOAuthClients?: McpOAuthClientConfig[]
    mcpRegistryFetchImpl?: typeof fetch
    requestBodyLimits?: Partial<RequestBodyLimits>
  } = {}
) => {
  const security = await createSecurityService(MASTER_KEY)
  const store = new MemoryAccountStore()
  const providerStore = new MemoryProviderStore()
  const syncStore = new MemorySyncStore()
  const mcpStore = new MemoryMcpStore()
  const mcpOAuthStore = new MemoryMcpOAuthStore()
  const skillStore = new MemorySkillStore()
  const defaultMcpClient: McpClient = {
    probe: async () => ({
      ok: true,
      server: { name: 'test-mcp', version: '1.0.0' },
      tools: [
        {
          name: 'lookup',
          description: 'Look up a value',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          readOnly: true,
        },
        {
          name: 'write',
          description: 'Write a value',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
          readOnly: false,
        },
      ],
      durationMs: 1,
    }),
    callTool: async (config, rawName, _args, approved) => {
      const readOnly = rawName === 'lookup'
      if (!(config.trustMode === 'trust-hints' && readOnly) && !approved) {
        throw new McpApprovalRequiredError()
      }
      return {
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }
    },
    beginOAuth: async () => 'REDIRECT',
    completeOAuth: async () => undefined,
  }
  const mcpClient = options.mcpClient ?? defaultMcpClient
  const calls: Array<{ url: string; init?: RequestInit; body?: Uint8Array }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    const body =
      init?.body instanceof ReadableStream
        ? new Uint8Array(await new Response(init.body).arrayBuffer())
        : undefined
    calls.push({ url, init, body })
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
    if (url === 'https://api.deepseek.test/anthropic/v1/files') {
      return Response.json({
        id: 'file-1',
        type: 'file',
        size_bytes: 5,
        created_at: '2026-11-15T00:00:00.000Z',
        filename: 'note.txt',
        mime_type: 'text/plain',
      })
    }
    if (url === 'https://api.deepseek.test/anthropic/v1/files/file-1') {
      return new Response(null, { status: 204 })
    }
    if (url === 'https://api.deepseek.test/v1/tools/asr') {
      return Response.json({ text: 'hello from audio' })
    }
    if (url === 'https://api.deepseek.test/v1/tools/search') {
      return Response.json({
        results: [
          {
            rerank_score: 2.5,
            title: 'DeepSeek Search result',
            url: 'https://example.com/search-result',
            snippet: 'A concise result.',
            summary: 'A longer result summary.',
            content: '',
            site_name: 'Example',
            site_icon: 'https://example.com/favicon.ico',
            date: '2026-11-18T00:00:00.000Z',
            authority: 3,
          },
        ],
      })
    }
    if (url === 'https://api.deepseek.test/v1/tools/fetch') {
      return Response.json({
        title: 'Fetched page',
        content: '# Fetched page\n\nPage body.',
      })
    }
    if (url === 'https://api.deepseek.test/v1/tools/tts') {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    }
    return new Response('unexpected request', { status: 500 })
  }
  const app = createApp({
    store,
    providerStore,
    syncStore,
    shareStore: new MemoryShareStore(),
    mcpStore,
    mcpOAuthStore,
    skillStore,
    mcpClient,
    security,
    appOrigin: APP_ORIGIN,
    apiOrigin: APP_ORIGIN,
    githubClientId: 'github-client-id',
    githubClientSecret: 'github-client-secret',
    githubCallbackUrl: `${APP_ORIGIN}${apiRoutes.githubCallback}`,
    mcpOAuthClients: options.mcpOAuthClients ?? [
      {
        resource: 'https://api.githubcopilot.com',
        clientId: 'github-client-id',
        clientSecret: 'github-client-secret',
        redirectUrl: `${APP_ORIGIN}${apiRoutes.githubCallback}`,
        clientAuthMethod: 'client_secret_post',
      },
    ],
    deepSeekBaseUrl: 'https://api.deepseek.test',
    requestTimeoutMs: 60_000,
    requestBodyLimits: options.requestBodyLimits,
    sessionTtlMs: 24 * 60 * 60 * 1000,
    cookieSecure: false,
    allowedOrigins: options.allowedOrigins,
    mcpRegistryFetchImpl: options.mcpRegistryFetchImpl,
    fetchImpl,
    logger: { warn: () => {} },
  })
  return {
    app,
    providerStore,
    calls,
    syncStore,
    mcpStore,
    mcpOAuthStore,
    skillStore,
    mcpClient,
    security,
    store,
  }
}

const authenticate = async (app: Awaited<ReturnType<typeof createTestApp>>['app']) => {
  const start = await app.request(`${APP_ORIGIN}${apiRoutes.githubStart}`)
  const state = cookieValue(start.headers.get('set-cookie'), 'sdom_oauth_state')
  assert.ok(state)
  const callback = await app.request(
    `${APP_ORIGIN}${apiRoutes.githubCallback}?code=oauth-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: `sdom_oauth_state=${state}` } }
  )
  const token = cookieValue(callback.headers.get('set-cookie'), 'sdom_session')
  assert.ok(token)
  return token
}

const authenticateTestUser = async (
  store: MemoryAccountStore,
  security: Awaited<ReturnType<typeof createSecurityService>>,
  profile: { githubId: string; githubLogin: string }
) => {
  const user = await store.upsertGithubUser({ ...profile, avatarUrl: null })
  const token = security.createToken()
  const now = Date.now()
  await store.createSession({
    tokenHash: await security.hashToken(token),
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  })
  return { token, user }
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
  assert.ok(calls.every((call) => call.init?.redirect === 'manual'))

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

test('JSON-Render validation requires auth and rejects unknown nodes', async () => {
  const { app } = await createTestApp()
  const unauthorized = await app.request(`${APP_ORIGIN}${apiRoutes.jsonRenderValidate}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: '{}' }),
  })
  assert.equal(unauthorized.status, 401)

  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const source = JSON.stringify({
    version: JSON_RENDER_VERSION,
    root: {
      type: 'Card',
      title: 'Ready',
      content: [{ type: 'Markdown', value: 'Rendered safely.' }],
    },
  })
  const valid = await app.request(`${APP_ORIGIN}${apiRoutes.jsonRenderValidate}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source }),
  })
  assert.equal(valid.status, 200)
  const body = (await valid.json()) as { document: { root: { type: string } } }
  assert.equal(body.document.root.type, 'Card')

  const invalid = await app.request(`${APP_ORIGIN}${apiRoutes.jsonRenderValidate}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: JSON.stringify({
        version: JSON_RENDER_VERSION,
        root: { type: 'Unknown', value: 'no' },
      }),
    }),
  })
  assert.equal(invalid.status, 400)

  const tooLarge = await app.request(`${APP_ORIGIN}${apiRoutes.jsonRenderValidate}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: ' '.repeat(JSON_RENDER_LIMITS.maxDocumentBytes + 1024) }),
  })
  assert.equal(tooLarge.status, 413)
})

test('Skill CRUD is account-scoped and validates SKILL.md frontmatter', async () => {
  const { app, store, security } = await createTestApp()
  const unauthorized = await app.request(`${APP_ORIGIN}${apiRoutes.skills}`)
  assert.equal(unauthorized.status, 401)

  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const source = `---
name: weekly-review
description: Summarize the week and plan the next one.
whenToUse: When the user asks for a weekly review.
license: MIT
---

Lead with outcomes, then risks, then next actions.
`

  const created = await app.request(`${APP_ORIGIN}${apiRoutes.skills}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      files: [
        { path: 'SKILL.md', content: source },
        { path: 'references/checklist.md', content: '# Checklist\n' },
      ],
      enabled: true,
    }),
  })
  assert.equal(created.status, 201)
  const createdBody = (await created.json()) as {
    skill: {
      id: string
      name: string
      enabled: boolean
      instructions: string
      warnings: Array<{ code: string; keys: string[]; omittedCount: number }>
      files: Array<{ path: string; content: string }>
    }
  }
  assert.equal(createdBody.skill.name, 'weekly-review')
  assert.equal(createdBody.skill.enabled, true)
  assert.match(createdBody.skill.instructions, /next actions/u)
  assert.deepEqual(createdBody.skill.warnings, [
    {
      code: 'unsupported_frontmatter_keys',
      keys: ['license'],
      omittedCount: 0,
    },
  ])
  assert.deepEqual(
    createdBody.skill.files.map((file) => file.path),
    ['SKILL.md', 'references/checklist.md']
  )

  const other = await authenticateTestUser(store, security, {
    githubId: '67890',
    githubLogin: 'other-user',
  })
  const otherHeaders = {
    Cookie: `sdom_session=${other.token}`,
    Origin: APP_ORIGIN,
  }
  const hidden = await app.request(
    `${APP_ORIGIN}${apiRoutes.skill.replace(':skillId', createdBody.skill.id)}`,
    { headers: otherHeaders }
  )
  assert.equal(hidden.status, 404)
  const otherList = await app.request(`${APP_ORIGIN}${apiRoutes.skills}`, {
    headers: otherHeaders,
  })
  assert.deepEqual(((await otherList.json()) as { skills: unknown[] }).skills, [])

  const list = await app.request(`${APP_ORIGIN}${apiRoutes.skills}`, { headers })
  assert.equal(list.status, 200)
  const listBody = (await list.json()) as { skills: Array<{ name: string; enabled: boolean }> }
  assert.deepEqual(
    listBody.skills.map((skill) => [skill.name, skill.enabled]),
    [['weekly-review', true]]
  )

  const updated = await app.request(
    `${APP_ORIGIN}${apiRoutes.skill.replace(':skillId', createdBody.skill.id)}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: false }),
    }
  )
  assert.equal(updated.status, 200)
  const updatedBody = (await updated.json()) as {
    skill: { enabled: boolean; files: Array<{ path: string }> }
  }
  assert.equal(updatedBody.skill.enabled, false)
  assert.equal(updatedBody.skill.files.length, 2)

  const invalid = await app.request(`${APP_ORIGIN}${apiRoutes.skills}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      files: [{ path: 'SKILL.md', content: '# missing frontmatter' }],
      enabled: true,
    }),
  })
  assert.equal(invalid.status, 400)

  const removed = await app.request(
    `${APP_ORIGIN}${apiRoutes.skill.replace(':skillId', createdBody.skill.id)}`,
    { method: 'DELETE', headers }
  )
  assert.equal(removed.status, 204)
})

test('MCP servers are private per user and keep request headers encrypted', async () => {
  const { app, mcpStore, security, store } = await createTestApp()
  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }

  const created = await app.request(`${APP_ORIGIN}${apiRoutes.mcpServers}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Demo MCP',
      slug: 'demo',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer test-secret' },
      enabled: true,
    }),
  })
  assert.equal(created.status, 201)
  const createdBody = (await created.json()) as {
    server: { id: string; headerNames: string[]; trustMode: string }
  }
  assert.deepEqual(createdBody.server.headerNames, ['Authorization'])
  assert.equal(createdBody.server.trustMode, 'prompt')
  assert.doesNotMatch(JSON.stringify(createdBody), /test-secret/u)

  const serverId = createdBody.server.id
  const owner = await store.upsertGithubUser({
    githubId: '12345',
    githubLogin: 'octocat',
    avatarUrl: null,
  })
  const stored = await mcpStore.findServer(owner.id, serverId)
  assert.ok(stored?.encryptedHeaders)
  assert.equal(stored?.trustMode, 'prompt')
  assert.doesNotMatch(JSON.stringify(stored.encryptedHeaders), /test-secret/u)

  const probed = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpServerProbe.replace(':serverId', serverId)}`,
    { method: 'POST', headers }
  )
  assert.equal(probed.status, 200)
  const probeBody = (await probed.json()) as {
    ok: true
    tools: Array<{
      name: string
      rawName: string
      readOnly: boolean
      requiresApproval: boolean
    }>
  }
  assert.equal(probeBody.ok, true)
  assert.deepEqual(
    probeBody.tools.map((tool) => [tool.name, tool.rawName, tool.readOnly, tool.requiresApproval]),
    [
      ['mcp__demo__lookup', 'lookup', true, true],
      ['mcp__demo__write', 'write', false, true],
    ]
  )

  const readOnlyCall = await app.request(`${APP_ORIGIN}${apiRoutes.mcpToolCall}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      serverId,
      rawName: 'lookup',
      arguments: { query: 'hello' },
      approved: false,
    }),
  })
  assert.equal(readOnlyCall.status, 403)

  const trusted = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpServer.replace(':serverId', serverId)}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({ trustMode: 'trust-hints' }),
    }
  )
  assert.equal(trusted.status, 200)

  const trustedProbe = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpServerProbe.replace(':serverId', serverId)}`,
    { method: 'POST', headers }
  )
  assert.equal(trustedProbe.status, 200)
  const trustedProbeBody = (await trustedProbe.json()) as {
    ok: true
    tools: Array<{ rawName: string; requiresApproval: boolean }>
  }
  assert.deepEqual(
    trustedProbeBody.tools.map((tool) => [tool.rawName, tool.requiresApproval]),
    [
      ['lookup', false],
      ['write', true],
    ]
  )

  const trustedReadOnlyCall = await app.request(`${APP_ORIGIN}${apiRoutes.mcpToolCall}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      serverId,
      rawName: 'lookup',
      arguments: { query: 'hello' },
      approved: false,
    }),
  })
  assert.equal(trustedReadOnlyCall.status, 200)
  assert.deepEqual(await trustedReadOnlyCall.json(), {
    content: [{ type: 'text', text: 'result' }],
    isError: false,
  })

  const unapprovedWrite = await app.request(`${APP_ORIGIN}${apiRoutes.mcpToolCall}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      serverId,
      rawName: 'write',
      arguments: { value: 'hello' },
      approved: false,
    }),
  })
  assert.equal(unapprovedWrite.status, 403)

  const second = await authenticateTestUser(store, security, {
    githubId: '67890',
    githubLogin: 'second-user',
  })
  const secondHeaders = {
    Cookie: `sdom_session=${second.token}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const secondList = await app.request(`${APP_ORIGIN}${apiRoutes.mcpServers}`, {
    headers: secondHeaders,
  })
  assert.equal(secondList.status, 200)
  assert.deepEqual(await secondList.json(), { servers: [] })
  const secondProbe = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpServerProbe.replace(':serverId', serverId)}`,
    { method: 'POST', headers: secondHeaders }
  )
  assert.equal(secondProbe.status, 404)
})

test('MCP Registry proxy requires auth and normalizes remote servers', async () => {
  const { app } = await createTestApp({
    mcpRegistryFetchImpl: async () =>
      Response.json({
        servers: [
          {
            server: {
              name: 'io.github.example/remote',
              title: 'Remote Example',
              description: 'Remote MCP server',
              version: '1.0.0',
              remotes: [
                {
                  type: 'streamable-http',
                  url: 'https://mcp.example.test/mcp',
                },
              ],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': {
                status: 'active',
                updatedAt: '2026-11-16T00:00:00Z',
              },
            },
          },
        ],
        metadata: { nextCursor: null },
      }),
  })
  const unauthorized = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpRegistryServers}?search=remote`
  )
  assert.equal(unauthorized.status, 401)

  const sessionToken = await authenticate(app)
  const response = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpRegistryServers}?search=remote&limit=10`,
    { headers: { Cookie: `sdom_session=${sessionToken}` } }
  )
  assert.equal(response.status, 200)
  const body = (await response.json()) as {
    servers: Array<{ registryName: string; remotes: Array<{ url: string }> }>
    nextCursor: string | null
  }
  assert.equal(body.servers[0]?.registryName, 'io.github.example/remote')
  assert.equal(body.servers[0]?.remotes[0]?.url, 'https://mcp.example.test/mcp')
  assert.equal(body.nextCursor, null)
})

test('MCP OAuth start and callback persist an account-scoped authorization state', async () => {
  let seenClientId: string | undefined
  const oauthClient: McpClient = {
    probe: async () => ({
      ok: true,
      server: { name: 'oauth-mcp', version: '1.0.0' },
      tools: [
        {
          name: 'lookup',
          description: 'Look up',
          inputSchema: { type: 'object' },
          readOnly: true,
        },
      ],
      durationMs: 1,
    }),
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
    beginOAuth: async (_config, provider) => {
      seenClientId = (await provider.clientInformation())?.client_id
      const state = await provider.state?.()
      provider.redirectToAuthorization(
        new URL(`https://auth.example.test/authorize?state=${encodeURIComponent(state ?? '')}`)
      )
      return 'REDIRECT'
    },
    completeOAuth: async () => undefined,
  }
  const { app, mcpOAuthStore, security, store } = await createTestApp({
    mcpClient: oauthClient,
    mcpOAuthClients: [
      {
        resource: 'https://mcp.example.test/mcp',
        clientId: 'deployment-client-id',
        clientSecret: 'deployment-client-secret',
        redirectUrl: `${APP_ORIGIN}${apiRoutes.mcpOAuthCallback}`,
        clientAuthMethod: 'client_secret_post',
      },
    ],
  })
  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const created = await app.request(`${APP_ORIGIN}${apiRoutes.mcpServers}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'OAuth MCP',
      slug: 'oauth',
      url: 'https://mcp.example.test/mcp',
      authMode: 'oauth',
      enabled: true,
    }),
  })
  assert.equal(created.status, 201)
  const createdBody = (await created.json()) as {
    server: {
      id: string
      authMode: string
      oauthConnected: boolean
    }
  }
  assert.equal(createdBody.server.authMode, 'oauth')
  assert.equal(createdBody.server.oauthConnected, false)
  assert.doesNotMatch(JSON.stringify(createdBody), /client_secret|clientSecret/u)

  const started = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpServerOAuthStart.replace(':serverId', createdBody.server.id)}`,
    { method: 'POST', headers }
  )
  assert.equal(started.status, 200)
  const startedBody = (await started.json()) as { authorizationUrl: string }
  const state = new URL(startedBody.authorizationUrl).searchParams.get('state')
  assert.ok(state)
  assert.equal(seenClientId, 'deployment-client-id')
  const pending = await mcpOAuthStore.findByState(state)
  assert.ok(pending)
  assert.equal(pending.userId, (await store.findUserById(pending.userId))?.id)

  const second = await authenticateTestUser(store, security, {
    githubId: 'oauth-second',
    githubLogin: 'oauth-second',
  })
  const wrongUserCallback = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpOAuthCallback}?state=${encodeURIComponent(state)}&code=code-1`,
    { headers: { Cookie: `sdom_session=${second.token}` } }
  )
  assert.equal(wrongUserCallback.status, 200)
  assert.match(await wrongUserCallback.text(), /invalid or expired/u)

  const callback = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpOAuthCallback}?state=${encodeURIComponent(state)}&code=code-1`,
    { headers }
  )
  assert.equal(callback.status, 200)
  assert.match(await callback.text(), /MCP authorization completed/u)
  const connected = await mcpOAuthStore.find(pending.userId, createdBody.server.id)
  assert.equal(connected?.connected, true)

  const listed = await app.request(`${APP_ORIGIN}${apiRoutes.mcpServers}`, { headers })
  assert.equal(listed.status, 200)
  const listedBody = (await listed.json()) as {
    servers: Array<{ id: string; oauthConnected: boolean }>
  }
  assert.equal(listedBody.servers[0]?.oauthConnected, true)
})

test('GitHub MCP OAuth reuses the deployment GitHub callback and session', async () => {
  let seenRedirectUrl: string | undefined
  let completed = false
  const oauthClient: McpClient = {
    probe: async () => ({
      ok: true,
      server: { name: 'github-mcp', version: '1.0.0' },
      tools: [],
      durationMs: 1,
    }),
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
    beginOAuth: async (_config, provider) => {
      seenRedirectUrl = provider.redirectUrl?.toString()
      const state = await provider.state?.()
      provider.redirectToAuthorization(
        new URL(`https://github.com/login/oauth/authorize?state=${encodeURIComponent(state ?? '')}`)
      )
      return 'REDIRECT'
    },
    completeOAuth: async () => {
      completed = true
    },
  }
  const { app, mcpOAuthStore } = await createTestApp({ mcpClient: oauthClient })
  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const created = await app.request(`${APP_ORIGIN}${apiRoutes.mcpServers}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'GitHub MCP',
      slug: 'github',
      url: 'https://api.githubcopilot.com/mcp',
      authMode: 'oauth',
      enabled: true,
    }),
  })
  assert.equal(created.status, 201)
  const createdBody = (await created.json()) as { server: { id: string } }

  const started = await app.request(
    `${APP_ORIGIN}${apiRoutes.mcpServerOAuthStart.replace(':serverId', createdBody.server.id)}`,
    { method: 'POST', headers }
  )
  assert.equal(started.status, 200)
  const startedBody = (await started.json()) as { authorizationUrl: string }
  const state = new URL(startedBody.authorizationUrl).searchParams.get('state')
  assert.ok(state)
  assert.equal(seenRedirectUrl, `${APP_ORIGIN}${apiRoutes.githubCallback}`)

  const unauthenticated = await app.request(
    `${APP_ORIGIN}${apiRoutes.githubCallback}?state=${encodeURIComponent(state)}&code=code-1`
  )
  assert.equal(unauthenticated.status, 200)
  assert.match(await unauthenticated.text(), /Sign in again/u)
  assert.equal(completed, false)

  const callback = await app.request(
    `${APP_ORIGIN}${apiRoutes.githubCallback}?state=${encodeURIComponent(state)}&code=code-1`,
    { headers }
  )
  assert.equal(callback.status, 200)
  assert.match(await callback.text(), /MCP authorization completed/u)
  assert.equal(completed, true)
  const connected = await mcpOAuthStore.findByState(state)
  assert.equal(connected, null)
})

test('API key storage and DeepSeek proxies keep credentials on the server', async () => {
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
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
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
  const upstreamBody = JSON.parse(String(upstream.init?.body)) as {
    stream: boolean
    thinking: { type: string }
    output_config?: { effort: string }
    reasoning_effort?: string
  }
  assert.equal(upstreamBody.stream, true)
  assert.deepEqual(upstreamBody.thinking, { type: 'enabled' })
  assert.deepEqual(upstreamBody.output_config, { effort: 'high' })
  assert.equal(upstreamBody.reasoning_effort, undefined)

  const customToolChat = await app.request(`${APP_ORIGIN}${apiRoutes.chat}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'deepseek-flash',
      system: 'test',
      messages: [{ role: 'user', content: 'use the tool' }],
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
      tools: [
        {
          name: 'mcp__demo__lookup',
          description: 'Look up a value',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      safety_check: { level: 'high' },
    }),
  })
  assert.equal(customToolChat.status, 200)
  const customToolRequest = calls
    .filter((call) => call.url === 'https://api.deepseek.test/anthropic/v1/messages')
    .at(-1)
  assert.ok(customToolRequest)
  const customToolBody = JSON.parse(String(customToolRequest.init?.body)) as {
    tools: Array<{ name: string; input_schema: { type: string } }>
  }
  assert.deepEqual(customToolBody.tools, [
    {
      name: 'mcp__demo__lookup',
      description: 'Look up a value',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ])

  const search = await app.request(`${APP_ORIGIN}${apiRoutes.deepseekSearch}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: 'DeepSeek release', count: 5, need_content: false }),
  })
  assert.equal(search.status, 200)
  assert.equal(
    ((await search.json()) as { results: Array<{ title: string }> }).results[0]?.title,
    'DeepSeek Search result'
  )
  const searchUpstream = calls.find(
    (call) => call.url === 'https://api.deepseek.test/v1/tools/search'
  )
  assert.ok(searchUpstream)
  assert.equal(
    new Headers(searchUpstream.init?.headers).get('authorization'),
    'Bearer sk-test-key'
  )
  assert.deepEqual(JSON.parse(String(searchUpstream.init?.body)), {
    query: 'DeepSeek release',
    count: 5,
    need_content: false,
  })

  const fetched = await app.request(`${APP_ORIGIN}${apiRoutes.deepseekFetch}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: 'https://example.com/page' }),
  })
  assert.equal(fetched.status, 200)
  assert.deepEqual(await fetched.json(), {
    title: 'Fetched page',
    content: '# Fetched page\n\nPage body.',
  })
  const fetchUpstream = calls.find(
    (call) => call.url === 'https://api.deepseek.test/v1/tools/fetch'
  )
  assert.ok(fetchUpstream)
  assert.equal(
    new Headers(fetchUpstream.init?.headers).get('authorization'),
    'Bearer sk-test-key'
  )

  const invalidThinking = await app.request(`${APP_ORIGIN}${apiRoutes.chat}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'deepseek-flash',
      system: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'high' },
      tools: [],
      safety_check: { level: 'high' },
    }),
  })
  assert.equal(invalidThinking.status, 400)
  const invalidEffort = await app.request(`${APP_ORIGIN}${apiRoutes.chat}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'deepseek-flash',
      system: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'enabled' },
      output_config: { effort: 'ultra' },
      tools: [],
      safety_check: { level: 'high' },
    }),
  })
  assert.equal(invalidEffort.status, 400)
  const disabledWithEffort = await app.request(`${APP_ORIGIN}${apiRoutes.chat}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'deepseek-flash',
      system: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'disabled' },
      output_config: { effort: 'high' },
      tools: [],
      safety_check: { level: 'high' },
    }),
  })
  assert.equal(disabledWithEffort.status, 400)
  assert.equal(
    calls.filter((call) => call.url === 'https://api.deepseek.test/anthropic/v1/messages').length,
    2
  )

  const uploadForm = new FormData()
  uploadForm.append('purpose', 'user_data')
  uploadForm.append('file', new File(['hello'], 'note.txt', { type: 'text/plain' }))
  const upload = await app.request(`${APP_ORIGIN}${apiRoutes.files}`, {
    method: 'POST',
    headers: { Cookie: `sdom_session=${sessionToken}`, Origin: APP_ORIGIN },
    body: uploadForm,
  })
  assert.equal(upload.status, 200)
  const uploaded = (await upload.json()) as { id: string }
  assert.equal(uploaded.id, 'file-1')
  const upstreamUpload = calls.find(
    (call) => call.url === 'https://api.deepseek.test/anthropic/v1/files'
  )
  assert.ok(upstreamUpload?.body)
  assert.match(
    new Headers(upstreamUpload.init?.headers).get('Content-Type') ?? '',
    /^multipart\/form-data; boundary=/u
  )
  const uploadBody = new TextDecoder().decode(upstreamUpload.body)
  assert.match(uploadBody, /name="purpose"\r\n\r\nuser_data/u)
  assert.match(uploadBody, /name="file"; filename="note.txt"/u)
  assert.match(uploadBody, /\r\n\r\nhello\r\n/u)

  const remove = await app.request(`${APP_ORIGIN}/api/files/file-1`, {
    method: 'DELETE',
    headers: { Cookie: `sdom_session=${sessionToken}`, Origin: APP_ORIGIN },
  })
  assert.equal(remove.status, 204)

  const audioForm = new FormData()
  audioForm.append('file', new File(['audio'], 'recording.wav', { type: 'audio/wav' }))
  const asr = await app.request(`${APP_ORIGIN}${apiRoutes.speechAsr}`, {
    method: 'POST',
    headers: { Cookie: `sdom_session=${sessionToken}`, Origin: APP_ORIGIN },
    body: audioForm,
  })
  assert.equal(asr.status, 200)
  assert.deepEqual(await asr.json(), { text: 'hello from audio' })
  const upstreamAsr = calls.find((call) => call.url === 'https://api.deepseek.test/v1/tools/asr')
  assert.ok(upstreamAsr?.body)
  const asrBody = new TextDecoder().decode(upstreamAsr.body)
  assert.match(asrBody, /name="file"; filename="recording.wav"/u)
  assert.match(asrBody, /\r\n\r\naudio\r\n/u)

  const tts = await app.request(`${APP_ORIGIN}${apiRoutes.speechTts}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text: 'read this',
      voice_id: 'stella',
      format: 'pcm',
      filter_markdown: true,
    }),
  })
  assert.equal(tts.status, 200)
  assert.deepEqual(new Uint8Array(await tts.arrayBuffer()), new Uint8Array([1, 2, 3, 4]))
  assert.ok(calls.every((call) => call.init?.redirect === 'manual'))
})

test('configured JSON body limits reject oversized streams without Content-Length', async () => {
  const { app } = await createTestApp({ requestBodyLimits: { apiKey: 16 } })
  const sessionToken = await authenticate(app)
  const body = new TextEncoder().encode(JSON.stringify({ apiKey: 'sk-too-large' }))
  const response = await app.request(`${APP_ORIGIN}${apiRoutes.deepseekKey}`, {
    method: 'PUT',
    headers: {
      Cookie: `sdom_session=${sessionToken}`,
      Origin: APP_ORIGIN,
      'Content-Type': 'application/json',
    },
    body,
  })
  assert.equal(response.status, 413)
})

test('cross-origin writes are rejected before authentication', async () => {
  const { app } = await createTestApp()
  const response = await app.request(`${APP_ORIGIN}${apiRoutes.logout}`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
  })
  assert.equal(response.status, 403)
})

test('configured frontend origins can use credentialed API requests', async () => {
  const frontendOrigin = 'https://frontend.example'
  const { app } = await createTestApp({ allowedOrigins: [frontendOrigin] })
  const preflight = await app.request(`${APP_ORIGIN}${apiRoutes.session}`, {
    method: 'OPTIONS',
    headers: {
      Origin: frontendOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), frontendOrigin)
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), 'true')

  const response = await app.request(`${APP_ORIGIN}${apiRoutes.logout}`, {
    method: 'POST',
    headers: { Origin: frontendOrigin },
  })
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), frontendOrigin)
})

test('OAuth callback rejects a mismatched state', async () => {
  const { app } = await createTestApp()
  const response = await app.request(
    `${APP_ORIGIN}${apiRoutes.githubCallback}?code=oauth-code&state=wrong`,
    { headers: { Cookie: 'sdom_oauth_state=expected' } }
  )
  assert.equal(response.status, 302)
  assert.match(response.headers.get('location') ?? '', /\?auth=error&reason=oauth_state$/u)
})

test('session sync enforces revisions and deletion tombstones', async () => {
  const { app } = await createTestApp()
  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const payload = {
    schemaVersion: 1,
    id: 'session-sync-1',
    title: 'Sync test',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      {
        id: 'message-sync-1',
        role: 'user',
        content: 'hello',
        files: [],
        createdAt: 1,
      },
    ],
    rootMessageId: null,
  }
  const path = `${APP_ORIGIN}/api/sync/sessions/session-sync-1`
  const first = await app.request(path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ baseRevision: 0, payload }),
  })
  assert.equal(first.status, 200)
  const firstBody = (await first.json()) as {
    session: { revision: number; payload: null }
  }
  assert.equal(firstBody.session.revision, 1)
  assert.equal(firstBody.session.payload, null)

  const loaded = await app.request(path, {
    headers: { Cookie: `sdom_session=${sessionToken}` },
  })
  assert.equal(loaded.status, 200)
  const loadedBody = (await loaded.json()) as {
    session: { revision: number; payload: { title: string } }
  }
  assert.equal(loadedBody.session.revision, 1)
  assert.equal(loadedBody.session.payload.title, 'Sync test')

  const stale = await app.request(path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ baseRevision: 0, payload }),
  })
  assert.equal(stale.status, 409)
  assert.equal(((await stale.json()) as { error: { code: string } }).error.code, 'sync_conflict')

  const removed = await app.request(path, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ baseRevision: 1, deletedAt: 3 }),
  })
  assert.equal(removed.status, 200)
  const removedBody = (await removed.json()) as {
    session: { revision: number; deletedAt: number | null }
  }
  assert.equal(removedBody.session.revision, 2)
  assert.equal(removedBody.session.deletedAt, 3)

  const list = await app.request(`${APP_ORIGIN}${apiRoutes.syncSessions}`, {
    headers: { Cookie: `sdom_session=${sessionToken}` },
  })
  const listBody = (await list.json()) as {
    sessions: Array<{ id: string; revision: number; deletedAt: number | null }>
  }
  assert.equal(listBody.sessions.length, 1)
  assert.equal(listBody.sessions[0]?.id, 'session-sync-1')
  assert.equal(listBody.sessions[0]?.revision, 2)
  assert.equal(listBody.sessions[0]?.deletedAt, 3)

  const cleared = await app.request(`${APP_ORIGIN}${apiRoutes.syncSessions}`, {
    method: 'DELETE',
    headers: {
      Cookie: `sdom_session=${sessionToken}`,
      Origin: APP_ORIGIN,
    },
  })
  assert.equal(cleared.status, 204)
  const emptyList = await app.request(`${APP_ORIGIN}${apiRoutes.syncSessions}`, {
    headers: { Cookie: `sdom_session=${sessionToken}` },
  })
  assert.deepEqual(await emptyList.json(), { sessions: [] })
})

test('creates expiring public share snapshots without file credentials', async () => {
  const { app } = await createTestApp()
  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const session = {
    schemaVersion: 1 as const,
    id: 'shared-session',
    title: 'Shared chat',
    createdAt: 1,
    updatedAt: 2,
    rootMessageId: 'user-1',
    messages: [
      {
        id: 'user-1',
        role: 'user' as const,
        content: 'Share this',
        files: [
          {
            id: 'file-1',
            serverId: 'private-file-id',
            name: 'note.txt',
            size: 4,
            isImage: false,
            mimeType: 'text/plain',
          },
        ],
        createdAt: 1,
        parentId: null,
        selectedChildId: 'assistant-1',
      },
      {
        id: 'assistant-1',
        role: 'assistant' as const,
        createdAt: 2,
        model: 'deepseek-flash' as const,
        prefix: true,
        status: 'done' as const,
        blocks: [
          { type: 'text' as const, text: 'Shared answer' },
          {
            type: 'tool_use' as const,
            id: 'tool-1',
            name: 'mcp__demo__lookup',
            input: { secret: 'private-mcp-argument' },
            startedAt: 2,
            endedAt: 3,
          },
          {
            type: 'tool_result' as const,
            tool_use_id: 'tool-1',
            content: [{ type: 'text' as const, text: 'private-mcp-output' }],
            isError: false,
          },
          {
            type: 'tool_use' as const,
            id: 'skill-1',
            name: 'skill',
            input: { name: 'private-skill' },
            startedAt: 2,
            endedAt: 3,
          },
          {
            type: 'tool_result' as const,
            tool_use_id: 'skill-1',
            content: [
              { type: 'text' as const, text: '<skill_content>LOCAL_SKILL_SECRET</skill_content>' },
            ],
            isError: false,
          },
        ],
        parentId: 'user-1',
      },
    ],
  }

  const created = await app.request(`${APP_ORIGIN}${apiRoutes.shares}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ session, expiresInDays: 2 }),
  })
  assert.equal(created.status, 200)
  const createdBody = (await created.json()) as {
    share: { token: string; url: string; expiresAt: string }
  }
  assert.match(createdBody.share.token, /^[A-Za-z0-9_-]{20,128}$/u)
  assert.match(createdBody.share.expiresAt, /^\d{4}-\d{2}-\d{2}T/u)
  assert.equal(new URL(createdBody.share.url).searchParams.get('share'), createdBody.share.token)

  const shared = await app.request(
    `${APP_ORIGIN}${apiRoutes.sharedSession.replace(':token', createdBody.share.token)}`,
    {
      headers: { Origin: 'https://reader.example' },
    }
  )
  assert.equal(shared.status, 200)
  assert.equal(shared.headers.get('access-control-allow-origin'), '*')
  const sharedBody = (await shared.json()) as {
    share: { session: typeof session }
  }
  assert.equal(sharedBody.share.session.title, 'Shared chat')
  const sharedUserMessage = sharedBody.share.session.messages[0]
  assert.equal(sharedUserMessage?.role, 'user')
  if (sharedUserMessage?.role === 'user') {
    assert.equal(sharedUserMessage.files[0]?.serverId, null)
  }
  assert.equal(JSON.stringify(sharedBody).includes('private-mcp-argument'), false)
  assert.equal(JSON.stringify(sharedBody).includes('private-mcp-output'), false)
  assert.equal(JSON.stringify(sharedBody).includes('LOCAL_SKILL_SECRET'), false)

  const invalid = await app.request(`${APP_ORIGIN}${apiRoutes.shares}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ session, expiresInDays: 0 }),
  })
  assert.equal(invalid.status, 400)
})

test('settings sync advances one revision per account', async () => {
  const { app } = await createTestApp()
  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const path = `${APP_ORIGIN}${apiRoutes.syncSettings}`
  const initial = await app.request(path, {
    headers: { Cookie: `sdom_session=${sessionToken}` },
  })
  assert.deepEqual(await initial.json(), { settings: null })

  const payload = {
    schemaVersion: 4,
    thinkingMode: 'high',
    customInstructions: 'Prefer concise answers.',
    defaultModel: null,
    search: false,
    ttsVoice: 'tide',
    location: { region: 'CN', province: '440000', city: '440300' },
    updatedAt: 100,
  }
  const first = await app.request(path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ baseRevision: 0, payload }),
  })
  assert.equal(first.status, 200)
  const firstBody = (await first.json()) as {
    settings: { revision: number; payload: typeof payload }
  }
  assert.equal(firstBody.settings.revision, 1)
  assert.deepEqual(firstBody.settings.payload, payload)

  const stale = await app.request(path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ baseRevision: 0, payload }),
  })
  assert.equal(stale.status, 409)
  assert.equal(((await stale.json()) as { error: { code: string } }).error.code, 'sync_conflict')

  const updatedPayload = { ...payload, search: true, updatedAt: 200 }
  const updated = await app.request(path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ baseRevision: 1, payload: updatedPayload }),
  })
  assert.equal(updated.status, 200)
  const updatedBody = (await updated.json()) as {
    settings: { revision: number; payload: typeof updatedPayload }
  }
  assert.equal(updatedBody.settings.revision, 2)
  assert.deepEqual(updatedBody.settings.payload, updatedPayload)
})

test('provider profiles are account-scoped and never return API keys', async () => {
  const { app } = await createTestApp()
  const sessionToken = await authenticate(app)
  const headers = {
    Cookie: `sdom_session=${sessionToken}`,
    Origin: APP_ORIGIN,
    'Content-Type': 'application/json',
  }
  const created = await app.request(`${APP_ORIGIN}${apiRoutes.providers}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId: 'custom-openai-completions',
      name: 'Test gateway',
      apiKey: 'provider-secret',
      baseUrl: 'https://gateway.example.test/v1',
      models: [
        {
          id: 'test-model',
          contextWindow: 64_000,
          maxTokens: 8_000,
          input: ['text'],
          reasoning: false,
          thinkingLevels: [],
        },
      ],
    }),
  })
  assert.equal(created.status, 200)
  const createdText = await created.text()
  assert.doesNotMatch(createdText, /provider-secret/)
  const provider = (JSON.parse(createdText) as { provider: { id: string } }).provider

  const listed = await app.request(`${APP_ORIGIN}${apiRoutes.providers}`, {
    headers: { Cookie: `sdom_session=${sessionToken}` },
  })
  assert.equal(listed.status, 200)
  const listedText = await listed.text()
  assert.match(listedText, /Test gateway/)
  assert.doesNotMatch(listedText, /provider-secret/)
  const listedBody = JSON.parse(listedText) as { templates: unknown[] }
  assert.ok(listedBody.templates.length >= 40)

  const deleted = await app.request(
    `${APP_ORIGIN}${apiRoutes.provider.replace(':providerId', provider.id)}`,
    { method: 'DELETE', headers }
  )
  assert.equal(deleted.status, 204)
})
