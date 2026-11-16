import assert from 'node:assert/strict'
import test from 'node:test'
import type { FetchLike } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { createMcpClient, McpApprovalRequiredError } from './mcp-client.js'

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

    const result = await client.callTool(
      { url: 'https://mcp.example.test/mcp', headers: {} },
      'lookup',
      { query: 'hello' },
      false
    )
    assert.equal(result.isError, false)
    assert.deepEqual(result.content, [{ type: 'text', text: 'found: hello' }])

    await assert.rejects(
      client.callTool(
        { url: 'https://mcp.example.test/mcp', headers: {} },
        'write',
        { value: 'hello' },
        false
      ),
      McpApprovalRequiredError
    )
    const approved = await client.callTool(
      { url: 'https://mcp.example.test/mcp', headers: {} },
      'write',
      { value: 'hello' },
      true
    )
    assert.deepEqual(approved.content, [{ type: 'text', text: 'wrote: hello' }])
  } finally {
    await handler.close()
  }
})
