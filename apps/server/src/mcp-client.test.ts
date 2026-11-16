import assert from 'node:assert/strict'
import test from 'node:test'
import type { FetchLike } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { createMcpClient, McpApprovalRequiredError } from './mcp-client.js'
import { McpOAuthProvider } from './mcp-oauth.js'

test('MCP client discovers and calls tools through Streamable HTTP', async () => {
  let authorization: string | null | undefined
  let redirectMode: RequestRedirect | undefined
  const handler = createMcpHandler((context) => {
    authorization ??= context.requestInfo?.headers.get('authorization')
    const server = new McpServer({ name: 'test-mcp', version: '1.0.0' })
    server.registerTool(
      'lookup',
      {
        description: 'Look up a value',
        inputSchema: z.object({ query: z.string() }),
        annotations: { readOnlyHint: true },
      },
      async ({ query }) => ({
        content: [{ type: 'text', text: `found: ${query}` }],
      })
    )
    server.registerTool(
      'write',
      {
        description: 'Write a value',
        inputSchema: z.object({ value: z.string() }),
      },
      async ({ value }) => ({
        content: [{ type: 'text', text: `wrote: ${value}` }],
      })
    )
    return server
  })
  const fetchImpl: FetchLike = async (input, init) => {
    redirectMode ??= init?.redirect
    const request = new Request(String(input), init)
    return await handler.fetch(request)
  }
  const client = createMcpClient({ fetchImpl })
  try {
    const probe = await client.probe({
      url: 'https://mcp.example.test/mcp',
      headers: { Authorization: 'Bearer test-secret' },
      trustMode: 'trust-hints',
    })
    assert.equal(probe.ok, true)
    if (!probe.ok) {
      return
    }
    assert.equal(probe.server.name, 'test-mcp')
    assert.deepEqual(
      probe.tools.map((tool) => [tool.name, tool.readOnly]),
      [
        ['lookup', true],
        ['write', false],
      ]
    )
    assert.equal(authorization, 'Bearer test-secret')
    assert.equal(redirectMode, 'manual')

    await assert.rejects(
      client.callTool(
        { url: 'https://mcp.example.test/mcp', headers: {}, trustMode: 'prompt' },
        'lookup',
        { query: 'hello' },
        false
      ),
      McpApprovalRequiredError
    )

    const result = await client.callTool(
      { url: 'https://mcp.example.test/mcp', headers: {}, trustMode: 'trust-hints' },
      'lookup',
      { query: 'hello' },
      false
    )
    assert.equal(result.isError, false)
    assert.deepEqual(result.content, [{ type: 'text', text: 'found: hello' }])

    await assert.rejects(
      client.callTool(
        { url: 'https://mcp.example.test/mcp', headers: {}, trustMode: 'trust-hints' },
        'write',
        { value: 'hello' },
        false
      ),
      McpApprovalRequiredError
    )
    const approved = await client.callTool(
      { url: 'https://mcp.example.test/mcp', headers: {}, trustMode: 'trust-hints' },
      'write',
      { value: 'hello' },
      true
    )
    assert.deepEqual(approved.content, [{ type: 'text', text: 'wrote: hello' }])
  } finally {
    await handler.close()
  }
})

test('MCP OAuth helper runs discovery, authorization, and token exchange', async () => {
  const requests: string[] = []
  const fetchImpl: FetchLike = async (input, init) => {
    const request = new Request(String(input), init)
    requests.push(`${request.method} ${request.url}`)
    const { pathname } = new URL(request.url)
    if (pathname === '/.well-known/oauth-protected-resource') {
      return Response.json({
        resource: 'https://mcp.example.test/mcp',
        authorization_servers: ['https://auth.example.test'],
        scopes_supported: ['mcp'],
      })
    }
    if (pathname === '/.well-known/oauth-authorization-server') {
      return Response.json({
        issuer: 'https://auth.example.test',
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        registration_endpoint: 'https://auth.example.test/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['mcp'],
      })
    }
    if (pathname === '/register') {
      return Response.json({
        client_id: 'client-1',
        redirect_uris: ['https://app.example.test/api/mcp/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      })
    }
    if (pathname === '/token') {
      return Response.json({
        access_token: 'access-1',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-1',
        scope: 'mcp',
      })
    }
    return new Response('not found', { status: 404 })
  }
  const provider = new McpOAuthProvider({
    state: 'state-1',
    redirectUrl: 'https://app.example.test/api/mcp/oauth/callback',
    persist: async () => undefined,
  })
  const client = createMcpClient({ fetchImpl })

  const result = await client.beginOAuth(
    {
      url: 'https://mcp.example.test/mcp',
      headers: {},
      trustMode: 'prompt',
      authProvider: provider,
    },
    provider
  )
  assert.equal(result, 'REDIRECT')
  const authorizationUrl = provider.getAuthorizationUrl()
  assert.ok(authorizationUrl)
  assert.equal(new URL(authorizationUrl).searchParams.get('state'), 'state-1')

  await client.completeOAuth(
    {
      url: 'https://mcp.example.test/mcp',
      headers: {},
      trustMode: 'prompt',
      authProvider: provider,
    },
    provider,
    new URL(`${authorizationUrl}&code=code-1`).searchParams
  )
  assert.equal(provider.snapshot().tokens?.access_token, 'access-1')
  assert.equal(provider.snapshot().tokens?.refresh_token, 'refresh-1')
  assert.ok(requests.some((request) => request.endsWith('/register')))
  assert.ok(requests.some((request) => request.endsWith('/token')))
})

test('MCP OAuth helper supports a pre-registered client without DCR', async () => {
  const requests: string[] = []
  let tokenBody = ''
  const fetchImpl: FetchLike = async (input, init) => {
    const request = new Request(String(input), init)
    requests.push(`${request.method} ${request.url}`)
    const { pathname } = new URL(request.url)
    if (
      pathname === '/.well-known/oauth-protected-resource' ||
      pathname === '/.well-known/oauth-protected-resource/mcp'
    ) {
      return Response.json({
        resource: 'https://mcp.example.test/mcp',
        authorization_servers: ['https://auth.example.test'],
        scopes_supported: ['repo', 'read:user'],
      })
    }
    if (pathname === '/.well-known/oauth-authorization-server') {
      return Response.json({
        issuer: 'https://auth.example.test',
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        scopes_supported: ['repo', 'read:user'],
      })
    }
    if (pathname === '/token') {
      tokenBody = await request.text()
      return Response.json({
        access_token: 'access-preregistered',
        token_type: 'Bearer',
        scope: 'repo read:user',
      })
    }
    return new Response('not found', { status: 404 })
  }
  const provider = new McpOAuthProvider({
    state: 'state-preregistered',
    redirectUrl: 'https://app.example.test/api/mcp/oauth/callback',
    clientInformation: {
      client_id: 'client-preregistered',
      client_secret: 'secret-preregistered',
      redirect_uris: ['https://app.example.test/api/mcp/oauth/callback'],
      token_endpoint_auth_method: 'client_secret_post',
    },
    clientAuthMethod: 'client_secret_post',
    persist: async () => undefined,
  })
  const client = createMcpClient({ fetchImpl })

  const result = await client.beginOAuth(
    {
      url: 'https://mcp.example.test/mcp',
      headers: {},
      trustMode: 'prompt',
      authProvider: provider,
    },
    provider
  )
  assert.equal(result, 'REDIRECT')
  const authorizationUrl = provider.getAuthorizationUrl()
  assert.ok(authorizationUrl)
  assert.equal(new URL(authorizationUrl).searchParams.get('client_id'), 'client-preregistered')
  assert.equal(
    requests.some((request) => request.endsWith('/register')),
    false
  )

  await client.completeOAuth(
    {
      url: 'https://mcp.example.test/mcp',
      headers: {},
      trustMode: 'prompt',
      authProvider: provider,
    },
    provider,
    new URL(`${authorizationUrl}&code=code-preregistered`).searchParams
  )
  assert.equal(provider.snapshot().tokens?.access_token, 'access-preregistered')
  assert.match(tokenBody, /client_id=client-preregistered/u)
  assert.match(tokenBody, /client_secret=secret-preregistered/u)
})
