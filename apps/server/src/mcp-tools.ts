import type { McpToolSummary } from '@sweet-deepseek/contracts/mcp'
import { MCP_PUBLIC_TOOL_NAME_MAX_LENGTH } from '@sweet-deepseek/contracts/mcp'
import type { McpRemoteTool } from './mcp-client.js'
import type { McpServerRecord } from './mcp-store.js'

const PUBLIC_TOOL_PREFIX = 'mcp__'
const INVALID_PUBLIC_NAME_CHARS = /[^A-Za-z0-9_-]/gu
const HASH_LENGTH = 12

const hashIdentity = async (slug: string, rawName: string): Promise<string> => {
  const bytes = new TextEncoder().encode(`${slug}\0${rawName}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest.slice(0, HASH_LENGTH / 2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export const publicMcpToolName = async (slug: string, rawName: string): Promise<string> => {
  const joined = `${PUBLIC_TOOL_PREFIX}${slug}__${rawName}`
  const normalized = joined.replace(INVALID_PUBLIC_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MCP_PUBLIC_TOOL_NAME_MAX_LENGTH) {
    return normalized
  }
  const hash = await hashIdentity(slug, rawName)
  return `${normalized.slice(0, MCP_PUBLIC_TOOL_NAME_MAX_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

export const toMcpToolSummaries = async (
  server: McpServerRecord,
  tools: McpRemoteTool[]
): Promise<McpToolSummary[]> => {
  const names = new Set<string>()
  const summaries: McpToolSummary[] = []
  for (const tool of tools) {
    const name = await publicMcpToolName(server.slug, tool.name)
    if (names.has(name)) {
      throw new Error(`MCP tool name collision: ${name}`)
    }
    names.add(name)
    summaries.push({
      name,
      rawName: tool.name,
      serverId: server.id,
      serverSlug: server.slug,
      serverName: server.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      readOnly: tool.readOnly,
      requiresApproval: server.trustMode !== 'trust-hints' || !tool.readOnly,
    })
  }
  return summaries
}
