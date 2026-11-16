import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchOfficialMcpRegistryServers, McpRegistrySearchTooShortError } from './mcp-registry.js'

const activeMeta = {
  'io.modelcontextprotocol.registry/official': {
    status: 'active',
    updatedAt: '2026-11-16T08:00:00Z',
  },
}

test('official MCP Registry results keep only active Streamable HTTP remotes', async () => {
  let requestedUrl = ''
  const response = await fetchOfficialMcpRegistryServers({
    search: 'github',
    limit: 20,
    cursor: 'cursor-1',
    fetchImpl: async (input) => {
      requestedUrl = String(input)
      return Response.json({
        servers: [
          {
            server: {
              name: 'com.example/github',
              title: 'Example GitHub',
              description: 'Example remote server',
              version: '1.2.3',
              repository: { url: 'https://github.com/example/mcp' },
              remotes: [
                {
                  type: 'streamable-http',
                  url: 'https://mcp.example.com/mcp',
                  headers: [
                    {
                      name: 'Authorization',
                      isRequired: true,
                      isSecret: true,
                    },
                  ],
                },
                {
                  type: 'sse',
                  url: 'https://mcp.example.com/sse',
                },
              ],
            },
            _meta: activeMeta,
          },
          {
            server: {
              name: 'com.example/local-only',
              description: 'Only a stdio package',
              version: '1.0.0',
              packages: [{ registryType: 'npm', identifier: 'local-only' }],
            },
            _meta: activeMeta,
          },
          {
            server: {
              name: 'com.example/deprecated',
              description: 'Deprecated server',
              version: '1.0.0',
              remotes: [{ type: 'streamable-http', url: 'https://deprecated.example.com/mcp' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': {
                status: 'deprecated',
              },
            },
          },
        ],
        metadata: { nextCursor: 'cursor-2' },
      })
    },
  })

  const endpoint = new URL(requestedUrl)
  assert.equal(endpoint.pathname, '/v0.1/servers')
  assert.equal(endpoint.searchParams.get('version'), 'latest')
  assert.equal(endpoint.searchParams.get('search'), 'github')
  assert.equal(endpoint.searchParams.get('limit'), '20')
  assert.equal(endpoint.searchParams.get('cursor'), 'cursor-1')
  assert.equal(response.nextCursor, 'cursor-2')
  assert.equal(response.servers.length, 1)
  assert.equal(response.servers[0]?.registryName, 'com.example/github')
  assert.equal(response.servers[0]?.title, 'Example GitHub')
  assert.deepEqual(response.servers[0]?.remotes, [
    {
      url: 'https://mcp.example.com/mcp',
      requiredHeaderNames: ['Authorization'],
      requiresAuthentication: true,
    },
  ])
})

test('official MCP Registry short search errors are mapped explicitly', async () => {
  await assert.rejects(
    fetchOfficialMcpRegistryServers({
      search: 'ab',
      fetchImpl: async () =>
        Response.json({ title: 'Unprocessable Entity', status: 422 }, { status: 422 }),
    }),
    McpRegistrySearchTooShortError
  )
})
