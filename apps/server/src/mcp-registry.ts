import {
  McpRegistryServersResponseSchema,
  type McpRegistryRemote,
  type McpRegistryServer,
} from '@sweet-deepseek/contracts/mcp'
import { assertAllowedMcpUrl } from './mcp-policy.js'

const OFFICIAL_REGISTRY_ORIGIN = 'https://registry.modelcontextprotocol.io'
const REGISTRY_OFFICIAL_META = 'io.modelcontextprotocol.registry/official'
const REGISTRY_REQUEST_TIMEOUT_MS = 15_000
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u
const BLOCKED_HEADER_NAMES = new Set([
  '__proto__',
  'connection',
  'constructor',
  'content-length',
  'host',
  'prototype',
  'transfer-encoding',
  'upgrade',
])

export class McpRegistrySearchTooShortError extends Error {
  constructor() {
    super('Official MCP Registry search requires at least 3 characters')
    this.name = 'McpRegistrySearchTooShortError'
  }
}

export class McpRegistryUpstreamError extends Error {
  constructor() {
    super('Official MCP Registry request failed')
    this.name = 'McpRegistryUpstreamError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const readHttpsUrl = (value: unknown): string | null => {
  const raw = readString(value)
  if (!raw) {
    return null
  }
  try {
    const url = assertAllowedMcpUrl(raw, false)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const readRegistryRemote = (value: unknown): McpRegistryRemote | null => {
  if (!isRecord(value) || value.type !== 'streamable-http') {
    return null
  }
  const url = readHttpsUrl(value.url)
  if (!url) {
    return null
  }
  const headers = Array.isArray(value.headers) ? value.headers : []
  const requiredHeaderNames = [
    ...new Set(
      headers.flatMap((header) => {
        if (!isRecord(header)) {
          return []
        }
        const name = readString(header.name)
        if (
          !name ||
          name.length > 128 ||
          !HEADER_NAME_PATTERN.test(name) ||
          BLOCKED_HEADER_NAMES.has(name.toLowerCase())
        ) {
          return []
        }
        const required = header.isRequired === true || header.isSecret === true
        const authorization = name.toLowerCase() === 'authorization'
        return required || authorization ? [name] : []
      })
    ),
  ].sort()
  return {
    url,
    requiredHeaderNames,
    requiresAuthentication: requiredHeaderNames.length > 0,
  }
}

const readRegistryServer = (value: unknown): McpRegistryServer | null => {
  if (!isRecord(value) || !isRecord(value.server) || !isRecord(value._meta)) {
    return null
  }
  const official = value._meta[REGISTRY_OFFICIAL_META]
  if (!isRecord(official) || official.status !== 'active') {
    return null
  }
  const server = value.server
  const registryName = readString(server.name)
  const version = readString(server.version)
  if (!registryName || !version) {
    return null
  }
  const remotes = Array.isArray(server.remotes)
    ? server.remotes.flatMap((remote) => {
        const parsed = readRegistryRemote(remote)
        return parsed ? [parsed] : []
      })
    : []
  const uniqueRemotes = remotes.filter(
    (remote, index) => remotes.findIndex((candidate) => candidate.url === remote.url) === index
  )
  if (uniqueRemotes.length === 0) {
    return null
  }
  const fallbackTitle = registryName.split('/').at(-1) ?? registryName
  const title = readString(server.title) ?? fallbackTitle
  const description = readString(server.description)?.slice(0, 4000) ?? ''
  const publisherName = registryName.includes('/') ? registryName.split('/')[0] : registryName
  const publisher = publisherName || registryName
  const repositoryUrl =
    isRecord(server.repository) && typeof server.repository.url === 'string'
      ? readHttpsUrl(server.repository.url)
      : null
  const updatedAt =
    readString(official.updatedAt) ??
    readString(official.publishedAt) ??
    readString(official.statusChangedAt)
  return {
    registryName,
    publisher: publisher.slice(0, 256),
    title: title.slice(0, 200),
    description,
    version: version.slice(0, 128),
    updatedAt,
    repositoryUrl,
    remotes: uniqueRemotes.slice(0, 10),
  }
}

export type FetchMcpRegistryOptions = {
  search?: string
  cursor?: string
  limit?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export const fetchOfficialMcpRegistryServers = async ({
  search = '',
  cursor,
  limit = 30,
  signal,
  fetchImpl = fetch,
}: FetchMcpRegistryOptions = {}) => {
  const endpoint = new URL('/v0.1/servers', OFFICIAL_REGISTRY_ORIGIN)
  endpoint.searchParams.set('version', 'latest')
  endpoint.searchParams.set('limit', String(limit))
  if (search) {
    endpoint.searchParams.set('search', search)
  }
  if (cursor) {
    endpoint.searchParams.set('cursor', cursor)
  }
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(REGISTRY_REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(REGISTRY_REQUEST_TIMEOUT_MS)
  const response = await fetchImpl(endpoint, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: requestSignal,
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new McpRegistryUpstreamError()
    }
    throw error
  })
  if (response.status === 422) {
    throw new McpRegistrySearchTooShortError()
  }
  if (!response.ok) {
    throw new McpRegistryUpstreamError()
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!isRecord(payload) || !Array.isArray(payload.servers)) {
    throw new McpRegistryUpstreamError()
  }
  const servers = payload.servers.flatMap((server) => {
    const parsed = readRegistryServer(server)
    return parsed ? [parsed] : []
  })
  const metadata = isRecord(payload.metadata) ? payload.metadata : {}
  return McpRegistryServersResponseSchema.parse({
    servers,
    nextCursor: readString(metadata.nextCursor),
    search,
  })
}
