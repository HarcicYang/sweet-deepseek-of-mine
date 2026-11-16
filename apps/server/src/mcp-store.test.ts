import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FileMcpStore } from './mcp-store.js'

test('file-backed MCP records default existing servers to prompt mode', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sweet-deepseek-mcp-'))
  const filePath = path.join(directory, 'mcp.json')
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'server-1',
            userId: 'user-1',
            name: 'Legacy MCP',
            slug: 'legacy',
            url: 'https://mcp.example.com/mcp',
            authMode: 'oauth',
            enabled: true,
            encryptedHeaders: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    )
    const store = new FileMcpStore(filePath)
    const servers = await store.listServers('user-1')
    assert.equal(servers[0]?.authMode, 'oauth')
    assert.equal(servers[0]?.trustMode, 'prompt')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
